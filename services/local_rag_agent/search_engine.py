from __future__ import annotations

import logging
import math
import json
import time
from dataclasses import dataclass
from typing import Any, Iterable, List, AsyncIterable, Dict
import asyncio
from .config import settings
from .clients import EmbeddingClient, LlmClient, RerankClient
from .models import AgentDiagnostics, AgentStep, AgentStepFile, QaRequest, QaResponse, SearchHit, SearchResponse, SubQueryResult
from .storage import IndexStorage
from .vector_store import VectorStore, vector_store
import re


logger = logging.getLogger(__name__)


class EmbeddingUnavailableError(RuntimeError):
    """Raised when the embedding backend cannot be reached."""


@dataclass
class QueryRewriteResult:
    original: str
    effective: str
    alternates: list[str]
    applied: bool

    def variants(self, include_original: bool = True, limit: int = 4) -> list[str]:
        ordered: list[str] = []
        seen: set[str] = set()

        def _push(value: str | None) -> None:
            if not value:
                return
            text = value.strip()
            if not text:
                return
            key = text.lower()
            if key in seen:
                return
            seen.add(key)
            ordered.append(text)

        _push(self.effective or self.original)
        for alternate in self.alternates:
            _push(alternate)
        if include_original:
            _push(self.original)
        if not ordered:
            ordered.append(self.original)
        return ordered[:limit]


class StepRecorder:
    def __init__(self, initial: Iterable[AgentStep] | None = None) -> None:
        self.steps: list[AgentStep] = list(initial) if initial else []

    def add(
        self,
        *,
        id: str,
        title: str,
        detail: str | None = None,
        status: str = "complete",
        queries: Iterable[str] | None = None,
        items: Iterable[str] | None = None,
        files: Iterable[AgentStepFile] | None = None,
        duration_ms: int | None = None,
    ) -> None:
        self.steps.append(
            AgentStep(
                id=id,
                title=title,
                detail=detail,
                status=status if status in {"running", "complete", "skipped", "error"} else "complete",
                queries=list(queries or []),
                items=list(items or []),
                files=list(files or []),
                duration_ms=duration_ms,
            )
        )

    def extend(self, steps: Iterable[AgentStep]) -> None:
        self.steps.extend(steps)

    def snapshot(self, summary: str | None = None) -> AgentDiagnostics | None:
        if not self.steps and summary is None:
            return None
        return AgentDiagnostics(steps=list(self.steps), summary=summary)


def _cosine_similarity(a: Iterable[float], b: Iterable[float]) -> float:
    dot = 0.0
    norm_a = 0.0
    norm_b = 0.0
    for x, y in zip(a, b, strict=False):
        dot += x * y
        norm_a += x * x
        norm_b += y * y
    denom = math.sqrt(norm_a) * math.sqrt(norm_b)
    if denom == 0:
        return 0.0
    return dot / denom


class SearchEngine:
    def __init__(
        self,
        storage: IndexStorage,
        embedding_client: EmbeddingClient,
        rerank_client: RerankClient,
        llm_client: LlmClient,
        *,
        vectors: VectorStore = vector_store,
    ) -> None:
        self.storage = storage
        self.embedding_client = embedding_client
        self.rerank_client = rerank_client
        self.llm_client = llm_client
        self.vector_store = vectors

    def _hit_label(self, hit: SearchHit) -> str:
        metadata = hit.metadata or {}
        label = (
            metadata.get("path")
            or metadata.get("file_path")
            or metadata.get("full_path")
            or metadata.get("file_name")
            or metadata.get("name")
            or metadata.get("title")
        )
        return str(label or hit.file_id)

    def _step_files(self, hits: list[SearchHit], limit: int = 3) -> list[AgentStepFile]:
        files: list[AgentStepFile] = []
        for hit in hits[:limit]:
            files.append(AgentStepFile(file_id=hit.file_id, label=self._hit_label(hit), score=hit.score))
        return files

    def _collect_multi_vector_hits(
        self,
        queries: list[str],
        embeddings: list[list[float]],
        limit: int,
        file_ids: list[str] | None = None,
    ) -> tuple[list[SearchHit], list[tuple[str, list[SearchHit]]]]:
        # Collect chunks from all queries (track by chunk_id to avoid exact duplicates)
        seen_chunks: dict[str, SearchHit] = {}
        per_query: list[tuple[str, list[SearchHit]]] = []

        for query, vector in zip(queries, embeddings, strict=False):
            hits = self._vector_hits(query, vector, limit, file_ids=file_ids)
            per_query.append((query, hits))
            for hit in hits:
                # Use chunk_id as key to avoid duplicate chunks, keep highest score
                chunk_key = hit.chunk_id or hit.file_id
                existing = seen_chunks.get(chunk_key)
                if existing is None or hit.score > existing.score:
                    seen_chunks[chunk_key] = hit

        ordered_hits = sorted(seen_chunks.values(), key=lambda item: item.score, reverse=True)
        return ordered_hits, per_query

    async def search(self, query: str, limit: int | None = None, enable_multi_path: bool = True) -> SearchResponse:
        """
        Enhanced search with multi-path retrieval and mandatory keyword matching:

        1. If query is complex (multi-aspect/comparison) AND enable_multi_path is True:
           → Decompose into sub-queries and search in parallel
           → Merge and rerank results

        2. If query has >= 4 terms AND chunks exist with ALL terms:
           → These chunks MUST appear in results (mandatory inclusion)
           → If not enough, supplement with vector search

        3. Otherwise (< 4 terms or no complete matches):
           → Use standard hybrid search
        """
        if limit is None:
            limit = settings.search_result_limit
        
        # Check for multi-path retrieval (complex queries with multiple aspects)
        if enable_multi_path and self._should_use_multi_path(query):
            logger.info(f"🔀 Using multi-path retrieval for: '{query}'")
            try:
                return await self.multi_path_search(query, limit=limit)
            except Exception as e:
                logger.warning(f"Multi-path search failed, falling back to standard: {e}")
                # Fall through to standard search
        
        import re
        # Match @"filename with spaces" or @filename
        file_filters = []
        matches = re.findall(r'@(?:"([^"]+)"|(\S+))', query)
        for m in matches:
            # m is a tuple (quoted_name, simple_name)
            name = m[0] if m[0] else m[1]
            if name:
                file_filters.append(name)

        # Remove the @mentions from the query
        clean_query = re.sub(r'@(?:"[^"]+"| \S+)', '', query).strip()
        # Also clean up any double spaces left behind
        clean_query = re.sub(r'\s+', ' ', clean_query).strip()

        target_file_ids = set()
        if file_filters:
            for fname in file_filters:
                files = self.storage.find_files_by_name(fname)
                for f in files:
                    target_file_ids.add(f.id)

        file_ids_list = list(target_file_ids) if target_file_ids else None

        # Use clean query if filters were found, otherwise keep original
        if file_filters and clean_query:
            query = clean_query

        started = time.perf_counter()
        rewrite = await self._maybe_rewrite_query(query)
        queries_for_embedding = rewrite.variants(include_original=True, limit=4)
        query_summary = (
            f"Expanded to {len(queries_for_embedding)} variants"
            if len(queries_for_embedding) > 1
            else "Using literal query"
        )

        steps = StepRecorder()
        steps.add(
            id="rewrite",
            title="Rewrite queries",
            detail=query_summary,
            queries=queries_for_embedding,
        )

        primary_query = queries_for_embedding[0] if queries_for_embedding else query

        # Count query terms (exclude very short words)
        query_terms = [term.strip().lower() for term in primary_query.split() if len(term.strip()) >= 2]
        num_terms = len(query_terms)

        # STEP 1: Check for mandatory keyword matching (for complex queries)
        if num_terms >= 4:
            # Complex query - try to find chunks with ALL terms
            mandatory_hits = self.storage.search_snippets(primary_query, limit=limit, require_all_terms=True, file_ids=file_ids_list)

            if mandatory_hits:
                # Found chunks with ALL query terms - these MUST be included
                logger.info(f"Found {len(mandatory_hits)} chunks with ALL {num_terms} terms for '{primary_query}'")

                steps.add(
                    id="mandatory_match",
                    title="Complete keyword match",
                    detail=f"Found {len(mandatory_hits)} chunks containing all {num_terms} query terms",
                    files=self._step_files(mandatory_hits[:limit]),
                )

                if len(mandatory_hits) >= limit:
                    # Enough mandatory hits - just rerank them
                    rerank_started = time.perf_counter()
                    reranked = await self._rerank_hits(primary_query, mandatory_hits, limit)
                    rerank_duration = int((time.perf_counter() - rerank_started) * 1000)

                    if reranked:
                        steps.add(
                            id="rerank",
                            title="Rerank complete matches",
                            detail=f"Reordered {len(reranked)} complete keyword matches",
                            files=self._step_files(reranked),
                            duration_ms=rerank_duration,
                        )
                        hits = reranked[:limit]
                    else:
                        hits = mandatory_hits[:limit]
                    
                    # Deduplicate mandatory hits
                    seen_chunk_ids = set()
                    deduplicated_hits = []
                    for hit in hits:
                        chunk_id = hit.chunk_id or hit.file_id
                        if chunk_id not in seen_chunk_ids:
                            seen_chunk_ids.add(chunk_id)
                            deduplicated_hits.append(hit)
                            if len(deduplicated_hits) >= limit:
                                break
                    hits = deduplicated_hits

                    strategy = "mandatory_keywords"
                    latency_ms = int((time.perf_counter() - started) * 1000)
                    diagnostics = steps.snapshot(summary=f"{len(hits)} file(s) with all {num_terms} keywords")

                    return SearchResponse(
                        query=query,
                        hits=hits,
                        rewritten_query=rewrite.effective if rewrite.applied else None,
                        query_variants=rewrite.alternates,
                        strategy=strategy,
                        latency_ms=latency_ms,
                        diagnostics=diagnostics,
                    )
                else:
                    # Not enough mandatory hits - supplement with vector search
                    logger.info(f"Only {len(mandatory_hits)} complete matches (need {limit}), supplementing with vector search")

                    try:
                        embeddings = await self.embedding_client.encode(queries_for_embedding)
                    except Exception as exc:  # noqa: BLE001
                        logger.warning("Embedding service unavailable: %s", exc)
                        # Fall back to just mandatory hits
                        hits = mandatory_hits[:limit]
                        strategy = "mandatory_keywords_only"
                        latency_ms = int((time.perf_counter() - started) * 1000)
                        diagnostics = steps.snapshot(summary=f"{len(hits)} file(s) with keywords (no vector)")

                        return SearchResponse(
                            query=query,
                            hits=hits,
                            rewritten_query=rewrite.effective if rewrite.applied else None,
                            query_variants=rewrite.alternates,
                            strategy=strategy,
                            latency_ms=latency_ms,
                            diagnostics=diagnostics,
                        )

                    if embeddings:
                        paired_queries = queries_for_embedding[: len(embeddings)] or [primary_query]
                        vector_hits, per_query_hits = self._collect_multi_vector_hits(paired_queries, embeddings, limit, file_ids=file_ids_list)

                        steps.add(
                            id="vector_supplement",
                            title="Vector supplement",
                            detail=f"Added {len(vector_hits)} vector candidates to supplement",
                            files=self._step_files(vector_hits[:5]),
                        )

                        # Combine: mandatory hits first, then vector hits (deduplicate by chunk_id)
                        combined_hits = self._mandatory_first_blend(mandatory_hits, vector_hits, limit)

                        # Rerank combined results
                        rerank_started = time.perf_counter()
                        reranked = await self._rerank_hits(primary_query, combined_hits, limit)
                        rerank_duration = int((time.perf_counter() - rerank_started) * 1000)

                        if reranked:
                            steps.add(
                                id="rerank",
                                title="Rerank combined results",
                                detail=f"Reranked {len(combined_hits)} candidates (mandatory + vector)",
                                duration_ms=rerank_duration,
                            )
                            hits = reranked[:limit]
                        else:
                            hits = combined_hits[:limit]

                        strategy = "mandatory_plus_vector"
                        latency_ms = int((time.perf_counter() - started) * 1000)
                        diagnostics = steps.snapshot(summary=f"{len(hits)} file(s) (mandatory keywords + vector)")

                        return SearchResponse(
                            query=query,
                            hits=hits,
                            rewritten_query=rewrite.effective if rewrite.applied else None,
                            query_variants=rewrite.alternates,
                            strategy=strategy,
                            latency_ms=latency_ms,
                            diagnostics=diagnostics,
                        )

        # STEP 2: Standard hybrid search (< 4 terms or no complete matches)
        logger.info(f"Using standard hybrid search for '{query}' ({num_terms} terms)")

        try:
            embeddings = await self.embedding_client.encode(queries_for_embedding)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Embedding service unavailable for query '%s': %s", query, exc)
            raise EmbeddingUnavailableError("embedding service unavailable") from exc

        if not embeddings:
            diagnostics = steps.snapshot(summary="Embedding backend returned no vectors")
            return SearchResponse(
                query=query,
                hits=[],
                rewritten_query=rewrite.effective if rewrite.applied else None,
                query_variants=rewrite.alternates,
                strategy="vector",
                latency_ms=int((time.perf_counter() - started) * 1000),
                diagnostics=diagnostics,
            )

        paired_queries = queries_for_embedding[: len(embeddings)] or [primary_query]
        vector_hits, per_query_hits = self._collect_multi_vector_hits(paired_queries, embeddings, limit, file_ids=file_ids_list)
        total_vector_hits = sum(len(entry[1]) for entry in per_query_hits)

        if total_vector_hits:
            steps.add(
                id="vector",
                title="Vector retrieval",
                detail=f"Collected {total_vector_hits} chunks",
                queries=[entry[0] for entry in per_query_hits],
                items=[f"{entry[0][:80]} → {len(entry[1])} hits" for entry in per_query_hits],
                files=self._step_files(vector_hits),
            )

        hits = vector_hits
        strategy = "vector"

        if hits:
            rerank_started = time.perf_counter()
            reranked = await self._rerank_hits(primary_query, hits, limit)
            rerank_duration = int((time.perf_counter() - rerank_started) * 1000)
            if reranked:
                steps.add(
                    id="rerank",
                    title="Rerank matches",
                    detail=f"Reordered top {min(len(reranked), limit)} candidates",
                    files=self._step_files(reranked),
                    duration_ms=rerank_duration,
                )
                hits = reranked
            lexical_hits = self._lexical_backfill(primary_query, limit, file_ids=file_ids_list)
            if lexical_hits:
                steps.add(
                    id="lexical",
                    title="Lexical backfill",
                    detail=f"Added {len(lexical_hits)} snippet matches",
                    files=self._step_files(lexical_hits),
                )
                hits = self._blend_hits(hits, lexical_hits, limit)
                strategy = "hybrid"
        else:
            lexical_hits = self._lexical_backfill(primary_query, limit, file_ids=file_ids_list)
            if lexical_hits:
                steps.add(
                    id="lexical",
                    title="Lexical fallback",
                    detail=f"Served {len(lexical_hits)} snippet matches",
                    files=self._step_files(lexical_hits),
                )
                hits = lexical_hits[:limit]
                strategy = "lexical"

        # Final deduplication: remove duplicate chunks by chunk_id and similar content
        seen_chunk_ids = set()
        seen_content_hashes = set()  # Hash of first 200 chars to detect near-duplicate content
        deduplicated_hits = []
        for hit in hits:
            chunk_id = hit.chunk_id or hit.file_id
            # Check by chunk_id first
            if chunk_id in seen_chunk_ids:
                continue
            
            # Check by content similarity (hash of snippet/first 200 chars)
            content = (hit.snippet or "")[:200] or (hit.summary or "")[:200]
            content_hash = hash(content.strip().lower())
            if content_hash in seen_content_hashes:
                # Skip if we've seen very similar content (likely duplicate chunk from same page)
                continue
            
            seen_chunk_ids.add(chunk_id)
            seen_content_hashes.add(content_hash)
            deduplicated_hits.append(hit)
            if len(deduplicated_hits) >= limit:
                break
        
        latency_ms = int((time.perf_counter() - started) * 1000)
        diagnostics = steps.snapshot(summary=f"{len(deduplicated_hits)} file(s) ready via {strategy} strategy")
        return SearchResponse(
            query=query,
            hits=deduplicated_hits,
            rewritten_query=rewrite.effective if rewrite.applied else None,
            query_variants=rewrite.alternates,
            strategy=strategy,
            latency_ms=latency_ms,
            diagnostics=diagnostics,
        )

    async def stream_search(self, query: str, limit: int = 10) -> AsyncIterable[str]:
        """
        Progressive/layered search that yields results as they become available.
        
        Stages:
        1. L1: Filename matching (fastest, ~5ms)
        2. L2: Summary search (~20ms)
        3. L3: Metadata search (~50ms)
        4. L4: Hybrid vector search (slowest but most semantic, ~2000ms+)
        
        Yields NDJSON lines with format:
        {"stage": "filename|summary|metadata|hybrid", "hits": [...], "done": bool, "latencyMs": int}
        """
        started = time.perf_counter()
        seen_file_ids: set[str] = set()
        all_hits: list[SearchHit] = []

        def merge_hits(new_hits: list[SearchHit], stage: str) -> list[SearchHit]:
            """Merge new hits, avoiding duplicates by file_id."""
            merged = []
            for hit in new_hits:
                if hit.file_id not in seen_file_ids:
                    seen_file_ids.add(hit.file_id)
                    # Tag the hit with the stage it was found in
                    hit.metadata = hit.metadata or {}
                    hit.metadata["_search_stage"] = stage
                    merged.append(hit)
                    all_hits.append(hit)
            return merged

        def make_response(stage: str, hits: list[SearchHit], done: bool = False) -> str:
            stage_latency = int((time.perf_counter() - started) * 1000)
            return json.dumps({
                "stage": stage,
                "hits": [h.model_dump(by_alias=True) for h in hits],
                "totalHits": len(all_hits),
                "done": done,
                "latencyMs": stage_latency,
            }) + "\n"

        # ======================================
        # L1: Filename matching (fastest)
        # ======================================
        try:
            filename_hits = self.storage.search_files_by_filename(query, limit=limit)
            new_hits = merge_hits(filename_hits, "filename")
            if new_hits:
                logger.info(f"L1 Filename: found {len(new_hits)} new files for '{query}'")
                yield make_response("filename", new_hits)
        except Exception as e:
            logger.warning(f"L1 Filename search failed: {e}")

        # ======================================
        # L2: Summary search
        # ======================================
        try:
            summary_hits = self.storage.search_files_by_summary(query, limit=limit, exclude_file_ids=seen_file_ids)
            new_hits = merge_hits(summary_hits, "summary")
            if new_hits:
                logger.info(f"L2 Summary: found {len(new_hits)} new files for '{query}'")
                yield make_response("summary", new_hits)
        except Exception as e:
            logger.warning(f"L2 Summary search failed: {e}")

        # ======================================
        # L3: Metadata search
        # ======================================
        try:
            metadata_hits = self.storage.search_files_by_metadata(query, limit=limit, exclude_file_ids=seen_file_ids)
            new_hits = merge_hits(metadata_hits, "metadata")
            if new_hits:
                logger.info(f"L3 Metadata: found {len(new_hits)} new files for '{query}'")
                yield make_response("metadata", new_hits)
        except Exception as e:
            logger.warning(f"L3 Metadata search failed: {e}")

        # ======================================
        # L4: Hybrid vector search (semantic)
        # ======================================
        # Only do hybrid search if we haven't found enough results yet
        if len(all_hits) < limit:
            try:
                # Use existing search method for hybrid search
                search_result = await self.search(query, limit=limit, enable_multi_path=False)
                
                # Filter to new files only and include chunk-level results
                hybrid_new_hits: list[SearchHit] = []
                for hit in search_result.hits:
                    if hit.file_id not in seen_file_ids:
                        seen_file_ids.add(hit.file_id)
                        hit.metadata = hit.metadata or {}
                        hit.metadata["_search_stage"] = "hybrid"
                        hybrid_new_hits.append(hit)
                        all_hits.append(hit)
                    elif hit.chunk_id:
                        # Include chunk-level hits even for existing files
                        hit.metadata = hit.metadata or {}
                        hit.metadata["_search_stage"] = "hybrid"
                        hybrid_new_hits.append(hit)

                if hybrid_new_hits:
                    logger.info(f"L4 Hybrid: found {len(hybrid_new_hits)} new results for '{query}'")
                    yield make_response("hybrid", hybrid_new_hits)

            except EmbeddingUnavailableError:
                logger.warning("L4 Hybrid search skipped: embedding service unavailable")
            except Exception as e:
                logger.warning(f"L4 Hybrid search failed: {e}")

        # Final done message
        total_latency = int((time.perf_counter() - started) * 1000)
        yield json.dumps({
            "stage": "complete",
            "hits": [],
            "totalHits": len(all_hits),
            "done": True,
            "latencyMs": total_latency,
        }) + "\n"

    async def answer(self, payload: QaRequest) -> QaResponse:
        # Get search_mode from payload, default to "auto"
        search_mode = getattr(payload, 'search_mode', 'auto')
        
        # Handle "direct" search_mode or "chat" mode - skip document search entirely
        if search_mode == "direct" or payload.mode == "chat":
            system_message = (
                "You are Local Cocoa, a helpful AI assistant for a local document workspace. "
                "You were created at NTU Singapore (Nanyang Technological University).\n\n"
                "Respond to the user naturally and helpfully."
            )
            messages = [
                {"role": "system", "content": system_message},
                {"role": "user", "content": payload.query}
            ]
            logger.info(f"🤖 DIRECT MODE (search_mode={search_mode}, mode={payload.mode}), query_len={len(payload.query)}")
            logger.debug(f"📝 User Query: {payload.query}")
            try:
                completion = await self.llm_client.chat_complete(messages, max_tokens=1024)
                logger.info(f"✅ DIRECT MODE response_len={len(completion)}")
                logger.debug(f"📤 Model Response: {completion}")
            except Exception as e:
                logger.error(f"Chat completion failed: {e}")
                completion = "Unable to contact the language model service."

            return QaResponse(
                answer=completion.strip(),
                hits=[],
                latency_ms=0,
                diagnostics=None
            )

        started = time.perf_counter()
        # Use settings.qa_context_limit as the authoritative limit for context
        limit = settings.qa_context_limit
        try:
            search = await self.search(payload.query, limit=limit)
        except EmbeddingUnavailableError:
            message = "Embedding service unavailable. Restart the local embedding server and try again."
            return QaResponse(answer=message, hits=[], latency_ms=0)
        hits = search.hits
        diagnostics_steps = StepRecorder(search.diagnostics.steps if search.diagnostics else None)
        if not hits:
            diagnostics = diagnostics_steps.snapshot(summary="No matching files yet")
            return QaResponse(
                answer="No matching files yet. Try refreshing the index.",
                hits=[],
                latency_ms=int((time.perf_counter() - started) * 1000),
                rewritten_query=search.rewritten_query,
                query_variants=search.query_variants,
                diagnostics=diagnostics,
            )

        logger.info(f"📝 Retrieved {len(hits)} chunks for QA, query_len={len(payload.query)}")
        logger.debug(f"Query: {payload.query}")
        for idx, hit in enumerate(hits, 1):
            chunk_text = self._chunk_text(hit)
            snippet = chunk_text or hit.snippet or hit.summary
            if not snippet:
                continue
            logger.debug(f"[Chunk {idx}] Score: {hit.score:.3f}, file_id={hit.file_id}, snippet_len={len(snippet)}")

        # Use the TOP chunk for answering - limit context to prevent VLM repetition issues
        context_parts: List[str] = []
        top_n = settings.qa_context_limit
        max_snippet_len = settings.max_snippet_length

        for hit in hits[:top_n]:
            chunk_text = self._chunk_text(hit)

            # For images, combine summary (VLM) and chunk_text (OCR) to provide full context
            kind = hit.metadata.get("kind") if hit.metadata else None
            if kind == "image":
                parts = []
                if hit.summary:
                    parts.append(f"[Image Description]: {hit.summary}")
                if chunk_text:
                    parts.append(f"[Image Text]: {chunk_text}")
                snippet = "\n".join(parts)
                if not snippet:
                    snippet = hit.snippet
            else:
                snippet = chunk_text or hit.snippet or hit.summary

            if not snippet:
                # Try harder to get content - check metadata
                if hit.metadata:
                    # For video segments, try to get segment caption
                    if hit.metadata.get("segment_caption"):
                        snippet = hit.metadata["segment_caption"]
                    # For any file, use name as fallback
                    elif hit.metadata.get("name") or hit.metadata.get("file_name"):
                        snippet = f"File: {hit.metadata.get('name') or hit.metadata.get('file_name')}"

            if snippet:
                source = hit.metadata.get("path") if hit.metadata else None
                label = source or hit.file_id

                # Add citation info based on file type
                citation = ""
                if hit.metadata:
                    logger.debug(f"🔍 Processing hit metadata: {hit.metadata}")
                    kind = hit.metadata.get("kind", "").lower()
                    page_start = hit.metadata.get("page_start")
                    page_end = hit.metadata.get("page_end")
                    page_numbers = hit.metadata.get("page_numbers")
                    logger.debug(f"📄 File type: {kind}, page_start: {page_start}, page_end: {page_end}, page_numbers: {page_numbers}")

                    # PDFs and documents - show page numbers
                    if page_start and page_end:
                        if page_start == page_end:
                            citation = f", Page {page_start}"
                        else:
                            citation = f", Page {page_start}-{page_end}"
                    elif page_numbers and len(page_numbers) > 0:
                        if len(page_numbers) == 1:
                            citation = f", Page {page_numbers[0]}"
                        else:
                            citation = f", Page {page_numbers[0]}-{page_numbers[-1]}"
                    # Videos - extract timestamp from segment_caption
                    elif kind == "video" or hit.metadata.get("segment_index") is not None:
                        if hit.metadata.get("segment_caption"):
                            import re
                            caption = hit.metadata["segment_caption"]
                            # Extract MM:SS timestamp
                            time_match = re.search(r'(\d+:\d+)\s*-\s*(\d+:\d+)', caption)
                            if time_match:
                                citation = f", {time_match.group(1)}-{time_match.group(2)}"

                logger.debug(f"✅ Final citation: '{citation}' for {label}")
                context_parts.append(f"{label}{citation}\n{snippet[:max_snippet_len]}")

        # If still no context, use file names as fallback
        if not context_parts and hits:
            for hit in hits[:3]:
                source = hit.metadata.get("path") if hit.metadata else None
                label = source or hit.file_id
                context_parts.append(f"Source: {label}")
        context = "\n\n".join(context_parts)
        logger.info(f"📤 Sending top {len(context_parts)} chunks to LLM ({len(context)} chars)")
        if not context:
            logger.warning("⚠️  WARNING: Empty context! Using hits info as fallback")

        # Use chat API for better VLM responses
        # Check if this was a multi-path query for specialized prompting
        is_multi_path = search.strategy == "multi_path" and search.sub_queries
        
        if is_multi_path:
            # Specialized prompt for multi-aspect queries
            system_message = (
                "You are a helpful assistant for a local document workspace. "
                "The user's question involves multiple aspects/entities. "
                "Answer each aspect separately and then provide a synthesized summary.\n"
                "Answer based ONLY on the provided context.\n"
                "Be concise and cite sources using [1], [2] format.\n"
                "If information for some aspects is not found, mention which aspects are missing.\n"
                "Structure your answer clearly to address each part of the question."
            )
            
            # Include sub-query info in the prompt
            sub_query_info = "\n".join(f"- {sq}" for sq in search.sub_queries)
            user_message = (
                f"Question: {payload.query}\n\n"
                f"This question was decomposed into:\n{sub_query_info}\n\n"
                f"Context:\n{context}\n\n"
                "Answer each aspect and provide a summary:"
            )
        else:
            system_message = (
                "You are a helpful assistant for a local document workspace. "
                "Answer the user's question based ONLY on the provided context (including document summaries and image descriptions).\n"
                "If the query is a keyword search, summarize the relevant information found in the context.\n"
                "If the answer is found, be concise (2-3 sentences) and cite sources using [1], [2] format.\n"
                "If the answer is NOT in the context, state 'I cannot find the answer in your files.' ONCE and stop. Do NOT repeat this phrase.\n"
                "Do NOT add the 'not found' statement if you have provided relevant information."
            )
            user_message = (
                f"Question: {payload.query}\n\n"
                f"Context:\n{context}\n\n"
                "Answer:"
            )

        messages = [
            {"role": "system", "content": system_message},
            {"role": "user", "content": user_message}
        ]

        sub_query_count = len(search.sub_queries) if is_multi_path else 0
        logger.info(f"🤖 LLM request: hits={len(hits)}, context_len={len(context)}, multi_path={is_multi_path}, sub_queries={sub_query_count}")
        logger.debug(f"📝 User Query: {payload.query}")
        logger.debug(f"📨 Messages: {json.dumps(messages, indent=2, ensure_ascii=False)}")
        try:
            completion = await self.llm_client.chat_complete(
                messages,
                max_tokens=1024,
                repeat_penalty=1.2,
            )
            logger.info(f"✅ LLM response_len={len(completion)}")
            logger.debug(f"📤 Model Response: {completion}")
        except Exception as e:
            logger.error(f"Chat completion failed: {e}")
            completion = "Unable to contact the language model service."
        if is_multi_path:
            diagnostics_steps.add(
                id="answer",
                title="Compose multi-path answer",
                detail=f"LLM synthesised response from {len(search.sub_queries)} sub-queries",
                files=self._step_files(hits),
            )
            summary = f"Multi-path answer ready ({len(search.sub_queries)} sub-queries)"
        else:
            diagnostics_steps.add(
                id="answer",
                title="Compose answer",
                detail="LLM synthesised response from retrieved files",
                files=self._step_files(hits),
            )
            summary = "Answer ready"
        
        return QaResponse(
            answer=completion.strip(),
            hits=hits,
            latency_ms=int((time.perf_counter() - started) * 1000),
            rewritten_query=search.rewritten_query,
            query_variants=search.query_variants,
            diagnostics=diagnostics_steps.snapshot(summary=summary),
        )

    def _detect_document_intent_by_rules(self, query: str) -> bool:
        """
        Rule-based shortcut to detect document intent.
        Returns True if the query clearly refers to documents.
        This avoids unnecessary LLM calls for obvious cases.
        """
        query_lower = query.lower().strip()
        
        # Pattern 1: @ mentions (file references)
        if "@" in query:
            return True
        
        # Pattern 2: Common file extensions
        file_extensions = [".pdf", ".doc", ".docx", ".txt", ".md", ".csv", ".xlsx", ".xls", ".ppt", ".pptx"]
        for ext in file_extensions:
            if ext in query_lower:
                return True
        
        # # Pattern 3: Document-related keywords
        # document_keywords = [
        #     "document", "file", "report", "paper", "article", "pdf", 
        #     "summary", "summarize", "summarise", "extract", "find in",
        #     "search for", "look up", "what does", "according to",
        #     "in the", "from the", "based on the", "refer to",
        #     "uploaded", "my files", "my documents"
        # ]
        # for keyword in document_keywords:
        #     if keyword in query_lower:
        #         return True
        
        return False

    async def query_intent_routing(self, query: str, max_retries: int = 3) -> Dict[str, Any]:
        """
        Route query to appropriate handler based on intent classification.
        
        Returns:
            Dict with keys:
            - intent: "greeting" | "general_chat" | "document"
            - call_tools: bool (whether to use document search)
            - confidence: float
        """
        # Step 1: Rule-based shortcut - if obvious document intent, skip LLM call
        if self._detect_document_intent_by_rules(query):
            logger.info(f"🔀 Rule-based routing: detected document intent for '{query[:50]}...'")
            return {
                "intent": "document",
                "call_tools": True,
                "confidence": 1.0
            }
        
        # Step 2: Use LLM for ambiguous cases
        system_prompt = """You are an intent classifier for a document workspace.
Your task is to classify the user's query into ONE of the following categories
and respond with JSON ONLY.

Classification categories:
1. "greeting" - Simple greetings or thanks (hi, hello, thanks, bye)
2. "general_chat" - Casual conversation, opinions, or questions not tied to any document
3. "document" - Any query related to documents, files, PDFs, reports, notes, or their content,
   including summarization, comparison, explanation, lookup, or analysis.
   If the user mentions or implies a document (e.g. @file.pdf), it MUST be classified as "document".

Response format (JSON only, no markdown, no extra text):
{
  "intent": "greeting | general_chat | document",
  "confidence": 0.0 to 1.0
}

Examples:
Query: "hi" -> {"intent": "greeting", "confidence": 0.95}
Query: "How are you today?" -> {"intent": "general_chat", "confidence": 0.8}
Query: "What did the Q3 report say?" -> {"intent": "document", "confidence": 0.9}
Query: "Please compare working memory with long-term storage in @2510.18212v3.pdf"
-> {"intent": "document", "confidence": 0.95}
"""

        for attempt in range(max_retries):
            try:
                logger.info(f"Routing attempt {attempt + 1}/{max_retries}")
                
                # Call LLM
                routing_result = await self.llm_client.chat_complete(
                    [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": query}
                    ],
                    max_tokens=100
                )
                
                # Try to parse the result
                parsed_result = self._parse_routing_result(routing_result)
                
                # If parsing succeeds and confidence > 0, it is a valid result
                if parsed_result["confidence"] > 0:
                    logger.info(f"✓ Routing successful on attempt {attempt + 1}")
                    
                    # Step 3: Code decides whether to call tools (not LLM)
                    intent = parsed_result["intent"]
                    if intent == "document":
                        return {
                            "intent": "document",
                            "call_tools": True,
                            "confidence": parsed_result["confidence"]
                        }
                    else:
                        # greeting or general_chat
                        return {
                            "intent": intent,
                            "call_tools": False,
                            "confidence": parsed_result["confidence"]
                        }
                else:
                    # confidence == 0 means parsing failed, continue retrying
                    logger.info(f"✗ Parsing failed on attempt {attempt + 1}, retrying...")
                    
            except Exception as e:
                logger.error(f"✗ Error on attempt {attempt + 1}: {e}")
                
                # If not the last attempt, continue retrying after a brief delay
                if attempt < max_retries - 1:
                    await asyncio.sleep(1)  # Short delay before retrying
                    continue
        
        # All retries failed, return default fallback (assume document intent for safety)
        logger.warning(f"⚠ All {max_retries} attempts failed, falling back to document intent")
        return {
            "intent": "document",
            "call_tools": True,
            "confidence": 0.0
        }


    def _parse_routing_result(self, raw_result: str) -> Dict[str, Any]:
        """
        Parse LLM's routing result.

        Args:
            raw_result: Original string returned by LLM

        Returns:
            Dictionary including intent and confidence.
            If parsing fails, confidence is set to 0.
        """
        try:
            # Clean potential markdown code block markers
            cleaned = raw_result.strip()
            
            # Remove possible ```json and ``` markers
            if '```' in cleaned:
                # Match ```json or ``` at start
                cleaned = re.sub(r'^```(?:json)?\s*\n?', '', cleaned)
                cleaned = re.sub(r'\n?```\s*$', '', cleaned)
                cleaned = cleaned.strip()
            
            # Try to extract JSON (if other text exists)
            json_match = re.search(r'\{[^{}]*\}', cleaned)
            if json_match:
                cleaned = json_match.group(0)
            
            # Parse JSON
            result = json.loads(cleaned)
            
            # Check required fields
            if "intent" not in result:
                raise ValueError("Missing 'intent' field in routing result")
            
            # Set default confidence if not present
            if "confidence" not in result:
                result["confidence"] = 0.5
            
            # Validate intent - now only 3 categories
            valid_intents = ["greeting", "general_chat", "document"]
            if result["intent"] not in valid_intents:
                logger.warning(f"Invalid intent: {result['intent']}, defaulting to document")
                result["intent"] = "document"
                result["confidence"] = max(0.3, result.get("confidence", 0.3))
            
            return result
            
        except json.JSONDecodeError as e:
            logger.error(f"JSON parsing error: {e}")
            logger.error(f"Raw result: {raw_result[:200]}...")  # Only print the first 200 characters
            # Return confidence=0 to indicate failure
            return {
                "intent": "document",
                "confidence": 0.0
            }
        
        except Exception as e:
            logger.error(f"Unexpected parsing error: {e}")
            return {
                "intent": "document",
                "confidence": 0.0
            }

    async def _filter_relevant_chunks(
        self, 
        query: str, 
        context_parts: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """
        Enhanced filtering: supports larger top_k.
        Strategy 1: Score filtering.
        Strategy 2: Keyword matching enhancement.
        Strategy 3: Length filtering (removes too-short/invalid content).
        """
        if not context_parts:
            return []
        
        # Strategy 1: Score filtering (if score exists)
        scored_parts = [p for p in context_parts if p.get("score", 0) > 0]
        
        if scored_parts:
            scores = [p["score"] for p in scored_parts]
            avg_score = sum(scores) / len(scores)
            max_score = max(scores)
            
            # Adaptive threshold: retain high-score chunks
            threshold = max(avg_score * 0.6, max_score * 0.5)
            filtered = [p for p in scored_parts if p["score"] >= threshold]
            
            # Retain at least 5
            if len(filtered) < 5:
                filtered = sorted(scored_parts, key=lambda x: x["score"], reverse=True)[:5]
        else:
            filtered = context_parts
        
        # Strategy 2: Enhanced keyword matching
        query_keywords = set(re.findall(r'\w+', query.lower()))
        
        for part in filtered:
            # Filter out too-short content
            if len(part["content"].strip()) < 50:
                part["keyword_overlap"] = 0
                continue
                
            content_keywords = set(re.findall(r'\w+', part["content"].lower()))
            overlap = len(query_keywords & content_keywords)
            part["keyword_overlap"] = overlap
        
        # Sort by combined score: original score (70%) + keyword overlap (30%)
        filtered.sort(
            key=lambda x: (x.get("score", 0) * 0.7 + x.get("keyword_overlap", 0) * 0.3),
            reverse=True
        )
        
        logger.info(f"📊 Filter: {len(context_parts)} -> {len(filtered)} chunks")
        return filtered


    async def _process_chunks_parallel_streaming(
        self,
        query: str,
        context_parts: List[Dict[str, Any]]
    ):
        """
        Streaming version: yields each chunk result as soon as it completes.
        Uses asyncio.as_completed to stream results one by one for real-time UI updates.
        """
        high_quality_count = 0
        batch_size = 5  # Process 5 per batch for concurrency control
        early_stop_threshold = 5  # Stop early if finding 5 high-quality answers
        processed_count = 0
        should_stop = False

        for i in range(0, len(context_parts), batch_size):
            batch = context_parts[i:i + batch_size]

            # Create tasks with index tracking
            tasks_with_index = []
            for idx, part in enumerate(batch):
                task = asyncio.create_task(self._process_single_chunk(query, part))
                tasks_with_index.append((task, part, idx))

            # Use as_completed to yield results one by one as they finish
            pending_tasks = {task: (part, idx) for task, part, idx in tasks_with_index}

            for completed_task in asyncio.as_completed([t[0] for t in tasks_with_index]):
                try:
                    result = await completed_task
                except Exception as e:
                    # Find which task this was
                    for task, (part, idx) in pending_tasks.items():
                        if task == completed_task:
                            logger.error(f"Chunk {part['index']} processing failed: {e}")
                            result = {
                                "index": part["index"],
                                "has_answer": False,
                                "content": "",
                                "source": part["source"],
                                "confidence": 0.0
                            }
                            break
                    else:
                        continue

                processed_count += 1

                # Count high quality answers
                if result.get("has_answer") and result.get("confidence", 0) >= 0.8:
                    high_quality_count += 1

                # Extract file name from result
                source_path = result.get("source", "")
                file_name = source_path.split("/")[-1] if "/" in source_path else source_path.split("\\")[-1] if "\\" in source_path else source_path

                # Yield each chunk result immediately
                yield {
                    "event_type": "chunk_complete",
                    "processed_count": processed_count,
                    "total_count": len(context_parts),
                    "high_quality_count": high_quality_count,
                    "result": result,
                    "file_name": file_name,
                    "is_last": processed_count >= len(context_parts)
                }

            logger.info(f"📊 Processed {processed_count}/{len(context_parts)}: "
                    f"{high_quality_count} high-quality answers so far")

            # Check early stop condition
            if high_quality_count >= early_stop_threshold and i + batch_size < len(context_parts):
                logger.info(f"✨ Early stop: Found {high_quality_count} high-quality answers, "
                        f"skipping remaining {len(context_parts) - i - batch_size} chunks")
                should_stop = True
                break

        # Signal completion
        if not should_stop:
            yield {
                "event_type": "all_complete",
                "processed_count": processed_count,
                "total_count": len(context_parts),
                "high_quality_count": high_quality_count,
            }

    async def _process_single_chunk(
        self, 
        query: str, 
        context_part: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Enhanced single chunk processing: extracts comprehensive information for summary model.
        Provides detailed context, key facts, and supporting evidence.
        """
        system_prompt = (
            "You are an expert research analyst. Your task is to extract comprehensive, actionable information "
            "from a text passage that will be used by a summary model to synthesize a final answer. "
            "Focus on extracting ALL relevant facts, context, relationships, and details that could help answer the question."
        )
        
        user_prompt = (
            f"Question: {query}\n\n"
            f"Source: {context_part.get('source', 'Unknown')}\n\n"
            f"Text:\n{context_part['content']}\n\n"
            "Instructions:\n"
            "1. If the text contains relevant information for the question, respond with:\n"
            "ANSWER: <comprehensive extraction including:>\n"
            "- Direct answer to the question (if present)\n"
            "- Key facts, names, dates, numbers, or specific details\n"
            "- Important context that helps understand the answer\n"
            "- Relationships between entities mentioned\n"
            "- Any qualifications, conditions, or nuances\n"
            "(Write 2-5 sentences with all relevant details)\n"
            "| CONFIDENCE: HIGH/MEDIUM/LOW\n\n"
            "2. If the text does NOT contain any relevant information, respond with:\n"
            "NO_ANSWER"
        )

        # print system prompt and user prompt
        # logger.info("#" * 80)
        # logger.info(f"System prompt: {system_prompt}")
        # logger.info(f"User prompt: {user_prompt}")
        # logger.info("#" * 80)

        try:
            response = await self.llm_client.chat_complete(
                [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                max_tokens=300,  # Keep short to prevent repetition from small models
            )
            
            response = response.strip()
            response_upper = response.upper()
            
            # Quick check for NO_ANSWER
            if response_upper.startswith("NO_ANSWER") or response_upper == "NO_ANSWER":
                return {
                    "index": context_part["index"],
                    "has_answer": False,
                    "content": "",
                    "source": context_part["source"],
                    "confidence": 0.0
                }
            
            # Parse confidence
            confidence = 0.5
            if "CONFIDENCE: HIGH" in response_upper or "CONFIDENCE:HIGH" in response_upper:
                confidence = 0.9
            elif "CONFIDENCE: MEDIUM" in response_upper or "CONFIDENCE:MEDIUM" in response_upper:
                confidence = 0.7
            elif "CONFIDENCE: LOW" in response_upper or "CONFIDENCE:LOW" in response_upper:
                confidence = 0.4
            
            # Extract answer: remove "ANSWER:" prefix and confidence suffix
            answer = re.sub(r'^ANSWER:\s*', '', response, flags=re.IGNORECASE)
            answer = re.sub(r'\s*\|\s*CONFIDENCE:.*', '', answer, flags=re.IGNORECASE).strip()
            
            # Check if there is an answer - use unified _is_negative_response for consistency
            # This ensures the same patterns are used for:
            # 1. Setting has_answer=False here
            # 2. Filtering in valid_sub_answers
            # 3. Frontend isHitRelevant display
            is_no_answer = not answer or self._is_negative_response(answer)
            
            if is_no_answer:
                return {
                    "index": context_part["index"],
                    "has_answer": False,
                    "content": answer,  # Keep the LLM's explanation for why no answer was found
                    "source": context_part["source"],
                    "confidence": 0.0
                }
            
            return {
                "index": context_part["index"],
                "has_answer": True,
                "content": answer,
                "source": context_part["source"],
                "confidence": confidence
            }
            
        except Exception as e:
            logger.error(f"Failed to process chunk {context_part['index']}: {e}")
            return {
                "index": context_part["index"],
                "has_answer": False,
                "content": "",
                "source": context_part["source"],
                "confidence": 0.0
            }


    def _is_negative_response(self, content: str) -> bool:
        """
        Check if a response indicates "no answer found" or similar negative results.
        These should be filtered out from aggregation.
        
        IMPORTANT: This must be consistent with frontend isHitRelevant() in ThinkingProcess.tsx
        Frontend checks: comment.includes('no answer') || comment.includes('not relevant') || comment.includes('does not')
        
        NOTE: Patterns are split into two categories:
        1. Explicit markers (NO_ANSWER, NO ANSWER) - checked globally (LLM's explicit signal)
        2. Contextual phrases - checked only in first sentence to avoid false positives
           from supplementary statements like "There is no mention of his salary"
        """
        if not content:
            return True
        
        content_upper = content.upper().strip()
        
        # Explicit markers - LLM's clear signal that there's no answer
        # These should be checked globally as they are intentional markers
        explicit_markers = [
            "NO_ANSWER",
            "NO ANSWER",
        ]
        
        if any(marker in content_upper for marker in explicit_markers):
            return True
        
        # Extract the first sentence only (up to first sentence-ending punctuation)
        # This avoids false positives from supplementary negative statements
        first_sentence = content_upper
        for delimiter in ['. ', '.\n', '? ', '?\n', '! ', '!\n']:
            if delimiter in content_upper:
                first_sentence = content_upper.split(delimiter)[0]
                break
        
        # Contextual negative patterns - only check in first sentence
        # These phrases can appear legitimately in supplementary context
        contextual_patterns = [
            "DOES NOT PROVIDE",
            "DOES NOT CONTAIN",
            "DOES NOT ANSWER",
            "DOES NOT ADDRESS",
            "DOES NOT INCLUDE",
            "DOES NOT MENTION",
            "DOES NOT HAVE",
            "DOES NOT SPECIFY",
            "DOES NOT STATE",
            "DOES NOT DISCUSS",
            "DOESN'T PROVIDE",
            "DOESN'T CONTAIN",
            "DOESN'T ANSWER",
            "DOESN'T ADDRESS",
            "DOESN'T MENTION",
            "CANNOT FIND",
            "CANNOT ANSWER",
            "NOT FOUND",
            "NO RELEVANT",
            "NOT RELEVANT",
            "IS NOT AVAILABLE",
            "NO INFORMATION",
            "NOT MENTIONED",
            "NOT SPECIFIED",
            "NOT ADDRESSED",
            "THE DOCUMENT DOES NOT",
            "THE CHUNK DOES NOT",
            "THIS CHUNK DOES NOT",
            "THIS DOCUMENT DOES NOT",
            "THIS SECTION DOES NOT",
            "I CANNOT FIND",
            "I COULD NOT FIND",
            "UNABLE TO FIND",
            "NOT IN THE",
            "NO SPECIFIC",
            "NOTHING ABOUT",
            "NO MENTION OF",
            "DOESN'T HAVE",
        ]
        
        return any(pattern in first_sentence for pattern in contextual_patterns)

    def _deduplicate_sub_answers(self, sub_answers: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Removes duplicate or highly similar sub-answers, and filters out negative responses.
        """
        if len(sub_answers) <= 3:
            # Still need to filter out negative responses even for small lists
            return [
                ans for ans in sub_answers 
                if ans.get("has_answer") and not self._is_negative_response(ans.get("content", ""))
            ]
        
        unique_answers = []
        seen_contents = []
        
        for answer in sub_answers:
            if not answer.get("has_answer"):
                continue
            
            content = answer.get("content", "")
            
            # Skip negative responses (e.g., "The document does not provide...")
            if self._is_negative_response(content):
                logger.debug(f"Filtering out negative response from source {answer.get('source')}")
                continue
            
            content_lower = content.lower()
            words = set(re.findall(r'\w+', content_lower))
            
            if not words:
                continue
            
            # Check if this answer is a duplicate of any seen answers
            is_duplicate = False
            for seen_words in seen_contents:
                overlap = len(words & seen_words)
                similarity = overlap / max(len(words), len(seen_words), 1)
                if similarity > 0.75:  # 75% similarity is considered duplicate
                    is_duplicate = True
                    break
            
            if not is_duplicate:
                unique_answers.append(answer)
                seen_contents.append(words)
        
        logger.info(f"📊 Deduplication: {len([a for a in sub_answers if a.get('has_answer')])} -> {len(unique_answers)} unique answers")
        return unique_answers


    async def _aggregate_sub_answers(
        self, 
        query: str, 
        sub_answers: List[Dict[str, Any]]
    ) -> str:
        """
        Optimized aggregation: supports hierarchical aggregation (when there are too many sub-answers)
        """
        # Deduplication
        unique_answers = self._deduplicate_sub_answers(sub_answers)
        
        if not unique_answers:
            return "I cannot find a clear answer in your documents."
        
        # Sort by confidence
        unique_answers.sort(key=lambda x: x.get("confidence", 0), reverse=True)
        
        # If sub-answers are less than or equal to 8, directly aggregate
        if len(unique_answers) <= 8:
            return await self._simple_aggregation(query, unique_answers)
        
        # Otherwise use hierarchical aggregation
        logger.info(f"📊 Using hierarchical aggregation for {len(unique_answers)} answers")
        return await self._hierarchical_aggregation(query, unique_answers)


    async def _simple_aggregation(
        self, 
        query: str, 
        sub_answers: List[Dict[str, Any]]
    ) -> str:
        """
        Aggregate multiple sub-answers into a comprehensive, well-structured response.
        Synthesizes all evidence into a coherent answer with proper citations.
        """
        # Build evidence list with source citations
        evidence_lines = [
            f"[{ans['index']}] (Source: {ans.get('source', 'Unknown')}, Confidence: {ans.get('confidence', 0):.1f})\n{ans['content']}"
            for ans in sub_answers
            if ans.get('content')  # Skip empty content
        ]
        evidence_text = "\n\n".join(evidence_lines)
        
        system_prompt = (
            "You are an expert research synthesizer. Your task is to combine multiple pieces of evidence "
            "into a comprehensive, well-organized answer. You must:\n"
            "1. Integrate information from ALL relevant sources, prioritizing high-confidence evidence\n"
            "2. Present facts in a logical, structured manner\n"
            "3. Preserve important details, names, dates, and specific information\n"
            "4. Resolve any contradictions by noting different perspectives or preferring higher-confidence sources\n"
            "5. Always cite sources using [n] notation inline with the relevant information\n"
            "6. Write in a clear, professional tone suitable for a research summary"
        )
        
        user_prompt = (
            f"Question: {query}\n\n"
            f"Evidence from {len(sub_answers)} sources:\n{evidence_text}\n\n"
            "Task: Synthesize a comprehensive answer that:\n"
            "- Directly addresses the question with specific facts and details\n"
            "- Includes ALL key information from the evidence (names, dates, numbers, relationships)\n"
            "- Uses inline citations [1], [2], etc. to attribute information to sources\n"
            "- Organizes information logically (e.g., chronologically, by topic, or by importance)\n"
            "- Provides context and nuance where appropriate\n"
            "- Is 3-6 sentences for simple questions, or a structured paragraph for complex topics\n\n"
            "Answer:"
        )
        
        try:
            final_answer = await self.llm_client.chat_complete(
                [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                max_tokens=500,
                temperature=0.3,  # Slightly creative for natural synthesis
            )
            return final_answer.strip()
        except Exception as e:
            logger.error(f"Aggregation failed: {e}")
            # Fallback: Return the highest confidence answer
            best = max(sub_answers, key=lambda x: x.get('confidence', 0))
            return f"{best['content']} [{best['index']}]"


    async def _stream_simple_aggregation(
        self,
        query: str,
        sub_answers: List[Dict[str, Any]]
    ) -> AsyncIterable[str]:
        """
        Streaming version of _simple_aggregation.
        Yields tokens as they are generated for real-time UI updates.
        """
        # Build evidence list with source citations
        evidence_lines = [
            f"[{ans['index']}] (Source: {ans.get('source', 'Unknown')}, Confidence: {ans.get('confidence', 0):.1f})\n{ans['content']}"
            for ans in sub_answers
            if ans.get('content')
        ]
        evidence_text = "\n\n".join(evidence_lines)

        system_prompt = (
            "You are an expert research synthesizer. Your task is to combine multiple pieces of evidence "
            "into a comprehensive, well-organized answer. You must:\n"
            "1. Integrate information from ALL relevant sources, prioritizing high-confidence evidence\n"
            "2. Present facts in a logical, structured manner\n"
            "3. Preserve important details, names, dates, and specific information\n"
            "4. Resolve any contradictions by noting different perspectives or preferring higher-confidence sources\n"
            "5. Always cite sources using [n] notation inline with the relevant information\n"
            "6. Write in a clear, professional tone suitable for a research summary"
        )

        user_prompt = (
            f"Question: {query}\n\n"
            f"Evidence from {len(sub_answers)} sources:\n{evidence_text}\n\n"
            "Task: Synthesize a comprehensive answer that:\n"
            "- Directly addresses the question with specific facts and details\n"
            "- Includes ALL key information from the evidence (names, dates, numbers, relationships)\n"
            "- Uses inline citations [1], [2], etc. to attribute information to sources\n"
            "- Organizes information logically (e.g., chronologically, by topic, or by importance)\n"
            "- Provides context and nuance where appropriate\n"
            "- Is 3-6 sentences for simple questions, or a structured paragraph for complex topics\n\n"
            "Answer:"
        )

        try:
            async for token in self.llm_client.stream_chat_complete(
                [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                max_tokens=500,
                temperature=0.3,
            ):
                yield token
        except Exception as e:
            logger.error(f"Streaming aggregation failed: {e}")
            # Fallback: Return the highest confidence answer
            best = max(sub_answers, key=lambda x: x.get('confidence', 0))
            yield f"{best['content']} [{best['index']}]"


    async def _hierarchical_aggregation(
        self, 
        query: str, 
        sub_answers: List[Dict[str, Any]]
    ) -> str:
        """
        Two-stage hierarchical aggregation for large numbers of sub-answers.
        Stage 1: Batch sub-answers into groups and summarize each (preserving key details).
        Stage 2: Synthesize all group summaries into a comprehensive final answer.
        """
        batch_size = 6
        intermediate_summaries = []
        
        # Stage 1: Group aggregation - each group preserves detailed information
        for i in range(0, len(sub_answers), batch_size):
            batch = sub_answers[i:i + batch_size]
            group_num = i // batch_size + 1
            try:
                summary = await self._simple_aggregation(query, batch)
                intermediate_summaries.append({
                    "content": summary,
                    "source": f"Group {group_num}",
                    "index": group_num,
                    "has_answer": True,
                    "confidence": 0.8
                })
            except Exception as e:
                logger.error(f"Group {group_num} aggregation failed: {e}")
                continue
        
        if not intermediate_summaries:
            return "Unable to synthesize answer from the provided documents."
        
        if len(intermediate_summaries) == 1:
            return intermediate_summaries[0]["content"]
        
        # Stage 2: Final synthesis - comprehensive integration of all groups
        logger.info(f"📊 Final synthesis of {len(intermediate_summaries)} group summaries")
        
        summaries_text = "\n\n".join(
            f"[Group {s['index']}]\n{s['content']}"
            for s in intermediate_summaries
        )
        
        system_prompt = (
            "You are a senior research analyst performing the final synthesis of a multi-source investigation. "
            "Your task is to integrate multiple group summaries into one authoritative, comprehensive answer.\n\n"
            "Key responsibilities:\n"
            "1. Preserve ALL important facts, names, dates, numbers, and specific details from every group\n"
            "2. Identify and highlight the most significant findings\n"
            "3. Organize information in a clear, logical structure\n"
            "4. Resolve contradictions by noting different sources or using the more reliable information\n"
            "5. Maintain proper attribution using [Group n] citations\n"
            "6. Ensure no critical information is lost in the synthesis"
        )
        
        user_prompt = (
            f"Question: {query}\n\n"
            f"Group Summaries ({len(intermediate_summaries)} groups):\n{summaries_text}\n\n"
            "Task: Create a comprehensive final answer that:\n"
            "- Provides a complete, authoritative response to the question\n"
            "- Integrates key information from ALL groups without losing important details\n"
            "- Uses [Group 1], [Group 2], etc. citations for attribution\n"
            "- Structures the answer logically (by theme, chronology, or importance)\n"
            "- Highlights the most significant findings while preserving supporting details\n"
            "- Is thorough enough to fully answer the question (typically 4-8 sentences or a structured paragraph)\n\n"
            "Final Answer:"
        )
        
        try:
            final_answer = await self.llm_client.chat_complete(
                [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                max_tokens=600,
                temperature=0.3,
            )
            return final_answer.strip()
        except Exception as e:
            logger.error(f"Final synthesis failed: {e}")
            return intermediate_summaries[0]["content"]

    async def stream_answer(self, payload: QaRequest) -> AsyncIterable[str]:
        # Get search_mode from payload, default to "auto"
        search_mode = getattr(payload, 'search_mode', 'auto')
        
        # Handle "direct" search_mode - skip document search entirely
        if search_mode == "direct" or payload.mode == "chat":
            logger.info("=" * 80)
            logger.info(f"🤖 DIRECT MODE (search_mode={search_mode}, mode={payload.mode})")
            logger.info("=" * 80)
            logger.info(f"\n📝 User Query: {payload.query}")
            logger.info("=" * 80)
            yield json.dumps({"type": "status", "data": "answering"}) + "\n"
            try:
                # Build system message for direct chat
                system_message = (
                    "You are Local Cocoa, a helpful AI assistant for a local document workspace. "
                    "You were created at NTU Singapore (Nanyang Technological University).\n\n"
                    "Respond to the user naturally and helpfully."
                )
                messages = [
                    {"role": "system", "content": system_message},
                    {"role": "user", "content": payload.query}
                ]
                async for chunk in self.llm_client.stream_chat_complete(messages, max_tokens=1024):
                    yield json.dumps({"type": "token", "data": chunk}) + "\n"
            except Exception as e:
                logger.error(f"Streaming failed: {e}")
                yield json.dumps({"type": "error", "data": "LLM generation failed."}) + "\n"
            yield json.dumps({"type": "done"}) + "\n"
            return

        yield json.dumps({"type": "status", "data": "searching"}) + "\n"

        # For "knowledge" mode, always search docs (skip intent routing)
        # For "auto" mode, use intent routing to decide
        if search_mode == "knowledge":
            # Force document search
            intent = "document"
            call_tools = True
            logger.info(f"🔀 Knowledge mode: forcing document search")
        else:
            # Auto mode: use query routing
            routing_result = await self.query_intent_routing(payload.query)
            intent = routing_result.get("intent", "document")
            call_tools = routing_result.get("call_tools", True)
            confidence = routing_result.get('confidence', 0)
            logger.info(f"🔀 Routing: intent={intent}, call_tools={call_tools}, confidence={confidence:.2f}")

        # ============================================
        # Path 1: Does not require tools - direct answer (greeting or general_chat)
        # ============================================
        if not call_tools:
            yield json.dumps({"type": "status", "data": "direct_answer"}) + "\n"
            
            # Build messages for chat completion API
            if intent == "greeting":
                # Self-introduction when greeting
                system_message = (
                    "You are Local Cocoa, a friendly AI assistant for a local document workspace.\n\n"
                    "About you:\n"
                    "- Name: Local Cocoa\n"
                    "- Origin: Born at NTU Singapore (Nanyang Technological University)\n"
                    "- Personality: Warm, helpful, and knowledgeable about documents\n"
                    "- Purpose: Help users manage and search their local documents\n\n"
                    "When greeting users, be warm and briefly introduce yourself if it's appropriate. "
                    "Keep your response concise and friendly (1-2 sentences)."
                )
            else:
                # General conversation (general_chat)
                system_message = (
                    "You are Local Cocoa, a helpful AI assistant for a local document workspace. "
                    "You were created at NTU Singapore (Nanyang Technological University).\n\n"
                    "Respond to the user naturally and concisely. "
                    "If asked about yourself, mention your name (Local Cocoa) and that you're from NTU Singapore."
                )
            
            messages = [
                {"role": "system", "content": system_message},
                {"role": "user", "content": payload.query}
            ]
            
            logger.info("=" * 80)
            logger.info("🤖 DIRECT ANSWER MODE (NO DOCUMENT SEARCH)")
            logger.info("=" * 80)
            logger.info(f"📝 User Query: {payload.query}")
            logger.info(f"📄 Routing Intent: {intent}")
            logger.info(f"🎭 Response Mode: {'Greeting' if intent == 'greeting' else 'General Chat'}")
            logger.info("=" * 80)
            
            try:
                async for chunk in self.llm_client.stream_chat_complete(messages, max_tokens=512):
                    yield json.dumps({"type": "token", "data": chunk}) + "\n"
            except Exception as e:
                logger.error(f"Direct answer streaming failed: {e}")
                yield json.dumps({"type": "error", "data": "LLM generation failed."}) + "\n"
            
            yield json.dumps({"type": "done"}) + "\n"
            return

        # ============================================
        # Path 2: Requires tools - search docs and answer with context (document intent)
        # ============================================
        # Use settings.qa_context_limit as the authoritative limit for context
        limit = settings.qa_context_limit
        
        # Check if this is a multi-path query
        is_multi_path = self._should_use_multi_path(payload.query)
        
        if is_multi_path:
            # ============================================
            # Multi-Path Retrieval Flow with Full Visibility
            # ============================================
            fallback_to_standard = False
            async for event in self._stream_multi_path_answer(payload, limit):
                # Check if multi-path signals fallback to standard search
                try:
                    parsed = json.loads(event.strip())
                    if parsed.get("type") == "fallback_to_standard":
                        fallback_to_standard = True
                        logger.info("📝 Multi-path signaled fallback, continuing with standard search flow")
                        break  # Exit multi-path, continue with standard flow below
                except (json.JSONDecodeError, AttributeError):
                    pass
                yield event
            
            if not fallback_to_standard:
                # Multi-path completed successfully
                return
            # else: fall through to standard search flow below
        
        # ============================================
        # Standard Single-Path Flow
        # ============================================
        try:
            search = await self.search(payload.query, limit=limit, enable_multi_path=False)
        except EmbeddingUnavailableError:
            yield json.dumps({"type": "error", "data": "Embedding service unavailable."}) + "\n"
            return

        hits = search.hits
        
        if not hits:
            yield json.dumps({"type": "status", "data": "no_results"}) + "\n"
            yield json.dumps({"type": "done", "data": "No matching files found."}) + "\n"
            return

        yield json.dumps({"type": "hits", "data": [hit.dict() for hit in hits]}) + "\n"
        yield json.dumps({"type": "status", "data": "processing_chunks"}) + "\n"

        # ============================================
        # Step 1: Build context_parts and evaluate relevance
        # ============================================
        context_parts: List[Dict[str, Any]] = []

        for idx, hit in enumerate(hits, 1):
            chunk_text = self._chunk_text(hit)

            # For images, combine summary (VLM) and chunk_text (OCR)
            kind = hit.metadata.get("kind") if hit.metadata else None
            if kind == "image":
                parts = []
                if hit.summary:
                    parts.append(f"[Image Description]: {hit.summary}")
                if chunk_text:
                    parts.append(f"[Image Text]: {chunk_text}")
                snippet = "\n".join(parts)
                if not snippet:
                    snippet = hit.snippet
            else:
                snippet = chunk_text or hit.snippet or hit.summary

            if snippet:
                source = hit.metadata.get("path") if hit.metadata else None
                label = source or hit.file_id
                context_parts.append({
                    "index": idx,
                    "source": label,
                    "content": snippet[:settings.max_snippet_length],
                    "score": hit.score if hasattr(hit, 'score') else 0.0,
                    "file_id": hit.file_id,
                    "chunk_id": hit.chunk_id,
                })

        if not context_parts:
            yield json.dumps({"type": "done", "data": "No valid content found in documents."}) + "\n"
            return

        logger.info(f"📊 Processing {len(context_parts)} chunks for query: {payload.query}")

        # ============================================
        # Step 2: Relevance filtering (quick lightweight)
        # ============================================
        # If there are too many chunks or similarity is low, do quick filtering first
        filtered_parts = await self._filter_relevant_chunks(payload.query, context_parts)
        logger.info(f"📊 After filtering: {len(filtered_parts)} relevant chunks")

        # If filtering reduced the hits, send updated hits list to frontend
        # This ensures RecalledContext shows only the chunks being analyzed
        if len(filtered_parts) < len(context_parts):
            filtered_indices = {p.get("index") for p in filtered_parts}
            filtered_hits = [hit for idx, hit in enumerate(hits, 1) if idx in filtered_indices]
            yield json.dumps({"type": "hits", "data": [hit.dict() for hit in filtered_hits]}) + "\n"

        yield json.dumps({
            "type": "status",
            "data": f"analyzing_{len(filtered_parts)}_chunks"
        }) + "\n"

        # ============================================
        # Step 3: Process each chunk in parallel (Map phase) - STREAMING
        # ============================================
        sub_answers = []
        chunk_analysis = []

        async for chunk_data in self._process_chunks_parallel_streaming(payload.query, filtered_parts):
            event_type = chunk_data.get("event_type", "chunk_complete")

            if event_type == "all_complete":
                # All chunks processed
                continue

            if event_type == "chunk_complete":
                # Single chunk completed - process and send immediately
                ans = chunk_data["result"]
                sub_answers.append(ans)

                # Get the original context part to include file_id and chunk_id for matching
                original_part = next(
                    (p for p in context_parts if p.get("index") == ans.get("index")),
                    {}
                )
                chunk_analysis.append({
                    "index": ans.get("index"),
                    "has_answer": ans.get("has_answer", False),
                    "comment": ans.get("content", "") or None,
                    "confidence": ans.get("confidence", 0.0),
                    "source": ans.get("source", ""),
                    "file_id": original_part.get("file_id", ""),
                    "chunk_id": original_part.get("chunk_id", ""),
                })

                # Send single chunk result to frontend immediately
                logger.info(f"📤 Chunk {chunk_data['processed_count']}/{chunk_data['total_count']} complete: {chunk_data['file_name']}")

                yield json.dumps({
                    "type": "chunk_progress",
                    "data": {
                        "processed_count": chunk_data["processed_count"],
                        "total_count": chunk_data["total_count"],
                        "high_quality_count": chunk_data["high_quality_count"],
                        "is_last": chunk_data["is_last"],
                        "current_file": chunk_data["file_name"],
                        # Send single result for immediate UI update
                        "chunk_result": {
                            "index": ans.get("index"),
                            "has_answer": ans.get("has_answer", False),
                            "comment": ans.get("content", "") or None,
                            "confidence": ans.get("confidence", 0.0),
                            "source": ans.get("source", ""),
                            "file_name": chunk_data["file_name"],
                            "file_id": original_part.get("file_id", ""),
                            "chunk_id": original_part.get("chunk_id", ""),
                        }
                    }
                }) + "\n"

        # Send final complete chunk analysis (for compatibility)
        yield json.dumps({"type": "chunk_analysis", "data": chunk_analysis}) + "\n"

        # Filter out invalid sub_answers
        # Keep answers with meaningful content, regardless of confidence level
        # The confidence is just a hint, but actual content matters more
        valid_sub_answers = [
            ans for ans in sub_answers 
            if (
                ans.get("has_answer") 
                and ans.get("content") 
                and len(ans.get("content", "").strip()) > 20  # Filter out too-short answers
                and not self._is_negative_response(ans.get("content", ""))
            )
        ]

        logger.info(f"📊 Valid sub-answers for summary: {len(valid_sub_answers)}/{len(filtered_parts)}")

        if not valid_sub_answers:
            yield json.dumps({"type": "done", "data": "I cannot find the answer in your files."}) + "\n"
            return

        yield json.dumps({"type": "status", "data": "synthesizing_answer"}) + "\n"

        # ============================================
        # Step 4 & 5: Stream aggregation (Reduce phase with real-time output)
        # ============================================
        # Deduplicate and sort by confidence
        unique_answers = self._deduplicate_sub_answers(valid_sub_answers)
        unique_answers.sort(key=lambda x: x.get("confidence", 0), reverse=True)

        logger.info("=" * 80)
        logger.info("🤖 STREAMING FINAL ANSWER")
        logger.info("=" * 80)
        logger.info(f"Query: {payload.query}")
        logger.info(f"Sub-answers to process: {len(unique_answers)}")

        # For simple cases (<=8 answers), use streaming aggregation
        # For complex cases, fall back to non-streaming (hierarchical is complex)
        if len(unique_answers) <= 8:
            # Stream tokens as they are generated
            async for token in self._stream_simple_aggregation(payload.query, unique_answers):
                yield json.dumps({"type": "token", "data": token}) + "\n"
        else:
            # Fall back to non-streaming for hierarchical aggregation
            logger.info(f"📊 Using hierarchical aggregation for {len(unique_answers)} answers (non-streaming)")
            final_answer = await self._hierarchical_aggregation(payload.query, unique_answers)
            yield json.dumps({"type": "token", "data": final_answer}) + "\n"

        logger.info("=" * 80)
        yield json.dumps({"type": "done"}) + "\n"

    def _chunk_text(self, hit: SearchHit) -> str | None:
        metadata = hit.metadata or {}
        chunk_id = metadata.get("chunk_id") or hit.chunk_id
        if not chunk_id:
            return None
        chunk = self.storage.get_chunk(chunk_id)
        if chunk and chunk.text:
            return chunk.text.strip()
        return None

    def _vector_hits(self, query: str, query_vector: list[float], limit: int, file_ids: list[str] | None = None) -> list[SearchHit]:
        if self.vector_store:
            # Fetch more chunks than needed to ensure we get enough after enrichment
            raw_hits = self.vector_store.search(query_vector, limit=limit * 3, file_ids=file_ids)
            enriched_hits: list[SearchHit] = []

            for raw in raw_hits:
                file_id = raw.metadata.get("file_id") or raw.file_id
                record = self.storage.get_file(file_id)

                # Backward compatibility: if file not found by file_id, try chunk_id
                if not record and raw.chunk_id:
                    record = self.storage.get_file_by_chunk_id(raw.chunk_id)

                summary = record.summary if record else raw.summary
                snippet = raw.snippet or (summary[:480] if summary else None)

                # Enrich metadata with file information from database
                enriched_metadata = dict(raw.metadata) if raw.metadata else {}
                
                # Extract and merge chunk_metadata (contains page numbers, etc.)
                chunk_metadata = enriched_metadata.get("chunk_metadata")
                if chunk_metadata and isinstance(chunk_metadata, dict):
                    # Merge chunk_metadata into top-level metadata for easier access
                    for key, value in chunk_metadata.items():
                        if key not in enriched_metadata or enriched_metadata.get(key) is None:
                            enriched_metadata[key] = value
                
                if record:
                    enriched_metadata.update({
                        "file_id": record.id,
                        "file_name": record.name,
                        "name": record.name,
                        "path": str(record.path),
                        "full_path": str(record.path),
                        "file_path": str(record.path),
                        "extension": record.extension,
                        "size": record.size,
                        "kind": record.kind,
                        "folder_id": record.folder_id,
                    })

                enriched = raw.copy(
                    update={
                        "file_id": record.id if record else file_id,
                        "summary": summary,
                        "snippet": snippet,
                        "chunk_id": raw.chunk_id,
                        "metadata": enriched_metadata,
                    }
                )
                enriched_hits.append(enriched)

            # Return all chunks sorted by score (no aggregation by file_id)
            hits = sorted(enriched_hits, key=lambda item: item.score, reverse=True)
        else:
            candidates = self.storage.files_with_embeddings()
            if file_ids:
                candidates = [c for c in candidates if c.id in file_ids]
            scored: list[tuple[float, SearchHit]] = []
            for record in candidates:
                if record.embedding_vector is None:
                    continue
                score = _cosine_similarity(query_vector, record.embedding_vector)
                scored.append(
                    (
                        score,
                        SearchHit(
                            file_id=record.id,
                            score=score,
                            summary=record.summary,
                            snippet=record.summary[:480] if record.summary else None,
                        ),
                    )
                )
            scored.sort(key=lambda item: item[0], reverse=True)
            hits = [hit for _, hit in scored[: limit * 3]]
        logger.debug(
            "Vector hits for '%s': %s",
            query,
            [(hit.file_id, round(hit.score, 4)) for hit in hits[: min(len(hits), 5)]],
        )
        return hits

    async def _rerank_hits(self, query: str, hits: list[SearchHit], limit: int) -> list[SearchHit]:
        if not hits:
            return []
        try:
            documents: list[str] = []
            for hit in hits:
                chunk_text = self._chunk_text(hit)
                if not chunk_text:
                    chunk_text = (hit.snippet or "") or (hit.summary or "")
                documents.append(chunk_text[:settings.max_snippet_length])
            reranked = await self.rerank_client.rerank(query, documents, top_k=min(limit, len(hits)))
            if not reranked:
                return hits[:limit]
            ordered: list[SearchHit] = []
            seen_chunk_ids = set()
            for idx, score in reranked:
                if 0 <= idx < len(hits):
                    hit = hits[idx]
                    chunk_id = hit.chunk_id or hit.file_id
                    # Deduplicate by chunk_id to avoid returning the same chunk multiple times
                    if chunk_id not in seen_chunk_ids:
                        seen_chunk_ids.add(chunk_id)
                        ordered.append(hit.copy(update={"score": score}))
                        if len(ordered) >= limit:
                            break
            if ordered:
                logger.debug(
                    "Reranked hits for '%s': %s",
                    query,
                    [(hit.file_id, round(hit.score, 4)) for hit in ordered[: min(len(ordered), 5)]],
                )
                return ordered
        except Exception:
            logger.debug("Rerank failed; falling back to vector ordering", exc_info=True)
        return hits[:limit]

    def _lexical_backfill(self, query: str, limit: int, file_ids: list[str] | None = None) -> list[SearchHit]:
        """
        Perform lexical (keyword-based) search as a complement to vector search.
        Fetches more candidates than needed to ensure good coverage for RRF fusion.
        """
        # Fetch 3x more results for better RRF blending
        fallback_hits = self.storage.search_snippets(query, limit=limit * 3, file_ids=file_ids)
        if fallback_hits:
            logger.debug(
                "Lexical hits for '%s': %s",
                query,
                [(hit.file_id, round(hit.score, 4)) for hit in fallback_hits[: min(len(fallback_hits), 5)]],
            )
        return fallback_hits

    def _mandatory_first_blend(self, mandatory: list[SearchHit], supplemental: list[SearchHit], limit: int) -> list[SearchHit]:
        """
        Blend results with mandatory hits first (guaranteed inclusion).
        Mandatory hits always appear first, then supplemental hits fill remaining slots.
        Deduplicates by chunk_id.
        """
        blended: list[SearchHit] = []
        seen_chunks: set[str] = set()

        # Add all mandatory hits first
        for hit in mandatory:
            chunk_key = hit.chunk_id or hit.file_id
            if chunk_key not in seen_chunks:
                blended.append(hit)
                seen_chunks.add(chunk_key)

        # Fill remaining slots with supplemental hits
        for hit in supplemental:
            if len(blended) >= limit:
                break
            chunk_key = hit.chunk_id or hit.file_id
            if chunk_key not in seen_chunks:
                blended.append(hit)
                seen_chunks.add(chunk_key)

        logger.debug(f"Mandatory-first blend: {len(mandatory)} mandatory + {len(blended) - len(mandatory)} supplemental")
        return blended

    def _blend_hits(self, primary: list[SearchHit], secondary: list[SearchHit], limit: int) -> list[SearchHit]:
        """
        Blend vector and lexical search results using Reciprocal Rank Fusion (RRF).
        This gives higher weight to results that appear in both rankings.
        """
        if not secondary:
            return primary[:limit]

        # RRF parameters
        k = 60  # Constant to reduce the impact of high ranks

        # Build chunk-level ranking (not file-level)
        chunk_scores: dict[str, float] = {}
        chunk_hits: dict[str, SearchHit] = {}

        # Process primary (vector) results
        for rank, hit in enumerate(primary, start=1):
            chunk_key = hit.chunk_id or hit.file_id
            rrf_score = 1.0 / (k + rank)
            chunk_scores[chunk_key] = chunk_scores.get(chunk_key, 0.0) + rrf_score
            if chunk_key not in chunk_hits:
                chunk_hits[chunk_key] = hit

        # Process secondary (lexical) results with MUCH higher weight for keyword matches
        # Increased from 1.5 to 3.0 to prioritize exact keyword matches
        lexical_boost = 3.0  # Strong boost for lexical results
        for rank, hit in enumerate(secondary, start=1):
            chunk_key = hit.chunk_id or hit.file_id
            rrf_score = lexical_boost / (k + rank)
            chunk_scores[chunk_key] = chunk_scores.get(chunk_key, 0.0) + rrf_score
            if chunk_key not in chunk_hits:
                chunk_hits[chunk_key] = hit

        # Sort by combined RRF score
        sorted_chunks = sorted(chunk_scores.items(), key=lambda x: x[1], reverse=True)

        # Log top blended results for debugging
        logger.debug("RRF blend - top 5 results:")
        for idx, (chunk_key, score) in enumerate(sorted_chunks[:5], 1):
            hit = chunk_hits[chunk_key]
            logger.debug(f"  {idx}. {self._hit_label(hit)[:60]} (RRF={score:.4f})")

        # Build final result list
        blended: list[SearchHit] = []
        for chunk_key, rrf_score in sorted_chunks[:limit]:
            hit = chunk_hits[chunk_key]
            # Update score to reflect RRF ranking
            blended.append(hit.copy(update={"score": rrf_score}))

        return blended

    async def _maybe_rewrite_query(self, query: str) -> QueryRewriteResult:
        clean = query.strip()
        if not clean:
            return QueryRewriteResult(query, query, [], False)
        if not self._should_rewrite(clean):
            return QueryRewriteResult(query, clean, [], False)

        instructions = (
            "Rewrite the user's retrieval query so embeddings capture intent. Respond strictly with JSON in the form "
            '{"primary": "...", "alternates": ["...", "..."]}. Provide two or three diverse phrasings that emphasise different entities or intent cues. '
            "Keep each rewrite under twelve words and avoid repeating the original verbatim unless necessary."
        )
        try:
            messages = [
                {"role": "system", "content": instructions},
                {"role": "user", "content": f"User query: {clean}\nRewrite succinctly."}
            ]
            raw = await self.llm_client.chat_complete(
                messages,
                max_tokens=160,
                temperature=0.2,
            )
            payload = self._coerce_rewrite_payload(raw)
            primary = str(
                payload.get("primary")
                or payload.get("rewrite")
                or payload.get("rewritten")
                or ""
            ).strip()
            alternates_source = payload.get("alternates") or payload.get("alternatives") or payload.get("queries") or []
            if isinstance(alternates_source, str):
                alternates_iterable = [alternates_source]
            elif isinstance(alternates_source, list):
                alternates_iterable = alternates_source
            else:
                alternates_iterable = []
            seen = {clean.lower()}
            if primary:
                seen.add(primary.lower())
            alternates: list[str] = []
            for item in alternates_iterable:
                candidate = str(item or "").strip()
                if not candidate:
                    continue
                lowered = candidate.lower()
                if lowered in seen:
                    continue
                seen.add(lowered)
                alternates.append(candidate)
                if len(alternates) >= 3:
                    break
            effective = primary or clean
            applied = bool(primary and primary.lower() != clean.lower())
            return QueryRewriteResult(query, effective, alternates, applied)
        except Exception:
            logger.debug("Query rewrite skipped; using literal query", exc_info=True)
            return QueryRewriteResult(query, clean, [], False)

    @staticmethod
    def _coerce_rewrite_payload(raw: str) -> dict[str, Any]:
        if not raw:
            return {}
        start = raw.find("{")
        end = raw.rfind("}")
        if start == -1 or end == -1 or end <= start:
            return {}
        snippet = raw[start: end + 1]
        try:
            data = json.loads(snippet)
            if isinstance(data, dict):
                return data
        except json.JSONDecodeError:
            return {}
        return {}

    @staticmethod
    def _should_rewrite(query: str) -> bool:
        if len(query) < 12:
            return False
        reserved_tokens = (":", " AND ", " OR ", "site:")
        if any(token in query for token in reserved_tokens):
            return False
        return True

    # ============================================
    # Multi-Path Retrieval (Query Decomposition)
    # ============================================

    def _should_use_multi_path(self, query: str) -> bool:
        """
        Determine if a query should use multi-path retrieval.
        
        Multi-path is useful for:
        - Comparative queries (X and Y, X vs Y)
        - Multi-entity queries (multiple years, multiple subjects)
        - Complex questions with multiple aspects
        """
        query_lower = query.lower().strip()
        
        # Pattern 1: Conjunctions indicating multiple aspects
        multi_aspect_patterns = [
            " and ",           # "2023 and 2024"
            " vs ",            # "X vs Y"
            " versus ",        # "X versus Y"
            " or ",            # "A or B"
            " compared to ",   # "A compared to B"
            " between ",       # "difference between A and B"
        ]
        
        for pattern in multi_aspect_patterns:
            if pattern in query_lower:
                return True
        
        # Pattern 2: Multiple years/numbers mentioned
        import re
        years = re.findall(r'\b(19|20)\d{2}\b', query)
        if len(years) >= 2:
            return True
        
        # Pattern 3: Lists (comma-separated items)
        # "patents, publications, and grants"
        if query.count(',') >= 2:
            return True
        
        # Pattern 4: Question words suggesting comparison
        comparison_starters = [
            "compare", "difference", "how do", "what are the differences",
            "similarities", "contrast"
        ]
        for starter in comparison_starters:
            if query_lower.startswith(starter) or f" {starter}" in query_lower:
                return True
        
        return False

    async def _decompose_query(self, query: str) -> list[str]:
        """
        Decompose a complex query into multiple sub-queries using LLM.
        
        Example:
            "How many patents did NTU file in 2023 and 2024"
            → ["How many patents did NTU file in 2023",
               "How many patents did NTU file in 2024"]
        """
        system_prompt = """You are a query decomposition assistant for a document search system.

Your task is to break down a complex query into simpler, independent sub-queries.

Rules:
1. Each sub-query should be a complete, standalone question
2. Preserve the original intent and context in each sub-query
3. Each sub-query should be searchable independently
4. Return 2-4 sub-queries maximum
5. If the query cannot be meaningfully decomposed, return just the original query

Respond with JSON only:
{"sub_queries": ["query1", "query2", ...]}

Examples:

Query: "How many patents did NTU file in 2023 and 2024"
{"sub_queries": ["How many patents did NTU file in 2023", "How many patents did NTU file in 2024"]}

Query: "Compare the revenue and profit of Apple and Microsoft"
{"sub_queries": ["What is Apple's revenue", "What is Apple's profit", "What is Microsoft's revenue", "What is Microsoft's profit"]}

Query: "What is the capital of France"
{"sub_queries": ["What is the capital of France"]}
"""

        try:
            result = await self.llm_client.chat_complete(
                [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Query: {query}"}
                ],
                max_tokens=200,
                temperature=0.1,
            )
            
            # Parse JSON response
            result = result.strip()
            
            # Remove markdown code block if present
            if '```' in result:
                result = re.sub(r'^```(?:json)?\s*\n?', '', result)
                result = re.sub(r'\n?```\s*$', '', result)
                result = result.strip()
            
            # Extract JSON
            json_match = re.search(r'\{[^{}]*\}', result)
            if json_match:
                result = json_match.group(0)
            
            parsed = json.loads(result)
            sub_queries = parsed.get("sub_queries", [query])
            
            # Validate sub-queries
            if not sub_queries or not isinstance(sub_queries, list):
                return [query]
            
            # Filter empty and deduplicate
            seen = set()
            filtered = []
            for sq in sub_queries:
                sq_clean = str(sq).strip()
                if sq_clean and sq_clean.lower() not in seen:
                    seen.add(sq_clean.lower())
                    filtered.append(sq_clean)
            
            if not filtered:
                return [query]
            
            logger.info(f"📊 Query decomposition: '{query}' → {filtered}")
            return filtered[:4]  # Max 4 sub-queries
            
        except Exception as e:
            logger.warning(f"Query decomposition failed: {e}, using original query")
            return [query]

    async def multi_path_search(
        self, 
        query: str, 
        limit: int | None = None,
        file_ids: list[str] | None = None,
    ) -> SearchResponse:
        """
        Execute multi-path retrieval:
        1. Decompose query into sub-queries
        2. Execute searches in parallel
        3. Merge and deduplicate results
        4. Rerank combined results
        """
        if limit is None:
            limit = settings.search_result_limit
        
        started = time.perf_counter()
        steps = StepRecorder()
        
        # Step 1: Decompose query
        decompose_start = time.perf_counter()
        sub_queries = await self._decompose_query(query)
        decompose_duration = int((time.perf_counter() - decompose_start) * 1000)
        
        steps.add(
            id="decompose",
            title="Query decomposition",
            detail=f"Split into {len(sub_queries)} sub-queries",
            queries=sub_queries,
            duration_ms=decompose_duration,
        )
        
        # If only one sub-query, fall back to regular search
        if len(sub_queries) <= 1:
            logger.info("Single sub-query, falling back to regular search")
            return await self.search(sub_queries[0] if sub_queries else query, limit=limit)
        
        # Step 2: Execute parallel searches
        parallel_start = time.perf_counter()
        
        async def search_sub_query(sq: str) -> tuple[str, list[SearchHit], str]:
            """Execute search for a single sub-query."""
            try:
                result = await self._single_path_search(sq, limit=limit, file_ids=file_ids)
                return (sq, result.hits, result.strategy)
            except Exception as e:
                logger.warning(f"Sub-query search failed for '{sq}': {e}")
                return (sq, [], "error")
        
        # Run all searches in parallel
        tasks = [search_sub_query(sq) for sq in sub_queries]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        parallel_duration = int((time.perf_counter() - parallel_start) * 1000)
        
        # Collect results
        sub_query_results: list[SubQueryResult] = []
        all_hits: list[SearchHit] = []
        hit_scores: dict[str, float] = {}  # chunk_id -> best score
        hit_map: dict[str, SearchHit] = {}  # chunk_id -> hit
        
        for result in results:
            if isinstance(result, Exception):
                logger.error(f"Sub-query search exception: {result}")
                continue
            
            sq, hits, strategy = result
            sub_query_results.append(SubQueryResult(
                sub_query=sq,
                hits=hits,
                strategy=strategy,
            ))
            
            # Merge hits with score boosting for overlaps
            for hit in hits:
                chunk_key = hit.chunk_id or hit.file_id
                if chunk_key in hit_scores:
                    # Boost score for hits appearing in multiple sub-query results
                    hit_scores[chunk_key] = max(hit_scores[chunk_key], hit.score) * 1.2
                else:
                    hit_scores[chunk_key] = hit.score
                    hit_map[chunk_key] = hit
        
        steps.add(
            id="parallel_search",
            title="Parallel sub-query search",
            detail=f"Searched {len(sub_queries)} sub-queries in parallel",
            items=[f"{r.sub_query} → {len(r.hits)} hits" for r in sub_query_results],
            duration_ms=parallel_duration,
        )
        
        # Step 3: Build merged hit list with adjusted scores
        merged_hits: list[SearchHit] = []
        for chunk_key, score in sorted(hit_scores.items(), key=lambda x: x[1], reverse=True):
            hit = hit_map[chunk_key]
            merged_hits.append(hit.copy(update={"score": score}))
        
        logger.info(f"Multi-path merged {len(merged_hits)} unique chunks from {len(sub_queries)} sub-queries")
        
        # Step 4: Rerank combined results
        if merged_hits:
            rerank_start = time.perf_counter()
            reranked = await self._rerank_hits(query, merged_hits, limit)
            rerank_duration = int((time.perf_counter() - rerank_start) * 1000)
            
            if reranked:
                steps.add(
                    id="rerank",
                    title="Rerank merged results",
                    detail=f"Reranked {len(merged_hits)} candidates",
                    files=self._step_files(reranked),
                    duration_ms=rerank_duration,
                )
                merged_hits = reranked
        
        # Final deduplication
        final_hits = merged_hits[:limit]
        
        latency_ms = int((time.perf_counter() - started) * 1000)
        diagnostics = steps.snapshot(
            summary=f"Multi-path: {len(sub_queries)} sub-queries → {len(final_hits)} results"
        )
        
        return SearchResponse(
            query=query,
            hits=final_hits,
            rewritten_query=None,
            query_variants=sub_queries,
            strategy="multi_path",
            latency_ms=latency_ms,
            diagnostics=diagnostics,
            sub_queries=sub_queries,
            sub_query_results=sub_query_results,
        )

    async def _single_path_search(
        self, 
        query: str, 
        limit: int | None = None,
        file_ids: list[str] | None = None,
    ) -> SearchResponse:
        """
        Execute a single-path search (the original search logic).
        This is extracted to be called by multi_path_search for each sub-query.
        """
        if limit is None:
            limit = settings.search_result_limit
        
        started = time.perf_counter()
        rewrite = await self._maybe_rewrite_query(query)
        queries_for_embedding = rewrite.variants(include_original=True, limit=4)
        
        steps = StepRecorder()
        steps.add(
            id="rewrite",
            title="Rewrite queries",
            detail=f"Using {len(queries_for_embedding)} variants",
            queries=queries_for_embedding,
        )
        
        primary_query = queries_for_embedding[0] if queries_for_embedding else query
        
        try:
            embeddings = await self.embedding_client.encode(queries_for_embedding)
        except Exception as exc:
            logger.warning("Embedding service unavailable: %s", exc)
            raise EmbeddingUnavailableError("embedding service unavailable") from exc
        
        if not embeddings:
            return SearchResponse(
                query=query,
                hits=[],
                strategy="vector",
                latency_ms=int((time.perf_counter() - started) * 1000),
            )
        
        paired_queries = queries_for_embedding[:len(embeddings)] or [primary_query]
        vector_hits, per_query_hits = self._collect_multi_vector_hits(
            paired_queries, embeddings, limit, file_ids=file_ids
        )
        
        hits = vector_hits
        strategy = "vector"
        
        if hits:
            reranked = await self._rerank_hits(primary_query, hits, limit)
            if reranked:
                hits = reranked
            
            lexical_hits = self._lexical_backfill(primary_query, limit, file_ids=file_ids)
            if lexical_hits:
                hits = self._blend_hits(hits, lexical_hits, limit)
                strategy = "hybrid"
        else:
            lexical_hits = self._lexical_backfill(primary_query, limit, file_ids=file_ids)
            if lexical_hits:
                hits = lexical_hits[:limit]
                strategy = "lexical"
        
        latency_ms = int((time.perf_counter() - started) * 1000)
        return SearchResponse(
            query=query,
            hits=hits[:limit],
            rewritten_query=rewrite.effective if rewrite.applied else None,
            query_variants=rewrite.alternates,
            strategy=strategy,
            latency_ms=latency_ms,
            diagnostics=steps.snapshot(),
        )

    async def _stream_single_query_flow(
        self,
        query: str,
        hits: list[SearchHit],
        sub_query_index: int | None = None,
        total_sub_queries: int | None = None,
    ) -> AsyncIterable[tuple[str, list[dict[str, Any]]]]:
        """
        Core single-query processing flow that can be reused.
        Yields (event_json, valid_sub_answers) tuples.
        
        This is the standard flow: build context → filter → analyze chunks → return sub-answers.
        """
        prefix = ""
        if sub_query_index is not None and total_sub_queries is not None:
            prefix = f"[Sub-query {sub_query_index}/{total_sub_queries}] "
        
        # Build context_parts with file_id and chunk_id for matching
        context_parts: List[Dict[str, Any]] = []
        for idx, hit in enumerate(hits, 1):
            chunk_text = self._chunk_text(hit)
            kind = hit.metadata.get("kind") if hit.metadata else None
            if kind == "image":
                parts = []
                if hit.summary:
                    parts.append(f"[Image Description]: {hit.summary}")
                if chunk_text:
                    parts.append(f"[Image Text]: {chunk_text}")
                snippet = "\n".join(parts)
                if not snippet:
                    snippet = hit.snippet
            else:
                snippet = chunk_text or hit.snippet or hit.summary
            
            if snippet:
                source = hit.metadata.get("path") if hit.metadata else None
                label = source or hit.file_id
                context_parts.append({
                    "index": idx,
                    "source": label,
                    "content": snippet[:settings.max_snippet_length],
                    "score": hit.score if hasattr(hit, 'score') else 0.0,
                    "file_id": hit.file_id,
                    "chunk_id": hit.chunk_id,
                })
        
        if not context_parts:
            yield (json.dumps({"type": "token", "data": f"{prefix}⚠️ No valid content found.\n\n"}) + "\n", [])
            return
        
        # Filter relevant chunks
        filtered_parts = await self._filter_relevant_chunks(query, context_parts)

        yield (json.dumps({
            "type": "status",
            "data": f"analyzing_{len(filtered_parts)}_chunks"
        }) + "\n", [])

        # Process chunks in parallel with streaming progress
        sub_answers = []
        chunk_analysis = []

        async for chunk_data in self._process_chunks_parallel_streaming(query, filtered_parts):
            event_type = chunk_data.get("event_type", "chunk_complete")

            if event_type == "all_complete":
                continue

            if event_type == "chunk_complete":
                ans = chunk_data["result"]
                sub_answers.append(ans)

                # Get the original context part to include file_id and chunk_id
                original_part = next(
                    (p for p in context_parts if p.get("index") == ans.get("index")),
                    {}
                )

                analysis_item = {
                    "index": ans.get("index"),
                    "has_answer": ans.get("has_answer", False),
                    "comment": ans.get("content", "") or None,
                    "confidence": ans.get("confidence", 0.0),
                    "source": ans.get("source", ""),
                    "file_id": original_part.get("file_id", ""),
                    "chunk_id": original_part.get("chunk_id", ""),
                    "sub_query_index": sub_query_index,
                }
                chunk_analysis.append(analysis_item)

                # Send progress update for Multi-Path
                yield (json.dumps({
                    "type": "chunk_progress",
                    "data": {
                        "processed_count": chunk_data["processed_count"],
                        "total_count": chunk_data["total_count"],
                        "high_quality_count": chunk_data["high_quality_count"],
                        "is_last": chunk_data["is_last"],
                        "current_file": chunk_data["file_name"],
                        "chunk_result": analysis_item,
                        "sub_query_index": sub_query_index,
                    }
                }) + "\n", [])

        # Send final chunk_analysis for compatibility
        yield (json.dumps({"type": "chunk_analysis", "data": chunk_analysis}) + "\n", [])
        
        # Filter valid sub_answers - keep answers with meaningful content
        # The confidence is just a hint, but actual content matters more
        valid_sub_answers = [
            ans for ans in sub_answers 
            if (
                ans.get("has_answer") 
                and ans.get("content")
                and len(ans.get("content", "").strip()) > 20  # Filter out too-short answers
                and not self._is_negative_response(ans.get("content", ""))
            )
        ]
        
        # Return valid_sub_answers for caller to use
        yield ("", valid_sub_answers)

    async def _stream_multi_path_answer(
        self,
        payload: QaRequest,
        limit: int,
    ) -> AsyncIterable[str]:
        """
        Stream multi-path retrieval with structured thinking steps for visualization.
        Sends both thinking_step events (for UI) and token events (for text display).
        """
        query = payload.query
        step_counter = 0
        
        def next_step_id() -> str:
            nonlocal step_counter
            step_counter += 1
            return f"step_{step_counter}"
        
        def thinking_step(
            step_id: str,
            step_type: str,
            title: str,
            status: str = "running",
            summary: str | None = None,
            details: str | None = None,
            metadata: dict | None = None
        ) -> str:
            return json.dumps({
                "type": "thinking_step",
                "data": {
                    "id": step_id,
                    "type": step_type,
                    "title": title,
                    "status": status,
                    "summary": summary,
                    "details": details,
                    "metadata": metadata or {}
                }
            }) + "\n"
        
        # ============================================
        # Step 1: Try Query Decomposition FIRST (before entering multi-path mode)
        # ============================================
        yield json.dumps({"type": "status", "data": "decomposing_query"}) + "\n"
        
        sub_queries = await self._decompose_query(query)
        logger.info(f"🔀 Multi-path decomposition: {query} → {sub_queries}")
        
        if len(sub_queries) <= 1:
            # Cannot decompose - signal caller to fall back to standard search completely
            # This will exit multi-path mode and let the caller run the full standard search flow
            logger.info(f"📝 Query cannot be decomposed, signaling fallback to standard search for: {query}")
            yield json.dumps({"type": "fallback_to_standard"}) + "\n"
            return
        
        # ============================================
        # Query CAN be decomposed - NOW enter multi-path mode
        # ============================================
        yield json.dumps({"type": "multi_path_start", "data": {"query": query}}) + "\n"
        
        decompose_id = next_step_id()
        # Decomposition already complete
        sub_query_list = "\n".join([f"{i+1}. {sq}" for i, sq in enumerate(sub_queries)])
        yield thinking_step(decompose_id, "decompose", "Query Decomposed", "complete",
                           f"Split into {len(sub_queries)} sub-queries",
                           details=sub_query_list,
                           metadata={"totalSubQueries": len(sub_queries)})
        
        # ============================================
        # Step 2: Execute Each Sub-Query
        # ============================================
        all_sub_query_answers: list[dict[str, Any]] = []
        hit_scores: dict[str, float] = {}
        hit_map: dict[str, SearchHit] = {}
        
        for idx, sq in enumerate(sub_queries, 1):
            # Sub-query search step
            search_id = next_step_id()
            yield thinking_step(search_id, "subquery", f"Sub-query {idx}/{len(sub_queries)}", "running",
                               sq,
                               metadata={"subQueryIndex": idx, "totalSubQueries": len(sub_queries)})
            yield json.dumps({"type": "status", "data": f"searching_subquery_{idx}_of_{len(sub_queries)}"}) + "\n"
            
            # Search
            try:
                sub_search = await self._single_path_search(sq, limit=limit)
            except Exception as e:
                logger.error(f"Sub-query search failed for '{sq}': {e}")
                yield thinking_step(search_id, "subquery", f"Sub-query {idx} Failed", "error", str(e))
                continue
            
            if not sub_search.hits:
                yield thinking_step(search_id, "subquery", f"Sub-query {idx}: No Results", "complete",
                                   "No matching documents found")
                continue
            
            # Get source files
            sources = list(set(
                hit.metadata.get("path", hit.file_id) if hit.metadata else hit.file_id 
                for hit in sub_search.hits[:5]
            ))
            
            yield thinking_step(search_id, "search", f"Search Complete ({idx}/{len(sub_queries)})", "complete",
                               f"Found {len(sub_search.hits)} results using {sub_search.strategy}",
                               metadata={
                                   "subQueryIndex": idx,
                                   "totalSubQueries": len(sub_queries),
                                   "resultsCount": len(sub_search.hits),
                                   "strategy": sub_search.strategy,
                                   "sources": sources[:3]
                               })
            
            # Send hits for frontend
            yield json.dumps({
                "type": "subquery_hits", 
                "data": {
                    "sub_query_index": idx,
                    "sub_query": sq,
                    "hits": [hit.dict() for hit in sub_search.hits]
                }
            }) + "\n"
            
            # Merge hits
            for hit in sub_search.hits:
                chunk_key = hit.chunk_id or hit.file_id
                if chunk_key in hit_scores:
                    hit_scores[chunk_key] = max(hit_scores[chunk_key], hit.score) * 1.2
                else:
                    hit_scores[chunk_key] = hit.score
                    hit_map[chunk_key] = hit
            
            # Analyze step
            analyze_id = next_step_id()
            yield thinking_step(analyze_id, "analyze", f"Analyzing Chunks ({idx}/{len(sub_queries)})", "running",
                               f"Processing {len(sub_search.hits)} chunks...")
            
            valid_answers_for_sq: list[dict[str, Any]] = []
            async for event, answers in self._stream_single_query_flow(
                query=sq,
                hits=sub_search.hits,
                sub_query_index=idx,
                total_sub_queries=len(sub_queries),
            ):
                if event:
                    yield event
                if answers:
                    valid_answers_for_sq = answers
            
            if valid_answers_for_sq:
                # Generate answer for this sub-query
                sq_answer = await self._aggregate_sub_answers(query=sq, sub_answers=valid_answers_for_sq)
                top_sources = list(set(ans.get("source", "") for ans in valid_answers_for_sq[:3]))
                
                # Send analysis complete with the answer
                yield json.dumps({
                    "type": "thinking_step",
                    "data": {
                        "id": analyze_id,
                        "type": "analyze",
                        "title": f"Analysis Complete ({idx}/{len(sub_queries)})",
                        "status": "complete",
                        "summary": f"Found {len(valid_answers_for_sq)} relevant chunks",
                        "subQueryAnswer": sq_answer,
                        "subQuery": sq,
                        "metadata": {
                            "subQueryIndex": idx,
                            "relevantCount": len(valid_answers_for_sq),
                            "sources": top_sources[:3]
                        }
                    }
                }) + "\n"
                
                all_sub_query_answers.append({
                    "sub_query": sq,
                    "answer": sq_answer,
                    "index": idx,
                    "sources": top_sources[:3],
                })
            else:
                yield thinking_step(analyze_id, "analyze", f"Analysis Complete ({idx}/{len(sub_queries)})", "complete",
                                   "No relevant information found",
                                   metadata={"subQueryIndex": idx})
        
        # ============================================
        # Step 3: Merge Results
        # ============================================
        merge_id = next_step_id()
        yield thinking_step(merge_id, "merge", "Merging Results", "running",
                           f"Combining {len(hit_scores)} unique results...")
        yield json.dumps({"type": "status", "data": "merging_results"}) + "\n"
        
        merged_hits: list[SearchHit] = []
        for chunk_key, score in sorted(hit_scores.items(), key=lambda x: x[1], reverse=True):
            hit = hit_map[chunk_key]
            merged_hits.append(hit.copy(update={"score": score}))
        
        if merged_hits:
            reranked = await self._rerank_hits(query, merged_hits, limit)
            if reranked:
                merged_hits = reranked
            
            final_hits = merged_hits[:limit]
            yield json.dumps({"type": "hits", "data": [hit.dict() for hit in final_hits]}) + "\n"
            
            yield thinking_step(merge_id, "merge", "Results Merged", "complete",
                               f"Consolidated {len(final_hits)} unique sources",
                               metadata={"resultsCount": len(final_hits)})
        else:
            yield thinking_step(merge_id, "merge", "Merge Complete", "complete", "No results to merge")
        
        # ============================================
        # Step 4: Synthesize Final Answer
        # ============================================
        synthesize_id = next_step_id()
        yield thinking_step(synthesize_id, "synthesize", "Synthesizing Answer", "running",
                           f"Combining {len(all_sub_query_answers)} partial answers...")
        yield json.dumps({"type": "status", "data": "synthesizing_answer"}) + "\n"
        
        if not all_sub_query_answers:
            yield thinking_step(synthesize_id, "synthesize", "No Answer Found", "error",
                               "Could not find relevant information")
            yield json.dumps({"type": "multi_path_end"}) + "\n"
            yield json.dumps({"type": "done", "data": "I cannot find relevant information in your documents for this query."}) + "\n"
            return
        
        # Build synthesis
        synthesis_parts = []
        for sa in all_sub_query_answers:
            synthesis_parts.append(f"[{sa['index']}] {sa['sub_query']}: {sa['answer']}")
        
        synthesis_prompt = (
            f"Original question: {query}\n\n"
            "Partial answers from sub-queries:\n" + "\n".join(synthesis_parts) + "\n\n"
            "Task: Combine these partial answers into a coherent, comprehensive response. "
            "Keep citations using [1], [2] format. Be concise (2-4 sentences). "
            "Address each aspect of the original question."
        )
        
        try:
            final_answer = await self.llm_client.chat_complete(
                [{"role": "user", "content": synthesis_prompt}],
                max_tokens=400,
                temperature=0.2,
            )
            
            yield thinking_step(synthesize_id, "synthesize", "Answer Synthesized", "complete",
                               "Final answer generated successfully")
            
            # Send final answer as token
            yield json.dumps({"type": "token", "data": final_answer.strip()}) + "\n"
            
        except Exception as e:
            logger.error(f"Final synthesis failed: {e}")
            yield thinking_step(synthesize_id, "synthesize", "Synthesis Complete", "complete",
                               "Combined partial answers")
            # Fallback: combine partial answers
            combined = "\n".join([f"[{sa['index']}] {sa['answer']}" for sa in all_sub_query_answers])
            yield json.dumps({"type": "token", "data": combined}) + "\n"
        
        yield json.dumps({"type": "multi_path_end"}) + "\n"
        yield json.dumps({"type": "done"}) + "\n"

    async def _multi_path_answer(
        self,
        query: str,
        sub_queries: list[str],
        sub_query_results: list[SubQueryResult],
        hits: list[SearchHit],
    ) -> str:
        """
        Synthesize a final answer from multi-path retrieval results.
        Each sub-query's results are processed and combined.
        """
        # Process each sub-query to extract partial answers
        sub_answers: list[dict[str, Any]] = []
        
        for sq_result in sub_query_results:
            if not sq_result.hits:
                continue
            
            # Get context from this sub-query's hits
            context_parts = []
            for hit in sq_result.hits[:3]:  # Top 3 hits per sub-query
                chunk_text = self._chunk_text(hit)
                snippet = chunk_text or hit.snippet or hit.summary
                if snippet:
                    source = hit.metadata.get("path") if hit.metadata else None
                    label = source or hit.file_id
                    context_parts.append(f"{label}: {snippet[:800]}")
            
            if not context_parts:
                continue
            
            # Extract answer for this sub-query
            context = "\n\n".join(context_parts)
            sub_prompt = (
                f"Question: {sq_result.sub_query}\n\n"
                f"Context:\n{context}\n\n"
                "Extract a concise answer (1-2 sentences) from the context. "
                "If not found, say 'Not found'."
            )
            
            try:
                sub_answer = await self.llm_client.chat_complete(
                    [{"role": "user", "content": sub_prompt}],
                    max_tokens=150,
                    temperature=0.1,
                )
                
                if sub_answer and "not found" not in sub_answer.lower():
                    sub_answers.append({
                        "sub_query": sq_result.sub_query,
                        "answer": sub_answer.strip(),
                        "sources": [h.file_id for h in sq_result.hits[:2]],
                    })
            except Exception as e:
                logger.warning(f"Failed to extract sub-answer for '{sq_result.sub_query}': {e}")
        
        if not sub_answers:
            return "I cannot find relevant information in your documents for this query."
        
        # Synthesize final answer
        synthesis_parts = []
        for idx, sa in enumerate(sub_answers, 1):
            synthesis_parts.append(f"[{idx}] {sa['sub_query']}: {sa['answer']}")
        
        synthesis_prompt = (
            f"Original question: {query}\n\n"
            "Partial answers from sub-queries:\n" + "\n".join(synthesis_parts) + "\n\n"
            "Task: Combine these partial answers into a coherent, comprehensive response. "
            "Keep citations using [1], [2] format. Be concise (2-4 sentences)."
        )
        
        try:
            final_answer = await self.llm_client.chat_complete(
                [{"role": "user", "content": synthesis_prompt}],
                max_tokens=300,
                temperature=0.2,
            )
            return final_answer.strip()
        except Exception as e:
            logger.error(f"Final synthesis failed: {e}")
            # Fallback: concatenate sub-answers
            return " ".join(sa["answer"] for sa in sub_answers)