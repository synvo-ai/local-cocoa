import { useMemo } from 'react';
import type { IndexedFile } from '../types';

interface ActivitySummariesPanelProps {
    files: IndexedFile[];
    onOpenFile: (file: IndexedFile) => void;
}

function formatSummaryDate(filename: string, createdAt: string): { date: string; time: string; label: string } {
    // Expected format: Activity_Summary_2025-11-20_14-30.md
    const match = filename.match(/Activity_Summary_(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2})/);

    if (match) {
        const dateStr = match[1];
        const timeStr = match[2].replace('-', ':');
        return {
            date: dateStr,
            time: timeStr,
            label: `Summary for ${dateStr} at ${timeStr}`
        };
    }

    // Fallback to creation date
    const date = new Date(createdAt);
    return {
        date: date.toLocaleDateString(),
        time: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        label: filename
    };
}

export function ActivitySummariesPanel({ files, onOpenFile }: ActivitySummariesPanelProps) {
    const summaries = useMemo(() => {
        return files
            .filter(f => (f.fullPath || f.path).includes('local-cocoa-activity-summaries') && f.extension === 'md')
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .map(file => ({
                file,
                ...formatSummaryDate(file.name, file.createdAt)
            }));
    }, [files]);

    // Group by date
    const grouped = useMemo(() => {
        const groups: Record<string, typeof summaries> = {};
        summaries.forEach(item => {
            if (!groups[item.date]) {
                groups[item.date] = [];
            }
            groups[item.date].push(item);
        });
        return groups;
    }, [summaries]);

    if (summaries.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed p-12 text-center">
                <div className="mb-4 rounded-full bg-muted p-4">
                    <span className="text-2xl">⏱️</span>
                </div>
                <h3 className="text-lg font-medium text-foreground">No summaries yet</h3>
                <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                    Activity summaries are generated automatically every 30 minutes.
                    They will appear here once the first one is created.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-8">
            {Object.entries(grouped).map(([date, items]) => (
                <div key={date} className="space-y-4">
                    <div className="flex items-center gap-4">
                        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{date}</h3>
                        <div className="h-px flex-1 bg-border"></div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {items.map(({ file, time }) => (
                            <button
                                key={file.id}
                                onClick={() => onOpenFile(file)}
                                className="group relative flex flex-col items-start justify-between gap-4 rounded-xl border bg-card p-4 text-left transition hover:border-primary/30 hover:bg-accent"
                            >
                                <div className="w-full">
                                    <div className="flex items-center justify-between">
                                        <span className="rounded bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary">
                                            {time}
                                        </span>
                                        <span className="text-[10px] text-muted-foreground">
                                            {(file.size / 1024).toFixed(1)} KB
                                        </span>
                                    </div>
                                    <h4 className="mt-3 font-medium text-foreground group-hover:text-primary">
                                        Activity Summary
                                    </h4>
                                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                                        {file.summary || "Click to view detailed activity breakdown..."}
                                    </p>
                                </div>
                                <div className="flex w-full items-center justify-between border-t pt-3">
                                    <span className="text-[10px] text-muted-foreground">Markdown Report</span>
                                    <span className="text-xs text-primary opacity-0 transition group-hover:opacity-100">
                                        Open →
                                    </span>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}
