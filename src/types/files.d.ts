export type FileKind =
    | 'document'
    | 'image'
    | 'presentation'
    | 'spreadsheet'
    | 'audio'
    | 'video'
    | 'archive'
    | 'code'
    | 'book'
    | 'other';

export type FileIndexStatus = 'pending' | 'indexed' | 'error';
export type StageValue = 0 | 1 | 2 | -1 | -2;
export type MemoryStatus = 'pending' | 'extracted' | 'skipped' | 'error';
export type PrivacyLevel = 'normal' | 'private';

export interface FolderRecord {
    id: string;
    label: string;
    path: string;
    createdAt: string;
    updatedAt: string;
    lastIndexedAt: string | null;
    enabled: boolean;
    privacyLevel?: PrivacyLevel;
}

export interface MonitoredFolder extends FolderRecord { }

export interface FileRecord {
    id: string;
    folderId: string;
    path: string;
    name: string;
    extension: string;
    size: number;
    modifiedAt: string;
    createdAt: string;
    kind: FileKind;
    summary?: string | null;
    metadata?: Record<string, unknown>;
    // Index status tracking
    indexStatus?: FileIndexStatus;
    errorReason?: string | null;
    errorAt?: string | null;
    // Two-round indexing stages
    fastStage?: StageValue;
    fastTextAt?: string | null;
    fastEmbedAt?: string | null;
    deepStage?: StageValue;
    deepTextAt?: string | null;
    deepEmbedAt?: string | null;
    // Memory extraction status
    memoryStatus?: MemoryStatus;
    memoryExtractedAt?: string | null;
    // Privacy level
    privacyLevel?: PrivacyLevel;
}

export interface IndexedFile extends FileRecord {
    location: string;
    fullPath: string;
}

export interface IndexResultSnapshot {
    files: IndexedFile[];
    startedAt: string;
    completedAt: string;
    totalCount: number;
    totalSize: number;
    byKind: Record<FileKind, number>;
    byLocation: Record<string, number>;
}

export interface IndexProgressUpdate {
    status: 'idle' | 'running' | 'paused' | 'failed' | 'completed';
    startedAt?: string | null;
    completedAt?: string | null;
    processed: number;
    total?: number | null;
    message?: string | null;
    lastError?: string | null;
}

export interface IndexSummary {
    filesIndexed: number;
    totalSizeBytes: number;
    foldersIndexed: number;
    lastCompletedAt: string | null;
}

export interface HealthStatus {
    status: 'idle' | 'indexing' | 'ready' | 'degraded';
    indexedFiles: number;
    watchedFolders: number;
    message?: string | null;
}

export interface FileListResponse {
    files: FileRecord[];
    total: number;
}

export interface SearchHit {
    fileId: string;
    score: number;
    summary?: string | null;
    snippet?: string | null;
    metadata: Record<string, unknown>;
    chunkId?: string | null;
}

export interface AgentStepFile {
    fileId: string;
    label: string;
    score?: number | null;
}

export interface AgentStep {
    id: string;
    title: string;
    detail?: string | null;
    status?: 'running' | 'complete' | 'skipped' | 'error';
    queries?: string[];
    items?: string[];
    files?: AgentStepFile[];
    durationMs?: number | null;
}

export interface AgentDiagnostics {
    steps: AgentStep[];
    summary?: string | null;
}

export interface SearchResponse {
    query: string;
    hits: SearchHit[];
    rewrittenQuery?: string | null;
    queryVariants?: string[];
    strategy?: 'vector' | 'hybrid' | 'lexical';
    latencyMs?: number | null;
    diagnostics?: AgentDiagnostics;
}

export interface QaResponse {
    answer: string;
    hits: SearchHit[];
    latencyMs: number;
    rewrittenQuery?: string | null;
    queryVariants?: string[];
    diagnostics?: AgentDiagnostics;
}

export interface ModelAssetStatus {
    id: string;
    label: string;
    path: string;
    exists: boolean;
    sizeBytes: number | null;
    optional?: boolean;
}

export interface ModelStatusSummary {
    assets: ModelAssetStatus[];
    ready: boolean;
    missing: string[];
    lastCheckedAt: string;
}

export interface ModelDownloadEvent {
    state: 'idle' | 'checking' | 'downloading' | 'completed' | 'error';
    message?: string | null;
    percent?: number | null;
    assetId?: string | null;
    statuses?: ModelAssetStatus[];
    logLine?: string;
}
