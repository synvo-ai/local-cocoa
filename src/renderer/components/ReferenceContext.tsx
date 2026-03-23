import { useEffect, useState } from 'react';
import { FileText, Layers } from 'lucide-react';
import type { SearchHit } from '../types';
import { cn } from '../lib/utils';

export function getReferenceLabel(reference: SearchHit): { name: string; location: string } {
    const metadata = reference.metadata ?? {};
    const name = (metadata.title || metadata.subject || metadata.file_name || metadata.name || metadata.filename) as string | undefined;
    const location = (metadata.path || metadata.file_path || metadata.full_path || '') as string | undefined;

    if (name && location) {
        return { name: String(name), location: String(location) };
    }

    if (location) {
        const normalised = String(location).replace(/\\/g, '/');
        const segments = normalised.split('/').filter(Boolean);
        const derivedName = segments[segments.length - 1] ?? `File ${reference.fileId}`;
        return { name: derivedName, location: String(location) };
    }

    if (name) {
        return { name: String(name), location: '' };
    }

    return { name: `File ${reference.fileId}`, location: '' };
}

function ReferenceItem({ reference, index, onPreview }: { reference: SearchHit, index: number, onPreview: (ref: SearchHit) => void }) {
    const [expanded, setExpanded] = useState(false);
    const { name, location } = getReferenceLabel(reference);
    const snippet = reference.snippet || reference.summary;
    const isClickable = !!(reference.fileId || location);

    // Chunk analysis info
    const hasAnswer = reference.hasAnswer;
    const analysisComment = reference.analysisComment;
    const _confidence = reference.analysisConfidence ?? 0;

    // Determine if this chunk was analyzed (hasAnswer is defined means it was analyzed)
    const wasAnalyzed = hasAnswer !== undefined;

    // Check if comment indicates no relevant information
    const commentUpper = analysisComment?.toUpperCase() ?? '';
    const noAnswerPatterns = [
        'NO_ANSWER',
        'NO ANSWER',
        'DOES NOT PROVIDE',
        'DOES NOT CONTAIN',
        "DOESN'T PROVIDE",
        "DOESN'T CONTAIN",
        'NOT PROVIDE SPECIFIC',
        'NOT CONTAIN SPECIFIC',
        'NO SPECIFIC',
        'NO RELEVANT',
        'NOT RELEVANT',
        'CANNOT ANSWER',
        "CAN'T ANSWER",
        'NO INFORMATION',
        'NOT MENTIONED',
        "DOESN'T MENTION",
        'DOES NOT MENTION',
    ];
    const containsNoAnswer = noAnswerPatterns.some(pattern => commentUpper.includes(pattern));
    const isRelevant = hasAnswer === true && !containsNoAnswer;

    // Extract page information from metadata
    const metadata = reference.metadata ?? {};
    const pageStart = metadata.page_start ?? metadata.page_number ?? null;
    const pageEnd = metadata.page_end ?? null;
    const pageNumbers = metadata.page_numbers as number[] | undefined;

    // Format page display
    let pageDisplay = '';
    if (pageStart) {
        if (pageEnd && pageEnd !== pageStart) {
            pageDisplay = `Page ${pageStart}-${pageEnd}`;
        } else {
            pageDisplay = `Page ${pageStart}`;
        }
    } else if (pageNumbers && pageNumbers.length > 0) {
        if (pageNumbers.length === 1) {
            pageDisplay = `Page ${pageNumbers[0]}`;
        } else {
            pageDisplay = `Page ${pageNumbers[0]}-${pageNumbers[pageNumbers.length - 1]}`;
        }
    }

    // Confidence badge color
    const getConfidenceBadge = () => {
        if (!wasAnalyzed) return null;

        if (!isRelevant) {
            return (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400">
                    Not relevant
                </span>
            );
        }

        return (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                Relevant
            </span>
        );
    };

    return (
        <div className={cn(
            "group rounded-lg border text-left transition-all duration-300 hover:shadow-sm",
            wasAnalyzed && isRelevant
                ? "bg-card border-green-200 dark:border-green-800/50 animate-in fade-in-50 duration-300"
                : wasAnalyzed && !isRelevant
                    ? "bg-red-50/30 dark:bg-red-900/5 border-red-200 dark:border-red-800/30 opacity-70 animate-in fade-in-50 duration-300"
                    : "bg-card border-muted"
        )}>
            <button
                onClick={() => isClickable && onPreview(reference)}
                className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 rounded-t-lg transition-colors",
                    isClickable ? "hover:bg-accent/50 cursor-pointer" : "cursor-default opacity-80"
                )}
            >
                <div className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold",
                    wasAnalyzed && isRelevant
                        ? "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-400"
                        : wasAnalyzed && !isRelevant
                            ? "bg-red-100 text-red-600 dark:bg-red-900/50 dark:text-red-400"
                            : "bg-muted text-muted-foreground"
                )}>
                    {index + 1}
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <p className="truncate text-xs font-medium text-foreground">{name}</p>
                        {getConfidenceBadge()}
                    </div>
                    <div className="flex items-center gap-2">
                        {location && <p className="truncate text-[10px] text-muted-foreground">{location}</p>}
                        {pageDisplay && (
                            <>
                                {location && <span className="text-[10px] text-muted-foreground">•</span>}
                                <p className="text-[10px] text-muted-foreground font-medium">{pageDisplay}</p>
                            </>
                        )}
                        {reference.score > 0 && (
                            <>
                                {(location || pageDisplay) && <span className="text-[10px] text-muted-foreground">•</span>}
                                <p className="text-[10px] text-muted-foreground font-mono">{reference.score.toFixed(2)}</p>
                            </>
                        )}
                    </div>
                </div>
                {isClickable && (
                    <FileText className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                )}
            </button>

            {/* LLM Analysis Comment */}
            {analysisComment && (
                <div className={cn(
                    "border-t px-3 py-2",
                    isRelevant
                        ? "border-green-200 dark:border-green-800/30 bg-green-50/50 dark:bg-green-900/10"
                        : "border-red-200 dark:border-red-800/30 bg-red-50/50 dark:bg-red-900/10"
                )}>
                    <p className={cn(
                        "text-[10px] leading-relaxed",
                        isRelevant
                            ? "text-green-700 dark:text-green-400"
                            : "text-red-600 dark:text-red-400"
                    )}>
                        <span className="font-medium">AI Analysis: </span>
                        {analysisComment}
                    </p>
                </div>
            )}

            {/* Original Snippet */}
            {snippet && (
                <div
                    className="border-t bg-muted/20 px-3 py-2 cursor-pointer hover:bg-muted/30"
                    onClick={() => setExpanded(!expanded)}
                    title="Click to expand/collapse"
                >
                    <p className={cn(
                        "text-[10px] text-muted-foreground font-mono leading-relaxed",
                        expanded ? "" : "line-clamp-3"
                    )}>
                        {snippet}
                    </p>
                </div>
            )}
        </div>
    );
}

export function RecalledContext({ references, onPreview, isComplete, analysisProgress }: {
    references: SearchHit[],
    onPreview: (ref: SearchHit) => void,
    isComplete: boolean,
    analysisProgress?: {
        processedCount: number;
        totalCount: number;
        highQualityCount: number;
        batchNum: number;
        totalBatches: number;
        currentFiles?: string[];
        isProcessing?: boolean;
        isPreparing?: boolean;
        isComplete: boolean;
    }
}) {
    // Start collapsed, expand when we have references and are still processing
    const [isExpanded, setIsExpanded] = useState(false);
    const [showNotRelevant, setShowNotRelevant] = useState(false);
    const [hasExpandedOnce, setHasExpandedOnce] = useState(false);

    // Check if analysis is in progress
    const isAnalyzing = analysisProgress && !analysisProgress.isComplete;

    // Auto-expand when we have references and processing isn't complete (only once)
    useEffect(() => {
        if (references.length > 0 && !isComplete && !hasExpandedOnce) {
            setIsExpanded(true);
            setHasExpandedOnce(true);
        }
    }, [references.length, isComplete, hasExpandedOnce]);

    if (!references || references.length === 0) return null;

    // Helper to check if a reference is truly relevant (has answer and no negative patterns)
    // NOTE: Patterns are split into two categories:
    // 1. Explicit markers (NO_ANSWER, NO ANSWER) - checked globally (LLM's explicit signal)
    // 2. Contextual phrases - checked only in first sentence to avoid false positives
    const isTrulyRelevant = (r: SearchHit) => {
        if (r.hasAnswer !== true) return false;
        const comment = r.analysisComment?.toUpperCase() ?? '';

        // Explicit markers - check globally (LLM's clear signal)
        const explicitMarkers = ['NO_ANSWER', 'NO ANSWER'];
        if (explicitMarkers.some(marker => comment.includes(marker))) {
            return false;
        }

        // Contextual patterns - only check in first sentence to avoid false positives
        const firstSentence = comment.split(/[.?!]\s/)[0] || comment;
        const contextualPatterns = [
            'DOES NOT PROVIDE', 'DOES NOT CONTAIN',
            "DOESN'T PROVIDE", "DOESN'T CONTAIN", 'NOT PROVIDE SPECIFIC',
            'NOT CONTAIN SPECIFIC', 'NO SPECIFIC', 'NO RELEVANT', 'NOT RELEVANT',
            'CANNOT ANSWER', "CAN'T ANSWER", 'NO INFORMATION', 'NOT MENTIONED',
            "DOESN'T MENTION", 'DOES NOT MENTION'
        ];
        return !contextualPatterns.some(pattern => firstSentence.includes(pattern));
    };

    // Calculate stats for analyzed chunks
    const analyzedRefs = references.filter(r => r.hasAnswer !== undefined);
    const relevantRefs = references.filter(isTrulyRelevant);
    const notRelevantRefs = analyzedRefs.filter(r => !isTrulyRelevant(r));
    const hasAnalysis = analyzedRefs.length > 0;

    // Sort relevant references by confidence
    const sortedRelevantRefs = [...relevantRefs].sort((a, b) => {
        return (b.analysisConfidence ?? 0) - (a.analysisConfidence ?? 0);
    });

    // Sort not relevant references by confidence as well
    const sortedNotRelevantRefs = [...notRelevantRefs].sort((a, b) => {
        return (b.analysisConfidence ?? 0) - (a.analysisConfidence ?? 0);
    });

    // For references without analysis, keep original order
    const unanalyzedRefs = references.filter(r => r.hasAnswer === undefined);

    return (
        <div className="rounded-lg border bg-card overflow-hidden mb-4 transition-all duration-300 ease-in-out">
            <div className="flex items-center justify-between bg-card px-4 py-3 border-b border-transparent data-[expanded=true]:border-border" data-expanded={isExpanded}>
                <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full border border-primary/30 bg-primary/5 text-primary">
                        <Layers className="h-4 w-4" />
                    </div>
                    <div className="flex flex-col items-start flex-1">
                        <span className="text-sm font-medium">Recalled Context</span>
                        {isAnalyzing ? (
                            <div className="flex flex-col gap-1 w-full max-w-[320px]">
                                {analysisProgress.isPreparing ? (
                                    // Preparing state - waiting for first chunk
                                    <>
                                        <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                                            <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                                            Starting analysis of {analysisProgress.totalCount} sources...
                                        </span>
                                        <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                                            <div className="h-full rounded-full bg-primary/50 animate-pulse w-[10%]" />
                                        </div>
                                    </>
                                ) : (
                                    // Active analysis - show progress and current file
                                    <>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs text-muted-foreground">
                                                Analyzed {analysisProgress.processedCount}/{analysisProgress.totalCount}
                                            </span>
                                            {analysisProgress.highQualityCount > 0 && (
                                                <span className="text-[10px] text-green-600 dark:text-green-400">
                                                    {analysisProgress.highQualityCount} relevant
                                                </span>
                                            )}
                                        </div>
                                        <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                                            <div
                                                className="h-full rounded-full transition-all duration-200 ease-out bg-primary"
                                                style={{
                                                    width: `${(analysisProgress.processedCount / analysisProgress.totalCount) * 100}%`
                                                }}
                                            />
                                        </div>
                                        {analysisProgress.currentFiles && analysisProgress.currentFiles.length > 0 && (
                                            <span className="text-[10px] text-muted-foreground/70 truncate flex items-center gap-1">
                                                <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                                                {analysisProgress.currentFiles[0]}
                                            </span>
                                        )}
                                    </>
                                )}
                            </div>
                        ) : hasAnalysis ? (
                            <span className="text-xs text-muted-foreground">
                                <span className="text-green-600 dark:text-green-400 font-medium">{relevantRefs.length} relevant</span>
                                {' / '}
                                {references.length} sources
                            </span>
                        ) : !isComplete ? (
                            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                                <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                                Found {references.length} sources, preparing analysis...
                            </span>
                        ) : (
                            <span className="text-xs text-muted-foreground">
                                {references.length} sources referenced
                            </span>
                        )}
                    </div>
                </div>
                <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="text-xs font-medium text-primary hover:underline focus:outline-none"
                >
                    {isExpanded ? 'Hide details' : 'Show details'}
                </button>
            </div>

            {isExpanded && (
                <div className="bg-background p-4 animate-in slide-in-from-top-2 duration-200">
                    {/* Relevant sources */}
                    {sortedRelevantRefs.length > 0 && (
                        <div className="grid gap-2 sm:grid-cols-1">
                            {sortedRelevantRefs.map((reference, idx) => (
                                <ReferenceItem
                                    key={`relevant-${reference.fileId}-${idx}`}
                                    reference={reference}
                                    index={references.indexOf(reference)}
                                    onPreview={onPreview}
                                />
                            ))}
                        </div>
                    )}

                    {/* Unanalyzed sources (show normally) */}
                    {unanalyzedRefs.length > 0 && (
                        <div className={cn("grid gap-2 sm:grid-cols-1", sortedRelevantRefs.length > 0 && "mt-2")}>
                            {unanalyzedRefs.map((reference, idx) => (
                                <ReferenceItem
                                    key={`unanalyzed-${reference.fileId}-${idx}`}
                                    reference={reference}
                                    index={references.indexOf(reference)}
                                    onPreview={onPreview}
                                />
                            ))}
                        </div>
                    )}

                    {/* Collapsible not-relevant section */}
                    {notRelevantRefs.length > 0 && (
                        <div className={cn(
                            "mt-3 rounded-lg border border-dashed transition-all duration-200",
                            showNotRelevant
                                ? "border-muted-foreground/30 bg-muted/20"
                                : "border-muted-foreground/20 hover:border-muted-foreground/30 bg-muted/10"
                        )}>
                            <button
                                onClick={() => setShowNotRelevant(!showNotRelevant)}
                                className="w-full flex items-center justify-between px-3 py-2.5 text-left group"
                            >
                                <div className="flex items-center gap-2">
                                    <div className={cn(
                                        "flex h-5 w-5 items-center justify-center rounded transition-transform duration-200",
                                        showNotRelevant ? "rotate-90" : ""
                                    )}>
                                        <svg
                                            className="h-3 w-3 text-muted-foreground"
                                            fill="none"
                                            viewBox="0 0 24 24"
                                            stroke="currentColor"
                                        >
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                        </svg>
                                    </div>
                                    <span className="text-xs text-muted-foreground">
                                        <span className="font-medium">{notRelevantRefs.length}</span>
                                        {' '}other source{notRelevantRefs.length !== 1 ? 's' : ''} not directly relevant
                                    </span>
                                </div>
                                <span className="text-[10px] text-muted-foreground/70 opacity-0 group-hover:opacity-100 transition-opacity">
                                    {showNotRelevant ? 'Click to collapse' : 'Click to expand'}
                                </span>
                            </button>

                            {showNotRelevant && (
                                <div className="px-3 pb-3 pt-1 grid gap-2 sm:grid-cols-1 animate-in slide-in-from-top-2 duration-200">
                                    {sortedNotRelevantRefs.map((reference, idx) => (
                                        <ReferenceItem
                                            key={`not-relevant-${reference.fileId}-${idx}`}
                                            reference={reference}
                                            index={references.indexOf(reference)}
                                            onPreview={onPreview}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Empty state when no relevant sources */}
                    {sortedRelevantRefs.length === 0 && unanalyzedRefs.length === 0 && notRelevantRefs.length > 0 && !showNotRelevant && (
                        <div className="text-center py-2 text-xs text-muted-foreground">
                            No directly relevant sources found. Expand above to see all retrieved sources.
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
