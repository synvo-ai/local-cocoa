import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type {
    FolderRecord,
    IndexedFile,
    IndexingItem,
    IndexSummary,
    IndexProgressUpdate,
    HealthStatus,
    FileRecord,
    FileKind,
    IndexResultSnapshot,
    SystemSpecs
} from '../types';

/** Shallow-compare two arrays by element identity. */
function arraysEqual<T>(a: T[], b: T[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

/** Deep-compare two plain objects/arrays via JSON (for small payloads like progress). */
function jsonEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a == null || b == null) return a === b;
    try {
        return JSON.stringify(a) === JSON.stringify(b);
    } catch {
        return false;
    }
}

// No limit - use virtual scrolling on the frontend for performance
const INVENTORY_LIMIT = undefined;

const KIND_DEFAULT_COUNTS: Record<FileKind, number> = {
    document: 0,
    image: 0,
    presentation: 0,
    spreadsheet: 0,
    audio: 0,
    video: 0,
    archive: 0,
    code: 0,
    book: 0,
    other: 0
};

function inferKind(extension: string): IndexedFile['kind'] {
    const ext = extension.toLowerCase();
    if (['pdf', 'doc', 'docx', 'txt', 'md', 'rtf'].includes(ext)) return 'document';
    if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'bmp', 'webp'].includes(ext)) return 'image';
    if (['ppt', 'pptx', 'key'].includes(ext)) return 'presentation';
    if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return 'spreadsheet';
    if (['mp3', 'wav', 'aac', 'flac'].includes(ext)) return 'audio';
    if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) return 'video';
    if (['zip', 'rar', 'tar', 'gz', '7z'].includes(ext)) return 'archive';
    return 'other';
}

function deriveDefaultLabel(pathValue: string): string {
    const normalised = pathValue.replace(/\\/g, '/');
    const segments = normalised.split('/').filter(Boolean);
    return segments[segments.length - 1] ?? pathValue ?? 'Folder';
}

function deriveFolderLabel(folder: FolderRecord): string {
    if (folder.label && folder.label.trim()) return folder.label.trim();
    if (folder.path) return deriveDefaultLabel(folder.path);
    return `Folder ${folder.id}`;
}

function mapIndexedFile(record: FileRecord, folderMap: Map<string, FolderRecord>): IndexedFile {
    const folder = folderMap.get(record.folderId);
    const location = folder ? deriveFolderLabel(folder) : 'Unknown';
    const fullPath = record.path || record.name;

    // Ensure kind is set
    let kind = record.kind as IndexedFile['kind'];
    if (!kind) {
        const ext = record.extension || (record.name.includes('.') ? record.name.split('.').pop() || 'other' : 'other');
        kind = inferKind(ext);
    }

    return {
        ...record,
        kind,
        location,
        fullPath
    };
}

function buildSnapshot(files: IndexedFile[], summary: IndexSummary | null): IndexResultSnapshot | null {
    if (!summary) return null;
    const byKind: Record<FileKind, number> = { ...KIND_DEFAULT_COUNTS };
    const byLocation: Record<string, number> = {};
    files.forEach((file) => {
        byKind[file.kind] = (byKind[file.kind] ?? 0) + 1;
        byLocation[file.location] = (byLocation[file.location] ?? 0) + 1;
    });

    const completedAt = summary.lastCompletedAt ?? new Date().toISOString();
    const totalSize = summary.totalSizeBytes || files.reduce((sum, file) => sum + (file.size ?? 0), 0);
    const totalCount = summary.filesIndexed || files.length;

    return {
        files,
        startedAt: summary.lastCompletedAt ?? completedAt,
        completedAt,
        totalCount,
        totalSize,
        byKind,
        byLocation
    };
}

export function useWorkspaceData() {
    const [folders, setFolders] = useState<FolderRecord[]>([]);
    const [files, setFiles] = useState<IndexedFile[]>([]);
    const [indexingItems, setIndexingItems] = useState<IndexingItem[]>([]);
    const [summary, setSummary] = useState<IndexSummary | null>(null);
    const [progress, setProgress] = useState<IndexProgressUpdate | null>(null);
    const [stageProgress, setStageProgress] = useState<any | null>(null);
    const [health, setHealth] = useState<HealthStatus | null>(null);
    const [systemSpecs, setSystemSpecs] = useState<SystemSpecs | null>(null);
    const [isIndexing, setIsIndexing] = useState(false);
    const [backendStarting, setBackendStarting] = useState(true);

    const pollTimerRef = useRef<number | null>(null);
    const startupRetryCountRef = useRef(0);
    const maxStartupRetries = 30; // Allow up to 30 retries (about 60 seconds with 2s intervals)
    const refreshCountRef = useRef(0); // Track refresh count for skipping expensive queries during indexing

    // ── Hysteresis: require N consecutive idle polls before transitioning isIndexing → false ──
    const idleStreakRef = useRef(0);
    const IDLE_HYSTERESIS = 2; // must see 2 consecutive "not running/paused" before declaring idle

    const refreshData = useCallback(async () => {
        const api = window.api;
        if (!api) {
            console.warn('[useWorkspaceData] No window.api available!');
            return;
        }

        try {
            // First check if backend is reachable via health check
            console.info('[useWorkspaceData] Calling health check...');
            const healthData = await api.health();
            console.debug('[useWorkspaceData] Health check result:', healthData);

            // Handle null health response (backend not responding at all)
            if (!healthData) {
                console.warn('[useWorkspaceData] Health check returned null');
                if (backendStarting && startupRetryCountRef.current < maxStartupRetries) {
                    startupRetryCountRef.current += 1;
                    console.info('[useWorkspaceData] Startup retry (null health):', startupRetryCountRef.current, '/', maxStartupRetries);
                    setHealth({
                        status: 'degraded',
                        indexedFiles: 0,
                        watchedFolders: 0,
                        message: 'Backend starting...'
                    });
                    return null;
                }
                return null;
            }

            // If health status is degraded, check if backend is actually reachable
            // Some optional services (like Whisper) being offline shouldn't block file management
            if (healthData.status === 'degraded') {
                console.warn('[useWorkspaceData] Health status is degraded:', healthData);
                setHealth(healthData);

                // Check if this is a "soft" degradation (backend reachable, but some services offline)
                // vs "hard" degradation (backend completely unreachable)
                const isBackendReachable = healthData.message !== 'Backend unreachable' &&
                    (healthData.indexedFiles > 0 || healthData.watchedFolders > 0 ||
                        (healthData.services && healthData.services.some(s => s.status === 'online')));

                if (isBackendReachable) {
                    // Backend is reachable but some services are offline - continue loading data
                    console.info('[useWorkspaceData] Backend reachable despite degraded status, continuing...');
                    // Reset startup state since backend is actually responding
                    if (backendStarting) {
                        setBackendStarting(false);
                        startupRetryCountRef.current = 0;
                    }
                    // Don't return - continue to fetch data below
                } else {
                    // Backend is actually unreachable
                    // During startup, silently wait for backend - don't spam errors
                    if (backendStarting && startupRetryCountRef.current < maxStartupRetries) {
                        startupRetryCountRef.current += 1;
                        console.info('[useWorkspaceData] Startup retry:', startupRetryCountRef.current, '/', maxStartupRetries);
                        return null;
                    }
                    // After startup period, log but don't spam
                    if (startupRetryCountRef.current === maxStartupRetries) {
                        console.warn('Backend appears to be offline. Will continue checking...');
                        startupRetryCountRef.current += 1; // Prevent repeated warnings
                    }
                    return null;
                }
            }

            // Backend is ready - reset startup state
            if (backendStarting) {
                setBackendStarting(false);
                startupRetryCountRef.current = 0;
            }

            // OPTIMIZATION: Skip expensive inventory query occasionally during active indexing
            // This query fetches all files with full metadata, causing DB contention
            // Skip every 5th poll during indexing to reduce load (but keep queue responsive)
            refreshCountRef.current += 1;
            const isCurrentlyIndexing = healthData.status === 'indexing';
            const shouldSkipInventory = isCurrentlyIndexing && (refreshCountRef.current % 5 === 0);

            console.debug('[useWorkspaceData] Fetching data...');
            const [summaryData, folderData, inventoryData, specsData, stageProgressData] = await Promise.all([
                api.indexSummary(),
                api.listFolders().then(f => { console.debug('[useWorkspaceData] listFolders returned:', f.length, 'folders'); return f; }),
                shouldSkipInventory
                    // FIX: preserve previous indexingItems instead of hardcoding []
                    // The old code used `indexing: []` which flashed the queue empty on skipped refreshes
                    ? Promise.resolve(null)
                    : api.indexInventory(INVENTORY_LIMIT ? { limit: INVENTORY_LIMIT } : {}),
                (api as any).getSystemSpecs ? (api as any).getSystemSpecs() : Promise.resolve(null),
                (api as any).stageProgress ? (api as any).stageProgress() : Promise.resolve(null)
            ]);

            console.info('[useWorkspaceData] Setting state - folders:', folderData.length, 'files:', inventoryData?.files?.length ?? '(skipped)');
            setHealth(healthData);
            setSystemSpecs(prev => jsonEqual(prev, specsData) ? prev : specsData);
            setSummary(prev => jsonEqual(prev, summaryData) ? prev : summaryData);
            setStageProgress(prev => jsonEqual(prev, stageProgressData) ? prev : stageProgressData);
            setFolders(folderData);

            // ── Hysteresis for isIndexing: prevent bouncing ──
            const newProgressData = inventoryData ? inventoryData.progress : null;
            const statusFromHealth = healthData.status === 'indexing';
            const nowRunning = newProgressData
                ? (newProgressData.status === 'running' || newProgressData.status === 'paused')
                : statusFromHealth;
            if (nowRunning) {
                idleStreakRef.current = 0;
                setIsIndexing(true);
            } else {
                idleStreakRef.current += 1;
                if (idleStreakRef.current >= IDLE_HYSTERESIS) {
                    setIsIndexing(false);
                }
                // else: keep previous isIndexing value (don't flash to false)
            }
            if (newProgressData) {
                setProgress(prev => jsonEqual(prev, newProgressData) ? prev : newProgressData);
            }

            // Only update files/indexing when we actually fetched inventory (not skipped)
            if (inventoryData) {
                const folderMap = new Map<string, FolderRecord>(folderData.map((folder: FolderRecord) => [folder.id, folder]));
                const indexedFiles = inventoryData.files.map((record: FileRecord) => mapIndexedFile(record, folderMap));
                setFiles(indexedFiles);

                setIndexingItems(inventoryData.indexing);
            }

            return {
                folders: folderData,
            };
        } catch (error) {
            console.error('[useWorkspaceData] Error in refreshData:', error);
            console.error('[useWorkspaceData] Error stack:', error instanceof Error ? error.stack : 'N/A');
            // During startup, silently handle errors to avoid log spam
            if (backendStarting && startupRetryCountRef.current < maxStartupRetries) {
                startupRetryCountRef.current += 1;
                console.warn('[useWorkspaceData] Startup error retry:', startupRetryCountRef.current);
                // Set degraded health status
                setHealth({
                    status: 'degraded',
                    indexedFiles: 0,
                    watchedFolders: 0,
                    message: 'Backend starting...'
                });
                return null;
            }
            // Only log after startup period
            console.error('Failed to refresh workspace data', error);
            return null;
        }
    }, [backendStarting]);

    const stopPolling = useCallback(() => {
        if (pollTimerRef.current !== null) {
            window.clearTimeout(pollTimerRef.current);
            pollTimerRef.current = null;
        }
    }, []);

    const scheduleStatusPoll = useCallback(() => {
        const api = window.api;
        if (!api?.indexStatus) return;

        stopPolling();

        let consecutiveIdle = 0;

        const poll = async () => {
            try {
                const status = await api.indexStatus();
                console.info('[useWorkspaceData] [StatusPoll] status:', status.status);

                if (status.status === 'running' || status.status === 'paused') {
                    consecutiveIdle = 0;
                    idleStreakRef.current = 0;
                    setIsIndexing(true);
                    setProgress(prev => jsonEqual(prev, status) ? prev : status);

                    // Only fetch full inventory every other poll to reduce DB contention
                    if (status.status === 'running') {
                        try {
                            const inventory = await api.indexInventory(INVENTORY_LIMIT ? { limit: INVENTORY_LIMIT } : {});

                            // Log active item progress for debugging
                            const active = (inventory.indexing as IndexingItem[]).find(i => i.status === 'processing');
                            if (active) {
                                console.debug('[useWorkspaceData] [StatusPoll] active:', active.fileName,
                                    'progress:', active.progress, 'detail:', active.detail,
                                    'step:', active.stepCurrent, '/', active.stepTotal,
                                    'events:', active.recentEvents?.length ?? 0);
                            }

                            setIndexingItems(prev => arraysEqual(prev, inventory.indexing) ? prev : inventory.indexing);
                            setProgress(prev => jsonEqual(prev, inventory.progress) ? prev : inventory.progress);
                        } catch (inventoryError) {
                            console.warn('Failed to refresh inventory during indexing', inventoryError);
                        }
                    }

                    pollTimerRef.current = window.setTimeout(poll, 2000);
                } else {
                    // Status is idle/completed/failed — apply hysteresis
                    consecutiveIdle += 1;
                    if (consecutiveIdle < IDLE_HYSTERESIS) {
                        // Not enough consecutive idle polls — keep polling, don't flip isIndexing yet
                        pollTimerRef.current = window.setTimeout(poll, 1500);
                        return;
                    }

                    // Confirmed idle — clean up
                    setIndexingItems([]);
                    setIsIndexing(false);
                    idleStreakRef.current = IDLE_HYSTERESIS;
                    stopPolling();
                    await refreshData();
                }
            } catch (error) {
                console.error('Index status polling failed', error);
                // Don't immediately flip isIndexing to false on transient errors
                consecutiveIdle += 1;
                if (consecutiveIdle >= IDLE_HYSTERESIS + 1) {
                    setIsIndexing(false);
                    stopPolling();
                } else {
                    pollTimerRef.current = window.setTimeout(poll, 2000);
                }
            }
        };

        pollTimerRef.current = window.setTimeout(poll, 2000);
    }, [refreshData, stopPolling]);

    useEffect(() => {
        // Schedule initial load asynchronously to avoid synchronous setState in effect body
        const handle = window.setTimeout(() => void refreshData(), 0);
        return () => {
            window.clearTimeout(handle);
            stopPolling();
        };
    }, [refreshData, stopPolling]);

    useEffect(() => {
        // Use shorter interval during startup to detect backend readiness faster
        // OPTIMIZATION: During active indexing, the status poll loop handles frequent updates
        // so we use a moderate background refresh. 8s normal, 5s when indexing (as fallback).
        const interval = backendStarting ? 2000 : (isIndexing ? 5000 : 8000);
        const intervalId = window.setInterval(() => {
            void refreshData();
        }, interval);
        return () => window.clearInterval(intervalId);
    }, [refreshData, backendStarting, isIndexing]);

    useEffect(() => {
        // Start the fast status poll when either progress or health indicates indexing
        const isRunning = progress?.status === 'running' || progress?.status === 'paused';
        const healthSaysIndexing = health?.status === 'indexing';
        if ((isRunning || healthSaysIndexing) && pollTimerRef.current === null) {
            scheduleStatusPoll();
        }
    }, [progress?.status, health?.status, scheduleStatusPoll]);

    const snapshot = useMemo(() => buildSnapshot(files, summary), [files, summary]);
    const fileMap = useMemo(() => new Map(files.map((file) => [file.id, file])), [files]);

    const startSemanticIndexing = useCallback(async () => {
        const api = window.api;
        if (!api || !(api as any).startSemanticIndexing) return;
        try {
            await (api as any).startSemanticIndexing();
            await refreshData();
        } catch (error) {
            console.error('Failed to start semantic indexing', error);
        }
    }, [refreshData]);

    const stopSemanticIndexing = useCallback(async () => {
        const api = window.api;
        if (!api || !(api as any).stopSemanticIndexing) return;
        try {
            await (api as any).stopSemanticIndexing();
            await refreshData();
        } catch (error) {
            console.error('Failed to stop semantic indexing', error);
        }
    }, [refreshData]);

    const startDeepIndexing = useCallback(async () => {
        const api = window.api;
        if (!api || !(api as any).startDeepIndexing) return;
        try {
            await (api as any).startDeepIndexing();
            await refreshData();
        } catch (error) {
            console.error('Failed to start deep indexing', error);
        }
    }, [refreshData]);

    const stopDeepIndexing = useCallback(async () => {
        const api = window.api;
        if (!api || !(api as any).stopDeepIndexing) return;
        try {
            await (api as any).stopDeepIndexing();
            await refreshData();
        } catch (error) {
            console.error('Failed to stop deep indexing', error);
        }
    }, [refreshData]);

    return {
        folders,
        files,
        indexingItems,
        summary,
        progress,
        stageProgress,
        health,
        systemSpecs,
        isIndexing,
        snapshot,
        fileMap,
        refreshData,
        scheduleStatusPoll,
        setIsIndexing,
        setProgress,
        setIndexingItems,
        backendStarting,
        startSemanticIndexing,
        stopSemanticIndexing,
        startDeepIndexing,
        stopDeepIndexing
    };
}
