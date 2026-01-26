import { useEffect, useState, useRef } from 'react';
import { Activity, X, FileText, Check, Loader2 } from 'lucide-react';

interface MCPActivity {
    type: 'search' | 'qa';
    query: string;
    status: 'processing' | 'completed';
    hits?: { title: string; file_path: string; snippet: string; score: number }[];
    answer?: string;
    sources?: { title: string; file_path: string; snippet: string; score: number }[];
}

export function MCPActivityShell() {
    const [activity, setActivity] = useState<MCPActivity | null>(null);
    const [isVisible, setIsVisible] = useState(false);
    const autoHideTimerRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        const handleActivity = (data: MCPActivity) => {
            if (data.status === 'processing') {
                setActivity(data);
                setIsVisible(true);
                if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
            } else if (data.status === 'completed') {
                setActivity(data);
                setIsVisible(true);

                // Auto-hide after 10 seconds of inactivity
                if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
                autoHideTimerRef.current = setTimeout(() => {
                    setIsVisible(false);
                    // Hide window immediately when fade starts
                    if (window.api && 'closeMCPWindow' in window.api) {
                        // @ts-ignore
                        window.api.closeMCPWindow();
                    }
                    setTimeout(() => setActivity(null), 300); // Clear after fade out
                }, 10000);
            }
        };

        if (window.api && 'onMCPActivity' in window.api) {
            // @ts-ignore
            const cleanup = window.api.onMCPActivity(handleActivity);
            return () => {
                cleanup();
                if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
            };
        }
    }, []);

    const handleClose = () => {
        setIsVisible(false);
        if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
        // Hide window immediately when fade starts
        if (window.api && 'closeMCPWindow' in window.api) {
            // @ts-ignore
            window.api.closeMCPWindow();
        }
        setTimeout(() => setActivity(null), 300);
    };

    if (!activity) {
        return null;
    }

    const hasResults = (activity.hits && activity.hits.length > 0) || (activity.sources && activity.sources.length > 0);

    return (
        <div
            className={`h-full w-full transition-opacity duration-300 ${isVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        >
            <div className="h-full w-full bg-background/95 backdrop-blur-md border border-border rounded-xl shadow-2xl overflow-hidden flex flex-col">
                {/* Draggable Header */}
                <div className="flex items-center justify-between px-4 py-2.5 border-b bg-muted/40 cursor-move select-none draggable">
                    <div className="flex items-center gap-2">
                        {activity.status === 'processing' ? (
                            <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin" />
                        ) : (
                            <Check className="h-3.5 w-3.5 text-green-500" />
                        )}
                        <span className="text-xs font-semibold text-foreground/90">
                            {activity.type === 'qa' ? 'Answering Question' : 'Searching Files'}
                        </span>
                    </div>
                    <button
                        onClick={handleClose}
                        className="text-muted-foreground hover:text-foreground transition-colors no-drag p-1 rounded hover:bg-muted/60"
                    >
                        <X className="h-3.5 w-3.5" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-3 space-y-3 no-drag scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent">
                    {/* Query */}
                    <div className="text-xs">
                        <div className="text-muted-foreground/80 font-medium mb-1">Query:</div>
                        <div className="text-foreground/90 line-clamp-2">{activity.query}</div>
                    </div>

                    {/* Answer (for QA) */}
                    {activity.answer && activity.status === 'completed' && (
                        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                            <div className="text-muted-foreground/80 font-medium text-xs mb-1">Answer:</div>
                            <div className="text-xs text-foreground bg-accent/20 p-2.5 rounded-lg border border-accent/30 max-h-32 overflow-y-auto scrollbar-thin">
                                {activity.answer}
                            </div>
                        </div>
                    )}

                    {/* Results */}
                    {hasResults && activity.status === 'completed' && (
                        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                            <div className="text-muted-foreground/80 font-medium text-xs mb-1.5">
                                Found {(activity.hits || activity.sources || []).length} file{(activity.hits || activity.sources || []).length !== 1 ? 's' : ''}:
                            </div>
                            <div className="space-y-1.5 max-h-40 overflow-y-auto scrollbar-thin">
                                {(activity.hits || activity.sources || []).map((hit, i) => (
                                    <div key={i} className="flex gap-2 items-start p-2 rounded-md hover:bg-muted/40 transition-colors group">
                                        <FileText className="h-3 w-3 mt-0.5 text-muted-foreground flex-shrink-0" />
                                        <div className="min-w-0 flex-1">
                                            <div className="text-[11px] font-medium truncate group-hover:text-primary transition-colors">
                                                {hit.title || hit.file_path.split(/[/\\]/).pop()}
                                            </div>
                                            {hit.snippet && (
                                                <div className="text-[10px] text-muted-foreground line-clamp-2 mt-0.5">
                                                    {hit.snippet}
                                                </div>
                                            )}
                                        </div>
                                        <div className="text-[9px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded flex-shrink-0">
                                            {Math.round(hit.score * 100)}%
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Processing State */}
                    {activity.status === 'processing' && (
                        <div className="text-xs text-muted-foreground flex items-center gap-2 py-2">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            <span>Searching your files...</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// Inject draggable region styles
const style = document.createElement('style');
style.textContent = `
    .draggable { -webkit-app-region: drag; }
    .no-drag { -webkit-app-region: no-drag; }
    .scrollbar-thin::-webkit-scrollbar { width: 4px; height: 4px; }
    .scrollbar-thin::-webkit-scrollbar-track { background: transparent; }
    .scrollbar-thin::-webkit-scrollbar-thumb { background: hsl(var(--muted)); border-radius: 2px; }
    .scrollbar-thin::-webkit-scrollbar-thumb:hover { background: hsl(var(--muted-foreground) / 0.5); }
`;
document.head.appendChild(style);
