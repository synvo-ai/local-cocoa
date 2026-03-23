import { useEffect, useMemo, useState } from 'react';
import type { FolderRecord, IndexedFile, IndexingItem } from '../types';

interface FolderExplorerProps {
    folders: FolderRecord[];
    files: IndexedFile[];
    filter?: string;
    selectedFileId?: string | null;
    onSelectFile?: (file: IndexedFile) => void;
    onOpenFile?: (file: IndexedFile) => void | Promise<void>;
    progressPercent?: number;
    progressMessage?: string;
    isIndexing?: boolean;
    indexingItems?: IndexingItem[];
}

interface ExplorerNode {
    id: string;
    name: string;
    path: string;
    isFolder: boolean;
    matchesFilter: boolean;
    children: ExplorerNode[];
    file?: IndexedFile;
}

interface FolderTree {
    folder: FolderRecord;
    totalFiles: number;
    visibleFiles: number;
    nodes: ExplorerNode[];
    autoExpandIds: string[];
}

function normalisePath(value: string): string {
    return value.replace(/\\/g, '/');
}

function splitSegments(value: string): string[] {
    return normalisePath(value)
        .split('/')
        .filter(Boolean);
}

function buildFolderTree(folder: FolderRecord, folderFiles: IndexedFile[], filter: string): FolderTree {
    const root: ExplorerNode = {
        id: folder.id,
        name: folder.label,
        path: folder.path,
        isFolder: true,
        matchesFilter: false,
        children: []
    };

    const query = filter.trim().toLowerCase();
    const folderSegments = splitSegments(folder.path);
    let visibleFiles = 0;
    const autoExpandIds = new Set<string>();

    folderFiles.forEach((file) => {
        const haystack = `${file.name} ${file.extension} ${file.location} ${file.fullPath}`.toLowerCase();
        const matchesQuery = query.length === 0 || haystack.includes(query);
        if (!matchesQuery) {
            return;
        }

        visibleFiles += 1;

        const fileSegments = splitSegments(file.fullPath || file.path || file.name);
        let relativeSegments = fileSegments;
        if (folderSegments.length && fileSegments.slice(0, folderSegments.length).join('/') === folderSegments.join('/')) {
            relativeSegments = fileSegments.slice(folderSegments.length);
        }
        if (relativeSegments.length === 0) {
            relativeSegments = [file.name];
        }

        const ancestors: ExplorerNode[] = [root];
        let current = root;

        relativeSegments.forEach((segment, index) => {
            const isLeaf = index === relativeSegments.length - 1;
            if (isLeaf) {
                const node: ExplorerNode = {
                    id: file.id,
                    name: segment,
                    path: file.fullPath,
                    isFolder: false,
                    matchesFilter: true,
                    children: [],
                    file
                };
                current.children.push(node);
                ancestors.forEach((ancestor) => {
                    ancestor.matchesFilter = true;
                    autoExpandIds.add(ancestor.id);
                });
            } else {
                const existing = current.children.find((child) => child.isFolder && child.name === segment);
                let nextNode: ExplorerNode;
                if (existing) {
                    nextNode = existing;
                } else {
                    const derivedPath = current.path ? `${normalisePath(current.path)}/${segment}` : segment;
                    nextNode = {
                        id: `${current.id}/${segment}`,
                        name: segment,
                        path: derivedPath,
                        isFolder: true,
                        matchesFilter: false,
                        children: []
                    };
                    current.children.push(nextNode);
                }
                ancestors.push(nextNode);
                current = nextNode;
            }
        });
    });

    const sortNodes = (nodes: ExplorerNode[]) => {
        nodes.sort((a, b) => {
            if (a.isFolder && !b.isFolder) return -1;
            if (!a.isFolder && b.isFolder) return 1;
            return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        });
        nodes.forEach((node) => {
            if (node.children.length) {
                sortNodes(node.children);
            }
        });
    };

    sortNodes(root.children);

    if (!query.length) {
        // ensure folders without children still display counts
        root.matchesFilter = root.children.length > 0;
        root.children.forEach((node) => {
            if (node.isFolder && node.children.length) {
                node.matchesFilter = true;
            }
        });
    }

    return {
        folder,
        totalFiles: folderFiles.length,
        visibleFiles,
        nodes: root.children,
        autoExpandIds: Array.from(autoExpandIds)
    };
}

export function FolderExplorer({
    folders,
    files,
    filter = '',
    selectedFileId,
    onSelectFile,
    onOpenFile,
    progressPercent,
    progressMessage,
    isIndexing,
    indexingItems = []
}: FolderExplorerProps) {
    const [expandedNodes, setExpandedNodes] = useState<Set<string>>(() => new Set(folders.map((folder) => folder.id)));

    useEffect(() => {
        setExpandedNodes(new Set(folders.map((folder) => folder.id)));
    }, [folders]);

    const trees = useMemo(() => {
        return folders.map((folder) => buildFolderTree(folder, files.filter((file) => file.folderId === folder.id), filter));
    }, [files, filter, folders]);

    useEffect(() => {
        if (!filter.trim()) {
            return;
        }
        const next = new Set<string>();
        trees.forEach((tree) => {
            next.add(tree.folder.id);
            tree.autoExpandIds.forEach((id) => next.add(id));
        });
        setExpandedNodes(next);
    }, [filter, trees]);

    const folderStatusMap = useMemo(() => {
        const map = new Map<string, Map<string, IndexingItem['status']>>();
        indexingItems.forEach((item) => {
            if (!item.filePath) {
                return;
            }
            const folderKey = item.folderId;
            const fileMap = map.get(folderKey) ?? new Map<string, IndexingItem['status']>();
            const fileKey = normalisePath(item.filePath);
            const previous = fileMap.get(fileKey);
            if (!previous || (previous === 'pending' && item.status === 'processing')) {
                fileMap.set(fileKey, item.status);
            }
            map.set(folderKey, fileMap);
        });
        return map;
    }, [indexingItems]);

    const statusByPath = useMemo(() => {
        const map = new Map<string, IndexingItem['status']>();
        folderStatusMap.forEach((fileMap) => {
            fileMap.forEach((status, filePath) => {
                map.set(filePath, status);
            });
        });
        return map;
    }, [folderStatusMap]);

    function collectFilePaths(nodes: ExplorerNode[], accumulator: Set<string>): void {
        nodes.forEach((node) => {
            if (node.isFolder) {
                collectFilePaths(node.children, accumulator);
            } else if (node.file) {
                const key = normalisePath(node.file.fullPath || node.file.path || node.file.name);
                accumulator.add(key);
            }
        });
    }

    function toggleNode(id: string) {
        setExpandedNodes((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }

    function renderNodes(nodes: ExplorerNode[], depth: number): JSX.Element | null {
        if (!nodes.length) {
            return null;
        }
        return (
            <div className="space-y-1">
                {nodes.map((node) => (
                    <div key={node.id} style={{ paddingLeft: depth * 16 }}>
                        {node.isFolder ? (
                            <div className="rounded-lg border border-white/5 bg-white/5">
                                <button
                                    type="button"
                                    onClick={() => toggleNode(node.id)}
                                    className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold text-slate-100 transition hover:border-cyan-400/60 hover:text-cyan-100"
                                >
                                    <span className="inline-flex items-center gap-2">
                                        <span className="inline-block h-2 w-2 rounded-full bg-cyan-400/70" />
                                        {node.name}
                                    </span>
                                    <span>{expandedNodes.has(node.id) ? 'v' : '>'}</span>
                                </button>
                                {expandedNodes.has(node.id) ? (
                                    <div className="border-t border-white/5 p-2">
                                        {renderNodes(node.children, depth + 1)}
                                    </div>
                                ) : null}
                            </div>
                        ) : node.file ? (
                            (() => {
                                const file = node.file as IndexedFile;
                                const filePath = normalisePath(file.fullPath || file.path || file.name);
                                const status = statusByPath.get(filePath);
                                const statusKey: IndexingItem['status'] | 'indexed' = status ?? 'indexed';
                                const isSelected = selectedFileId === file.id;
                                let variantClass = isSelected
                                    ? 'border-cyan-400/60 bg-cyan-500/15 text-cyan-100'
                                    : 'border-white/10 bg-white/5 text-slate-200 hover:border-cyan-400/50 hover:text-cyan-100';
                                if (!isSelected) {
                                    if (statusKey === 'processing') {
                                        variantClass = 'border-amber-400/60 bg-amber-500/10 text-amber-100 hover:border-amber-300/60 hover:text-amber-50';
                                    } else if (statusKey === 'pending') {
                                        variantClass = 'border-sky-400/40 bg-sky-500/10 text-sky-100 hover:border-sky-300/60 hover:text-sky-50';
                                    }
                                }

                                const badgeClass =
                                    statusKey === 'processing'
                                        ? 'border-amber-400/60 bg-amber-500/15 text-amber-100'
                                        : statusKey === 'pending'
                                            ? 'border-sky-400/60 bg-sky-500/15 text-sky-100'
                                            : 'border-emerald-400/50 bg-emerald-500/10 text-emerald-100';
                                const badgeLabel =
                                    statusKey === 'processing' ? 'Indexing' : statusKey === 'pending' ? 'Pending' : 'Indexed';

                                return (
                                    <button
                                        type="button"
                                        onClick={() => onSelectFile?.(file)}
                                        onDoubleClick={() => void onOpenFile?.(file)}
                                        className={`w-full rounded-lg border px-3 py-2 text-left text-xs transition ${variantClass}`}
                                    >
                                        <div className="flex items-center justify-between gap-3">
                                            <p className="truncate text-sm font-semibold text-white/90">
                                                {String(file.metadata?.title || file.metadata?.subject || node.name)}
                                            </p>
                                            <div className="flex items-center gap-2">
                                                <span className="text-[10px] uppercase tracking-wide text-slate-300">.{file.extension}</span>
                                                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badgeClass}`}>
                                                    {badgeLabel}
                                                </span>
                                            </div>
                                        </div>
                                        <p className="mt-1 truncate text-[11px] text-slate-300/80">{file.fullPath}</p>
                                        <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">
                                            {new Date(file.modifiedAt).toLocaleString()}
                                        </p>
                                    </button>
                                );
                            })()
                        ) : null}
                    </div>
                ))}
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {typeof progressPercent === 'number' ? (
                <div className="rounded-2xl border border-cyan-500/30 bg-cyan-500/10 p-4">
                    <div className="flex items-center justify-between text-xs font-semibold text-cyan-100">
                        <span>Index progress</span>
                        <span>{progressPercent}%</span>
                    </div>
                    <div className="mt-2 h-2 w-full rounded-full bg-cyan-500/20">
                        <div
                            className="h-full rounded-full bg-cyan-400 transition-all"
                            style={{ width: `${Math.min(100, Math.max(0, progressPercent))}%` }}
                        />
                    </div>
                    {progressMessage ? (
                        <p className="mt-2 text-[11px] text-cyan-100/80">
                            {isIndexing ? 'Indexing in progress — ' : ''}
                            {progressMessage}
                        </p>
                    ) : null}
                </div>
            ) : null}

            {folders.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 p-6 text-sm text-slate-300">
                    No folders yet. Add a directory to begin indexing and the explorer will populate automatically.
                </div>
            ) : (
                <div className="space-y-3">
                    {trees.map((tree) => {
                        const expanded = expandedNodes.has(tree.folder.id);
                        const emptyState = tree.totalFiles === 0;
                        const noVisibleFiles = tree.visibleFiles === 0;
                        const folderStatusEntries = Array.from(folderStatusMap.get(tree.folder.id)?.entries() ?? []);
                        const processingCount = folderStatusEntries.filter(([, status]) => status === 'processing').length;
                        const pendingCount = folderStatusEntries.filter(([, status]) => status === 'pending').length;
                        const summaryParts: string[] = [];
                        summaryParts.push(`${tree.totalFiles} indexed`);
                        if (processingCount) summaryParts.push(`${processingCount} indexing`);
                        if (pendingCount) summaryParts.push(`${pendingCount} pending`);
                        const summaryText = summaryParts.join(' • ');
                        const folderFilePaths = new Set<string>();
                        collectFilePaths(tree.nodes, folderFilePaths);
                        const newPendingItems = folderStatusEntries.filter(([path]) => !folderFilePaths.has(path));
                        const pendingSection = newPendingItems.length ? (
                            <div className="mt-4 space-y-2">
                                <p className="text-[11px] uppercase tracking-[0.3em] text-cyan-200/70">Pending files</p>
                                {newPendingItems.map(([path, status]) => (
                                    <div
                                        key={path}
                                        className="rounded-lg border border-dashed border-cyan-400/40 bg-cyan-500/5 p-3 text-[11px] text-slate-100"
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <p className="truncate text-sm font-semibold text-white/90">
                                                {path.split('/').pop() ?? path}
                                            </p>
                                            <span
                                                className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${status === 'processing'
                                                    ? 'border-amber-400/60 bg-amber-500/15 text-amber-100'
                                                    : 'border-sky-400/60 bg-sky-500/15 text-sky-100'
                                                    }`}
                                            >
                                                {status === 'processing' ? 'Indexing' : 'Pending'}
                                            </span>
                                        </div>
                                        <p className="mt-1 truncate text-[11px] text-slate-300/80">{path}</p>
                                    </div>
                                ))}
                            </div>
                        ) : null;
                        const showDefaultSummary = emptyState && processingCount === 0 && pendingCount === 0;
                        return (
                            <div key={tree.folder.id} className="rounded-2xl border border-white/10 bg-white/5">
                                <button
                                    type="button"
                                    onClick={() => toggleNode(tree.folder.id)}
                                    className="flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left transition hover:border-cyan-400/40 hover:bg-cyan-400/10"
                                >
                                    <div>
                                        <p className="text-sm font-semibold text-white/90">{tree.folder.label || tree.folder.path}</p>
                                        <p className="mt-1 text-xs text-slate-300/80">{tree.folder.path}</p>
                                        <p className="mt-1 text-[11px] text-slate-400">
                                            {showDefaultSummary
                                                ? 'No files indexed yet.'
                                                : summaryText}
                                        </p>
                                    </div>
                                    <div className="text-right text-[11px] uppercase tracking-wide text-slate-300">
                                        <p>{expanded ? 'Collapse' : 'Expand'}</p>
                                        <p className="mt-1 text-xs text-cyan-200/90">
                                            {isIndexing ? 'Indexing…' : 'Idle'}
                                        </p>
                                    </div>
                                </button>
                                {expanded ? (
                                    <div className="border-t border-white/10 p-4">
                                        {noVisibleFiles ? (
                                            <>
                                                <div className="rounded-xl border border-dashed border-white/10 bg-slate-950/50 p-4 text-xs text-slate-300">
                                                    {filter.trim()
                                                        ? 'No files match the current filter in this folder.'
                                                        : 'Files will appear here once indexing completes.'}
                                                </div>
                                                {pendingSection}
                                            </>
                                        ) : (
                                            <>
                                                {renderNodes(tree.nodes, 0)}
                                                {pendingSection}
                                            </>
                                        )}
                                    </div>
                                ) : null}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
