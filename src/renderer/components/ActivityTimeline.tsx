import { useCallback, useEffect, useState, CSSProperties } from 'react';
import ReactMarkdown from 'react-markdown';
import { Activity, RefreshCw, Trash2, Play, Square, FileText, FolderOpen } from 'lucide-react';
import { cn } from '../lib/utils';
import { ActivitySummariesPanel } from './ActivitySummariesPanel';
import type { ActivityLog, IndexedFile } from '../types';

interface ActivityTimelineProps {
    isTracking: boolean;
    onToggleTracking: () => void;
    summaryFiles?: IndexedFile[];
    onOpenFile?: (file: IndexedFile) => void;
}

type ActivityTab = 'timeline' | 'summaries';

export function ActivityTimeline({ isTracking, onToggleTracking, summaryFiles = [], onOpenFile }: ActivityTimelineProps) {
    const [logs, setLogs] = useState<ActivityLog[]>([]);
    const [summary, setSummary] = useState<string | null>(null);
    const [loadingLogs, setLoadingLogs] = useState(false);
    const [loadingSummary, setLoadingSummary] = useState(false);
    const [activeTab, setActiveTab] = useState<ActivityTab>('timeline');

    const dragStyle = { WebkitAppRegion: 'drag' } as CSSProperties;
    const noDragStyle = { WebkitAppRegion: 'no-drag' } as CSSProperties;

    // Default to today 00:00 to 23:59
    const [startTime, setStartTime] = useState<string>(() => {
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        // Adjust for timezone offset to keep local time in ISO string for input
        const offset = now.getTimezoneOffset() * 60000;
        return new Date(now.getTime() - offset).toISOString().slice(0, 16);
    });

    const [endTime, setEndTime] = useState<string>(() => {
        const now = new Date();
        now.setHours(23, 59, 59, 999);
        const offset = now.getTimezoneOffset() * 60000;
        return new Date(now.getTime() - offset).toISOString().slice(0, 16);
    });

    const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

    const fetchLogs = useCallback(async () => {
        const api = window.api;
        if (!api?.getActivityTimeline) return;

        setLoadingLogs(true);
        try {
            // Convert local input time back to ISO/UTC for API
            const start = new Date(startTime).toISOString();
            const end = new Date(endTime).toISOString();

            // First fetch logs only (summary=false)
            const response = await api.getActivityTimeline(start, end, false);
            // console.log('ActivityTimeline: Received logs', response.logs.length);
            setLogs(response.logs);

            // Then fetch summary if needed
            if (response.logs.length > 0) {
                void fetchSummary(start, end);
            } else {
                setSummary(null);
            }
        } catch (error) {
            console.error('Failed to fetch timeline logs', error);
        } finally {
            setLoadingLogs(false);
        }
    }, [startTime, endTime]);

    const fetchSummary = async (start: string, end: string) => {
        const api = window.api;
        if (!api?.getActivityTimeline) return;

        setLoadingSummary(true);
        try {
            const response = await api.getActivityTimeline(start, end, true);
            // console.log('ActivityTimeline: Received summary');
            setSummary(response.summary ?? null);
        } catch (error) {
            console.error('Failed to fetch summary', error);
        } finally {
            setLoadingSummary(false);
        }
    };

    useEffect(() => {
        void fetchLogs();
    }, [fetchLogs]);

    const toggleExpand = (id: string) => {
        setExpandedLogId(prev => prev === id ? null : id);
    };

    const deleteLog = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        const api = window.api;
        if (!api?.deleteActivityLog) return;

        if (!confirm('Are you sure you want to delete this activity log?')) return;

        try {
            await api.deleteActivityLog(id);
            setLogs(prev => prev.filter(log => log.id !== id));
        } catch (error) {
            console.error('Failed to delete log', error);
        }
    };

    return (
        <div className="flex h-full flex-col bg-background">
            {/* Header Region - Draggable */}
            <div className="flex-none border-b px-6 pt-8 pb-0" style={dragStyle}>
                <div className="flex items-center justify-between mb-4">
                    <div style={noDragStyle}>
                        <div className="flex items-center gap-2">
                            <h2 className="text-lg font-semibold tracking-tight select-text">Activities</h2>
                            <span className="relative group cursor-help">
                                <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                                    Test Mode
                                </span>
                                <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-2 px-3 py-2 text-xs font-normal normal-case tracking-normal text-white bg-gray-900 dark:bg-gray-800 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 whitespace-nowrap z-50">
                                    Feature in development, may have issues
                                    <span className="absolute left-1/2 -translate-x-1/2 -top-1 w-2 h-2 bg-gray-900 dark:bg-gray-800 rotate-45" />
                                </span>
                            </span>
                        </div>
                        <p className="text-xs text-muted-foreground select-text">Track and summarize your screen activity</p>
                    </div>
                    
                    {/* Controls - Non-draggable */}
                    {activeTab === 'timeline' && (
                        <div className="flex items-center gap-2" style={noDragStyle}>
                            <div className="flex items-center gap-2 rounded-md border bg-card p-1 shadow-sm">
                                <div className="flex items-center gap-1 px-2">
                                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">From</span>
                                    <input
                                        type="datetime-local"
                                        value={startTime}
                                        onChange={(e) => setStartTime(e.target.value)}
                                        className="h-6 bg-transparent text-xs font-medium focus:outline-none"
                                    />
                                </div>
                                <div className="h-4 w-px bg-border" />
                                <div className="flex items-center gap-1 px-2">
                                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">To</span>
                                    <input
                                        type="datetime-local"
                                        value={endTime}
                                        onChange={(e) => setEndTime(e.target.value)}
                                        className="h-6 bg-transparent text-xs font-medium focus:outline-none"
                                    />
                                </div>
                            </div>

                            <button
                                onClick={() => onToggleTracking()}
                                className={cn(
                                    "flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors shadow-sm",
                                    isTracking 
                                        ? "bg-red-500 text-white hover:bg-red-600" 
                                        : "bg-emerald-500 text-white hover:bg-emerald-600"
                                )}
                            >
                                {isTracking ? <Square className="h-3.5 w-3.5 fill-current" /> : <Play className="h-3.5 w-3.5 fill-current" />}
                                {isTracking ? 'Stop' : 'Start'}
                            </button>

                            <button
                                onClick={() => fetchLogs()}
                                disabled={loadingLogs}
                                className="flex h-8 w-8 items-center justify-center rounded-md border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                                title="Refresh"
                            >
                                <RefreshCw className={cn("h-3.5 w-3.5", loadingLogs && "animate-spin")} />
                            </button>
                        </div>
                    )}
                </div>

                {/* Tabs - Non-draggable */}
                <div className="flex items-center gap-6" style={noDragStyle}>
                    <button
                        onClick={() => setActiveTab('timeline')}
                        className={cn(
                            "flex items-center gap-2 py-3 text-sm font-medium border-b-2 transition-colors",
                            activeTab === 'timeline'
                                ? "border-primary text-primary"
                                : "border-transparent text-muted-foreground hover:text-foreground"
                        )}
                    >
                        <Activity className="h-4 w-4" />
                        Timeline
                    </button>
                    <button
                        onClick={() => setActiveTab('summaries')}
                        className={cn(
                            "flex items-center gap-2 py-3 text-sm font-medium border-b-2 transition-colors",
                            activeTab === 'summaries'
                                ? "border-primary text-primary"
                                : "border-transparent text-muted-foreground hover:text-foreground"
                        )}
                    >
                        <FolderOpen className="h-4 w-4" />
                        Summaries
                        {summaryFiles.length > 0 && (
                            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium">
                                {summaryFiles.length}
                            </span>
                        )}
                    </button>
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-hidden p-6">
                {activeTab === 'timeline' && (
                    <div className="grid h-full grid-cols-2 gap-6">
                        {/* Activity Log Column */}
                        <div className="flex flex-col rounded-xl border bg-card shadow-sm overflow-hidden">
                            <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-3">
                                <div className="flex items-center gap-2">
                                    <Activity className="h-4 w-4 text-primary" />
                                    <h3 className="text-sm font-medium">Activity Log</h3>
                                </div>
                                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                                    {logs.length} entries
                                </span>
                            </div>
                            
                            <div className="flex-1 overflow-y-auto p-6">
                                {logs.length === 0 ? (
                                    <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground p-8">
                                        <Activity className="h-8 w-8 opacity-20" />
                                        <p className="text-xs">No activity recorded.</p>
                                    </div>
                                ) : (
                                    <div className="relative pl-4 space-y-0">
                                        {/* Vertical Timeline Line */}
                                        <div className="absolute left-4 top-2 bottom-2 w-px bg-border" />
                                        
                                        {logs.map((log) => {
                                            const isExpanded = expandedLogId === log.id;
                                            return (
                                                <div 
                                                    key={log.id} 
                                                    className="group relative pl-8 pb-6 last:pb-0"
                                                >
                                                    {/* Timeline Dot */}
                                                    <div className={cn(
                                                        "absolute left-[13px] top-1.5 h-2.5 w-2.5 rounded-full border ring-4 ring-background transition-colors z-10",
                                                        isExpanded ? "bg-primary border-primary" : "bg-muted-foreground/30 border-muted-foreground/30 group-hover:border-primary/50"
                                                    )} />

                                                    <div 
                                                        className={cn(
                                                            "rounded-lg border bg-card p-3 transition-all cursor-pointer hover:shadow-sm",
                                                            isExpanded ? "ring-1 ring-primary/20 shadow-sm" : "hover:bg-accent/30"
                                                        )}
                                                        onClick={() => toggleExpand(log.id)}
                                                    >
                                                        <div className="flex items-start justify-between gap-4">
                                                            <div className="flex-1 min-w-0">
                                                                <div className="flex items-center gap-2 mb-1">
                                                                    <span className="text-[10px] font-mono font-medium text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
                                                                        {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                                                    </span>
                                                                </div>
                                                                <p className={cn(
                                                                    "text-sm font-medium leading-snug",
                                                                    isExpanded ? "text-primary" : "text-foreground"
                                                                )}>
                                                                    {log.short_description || 'Activity detected'}
                                                                </p>
                                                            </div>
                                                            <button
                                                                onClick={(e) => deleteLog(e, log.id)}
                                                                className="opacity-0 transition-opacity group-hover:opacity-100 p-1.5 hover:bg-destructive/10 hover:text-destructive rounded-md -mr-1 -mt-1"
                                                            >
                                                                <Trash2 className="h-3.5 w-3.5" />
                                                            </button>
                                                        </div>
                                                        
                                                        {isExpanded && log.description && (
                                                            <div className="mt-3 pt-3 border-t text-xs text-muted-foreground/90 prose prose-sm dark:prose-invert max-w-none animate-in slide-in-from-top-1 duration-200">
                                                                <ReactMarkdown>{log.description}</ReactMarkdown>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Summary Column */}
                        <div className="flex flex-col rounded-xl border bg-card shadow-sm overflow-hidden">
                            <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-3">
                                <div className="flex items-center gap-2">
                                    <FileText className="h-4 w-4 text-primary" />
                                    <h3 className="text-sm font-medium">Daily Summary</h3>
                                </div>
                                {summary && (
                                    <span className="text-[10px] text-muted-foreground">
                                        Generated from logs
                                    </span>
                                )}
                            </div>

                            <div className="flex-1 overflow-y-auto p-4">
                                {loadingSummary ? (
                                    <div className="flex h-full items-center justify-center">
                                        <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
                                    </div>
                                ) : summary ? (
                                    <div className="prose prose-sm dark:prose-invert max-w-none">
                                        <ReactMarkdown>{summary}</ReactMarkdown>
                                    </div>
                                ) : (
                                    <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                                        <FileText className="h-8 w-8 opacity-20" />
                                        <p className="text-xs">No data to summarize.</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'summaries' && (
                    <div className="h-full overflow-y-auto">
                        <ActivitySummariesPanel
                            files={summaryFiles}
                            onOpenFile={(file) => onOpenFile?.(file)}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
