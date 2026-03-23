import type { IndexedFile } from '../types';

interface FileListProps {
    files: IndexedFile[];
    onSelectFile?: (file: IndexedFile) => void;
    className?: string;
    emptyState?: string;
}

const kindBadge: Record<string, string> = {
    document: 'bg-emerald-500/20 text-emerald-200 border-emerald-500/30',
    image: 'bg-sky-500/20 text-sky-200 border-sky-500/30',
    presentation: 'bg-amber-500/20 text-amber-200 border-amber-500/30',
    spreadsheet: 'bg-lime-500/20 text-lime-200 border-lime-500/30',
    audio: 'bg-purple-500/20 text-purple-200 border-purple-500/30',
    video: 'bg-rose-500/20 text-rose-200 border-rose-500/30',
    archive: 'bg-slate-500/20 text-slate-200 border-slate-500/30',
    other: 'bg-slate-500/20 text-slate-200 border-slate-500/30'
};

function readableSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export function FileList({ files, onSelectFile, className, emptyState }: FileListProps) {
    if (!files.length) {
        return (
            <div className="h-full rounded-xl border border-white/10 bg-white/5 p-8 text-center text-sm text-slate-300">
                {emptyState ?? 'No matching files yet. Try re-indexing or adjusting your filters.'}
            </div>
        );
    }

    return (
        <div className={`space-y-1.5 overflow-y-auto rounded-xl border border-white/10 bg-white/5 p-3 ${className ?? 'max-h-[420px]'}`}>
            {files.map((file) => (
                <button
                    key={file.id}
                    onClick={() => onSelectFile?.(file)}
                    className="flex w-full items-center justify-between rounded-lg border border-white/5 bg-white/5 px-3 py-2.5 text-left transition hover:border-cyan-400/60 hover:bg-cyan-400/10"
                >
                    <div>
                        <div className="flex items-center gap-3">
                            <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-wide ${kindBadge[file.kind] ?? kindBadge.other}`}>
                                {file.kind}
                            </span>
                            <p className="text-sm font-semibold text-white/90 truncate max-w-[220px] md:max-w-[320px]">
                                {String(file.metadata?.title || file.metadata?.subject || file.name)}
                            </p>
                        </div>
                        <p className="mt-1 text-xs text-slate-300/80">
                            {file.location} · {readableSize(file.size)} · Last modified {new Date(file.modifiedAt).toLocaleString()}
                        </p>
                        {file.summary ? (
                            <p className="mt-2 line-clamp-2 text-[11px] text-slate-300/80">
                                {file.summary}
                            </p>
                        ) : null}
                    </div>
                    <span className="text-xs uppercase tracking-wide text-slate-400">.{file.extension}</span>
                </button>
            ))}
        </div>
    );
}
