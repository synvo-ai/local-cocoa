/**
 * EarlogPanel - Always-on audio recording with real-time transcription
 * 
 * Features:
 * - Real-time timeline with minute-by-minute paragraphs
 * - Dual-track: human voice (mic) + computer audio (system)
 * - Display filters: show human/computer/both
 * - Auto session management with idle detection
 * - Card-based history with time ranges and summaries
 */

import { useState, useCallback, CSSProperties, useMemo, useEffect, useRef } from 'react';
import { 
    Mic, 
    MicOff, 
    Settings2, 
    Search,
    Trash2,
    Clock,
    Globe,
    Cpu,
    Volume2,
    Monitor,
    User,
    ChevronDown,
    ChevronRight,
    RefreshCw,
    CheckCircle,
    XCircle,
    Loader2,
    Calendar,
    MessageSquare,
    Filter,
    Play,
    Pause
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useEarlogData, EarlogSession, EarlogTranscript, EarlogBackend } from '../hooks/useEarlogData';

type EarlogTab = 'live' | 'history' | 'settings';
type DisplayFilter = 'all' | 'human' | 'computer';

export function EarlogPanel() {
    const {
        state,
        currentSession,
        sessions,
        backends,
        settings,
        isLoading,
        error,
        startSession,
        pauseSession,
        resumeSession,
        deleteSession,
        setActiveBackend,
        updateSettings,
        searchTranscripts,
        refreshSessions,
    } = useEarlogData();

    const [activeTab, setActiveTab] = useState<EarlogTab>('live');
    const [displayFilter, setDisplayFilter] = useState<DisplayFilter>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<EarlogTranscript[]>([]);
    const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
    const [isPaused, setIsPaused] = useState(false);

    const dragStyle = { WebkitAppRegion: 'drag' } as CSSProperties;
    const noDragStyle = { WebkitAppRegion: 'no-drag' } as CSSProperties;

    const isRecording = state?.is_running ?? false;
    const activeBackend = backends.find(b => b.type === state?.active_backend);

    // Note: Recording is manually triggered via Start button
    // To enable auto-start, uncomment below:
    // useEffect(() => {
    //     if (!isRecording && !isLoading && !isPaused && activeBackend?.is_available) {
    //         startSession(undefined, 'both', 'auto', undefined, true).catch(console.error);
    //     }
    // }, [activeBackend?.is_available, isPaused]);

    // Handle start/pause based on actual recording state
    const handleStartPause = useCallback(async () => {
        if (isRecording) {
            // Currently recording -> Pause (can be resumed)
            setIsPaused(true);
            try {
                await pauseSession();
            } catch (err) {
                console.error('Failed to pause:', err);
            }
        } else if (isPaused) {
            // Paused -> Resume the same session
            setIsPaused(false);
            try {
                await resumeSession();
            } catch (err) {
                console.error('Failed to resume:', err);
                // If resume fails, start a new session
                try {
                    await startSession(undefined, 'both', 'auto', undefined, true);
                } catch (startErr) {
                    console.error('Failed to start new session:', startErr);
                }
            }
        } else {
            // Not recording and not paused -> Start new session
            try {
                await startSession(undefined, 'both', 'auto', undefined, true);
            } catch (err) {
                console.error('Failed to start:', err);
            }
        }
    }, [isRecording, isPaused, startSession, pauseSession, resumeSession]);

    const handleSearch = useCallback(async () => {
        if (!searchQuery.trim()) {
            setSearchResults([]);
            return;
        }
        const results = await searchTranscripts(searchQuery);
        setSearchResults(results);
    }, [searchQuery, searchTranscripts]);

    const handleDeleteSession = useCallback(async (sessionId: string) => {
        if (!confirm('Delete this recording session?')) return;
        try {
            await deleteSession(sessionId);
        } catch (err) {
            console.error('Failed to delete session:', err);
        }
    }, [deleteSession]);

    const formatDuration = (seconds: number) => {
        const hours = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        if (hours > 0) return `${hours}h ${mins}m`;
        return `${mins}m`;
    };

    const formatTimeRange = (start: string, end?: string) => {
        const startDate = new Date(start);
        const endDate = end ? new Date(end) : new Date();
        const startStr = startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const endStr = endDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const dateStr = startDate.toLocaleDateString([], { month: 'short', day: 'numeric' });
        return `${dateStr} ${startStr}–${endStr}`;
    };

    return (
        <div className="flex h-full flex-col bg-background">
            {/* Header */}
            <div className="flex-none border-b px-6 pt-8 pb-4" style={dragStyle}>
                <div className="flex items-center justify-between">
                    <div style={noDragStyle}>
                        <h2 className="text-lg font-semibold tracking-tight flex items-center gap-2 select-text">
                            <Mic className={cn("h-5 w-5", isRecording ? "text-rose-500" : "text-muted-foreground")} />
                            Earlog
                            {isRecording && (
                                <span className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500" />
                                </span>
                            )}
                            <span className="relative group cursor-help">
                                <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                                    Test Mode
                                </span>
                                <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-2 px-3 py-2 text-xs font-normal normal-case tracking-normal text-white bg-gray-900 dark:bg-gray-800 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 whitespace-nowrap z-50">
                                    Feature in development, may have issues
                                    <span className="absolute left-1/2 -translate-x-1/2 -top-1 w-2 h-2 bg-gray-900 dark:bg-gray-800 rotate-45" />
                                </span>
                            </span>
                        </h2>
                        <p className="text-xs text-muted-foreground select-text">
                            {isRecording ? 'Recording...' : isPaused ? 'Paused' : 'Ready to start'}
                        </p>
                    </div>
                    
                    <div className="flex items-center gap-3" style={noDragStyle}>
                        {/* Backend Indicator */}
                        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/50 text-xs">
                            <Cpu className="h-3.5 w-3.5" />
                            <span className="font-medium">{activeBackend?.name ?? 'No Backend'}</span>
                            {activeBackend?.is_available ? (
                                <CheckCircle className="h-3 w-3 text-emerald-500" />
                            ) : (
                                <XCircle className="h-3 w-3 text-rose-500" />
                            )}
                        </div>

                        {/* Start/Pause Button */}
                        <button
                            onClick={handleStartPause}
                            disabled={isLoading || !activeBackend?.is_available}
                            className={cn(
                                "flex h-9 items-center gap-2 rounded-lg px-4 text-sm font-medium transition-all shadow-sm",
                                isPaused || !isRecording
                                    ? "bg-emerald-500 text-white hover:bg-emerald-600"
                                    : "bg-amber-500 text-white hover:bg-amber-600",
                                (isLoading || !activeBackend?.is_available) && "opacity-50 cursor-not-allowed"
                            )}
                        >
                            {isLoading ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : isPaused || !isRecording ? (
                                <>
                                    <Play className="h-4 w-4" />
                                    Start
                                </>
                            ) : (
                                <>
                                    <Pause className="h-4 w-4" />
                                    Pause
                                </>
                            )}
                        </button>
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex items-center gap-1 mt-4" style={noDragStyle}>
                    {[
                        { id: 'live' as const, label: 'Live', icon: Volume2 },
                        { id: 'history' as const, label: 'History', icon: Calendar },
                        { id: 'settings' as const, label: 'Settings', icon: Settings2 },
                    ].map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={cn(
                                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors",
                                activeTab === tab.id
                                    ? "bg-primary/10 text-primary font-medium"
                                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                            )}
                        >
                            <tab.icon className="h-3.5 w-3.5" />
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto p-6" style={noDragStyle}>
                {error && (
                    <div className="mb-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-600 text-sm">
                        {error}
                    </div>
                )}

                {activeTab === 'live' && (
                    <LiveTimeline 
                        currentSession={currentSession}
                        sessions={sessions}
                        displayFilter={displayFilter}
                        setDisplayFilter={setDisplayFilter}
                        isRecording={isRecording}
                        isPaused={isPaused}
                    />
                )}

                {activeTab === 'history' && (
                    <HistoryCards
                        sessions={sessions}
                        expandedSessionId={expandedSessionId}
                        setExpandedSessionId={setExpandedSessionId}
                        handleDeleteSession={handleDeleteSession}
                        searchQuery={searchQuery}
                        setSearchQuery={setSearchQuery}
                        handleSearch={handleSearch}
                        searchResults={searchResults}
                        formatTimeRange={formatTimeRange}
                        formatDuration={formatDuration}
                        refreshSessions={refreshSessions}
                    />
                )}

                {activeTab === 'settings' && (
                    <SettingsTab
                        backends={backends}
                        activeBackend={state?.active_backend}
                        setActiveBackend={setActiveBackend}
                        settings={settings}
                        updateSettings={updateSettings}
                    />
                )}
            </div>
        </div>
    );
}

// Minute paragraph structure
interface MinuteParagraph {
    minuteKey: number;
    clockTime: string;
    humanText: string[];      // A: Human voice (microphone)
    computerText: string[];   // B: Computer audio (system)
    summary?: string;         // C: Fused description (TODO: generate via LLM)
}

// Simple Audio Level Bars Component with smooth animation
function AudioLevelBars({ isRecording }: { isRecording: boolean }) {
    const [micLevel, setMicLevel] = useState(0);
    const [systemLevel, setSystemLevel] = useState(0);
    const micTargetRef = useRef(0);
    const systemTargetRef = useRef(0);
    
    const threshold = 20; // Threshold percentage
    
    useEffect(() => {
        if (!isRecording) {
            setMicLevel(0);
            setSystemLevel(0);
            micTargetRef.current = 0;
            systemTargetRef.current = 0;
            return;
        }
        
        // Update target levels every 200ms (slower, more natural)
        const targetInterval = setInterval(() => {
            // Simulate audio levels with more natural variation
            const time = Date.now() / 1000;
            micTargetRef.current = Math.max(0, Math.min(100, 
                30 + Math.sin(time * 2) * 25 + Math.random() * 20
            ));
            systemTargetRef.current = Math.max(0, Math.min(100, 
                25 + Math.cos(time * 1.5) * 20 + Math.random() * 15
            ));
        }, 200);
        
        // Smooth animation towards target (easing)
        const smoothInterval = setInterval(() => {
            setMicLevel(prev => {
                const diff = micTargetRef.current - prev;
                return prev + diff * 0.15; // Ease towards target
            });
            setSystemLevel(prev => {
                const diff = systemTargetRef.current - prev;
                return prev + diff * 0.15;
            });
        }, 50);
        
        return () => {
            clearInterval(targetInterval);
            clearInterval(smoothInterval);
        };
    }, [isRecording]);
    
    const LevelBar = ({ level, label, color, icon: Icon }: { 
        level: number; label: string; color: string; icon: typeof User 
    }) => {
        const isActive = level > threshold;
        return (
            <div className="flex items-center gap-2">
                <Icon className={cn("h-3.5 w-3.5 flex-shrink-0 transition-colors duration-300", 
                    isActive ? color : "text-muted-foreground/50"
                )} />
                <span className="text-xs text-muted-foreground w-14 flex-shrink-0">{label}</span>
                <div className="flex-1 h-2.5 bg-muted/40 rounded-full overflow-hidden relative">
                    {/* Threshold marker */}
                    <div 
                        className="absolute top-0 bottom-0 w-0.5 bg-amber-500/60 z-10"
                        style={{ left: `${threshold}%` }}
                    />
                    {/* Level bar with smooth transition */}
                    <div 
                        className={cn(
                            "h-full rounded-full transition-all duration-150 ease-out",
                            isActive ? color.replace('text-', 'bg-') : "bg-muted-foreground/25"
                        )}
                        style={{ width: `${Math.max(2, level)}%` }}
                    />
                </div>
                {/* Level indicator */}
                <span className={cn(
                    "text-[10px] w-8 text-right font-mono transition-colors duration-300",
                    isActive ? "text-foreground/70" : "text-muted-foreground/50"
                )}>
                    {Math.round(level)}%
                </span>
            </div>
        );
    };
    
    if (!isRecording) return null;
    
    return (
        <div className="flex flex-col gap-1.5 p-3 rounded-lg border bg-card/30">
            <LevelBar level={micLevel} label="Mic" color="text-emerald-500" icon={User} />
            <LevelBar level={systemLevel} label="System" color="text-blue-500" icon={Monitor} />
        </div>
    );
}

// Live Timeline - shows minute-by-minute paragraphs
function LiveTimeline({
    currentSession,
    sessions,
    displayFilter,
    setDisplayFilter,
    isRecording,
    isPaused,
}: {
    currentSession: EarlogSession | null;
    sessions: EarlogSession[];
    displayFilter: DisplayFilter;
    setDisplayFilter: (f: DisplayFilter) => void;
    isRecording: boolean;
    isPaused: boolean;
}) {
    // Use current session or most recent from history
    const displaySession = currentSession ?? sessions[0] ?? null;
    
    // Build minute paragraphs from transcripts
    const paragraphs = useMemo(() => {
        if (!displaySession?.transcripts) return [];
        
        const validTranscripts = displaySession.transcripts.filter(
            t => t.text && !t.text.includes('[BLANK_AUDIO]') && t.text.trim().length > 0
        );

        // Group by minute
        const byMinute = new Map<number, MinuteParagraph>();
        
        validTranscripts.forEach(t => {
            const date = new Date(t.start_time);
            const minuteKey = date.getHours() * 60 + date.getMinutes();
            
            if (!byMinute.has(minuteKey)) {
                byMinute.set(minuteKey, {
                    minuteKey,
                    clockTime: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    humanText: [],
                    computerText: [],
                });
            }
            
            const para = byMinute.get(minuteKey)!;
            if (t.speaker === 'self') {
                para.humanText.push(t.text);
            } else if (t.speaker === 'other') {
                para.computerText.push(t.text);
            } else {
                // Unknown speaker - put in human by default
                para.humanText.push(t.text);
            }
        });

        return Array.from(byMinute.values()).sort((a, b) => a.minuteKey - b.minuteKey);
    }, [displaySession?.transcripts]);

    // Check if we're waiting for speech
    const lastTranscriptTime = displaySession?.transcripts?.length 
        ? new Date(displaySession.transcripts[displaySession.transcripts.length - 1].start_time).getTime() 
        : 0;
    const isWaitingForSpeech = Date.now() - lastTranscriptTime > 5000 || !displaySession?.transcripts?.length;

    return (
        <div className="space-y-4">
            {/* Display Filter Toggle */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 p-1 rounded-lg bg-muted/50">
                    {[
                        { id: 'all' as const, label: 'All', icon: Filter },
                        { id: 'human' as const, label: 'Human', icon: User },
                        { id: 'computer' as const, label: 'Computer', icon: Monitor },
                    ].map(f => (
                        <button
                            key={f.id}
                            onClick={() => setDisplayFilter(f.id)}
                            className={cn(
                                "flex items-center gap-1.5 px-3 py-1 rounded-md text-xs transition-all",
                                displayFilter === f.id
                                    ? "bg-background shadow-sm font-medium"
                                    : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            <f.icon className="h-3.5 w-3.5" />
                            {f.label}
                        </button>
                    ))}
                </div>
                
            </div>

            {/* Audio Level Bars */}
            <AudioLevelBars isRecording={isRecording} />

            {/* Timeline */}
            <div className="relative max-h-[400px] overflow-y-auto">
                {paragraphs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                        {isRecording ? (
                            <p className="text-sm text-muted-foreground">Waiting for speech above threshold...</p>
                        ) : isPaused ? (
                            <>
                                <Pause className="h-8 w-8 text-amber-500/50 mb-3" />
                                <p className="text-sm text-muted-foreground">Recording paused</p>
                                <p className="text-xs text-muted-foreground/70 mt-1">Click Start to resume</p>
                            </>
                        ) : (
                            <>
                                <MicOff className="h-8 w-8 text-muted-foreground/50 mb-3" />
                                <p className="text-sm text-muted-foreground">Click Start to begin recording</p>
                            </>
                        )}
                    </div>
                ) : (
                    <div className="space-y-4">
                        {paragraphs.map((para) => (
                            <MinuteParagraphCard 
                                key={para.minuteKey}
                                paragraph={para}
                                displayFilter={displayFilter}
                            />
                        ))}
                        
                        {/* Live indicator */}
                        {isRecording && (
                            <div className="flex items-center gap-3 p-3 border-l-2 border-rose-300">
                                <div className="flex gap-0.5">
                                    {[0, 1, 2].map(i => (
                                        <span 
                                            key={i}
                                            className="w-1.5 h-1.5 bg-rose-400/50 rounded-full animate-bounce" 
                                            style={{ animationDelay: `${i * 150}ms` }} 
                                        />
                                    ))}
                                </div>
                                <span className="text-xs text-muted-foreground">
                                    {isWaitingForSpeech ? 'Waiting for speech...' : 'Processing...'}
                                </span>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

// Single minute paragraph card
function MinuteParagraphCard({
    paragraph,
    displayFilter,
}: {
    paragraph: MinuteParagraph;
    displayFilter: DisplayFilter;
}) {
    const showHuman = displayFilter === 'all' || displayFilter === 'human';
    const showComputer = displayFilter === 'all' || displayFilter === 'computer';
    
    const hasHuman = paragraph.humanText.length > 0;
    const hasComputer = paragraph.computerText.length > 0;
    
    // Skip if nothing to show based on filter
    if ((displayFilter === 'human' && !hasHuman) || (displayFilter === 'computer' && !hasComputer)) {
        return null;
    }

    return (
        <div className="flex gap-4 group">
            {/* Time marker */}
            <div className="flex-shrink-0 w-14 pt-1">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <div className="w-2 h-2 rounded-full bg-primary/40 group-hover:bg-primary transition-colors" />
                    <span className="font-mono">{paragraph.clockTime}</span>
                </div>
            </div>
            
            {/* Content */}
            <div className="flex-1 p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors space-y-2">
                {/* Human voice (A) */}
                {showHuman && hasHuman && (
                    <div className="flex gap-2">
                        <div className="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
                            <User className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <p className="text-sm text-emerald-700 dark:text-emerald-400 leading-relaxed flex-1">
                            {paragraph.humanText.join(' ')}
                        </p>
                    </div>
                )}
                
                {/* Computer audio (B) */}
                {showComputer && hasComputer && (
                    <div className="flex gap-2">
                        <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
                            <Monitor className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                        </div>
                        <p className="text-sm text-blue-700 dark:text-blue-400 leading-relaxed flex-1">
                            {paragraph.computerText.join(' ')}
                        </p>
                    </div>
                )}
                
                {/* Summary/Description (C) - TODO: generate via LLM */}
                {paragraph.summary && (
                    <div className="flex gap-2 pt-2 border-t border-dashed">
                        <div className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
                            <MessageSquare className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                        </div>
                        <p className="text-sm text-amber-700 dark:text-amber-400 leading-relaxed flex-1 italic">
                            {paragraph.summary}
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}

// History Cards - card-based session history
function HistoryCards({
    sessions,
    expandedSessionId,
    setExpandedSessionId,
    handleDeleteSession,
    searchQuery,
    setSearchQuery,
    handleSearch,
    searchResults,
    formatTimeRange,
    formatDuration,
    refreshSessions,
}: {
    sessions: EarlogSession[];
    expandedSessionId: string | null;
    setExpandedSessionId: (id: string | null) => void;
    handleDeleteSession: (id: string) => void;
    searchQuery: string;
    setSearchQuery: (q: string) => void;
    handleSearch: () => void;
    searchResults: EarlogTranscript[];
    formatTimeRange: (start: string, end?: string) => string;
    formatDuration: (s: number) => string;
    refreshSessions: () => void;
}) {
    // Generate a simple summary from transcripts
    const generateSummary = (session: EarlogSession) => {
        const validTranscripts = session.transcripts.filter(
            t => t.text && !t.text.includes('[BLANK_AUDIO]') && t.text.trim().length > 0
        );
        if (validTranscripts.length === 0) return 'No transcripts';
        
        // Take first few words from first transcript as preview
        const firstText = validTranscripts[0].text;
        const words = firstText.split(' ').slice(0, 15).join(' ');
        return words + (firstText.split(' ').length > 15 ? '...' : '');
    };

    return (
        <div className="space-y-4">
            {/* Search */}
            <div className="flex items-center gap-2">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                        placeholder="Search transcripts..."
                        className="w-full pl-9 pr-3 py-2 rounded-md border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                </div>
                <button onClick={handleSearch} className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90">
                    Search
                </button>
                <button onClick={refreshSessions} className="p-2 rounded-md hover:bg-muted">
                    <RefreshCw className="h-4 w-4" />
                </button>
            </div>

            {/* Search Results */}
            {searchResults.length > 0 && (
                <div className="space-y-2 p-4 rounded-lg bg-amber-500/5 border border-amber-500/20">
                    <h3 className="text-sm font-medium text-amber-700">Found {searchResults.length} results</h3>
                    {searchResults.slice(0, 5).map(t => (
                        <div key={t.id} className="text-sm p-2 rounded bg-background">
                            <p>{t.text}</p>
                            <span className="text-xs text-muted-foreground">
                                {new Date(t.start_time).toLocaleString()}
                            </span>
                        </div>
                    ))}
                </div>
            )}

            {/* Session Cards */}
            <div className="grid gap-3">
                {sessions.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                        <Calendar className="h-12 w-12 mx-auto mb-3 opacity-50" />
                        <p className="text-sm">No recording sessions yet</p>
                    </div>
                ) : (
                    sessions.map(session => (
                        <div 
                            key={session.id} 
                            className={cn(
                                "rounded-xl border bg-card overflow-hidden transition-all",
                                expandedSessionId === session.id ? "ring-2 ring-primary/20" : "hover:bg-muted/30"
                            )}
                        >
                            {/* Card Header */}
                            <div
                                className="flex items-center justify-between p-4 cursor-pointer"
                                onClick={() => setExpandedSessionId(expandedSessionId === session.id ? null : session.id)}
                            >
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                                        <Mic className="h-5 w-5 text-primary" />
                                    </div>
                                    <div>
                                        <div className="font-medium text-sm">
                                            {formatTimeRange(session.started_at, session.ended_at)}
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                            {formatDuration(session.total_duration_seconds)} • {session.transcripts.length} segments
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleDeleteSession(session.id); }}
                                        className="p-1.5 rounded hover:bg-rose-500/10 text-muted-foreground hover:text-rose-500 transition-colors"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                    {expandedSessionId === session.id ? (
                                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                    ) : (
                                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                    )}
                                </div>
                            </div>
                            
                            {/* Summary Preview */}
                            {expandedSessionId !== session.id && (
                                <div className="px-4 pb-3 -mt-1">
                                    <p className="text-xs text-muted-foreground line-clamp-2">
                                        {generateSummary(session)}
                                    </p>
                                </div>
                            )}

                            {/* Expanded Content - Timeline View */}
                            {expandedSessionId === session.id && (
                                <div className="border-t p-4 bg-muted/10 max-h-80 overflow-y-auto">
                                    <SessionTimeline session={session} />
                                </div>
                            )}
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}

// Session Timeline for expanded history card
function SessionTimeline({ session }: { session: EarlogSession }) {
    const validTranscripts = session.transcripts.filter(
        t => t.text && !t.text.includes('[BLANK_AUDIO]') && t.text.trim().length > 0
    );

    if (validTranscripts.length === 0) {
        return <p className="text-sm text-muted-foreground text-center py-4">No transcripts in this session</p>;
    }

    // Group by minute
    const byMinute = new Map<number, { time: string; items: { speaker: string; text: string }[] }>();
    
    validTranscripts.forEach(t => {
        const date = new Date(t.start_time);
        const minuteKey = date.getHours() * 60 + date.getMinutes();
        
        if (!byMinute.has(minuteKey)) {
            byMinute.set(minuteKey, {
                time: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                items: [],
            });
        }
        byMinute.get(minuteKey)!.items.push({ speaker: t.speaker || 'unknown', text: t.text });
    });

    const paragraphs = Array.from(byMinute.entries()).sort((a, b) => a[0] - b[0]);

    return (
        <div className="space-y-3">
            {paragraphs.map(([key, para]) => (
                <div key={key} className="flex gap-3">
                    <div className="text-xs text-muted-foreground font-mono w-12 pt-0.5">{para.time}</div>
                    <div className="flex-1 space-y-1">
                        {para.items.map((item, i) => (
                            <div key={i} className="flex gap-2 items-start">
                                <span className={cn(
                                    "text-[10px] px-1.5 py-0.5 rounded",
                                    item.speaker === 'self' ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"
                                )}>
                                    {item.speaker === 'self' ? '人' : '机'}
                                </span>
                                <p className="text-sm flex-1">{item.text}</p>
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

// Settings Tab
function SettingsTab({
    backends,
    activeBackend,
    setActiveBackend,
    settings,
    updateSettings,
}: {
    backends: EarlogBackend[];
    activeBackend: string | null | undefined;
    setActiveBackend: (b: string) => void;
    settings: {
        chunk_duration_seconds: number;
        glm_asr_endpoint: string | null;
        moonshine_endpoint: string | null;
    } | null;
    updateSettings: (s: Partial<{ chunk_duration_seconds: number; glm_asr_endpoint: string | null; moonshine_endpoint: string | null }>) => void;
}) {
    return (
        <div className="space-y-6">
            {/* ASR Backend Selection */}
            <div>
                <h3 className="text-sm font-medium mb-3">ASR Backend</h3>
                <div className="grid gap-3">
                    {backends.map(backend => (
                        <div
                            key={backend.type}
                            onClick={() => backend.is_available && setActiveBackend(backend.type)}
                            className={cn(
                                "p-4 rounded-lg border cursor-pointer transition-all",
                                activeBackend === backend.type
                                    ? "border-primary bg-primary/5"
                                    : backend.is_available
                                        ? "hover:border-primary/50 hover:bg-muted/30"
                                        : "opacity-50 cursor-not-allowed"
                            )}
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Cpu className="h-4 w-4" />
                                    <span className="font-medium">{backend.name}</span>
                                    {activeBackend === backend.type && (
                                        <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">Active</span>
                                    )}
                                </div>
                                {backend.is_available ? (
                                    <CheckCircle className="h-4 w-4 text-emerald-500" />
                                ) : (
                                    <XCircle className="h-4 w-4 text-rose-500" />
                                )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">{backend.description}</p>
                            {backend.status_message && (
                                <div className={cn(
                                    "text-xs mt-2 p-2 rounded",
                                    backend.is_available ? "bg-emerald-500/10 text-emerald-600" : "bg-rose-500/10 text-rose-600"
                                )}>
                                    {backend.status_message}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {/* Session Settings */}
            <div>
                <h3 className="text-sm font-medium mb-3">Session Settings</h3>
                <div className="space-y-3">
                    <div>
                        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                            Idle Timeout for New Session (hours)
                        </label>
                        <input
                            type="number"
                            min={1}
                            max={24}
                            defaultValue={4}
                            className="w-24 px-3 py-2 rounded-md border bg-background text-sm"
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                            Start a new session after this many hours of inactivity
                        </p>
                    </div>
                </div>
            </div>

            {/* Chunk Duration */}
            <div>
                <label className="text-sm font-medium mb-1.5 block">Audio Chunk Duration (seconds)</label>
                <input
                    type="number"
                    min={3}
                    max={60}
                    value={settings?.chunk_duration_seconds ?? 5}
                    onChange={(e) => updateSettings({ chunk_duration_seconds: Number(e.target.value) })}
                    className="w-24 px-3 py-2 rounded-md border bg-background text-sm"
                />
                <p className="text-xs text-muted-foreground mt-1">Lower = faster response, Higher = better accuracy</p>
            </div>
        </div>
    );
}
