import { useCallback, useEffect, useMemo, useState, useRef, CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ArrowUpDown,
    Brain,
    Calendar,
    ChevronDown,
    ChevronRight,
    Clock,
    Database,
    FileText,
    Laptop,
    Lightbulb,
    Link2,
    RefreshCw,
    Search,
    User
} from 'lucide-react';
import { cn } from '../lib/utils';

interface MemCellMemory {
    id: string;
    user_id: string;
    original_data: string;
    summary?: string;
    subject?: string;
    file_id?: string;
    chunk_id?: string;
    chunk_ordinal?: number;
    type?: string;
    keywords?: string[];
    timestamp: string;
    created_at?: string;
    metadata?: Record<string, unknown>;
}

interface EpisodeMemory {
    id: string;
    user_id: string;
    summary: string;
    episode?: string;
    timestamp: string;
    subject?: string;
    parent_memcell_id?: string;
    metadata?: Record<string, unknown>;
}

interface ForesightMemory {
    id: string;
    user_id: string;
    content: string;
    evidence?: string;
    parent_episode_id?: string;
    metadata?: Record<string, unknown>;
}

interface EventLog {
    id: string;
    user_id: string;
    atomic_fact: string;
    timestamp: string;
    parent_episode_id?: string;
    metadata?: Record<string, unknown>;
}

interface UserProfile {
    user_id: string;
    user_name?: string;
    personality?: string[];
    interests?: string[];
    hard_skills?: Array<{ name: string; level: string }>;
    soft_skills?: Array<{ name: string; level: string }>;
}

interface MemorySummary {
    user_id: string;
    profile?: UserProfile;
    memcells_count: number;
    episodes_count: number;
    event_logs_count: number;
    foresights_count: number;
    recent_episodes: EpisodeMemory[];
    recent_foresights: ForesightMemory[];
}

interface ProfileSubtopic {
    name: string;
    description?: string;
    value?: any;
    confidence?: string;  // high, medium, low
    evidence?: string;
}

interface ProfileTopic {
    topic_id: string;
    topic_name: string;
    icon?: string;
    subtopics: ProfileSubtopic[];
}

interface BasicProfile {
    user_id: string;
    user_name?: string;
    // Hierarchical topics (primary structure)
    topics: ProfileTopic[];
    // Legacy flat fields (optional, for backward compatibility)
    personality?: string[];
    interests?: string[];
    hard_skills?: Array<{ name: string; level?: string }>;
    soft_skills?: Array<{ name: string; level?: string }>;
    working_habit_preference?: string[];
    user_goal?: string[];
    motivation_system?: string[];
    value_system?: string[];
    inferred_roles?: string[];
    raw_system_data?: {
        username: string;
        computer_name: string;
        shell: string;
        language: string;
        region: string;
        timezone: string;
        appearance: string;
        installed_apps: string[];
        dev_tools: Array<{ name: string; version: string }>;
    };
    scanned_at: string;
}

type MemoryTab = 'overview' | 'basic-profile' | 'memcells' | 'episodes' | 'events' | 'foresights' | 'timeline';

type TimeRange = 'all' | '7d' | '30d' | '90d';

type TimelineEntry = {
    id: string;
    type: 'episode' | 'event' | 'foresight';
    title: string;
    body: string;
    timestamp?: string;
    parentEpisodeId?: string;
    sourcePath?: string;
    sourceName?: string;
};

export function UserMemory() {
    const { t } = useTranslation();
    const [activeTab, setActiveTab] = useState<MemoryTab>('overview');
    const [userId] = useState('default_user');
    const [summary, setSummary] = useState<MemorySummary | null>(null);
    const [basicProfile, setBasicProfile] = useState<BasicProfile | null>(null);
    const [basicProfileLoading, setBasicProfileLoading] = useState(false);
    const [loadingTopics, setLoadingTopics] = useState<Set<string>>(new Set()); // Topics currently being generated
    const [_generatedTopics, setGeneratedTopics] = useState<Set<string>>(new Set()); // Topics already generated
    const streamCleanupRef = useRef<(() => void) | null>(null);
    const [memcells, setMemcells] = useState<MemCellMemory[]>([]);
    const [episodes, setEpisodes] = useState<EpisodeMemory[]>([]);
    const [eventLogs, setEventLogs] = useState<EventLog[]>([]);
    const [foresights, setForesights] = useState<ForesightMemory[]>([]);
    const [loading, setLoading] = useState(false);
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
    const [searchTerm, setSearchTerm] = useState('');
    const [timeRange, setTimeRange] = useState<TimeRange>('all');
    const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
    const [showLinkedOnly, setShowLinkedOnly] = useState(false);
    const [focusedEpisodeId, setFocusedEpisodeId] = useState<string | null>(null);

    const dragStyle = { WebkitAppRegion: 'drag' } as CSSProperties;
    const noDragStyle = { WebkitAppRegion: 'no-drag' } as CSSProperties;

    const fetchSummary = useCallback(async () => {
        setLoading(true);
        try {
            const api = window.api;
            if (api?.memoryGetSummary) {
                const data = await api.memoryGetSummary(userId);
                setSummary(data);
            } else {
                // Mock data for development
                setSummary({
                    user_id: userId,
                    memcells_count: 0,
                    episodes_count: 0,
                    event_logs_count: 0,
                    foresights_count: 0,
                    recent_episodes: [],
                    recent_foresights: [],
                });
            }
        } catch (error) {
            console.error('Failed to fetch memory summary', error);
        } finally {
            setLoading(false);
        }
    }, [userId]);

    // Progressive/streaming basic profile generation
    const fetchBasicProfile = useCallback(() => {
        // Cancel any existing stream
        if (streamCleanupRef.current) {
            streamCleanupRef.current();
            streamCleanupRef.current = null;
        }

        setBasicProfileLoading(true);
        setLoadingTopics(new Set(['basic_info', 'technical', 'work', 'interest', 'psychological', 'behavioral']));
        setGeneratedTopics(new Set());

        const api = window.api;

        // Try streaming first, fall back to regular fetch
        if (api?.memoryStreamBasicProfile) {
            console.log('[BasicProfile] Starting streaming...');
            const cleanup = api.memoryStreamBasicProfile(userId, (event) => {
                console.log('[BasicProfile] Stream event:', event.type, event.data?.topic_id || '');
                if (event.type === 'init') {
                    // Initialize with raw system data
                    setBasicProfile(prev => ({
                        user_id: event.data.user_id,
                        user_name: event.data.user_name,
                        topics: prev?.topics || [],
                        // Legacy fields
                        personality: prev?.personality || [],
                        interests: prev?.interests || [],
                        hard_skills: prev?.hard_skills || [],
                        soft_skills: prev?.soft_skills || [],
                        working_habit_preference: prev?.working_habit_preference || [],
                        user_goal: prev?.user_goal || [],
                        motivation_system: prev?.motivation_system || [],
                        value_system: prev?.value_system || [],
                        inferred_roles: prev?.inferred_roles || [],
                        raw_system_data: event.data.raw_system_data,
                        scanned_at: event.data.scanned_at,
                    }));
                } else if (event.type === 'topic') {
                    // Add generated topic
                    const topicData = event.data;
                    setBasicProfile(prev => {
                        if (!prev) return null;
                        const existingTopics = prev.topics.filter(t => t.topic_id !== topicData.topic_id);
                        return {
                            ...prev,
                            topics: [...existingTopics, topicData],
                        };
                    });
                    setLoadingTopics(prev => {
                        const next = new Set(prev);
                        next.delete(topicData.topic_id);
                        return next;
                    });
                    setGeneratedTopics(prev => new Set([...prev, topicData.topic_id]));
                } else if (event.type === 'complete') {
                    setBasicProfileLoading(false);
                    setLoadingTopics(new Set());
                    streamCleanupRef.current = null;
                } else if (event.type === 'error') {
                    console.error('Profile stream error:', event.data);
                    // Continue loading other topics
                    if (event.data.topic_id) {
                        setLoadingTopics(prev => {
                            const next = new Set(prev);
                            next.delete(event.data.topic_id);
                            return next;
                        });
                    }
                }
            });
            streamCleanupRef.current = cleanup;
        } else if (api?.memoryGetBasicProfile) {
            // Fallback to regular fetch
            api.memoryGetBasicProfile(userId)
                .then(data => {
                    setBasicProfile(data);
                })
                .catch(error => {
                    console.error('Failed to fetch basic profile', error);
                })
                .finally(() => {
                    setBasicProfileLoading(false);
                    setLoadingTopics(new Set());
                });
        } else {
            setBasicProfileLoading(false);
            setLoadingTopics(new Set());
        }
    }, [userId]);

    // Load cached profile (called when tab opens, doesn't regenerate)
    const loadCachedProfile = useCallback(async () => {
        const api = window.api;
        if (!api?.memoryGetCachedBasicProfile) return;

        try {
            const cached = await api.memoryGetCachedBasicProfile(userId);
            if (cached) {
                setBasicProfile(cached);
                setLoadingTopics(new Set());
                console.log('[BasicProfile] Loaded cached profile');
            } else {
                // No cached profile - user needs to click Analyze
                setBasicProfile(null);
                console.log('[BasicProfile] No cached profile found');
            }
        } catch (error) {
            console.error('Failed to load cached profile:', error);
            setBasicProfile(null);
        }
    }, [userId]);

    const fetchMemcells = useCallback(async () => {
        setLoading(true);
        try {
            const api = window.api;
            if (api?.memoryGetMemcells) {
                const data = await api.memoryGetMemcells(userId, 50, 0);
                setMemcells(data);
            }
            // Also fetch episodes to populate episodesByMemcell map
            if (api?.memoryGetEpisodes) {
                const episodesData = await api.memoryGetEpisodes(userId, 100, 0);
                setEpisodes(episodesData);
            }
        } catch (error) {
            console.error('Failed to fetch memcells', error);
        } finally {
            setLoading(false);
        }
    }, [userId]);

    const fetchEpisodes = useCallback(async () => {
        setLoading(true);
        try {
            const api = window.api;
            if (api?.memoryGetEpisodes) {
                const data = await api.memoryGetEpisodes(userId, 50, 0);
                setEpisodes(data);
            }
        } catch (error) {
            console.error('Failed to fetch episodes', error);
        } finally {
            setLoading(false);
        }
    }, [userId]);

    const fetchEventLogs = useCallback(async (limit = 100, offset = 0) => {
        setLoading(true);
        try {
            const api = window.api;
            if (api?.memoryGetEventLogs) {
                const data = await api.memoryGetEventLogs(userId, limit, offset);
                setEventLogs(data);
            }
        } catch (error) {
            console.error('Failed to fetch event logs', error);
        } finally {
            setLoading(false);
        }
    }, [userId]);

    const fetchForesights = useCallback(async (limit = 50) => {
        setLoading(true);
        try {
            const api = window.api;
            if (api?.memoryGetForesights) {
                const data = await api.memoryGetForesights(userId, limit);
                setForesights(data);
            }
        } catch (error) {
            console.error('Failed to fetch foresights', error);
        } finally {
            setLoading(false);
        }
    }, [userId]);

    useEffect(() => {
        if (activeTab === 'overview') {
            void fetchSummary();
            void fetchEventLogs(5, 0);
        } else if (activeTab === 'basic-profile') {
            // Load cached profile when tab opens (doesn't regenerate)
            void loadCachedProfile();
        } else if (activeTab === 'memcells') {
            void fetchMemcells();
        } else if (activeTab === 'episodes') {
            void fetchEpisodes();
        } else if (activeTab === 'events') {
            void fetchEventLogs(100, 0);
        } else if (activeTab === 'foresights') {
            void fetchForesights(50);
        } else if (activeTab === 'timeline') {
            void fetchEpisodes();
            void fetchEventLogs(100, 0);
            void fetchForesights(50);
        }
    }, [activeTab, fetchSummary, fetchMemcells, fetchEpisodes, fetchEventLogs, fetchForesights, loadCachedProfile]);

    const toggleExpand = (id: string) => {
        setExpandedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    const formatDate = (dateStr: string) => {
        try {
            const date = new Date(dateStr);
            return date.toLocaleString();
        } catch {
            return dateStr;
        }
    };

    const formatDateShort = (dateStr?: string) => {
        if (!dateStr) return 'No timestamp';
        try {
            const date = new Date(dateStr);
            return date.toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
            });
        } catch {
            return dateStr;
        }
    };

    const normalizeText = (value: string) => value.toLowerCase();

    const matchesSearch = (value: string) => {
        if (!searchTerm.trim()) return true;
        return normalizeText(value).includes(normalizeText(searchTerm.trim()));
    };

    const inTimeRange = (dateStr?: string) => {
        if (!dateStr) {
            return timeRange === 'all';
        }
        if (timeRange === 'all') return true;
        const date = new Date(dateStr);
        if (Number.isNaN(date.getTime())) return timeRange === 'all';
        const now = Date.now();
        const diffMs = now - date.getTime();
        const diffDays = diffMs / (1000 * 60 * 60 * 24);
        if (timeRange === '7d') return diffDays <= 7;
        if (timeRange === '30d') return diffDays <= 30;
        return diffDays <= 90;
    };

    const episodesById = useMemo(() => {
        const map = new Map<string, EpisodeMemory>();
        episodes.forEach(ep => map.set(ep.id, ep));
        return map;
    }, [episodes]);

    const eventsByEpisode = useMemo(() => {
        const map = new Map<string, EventLog[]>();
        eventLogs.forEach(log => {
            if (!log.parent_episode_id) return;
            const list = map.get(log.parent_episode_id) ?? [];
            list.push(log);
            map.set(log.parent_episode_id, list);
        });
        return map;
    }, [eventLogs]);

    const foresightsByEpisode = useMemo(() => {
        const map = new Map<string, ForesightMemory[]>();
        foresights.forEach(fs => {
            if (!fs.parent_episode_id) return;
            const list = map.get(fs.parent_episode_id) ?? [];
            list.push(fs);
            map.set(fs.parent_episode_id, list);
        });
        return map;
    }, [foresights]);

    const extractSource = (metadata?: Record<string, unknown>) => {
        if (!metadata) return null;
        const sourceName =
            (metadata.file_name as string | undefined) ??
            (metadata.fileName as string | undefined) ??
            (metadata.name as string | undefined);
        const sourcePath =
            (metadata.file_path as string | undefined) ??
            (metadata.filePath as string | undefined) ??
            (metadata.path as string | undefined);
        if (!sourceName && !sourcePath) return null;
        return { sourceName, sourcePath };
    };

    const handleOpenSource = async (path?: string) => {
        if (!path) return;
        try {
            await window.api?.openFile?.(path);
        } catch (error) {
            console.error('Failed to open file', error);
        }
    };

    const handleJumpToEpisode = useCallback((episodeId?: string) => {
        if (!episodeId) return;
        setActiveTab('episodes');
        setFocusedEpisodeId(episodeId);
    }, []);

    const handleJumpToMemcell = useCallback((memcellId?: string) => {
        if (!memcellId) return;
        setActiveTab('memcells');
        setExpandedIds(prev => {
            const next = new Set(prev);
            next.add(memcellId);
            return next;
        });
    }, []);

    const filteredMemcells = useMemo(() => {
        const items = memcells.filter(mc => {
            const text = `${mc.subject ?? ''} ${mc.summary ?? ''}`;
            return matchesSearch(text) && inTimeRange(mc.timestamp);
        });
        items.sort((a, b) => {
            const aTime = new Date(a.timestamp).getTime();
            const bTime = new Date(b.timestamp).getTime();
            if (Number.isNaN(aTime) || Number.isNaN(bTime)) return 0;
            return sortOrder === 'newest' ? bTime - aTime : aTime - bTime;
        });
        return items;
    }, [memcells, searchTerm, timeRange, sortOrder]);

    const episodesByMemcell = useMemo(() => {
        const map = new Map<string, EpisodeMemory[]>();
        episodes.forEach(ep => {
            if (!ep.parent_memcell_id) return;
            const list = map.get(ep.parent_memcell_id) ?? [];
            list.push(ep);
            map.set(ep.parent_memcell_id, list);
        });
        return map;
    }, [episodes]);

    const filteredEpisodes = useMemo(() => {
        const items = episodes.filter(ep => {
            const text = `${ep.subject ?? ''} ${ep.summary ?? ''} ${ep.episode ?? ''}`;
            return matchesSearch(text) && inTimeRange(ep.timestamp);
        });
        items.sort((a, b) => {
            const aTime = new Date(a.timestamp).getTime();
            const bTime = new Date(b.timestamp).getTime();
            if (Number.isNaN(aTime) || Number.isNaN(bTime)) return 0;
            return sortOrder === 'newest' ? bTime - aTime : aTime - bTime;
        });
        return items;
    }, [episodes, searchTerm, timeRange, sortOrder]);

    const filteredEventLogs = useMemo(() => {
        const items = eventLogs.filter(log => {
            const parent = log.parent_episode_id ? episodesById.get(log.parent_episode_id) : undefined;
            const text = `${log.atomic_fact ?? ''} ${parent?.subject ?? ''} ${parent?.summary ?? ''}`;
            const linkedOk = showLinkedOnly ? Boolean(log.parent_episode_id) : true;
            return matchesSearch(text) && linkedOk && inTimeRange(log.timestamp);
        });
        items.sort((a, b) => {
            const aTime = new Date(a.timestamp).getTime();
            const bTime = new Date(b.timestamp).getTime();
            if (Number.isNaN(aTime) || Number.isNaN(bTime)) return 0;
            return sortOrder === 'newest' ? bTime - aTime : aTime - bTime;
        });
        return items;
    }, [eventLogs, episodesById, searchTerm, showLinkedOnly, timeRange, sortOrder]);

    const filteredForesights = useMemo(() => {
        const items = foresights.filter(fs => {
            const parent = fs.parent_episode_id ? episodesById.get(fs.parent_episode_id) : undefined;
            const text = `${fs.content ?? ''} ${fs.evidence ?? ''} ${parent?.subject ?? ''}`;
            const linkedOk = showLinkedOnly ? Boolean(fs.parent_episode_id) : true;
            const timestamp = parent?.timestamp;
            return matchesSearch(text) && linkedOk && inTimeRange(timestamp);
        });
        return items;
    }, [foresights, episodesById, searchTerm, showLinkedOnly, timeRange]);

    const timelineEntries = useMemo(() => {
        const entries: TimelineEntry[] = [];
        episodes.forEach(ep => {
            const source = extractSource(ep.metadata);
            entries.push({
                id: ep.id,
                type: 'episode',
                title: ep.subject || 'Episode',
                body: ep.summary,
                timestamp: ep.timestamp,
                sourcePath: source?.sourcePath,
                sourceName: source?.sourceName,
            });
        });
        eventLogs.forEach(log => {
            const parent = log.parent_episode_id ? episodesById.get(log.parent_episode_id) : undefined;
            const source = extractSource(parent?.metadata);
            entries.push({
                id: log.id,
                type: 'event',
                title: parent?.subject ? `Event from ${parent.subject}` : 'Event log',
                body: log.atomic_fact,
                timestamp: log.timestamp,
                parentEpisodeId: log.parent_episode_id,
                sourcePath: source?.sourcePath,
                sourceName: source?.sourceName,
            });
        });
        foresights.forEach(fs => {
            const parent = fs.parent_episode_id ? episodesById.get(fs.parent_episode_id) : undefined;
            const source = extractSource(parent?.metadata);
            entries.push({
                id: fs.id,
                type: 'foresight',
                title: parent?.subject ? `Foresight from ${parent.subject}` : 'Foresight',
                body: fs.content,
                timestamp: parent?.timestamp,
                parentEpisodeId: fs.parent_episode_id,
                sourcePath: source?.sourcePath,
                sourceName: source?.sourceName,
            });
        });
        const filtered = entries.filter(entry => {
            const text = `${entry.title} ${entry.body}`;
            return matchesSearch(text) && inTimeRange(entry.timestamp);
        });
        filtered.sort((a, b) => {
            const aTime = a.timestamp ? new Date(a.timestamp).getTime() : 0;
            const bTime = b.timestamp ? new Date(b.timestamp).getTime() : 0;
            if (aTime === bTime) return 0;
            return sortOrder === 'newest' ? bTime - aTime : aTime - bTime;
        });
        return filtered;
    }, [episodes, eventLogs, foresights, episodesById, searchTerm, timeRange, sortOrder]);

    const recentEpisodes = useMemo(() => {
        const items = summary?.recent_episodes ?? [];
        return items.filter(ep => {
            const text = `${ep.subject ?? ''} ${ep.summary ?? ''}`;
            return matchesSearch(text) && inTimeRange(ep.timestamp);
        });
    }, [summary, searchTerm, timeRange]);

    const recentForesights = useMemo(() => {
        const items = summary?.recent_foresights ?? [];
        return items.filter(fs => {
            const parent = fs.parent_episode_id ? episodesById.get(fs.parent_episode_id) : undefined;
            const text = `${fs.content ?? ''} ${fs.evidence ?? ''} ${parent?.subject ?? ''}`;
            const timestamp = parent?.timestamp;
            return matchesSearch(text) && inTimeRange(timestamp);
        });
    }, [summary, episodesById, searchTerm, timeRange]);

    const recentEvents = useMemo(() => {
        const items = eventLogs.slice(0, 5);
        return items.filter(log => {
            const parent = log.parent_episode_id ? episodesById.get(log.parent_episode_id) : undefined;
            const text = `${log.atomic_fact ?? ''} ${parent?.subject ?? ''}`;
            return matchesSearch(text) && inTimeRange(log.timestamp);
        });
    }, [eventLogs, episodesById, searchTerm, timeRange]);

    useEffect(() => {
        if (activeTab !== 'episodes' || !focusedEpisodeId) return;
        setExpandedIds(prev => {
            if (prev.has(focusedEpisodeId)) return prev;
            const next = new Set(prev);
            next.add(focusedEpisodeId);
            return next;
        });
        const targetId = `episode-${focusedEpisodeId}`;
        window.requestAnimationFrame(() => {
            const element = document.getElementById(targetId);
            if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        });
    }, [activeTab, focusedEpisodeId]);

    const tabs: { id: MemoryTab; label: string; icon: React.ReactNode }[] = [
        { id: 'overview', label: t('memory.tabs.overview'), icon: <User className="h-4 w-4" /> },
        { id: 'basic-profile', label: t('memory.tabs.basicProfile', 'Basic Profile'), icon: <Laptop className="h-4 w-4" /> },
        { id: 'memcells', label: t('memory.tabs.memcells'), icon: <Database className="h-4 w-4" /> },
        { id: 'episodes', label: t('memory.tabs.episodes'), icon: <Brain className="h-4 w-4" /> },
        { id: 'events', label: t('memory.tabs.events'), icon: <Clock className="h-4 w-4" /> },
        { id: 'foresights', label: t('memory.tabs.foresights'), icon: <Lightbulb className="h-4 w-4" /> },
        { id: 'timeline', label: t('memory.tabs.timeline'), icon: <Calendar className="h-4 w-4" /> },
    ];

    return (
        <div className="flex h-full flex-col">
            {/* Header */}
            <div className="flex-none border-b px-6 pt-8 pb-4" style={dragStyle}>
                <div className="flex items-center justify-between" style={noDragStyle}>
                    <div>
                        <h1 className="text-2xl font-bold">{t('memory.title')}</h1>
                        <p className="text-muted-foreground text-sm mt-1">
                            {t('memory.subtitle')}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        {/* For basic-profile tab, show Analyze/Re-analyze button */}
                        {activeTab === 'basic-profile' ? (
                            <button
                                onClick={() => void fetchBasicProfile()}
                                disabled={basicProfileLoading}
                                className={cn(
                                    "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                                    "bg-primary text-primary-foreground hover:bg-primary/90",
                                    basicProfileLoading && "opacity-50 cursor-not-allowed"
                                )}
                            >
                                <Brain className={cn("h-4 w-4", basicProfileLoading && "animate-pulse")} />
                                {basicProfileLoading
                                    ? t('memory.basicProfile.analyzing', 'Analyzing...')
                                    : basicProfile
                                        ? t('memory.basicProfile.reanalyze', 'Re-analyze')
                                        : t('memory.basicProfile.analyze', 'Analyze')
                                }
                            </button>
                        ) : (
                            <button
                                onClick={() => {
                                    if (activeTab === 'overview') {
                                        void fetchSummary();
                                        void fetchEventLogs(5, 0);
                                    }
                                    else if (activeTab === 'memcells') void fetchMemcells();
                                    else if (activeTab === 'episodes') void fetchEpisodes();
                                    else if (activeTab === 'events') void fetchEventLogs(100, 0);
                                    else if (activeTab === 'foresights') void fetchForesights(50);
                                    else if (activeTab === 'timeline') {
                                        void fetchEpisodes();
                                        void fetchEventLogs(100, 0);
                                        void fetchForesights(50);
                                    }
                                }}
                                disabled={loading}
                                className={cn(
                                    "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                                    "bg-primary text-primary-foreground hover:bg-primary/90",
                                    loading && "opacity-50 cursor-not-allowed"
                                )}
                            >
                                <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                                {t('memory.refresh')}
                            </button>
                        )}
                    </div>
                </div>

                    {/* Tabs */}
                    <div className="flex gap-2 mt-4" style={noDragStyle}>
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={cn(
                                "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                                activeTab === tab.id
                                    ? "bg-accent text-accent-foreground"
                                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                            )}
                        >
                            {tab.icon}
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Filters */}
                <div className="mt-4 flex flex-wrap items-center gap-3" style={noDragStyle}>
                    <div className="flex w-full max-w-md items-center gap-2 rounded-lg border bg-background px-3 py-2 shadow-sm">
                        <Search className="h-4 w-4 text-muted-foreground" />
                        <input
                            value={searchTerm}
                            onChange={event => setSearchTerm(event.target.value)}
                            placeholder={t('memory.filters.searchPlaceholder')}
                            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                        />
                    </div>
                    <div className="flex items-center gap-1 rounded-lg border bg-muted/30 p-1">
                        {(['all', '7d', '30d', '90d'] as TimeRange[]).map(range => (
                            <button
                                key={range}
                                onClick={() => setTimeRange(range)}
                                className={cn(
                                    "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                                    timeRange === range
                                        ? "bg-background text-foreground shadow-sm"
                                        : "text-muted-foreground hover:text-foreground"
                                )}
                            >
                                {range === 'all' ? t('memory.filters.allTime') : range.toUpperCase()}
                            </button>
                        ))}
                    </div>
                    <button
                        onClick={() => setSortOrder(prev => (prev === 'newest' ? 'oldest' : 'newest'))}
                        className={cn(
                            "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors",
                            "hover:bg-accent/60"
                        )}
                    >
                        <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
                        {sortOrder === 'newest' ? t('memory.filters.newestFirst') : t('memory.filters.oldestFirst')}
                    </button>
                    {(activeTab === 'events' || activeTab === 'foresights') && (
                        <button
                            onClick={() => setShowLinkedOnly(prev => !prev)}
                            className={cn(
                                "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors",
                                showLinkedOnly ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"
                            )}
                        >
                            <Link2 className="h-3.5 w-3.5" />
                            {t('memory.filters.linkedOnly')}
                        </button>
                    )}
                    </div>
                </div>

            {/* Content */}
            <div className="flex-1 overflow-auto p-6">
                {activeTab === 'overview' && (
                    <div className="space-y-6">
                        {/* Stats Cards */}
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
                            <button
                                onClick={() => setActiveTab('memcells')}
                                className="rounded-xl border bg-card p-4 text-left shadow-sm transition hover:border-green-500/40 hover:bg-accent/30"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="rounded-lg bg-green-500/10 p-2">
                                        <Database className="h-5 w-5 text-green-500" />
                                    </div>
                                    <div>
                                        <p className="text-2xl font-bold">{summary?.memcells_count ?? 0}</p>
                                        <p className="text-xs text-muted-foreground">{t('memory.stats.memcells')}</p>
                                    </div>
                                </div>
                            </button>
                            <button
                                onClick={() => setActiveTab('episodes')}
                                className="rounded-xl border bg-card p-4 text-left shadow-sm transition hover:border-primary/40 hover:bg-accent/30"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="rounded-lg bg-primary/10 p-2">
                                        <Brain className="h-5 w-5 text-primary" />
                                    </div>
                                    <div>
                                        <p className="text-2xl font-bold">{summary?.episodes_count ?? 0}</p>
                                        <p className="text-xs text-muted-foreground">{t('memory.stats.episodes')}</p>
                                    </div>
                                </div>
                            </button>
                            <button
                                onClick={() => setActiveTab('events')}
                                className="rounded-xl border bg-card p-4 text-left shadow-sm transition hover:border-blue-500/40 hover:bg-accent/30"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="rounded-lg bg-blue-500/10 p-2">
                                        <Clock className="h-5 w-5 text-blue-500" />
                                    </div>
                                    <div>
                                        <p className="text-2xl font-bold">{summary?.event_logs_count ?? 0}</p>
                                        <p className="text-xs text-muted-foreground">{t('memory.stats.eventLogs')}</p>
                                    </div>
                                </div>
                            </button>
                            <button
                                onClick={() => setActiveTab('foresights')}
                                className="rounded-xl border bg-card p-4 text-left shadow-sm transition hover:border-amber-500/40 hover:bg-accent/30"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="rounded-lg bg-amber-500/10 p-2">
                                        <Lightbulb className="h-5 w-5 text-amber-500" />
                                    </div>
                                    <div>
                                        <p className="text-2xl font-bold">{summary?.foresights_count ?? 0}</p>
                                        <p className="text-xs text-muted-foreground">{t('memory.stats.foresights')}</p>
                                    </div>
                                </div>
                            </button>
                        </div>

                        <div className="grid gap-4 lg:grid-cols-3">
                            {/* Profile */}
                            <div className="rounded-xl border bg-card shadow-sm lg:col-span-2">
                                <div className="border-b px-4 py-3">
                                    <h3 className="font-semibold">{t('memory.profile.title')}</h3>
                                </div>
                                <div className="p-4">
                                    {summary?.profile ? (
                                        <div className="space-y-4">
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <p className="text-lg font-semibold">
                                                        {summary.profile.user_name || 'User'}
                                                    </p>
                                                    <p className="text-xs text-muted-foreground">
                                                        {summary.profile.user_id}
                                                    </p>
                                                </div>
                                                <div className="rounded-full border bg-muted/40 px-3 py-1 text-xs text-muted-foreground">
                                                    {t('memory.profile.memory')}
                                                </div>
                                            </div>
                                            <div className="grid gap-3 md:grid-cols-2">
                                                <div>
                                                    <p className="text-xs font-semibold uppercase text-muted-foreground">{t('memory.profile.personality')}</p>
                                                    <div className="mt-2 flex flex-wrap gap-2">
                                                        {(summary.profile.personality ?? []).length > 0 ? (
                                                            summary.profile.personality?.map(item => (
                                                                <span key={item} className="rounded-full border px-2 py-0.5 text-xs">
                                                                    {item}
                                                                </span>
                                                            ))
                                                        ) : (
                                                            <span className="text-xs text-muted-foreground">{t('memory.profile.noPersonality')}</span>
                                                        )}
                                                    </div>
                                                </div>
                                                <div>
                                                    <p className="text-xs font-semibold uppercase text-muted-foreground">{t('memory.profile.interests')}</p>
                                                    <div className="mt-2 flex flex-wrap gap-2">
                                                        {(summary.profile.interests ?? []).length > 0 ? (
                                                            summary.profile.interests?.map(item => (
                                                                <span key={item} className="rounded-full border px-2 py-0.5 text-xs">
                                                                    {item}
                                                                </span>
                                                            ))
                                                        ) : (
                                                            <span className="text-xs text-muted-foreground">{t('memory.profile.noInterests')}</span>
                                                        )}
                                                    </div>
                                                </div>
                                                <div>
                                                    <p className="text-xs font-semibold uppercase text-muted-foreground">{t('memory.profile.hardSkills')}</p>
                                                    <div className="mt-2 flex flex-wrap gap-2">
                                                        {(summary.profile.hard_skills ?? []).length > 0 ? (
                                                            summary.profile.hard_skills?.map(skill => (
                                                                <span key={`${skill.name}-${skill.level}`} className="rounded-full border px-2 py-0.5 text-xs">
                                                                    {skill.name} {skill.level ? `(${skill.level})` : ''}
                                                                </span>
                                                            ))
                                                        ) : (
                                                            <span className="text-xs text-muted-foreground">{t('memory.profile.noHardSkills')}</span>
                                                        )}
                                                    </div>
                                                </div>
                                                <div>
                                                    <p className="text-xs font-semibold uppercase text-muted-foreground">{t('memory.profile.softSkills')}</p>
                                                    <div className="mt-2 flex flex-wrap gap-2">
                                                        {(summary.profile.soft_skills ?? []).length > 0 ? (
                                                            summary.profile.soft_skills?.map(skill => (
                                                                <span key={`${skill.name}-${skill.level}`} className="rounded-full border px-2 py-0.5 text-xs">
                                                                    {skill.name} {skill.level ? `(${skill.level})` : ''}
                                                                </span>
                                                            ))
                                                        ) : (
                                                            <span className="text-xs text-muted-foreground">{t('memory.profile.noSoftSkills')}</span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                                            {t('memory.profile.noProfile')}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Recent Events */}
                            <div className="rounded-xl border bg-card shadow-sm">
                                <div className="border-b px-4 py-3">
                                    <h3 className="font-semibold">{t('memory.recent.events')}</h3>
                                </div>
                                <div className="p-4">
                                    {recentEvents.length > 0 ? (
                                        <div className="space-y-3">
                                            {recentEvents.map(log => {
                                                const parent = log.parent_episode_id ? episodesById.get(log.parent_episode_id) : undefined;
                                                return (
                                                    <div key={log.id} className="rounded-lg border p-3">
                                                        <p className="text-sm">{log.atomic_fact}</p>
                                                        <p className="mt-1 text-xs text-muted-foreground">
                                                            {formatDate(log.timestamp)}
                                                            {parent?.subject ? ` • ${parent.subject}` : ''}
                                                        </p>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <p className="text-sm text-muted-foreground text-center py-8">
                                            {t('memory.recent.noEvents')}
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="grid gap-4 lg:grid-cols-2">
                            {/* Recent Episodes */}
                            <div className="rounded-xl border bg-card shadow-sm">
                                <div className="border-b px-4 py-3">
                                    <h3 className="font-semibold">{t('memory.recent.episodes')}</h3>
                                </div>
                                <div className="p-4">
                                    {recentEpisodes.length > 0 ? (
                                        <div className="space-y-3">
                                            {recentEpisodes.map(ep => (
                                                <div key={ep.id} className="rounded-lg border p-3">
                                                    <p className="text-sm font-medium">{ep.summary}</p>
                                                    <p className="text-xs text-muted-foreground mt-1">
                                                        {formatDate(ep.timestamp)}
                                                    </p>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="text-sm text-muted-foreground text-center py-8">
                                            {t('memory.recent.noEpisodes')}
                                        </p>
                                    )}
                                </div>
                            </div>

                            {/* Recent Foresights */}
                            <div className="rounded-xl border bg-card shadow-sm">
                                <div className="border-b px-4 py-3">
                                    <h3 className="font-semibold">{t('memory.recent.foresights')}</h3>
                                </div>
                                <div className="p-4">
                                    {recentForesights.length > 0 ? (
                                        <div className="space-y-3">
                                            {recentForesights.map(fs => (
                                                <div key={fs.id} className="rounded-lg border p-3">
                                                    <p className="text-sm">{fs.content}</p>
                                                    {fs.evidence && (
                                                        <p className="text-xs text-muted-foreground mt-1">
                                                            {t('memory.foresight.evidence')}: {fs.evidence}
                                                        </p>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="text-sm text-muted-foreground text-center py-8">
                                            {t('memory.recent.noForesights')}
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'basic-profile' && (
                    <div className="space-y-6">
                        {/* Header */}
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="rounded-lg bg-primary/10 p-2">
                                    <Brain className="h-6 w-6 text-primary" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-semibold">{t('memory.basicProfile.title', 'Basic Profile')}</h2>
                                    <p className="text-sm text-muted-foreground">
                                        {t('memory.basicProfile.subtitle', 'AI-inferred semantic profile from your system')}
                                    </p>
                                </div>
                            </div>
                            {basicProfile && (
                                <span className="rounded-full bg-primary/10 px-3 py-1 text-xs text-primary">
                                    {t('memory.basicProfile.llmPowered', 'LLM Powered')}
                                </span>
                            )}
                        </div>

                        {basicProfileLoading && !basicProfile && loadingTopics.size === 0 ? (
                            /* Only show full-screen loading if no data received yet */
                            <div className="flex flex-col items-center justify-center py-16 gap-4">
                                <RefreshCw className="h-8 w-8 animate-spin text-primary" />
                                <p className="text-sm text-muted-foreground">
                                    {t('memory.basicProfile.analyzing', 'Analyzing your system and inferring profile...')}
                                </p>
                            </div>
                        ) : basicProfile || loadingTopics.size > 0 ? (
                            <div className="space-y-6">
                                {/* User Info Header - Enhanced (only show when basicProfile exists) */}
                                {basicProfile && (
                                    <div className="rounded-xl border bg-card p-4 shadow-sm">
                                        <div className="flex items-center gap-4 mb-4">
                                            <div className="rounded-full bg-primary/10 p-3">
                                                <span className="text-3xl">👤</span>
                                            </div>
                                            <div className="flex-1">
                                                <h3 className="text-xl font-semibold">{basicProfile.user_name || basicProfile.user_id}</h3>
                                                <p className="text-sm text-muted-foreground">
                                                    {basicProfile.raw_system_data?.computer_name}
                                                </p>
                                            </div>
                                            <div className="text-right text-xs text-muted-foreground">
                                                <p>{t('memory.basicProfile.scanned', 'Scanned')}</p>
                                                <p>{new Date(basicProfile.scanned_at).toLocaleString()}</p>
                                            </div>
                                        </div>
                                        {/* System Info Grid */}
                                        {basicProfile.raw_system_data && (
                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-3 border-t">
                                                <div className="flex items-center gap-2 text-sm">
                                                    <span className="text-base">🌍</span>
                                                    <div>
                                                        <p className="text-xs text-muted-foreground">Timezone</p>
                                                        <p className="font-medium">{basicProfile.raw_system_data.timezone || 'N/A'}</p>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2 text-sm">
                                                    <span className="text-base">⌨️</span>
                                                    <div>
                                                        <p className="text-xs text-muted-foreground">Shell</p>
                                                        <p className="font-medium font-mono">{basicProfile.raw_system_data.shell?.split('/').pop() || 'N/A'}</p>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2 text-sm">
                                                    <span className="text-base">{basicProfile.raw_system_data.appearance === 'dark' ? '🌙' : '☀️'}</span>
                                                    <div>
                                                        <p className="text-xs text-muted-foreground">Appearance</p>
                                                        <p className="font-medium capitalize">{basicProfile.raw_system_data.appearance || 'N/A'}</p>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2 text-sm">
                                                    <span className="text-base">🗣️</span>
                                                    <div>
                                                        <p className="text-xs text-muted-foreground">Language</p>
                                                        <p className="font-medium">{basicProfile.raw_system_data.language || basicProfile.raw_system_data.region || 'N/A'}</p>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Hierarchical Profile Topics */}
                                {(basicProfile?.topics && basicProfile.topics.length > 0) || loadingTopics.size > 0 ? (
                                    <div className="space-y-4">
                                        {/* Render topics in fixed order - either loading or generated */}
                                        {(() => {
                                            const allTopicDefs = [
                                                { id: 'basic_info', name: 'Basic Information' },
                                                { id: 'technical', name: 'Technical Profile' },
                                                { id: 'work', name: 'Work & Career' },
                                                { id: 'interest', name: 'Interests & Hobbies' },
                                                { id: 'psychological', name: 'Psychological Profile' },
                                                { id: 'behavioral', name: 'Behavioral Patterns' },
                                            ];
                                            const topicEmojis: Record<string, string> = {
                                                basic_info: '👤',
                                                contact_info: '🌐',
                                                education: '📚',
                                                work: '💼',
                                                interest: '💡',
                                                psychological: '🧠',
                                                behavioral: '📊',
                                                technical: '💻',
                                            };
                                            const topicColors: Record<string, string> = {
                                                basic_info: 'text-blue-500',
                                                contact_info: 'text-green-500',
                                                education: 'text-purple-500',
                                                work: 'text-orange-500',
                                                interest: 'text-pink-500',
                                                psychological: 'text-indigo-500',
                                                behavioral: 'text-cyan-500',
                                                technical: 'text-amber-500',
                                            };
                                            const bgColors: Record<string, string> = {
                                                basic_info: 'bg-blue-500/10 border-blue-500/20 text-blue-600 dark:text-blue-400',
                                                contact_info: 'bg-green-500/10 border-green-500/20 text-green-600 dark:text-green-400',
                                                education: 'bg-purple-500/10 border-purple-500/20 text-purple-600 dark:text-purple-400',
                                                work: 'bg-orange-500/10 border-orange-500/20 text-orange-600 dark:text-orange-400',
                                                interest: 'bg-pink-500/10 border-pink-500/20 text-pink-600 dark:text-pink-400',
                                                psychological: 'bg-indigo-500/10 border-indigo-500/20 text-indigo-600 dark:text-indigo-400',
                                                behavioral: 'bg-cyan-500/10 border-cyan-500/20 text-cyan-600 dark:text-cyan-400',
                                                technical: 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400',
                                            };

                                            const renderValue = (val: any, badgeColor: string): React.ReactNode => {
                                                if (Array.isArray(val)) {
                                                    if (val.length === 0) return <span className="text-muted-foreground text-xs">No data</span>;
                                                    if (typeof val[0] === 'object' && val[0] !== null && ('skill' in val[0] || 'name' in val[0])) {
                                                        return (
                                                            <div className="flex flex-wrap gap-1">
                                                                {val.map((item, i) => (
                                                                    <span key={i} className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", badgeColor)}>
                                                                        {item.skill || item.name}{item.level && ` (${item.level})`}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        );
                                                    }
                                                    return (
                                                        <div className="flex flex-wrap gap-1">
                                                            {val.map((item, i) => (
                                                                <span key={i} className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", badgeColor)}>
                                                                    {String(item)}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    );
                                                }
                                                // For boolean true, don't show "Yes" - the presence of the item already indicates it
                                                if (typeof val === 'boolean') {
                                                    if (val === true) {
                                                        return null; // Don't render anything for boolean true
                                                    }
                                                    return <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", badgeColor)}>No</span>;
                                                }
                                                return <span className="text-sm">{String(val)}</span>;
                                            };

                                            return allTopicDefs.map((def) => {
                                                const generatedTopic = basicProfile?.topics?.find(t => t.topic_id === def.id);
                                                const isLoading = loadingTopics.has(def.id);
                                                const _iconColor = topicColors[def.id] || 'text-muted-foreground';
                                                const badgeColor = bgColors[def.id] || 'bg-muted/50 border-muted text-muted-foreground';
                                                const emoji = topicEmojis[def.id] || '📋';

                                                // Skip if not loading and not generated
                                                if (!isLoading && !generatedTopic) return null;

                                                // Render loading state
                                                if (isLoading && !generatedTopic) {
                                                    return (
                                                        <div key={`loading-${def.id}`} className="rounded-xl border bg-card shadow-sm opacity-60">
                                                            <div className="px-4 py-3 flex items-center gap-2">
                                                                <span className="text-lg">{emoji}</span>
                                                                <span className="font-medium">{def.name}</span>
                                                                <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                                                                    <RefreshCw className="h-3 w-3 animate-spin" />
                                                                    Analyzing...
                                                                </span>
                                                            </div>
                                                        </div>
                                                    );
                                                }

                                                // Render generated topic
                                                if (generatedTopic) {
                                                    const validSubtopics = generatedTopic.subtopics.filter(s => s.value !== null && s.value !== undefined && s.value !== '');
                                                    if (validSubtopics.length === 0) return null;

                                                    return (
                                                        <details key={`topic-${def.id}`} className="rounded-xl border bg-card shadow-sm" open>
                                                            <summary className="px-4 py-3 cursor-pointer flex items-center gap-2 font-medium hover:bg-muted/50 rounded-t-xl">
                                                                <span className="text-lg">{emoji}</span>
                                                                <span>{generatedTopic.topic_name}</span>
                                                                <span className="ml-auto text-xs text-muted-foreground">
                                                                    {validSubtopics.length} {validSubtopics.length === 1 ? 'field' : 'fields'}
                                                                </span>
                                                                <span className="text-muted-foreground">▼</span>
                                                            </summary>
                                                            <div className="px-4 pb-4 pt-2 border-t space-y-3">
                                                                {validSubtopics.map((subtopic, subIdx) => (
                                                                    <div key={`sub-${subIdx}`} className="flex flex-col gap-1">
                                                                        <div className="flex items-center gap-2">
                                                                            <span className="text-xs font-medium text-muted-foreground capitalize min-w-[100px]">
                                                                                {subtopic.name.replace(/_/g, ' ')}
                                                                            </span>
                                                                            {subtopic.confidence && (
                                                                                <span className={cn(
                                                                                    "rounded px-1.5 py-0.5 text-[10px] font-medium",
                                                                                    subtopic.confidence === 'high' && "bg-green-500/20 text-green-600",
                                                                                    subtopic.confidence === 'medium' && "bg-yellow-500/20 text-yellow-600",
                                                                                    subtopic.confidence === 'low' && "bg-red-500/20 text-red-600"
                                                                                )}>
                                                                                    {subtopic.confidence}
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                        <div className="pl-0">{renderValue(subtopic.value, badgeColor)}</div>
                                                                        {subtopic.evidence && (
                                                                            <p className="text-[10px] text-muted-foreground italic pl-0">
                                                                                Evidence: {subtopic.evidence}
                                                                            </p>
                                                                        )}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </details>
                                                    );
                                                }

                                                return null;
                                            });
                                        })()}
                                    </div>
                                ) : basicProfile ? (
                                    /* Legacy flat fields fallback - only if basicProfile exists */
                                    <>
                                        {/* Inferred Roles */}
                                        {(basicProfile.inferred_roles?.length ?? 0) > 0 && (
                                            <div className="rounded-xl border bg-card p-4 shadow-sm">
                                                <div className="flex items-center gap-2 mb-4">
                                                    <span className="text-lg">👥</span>
                                                    <h3 className="font-semibold">{t('memory.basicProfile.inferredRoles', 'Inferred Roles')}</h3>
                                                </div>
                                                <div className="flex flex-wrap gap-2">
                                                    {basicProfile.inferred_roles?.map((role, idx) => (
                                                        <span key={`role-${idx}`} className="rounded-full bg-purple-500/10 border border-purple-500/20 px-4 py-1.5 text-sm font-medium text-purple-600 dark:text-purple-400">
                                                            {role}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Personality & Interests Row */}
                                        <div className="grid gap-4 md:grid-cols-2">
                                            <div className="rounded-xl border bg-card p-4 shadow-sm">
                                                <div className="flex items-center gap-2 mb-4">
                                                    <span className="text-lg">🎨</span>
                                                    <h3 className="font-semibold">{t('memory.basicProfile.personality', 'Personality')}</h3>
                                                </div>
                                                <div className="flex flex-wrap gap-2">
                                                    {(basicProfile.personality?.length ?? 0) > 0 ? basicProfile.personality?.map((trait, idx) => (
                                                        <span key={`personality-${idx}`} className="rounded-full bg-pink-500/10 border border-pink-500/20 px-3 py-1 text-xs font-medium text-pink-600 dark:text-pink-400">
                                                            {trait}
                                                        </span>
                                                    )) : <span className="text-xs text-muted-foreground">{t('memory.basicProfile.noData', 'No data')}</span>}
                                                </div>
                                            </div>
                                            <div className="rounded-xl border bg-card p-4 shadow-sm">
                                                <div className="flex items-center gap-2 mb-4">
                                                    <span className="text-lg">💡</span>
                                                    <h3 className="font-semibold">{t('memory.basicProfile.interests', 'Interests')}</h3>
                                                </div>
                                                <div className="flex flex-wrap gap-2">
                                                    {(basicProfile.interests?.length ?? 0) > 0 ? basicProfile.interests?.map((interest, idx) => (
                                                        <span key={`interest-${idx}`} className="rounded-full bg-amber-500/10 border border-amber-500/20 px-3 py-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                                                            {interest}
                                                        </span>
                                                    )) : <span className="text-xs text-muted-foreground">{t('memory.basicProfile.noData', 'No data')}</span>}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Skills Row */}
                                        <div className="grid gap-4 md:grid-cols-2">
                                            <div className="rounded-xl border bg-card p-4 shadow-sm">
                                                <div className="flex items-center gap-2 mb-4">
                                                    <span className="text-lg">💻</span>
                                                    <h3 className="font-semibold">{t('memory.basicProfile.hardSkills', 'Hard Skills')}</h3>
                                                </div>
                                                <div className="flex flex-wrap gap-2">
                                                    {(basicProfile.hard_skills?.length ?? 0) > 0 ? basicProfile.hard_skills?.map((skill, idx) => (
                                                        <span key={`hard-skill-${idx}`} className="rounded-full bg-blue-500/10 border border-blue-500/20 px-3 py-1 text-xs font-medium text-blue-600 dark:text-blue-400">
                                                            {skill.name}{skill.level && ` (${skill.level})`}
                                                        </span>
                                                    )) : <span className="text-xs text-muted-foreground">{t('memory.basicProfile.noData', 'No data')}</span>}
                                                </div>
                                            </div>
                                            <div className="rounded-xl border bg-card p-4 shadow-sm">
                                                <div className="flex items-center gap-2 mb-4">
                                                    <span className="text-lg">🤝</span>
                                                    <h3 className="font-semibold">{t('memory.basicProfile.softSkills', 'Soft Skills')}</h3>
                                                </div>
                                                <div className="flex flex-wrap gap-2">
                                                    {(basicProfile.soft_skills?.length ?? 0) > 0 ? basicProfile.soft_skills?.map((skill, idx) => (
                                                        <span key={`soft-skill-${idx}`} className="rounded-full bg-green-500/10 border border-green-500/20 px-3 py-1 text-xs font-medium text-green-600 dark:text-green-400">
                                                            {skill.name}{skill.level && ` (${skill.level})`}
                                                        </span>
                                                    )) : <span className="text-xs text-muted-foreground">{t('memory.basicProfile.noData', 'No data')}</span>}
                                                </div>
                                            </div>
                                        </div>
                                    </>
                                ) : null}

                                {/* Source Data (Collapsible) */}
                                {basicProfile?.raw_system_data && (
                                    <details className="rounded-xl border bg-card shadow-sm">
                                        <summary className="px-4 py-3 cursor-pointer flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground">
                                            <span className="text-base">💻</span>
                                            {t('memory.basicProfile.sourceData', 'Source Data')}
                                            <span className="ml-auto text-xs">
                                                {basicProfile.raw_system_data.installed_apps.length} apps, {basicProfile.raw_system_data.dev_tools.length} dev tools
                                            </span>
                                        </summary>
                                        <div className="px-4 pb-4 pt-2 border-t space-y-4">
                                            {/* System Info */}
                                            <div className="grid gap-2 text-sm md:grid-cols-3">
                                                <div className="flex justify-between">
                                                    <span className="text-muted-foreground">Shell</span>
                                                    <span className="font-mono text-xs">{basicProfile.raw_system_data.shell.split('/').pop()}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-muted-foreground">Language</span>
                                                    <span>{basicProfile.raw_system_data.language || 'N/A'}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-muted-foreground">Appearance</span>
                                                    <span className="flex items-center gap-1">
                                                        {basicProfile.raw_system_data.appearance === 'dark' ? '🌙' : '☀️'}
                                                        {basicProfile.raw_system_data.appearance}
                                                    </span>
                                                </div>
                                            </div>

                                            {/* Apps Preview */}
                                            <div>
                                                <p className="text-xs text-muted-foreground mb-2">Installed Apps (sample)</p>
                                                <div className="flex flex-wrap gap-1">
                                                    {basicProfile.raw_system_data.installed_apps.slice(0, 20).map((app, idx) => (
                                                        <span key={`app-${idx}`} className="rounded border px-2 py-0.5 text-xs bg-muted/30">{app}</span>
                                                    ))}
                                                    {basicProfile.raw_system_data.installed_apps.length > 20 && (
                                                        <span className="text-xs text-muted-foreground">+{basicProfile.raw_system_data.installed_apps.length - 20} more</span>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Dev Tools */}
                                            {basicProfile.raw_system_data.dev_tools.length > 0 && (
                                                <div>
                                                    <p className="text-xs text-muted-foreground mb-2">Dev Tools</p>
                                                    <div className="flex flex-wrap gap-1">
                                                        {basicProfile.raw_system_data.dev_tools.map((tool, idx) => (
                                                            <span key={`tool-${idx}`} className="rounded border px-2 py-0.5 text-xs font-mono bg-muted/30">{tool.name}</span>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </details>
                                )}
                            </div>
                        ) : (
                            /* Welcome screen - no profile yet */
                            <div className="rounded-xl border bg-gradient-to-br from-primary/5 to-purple-500/5 p-12 text-center">
                                <div className="inline-flex items-center justify-center rounded-full bg-primary/10 p-4 mb-6">
                                    <Brain className="h-12 w-12 text-primary" />
                                </div>
                                <h3 className="text-xl font-semibold mb-3">
                                    {t('memory.basicProfile.welcome', 'Build Your Semantic Profile')}
                                </h3>
                                <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
                                    {t('memory.basicProfile.welcomeDesc', 'Analyze your system to create an AI-inferred profile based on your installed apps, development tools, and preferences.')}
                                </p>
                                <button
                                    onClick={() => void fetchBasicProfile()}
                                    disabled={basicProfileLoading}
                                    className={cn(
                                        "inline-flex items-center gap-2 rounded-lg px-6 py-3 text-sm font-medium transition-colors",
                                        "bg-primary text-primary-foreground hover:bg-primary/90",
                                        basicProfileLoading && "opacity-50 cursor-not-allowed"
                                    )}
                                >
                                    <Brain className={cn("h-5 w-5", basicProfileLoading && "animate-pulse")} />
                                    {basicProfileLoading
                                        ? t('memory.basicProfile.analyzing', 'Analyzing...')
                                        : t('memory.basicProfile.startAnalyze', 'Start Analysis')
                                    }
                                </button>
                                <p className="text-xs text-muted-foreground mt-4">
                                    {t('memory.basicProfile.privacyNote', 'All analysis is performed locally. No data is sent externally.')}
                                </p>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'memcells' && (
                    <div className="space-y-3">
                        <div className="flex items-center justify-between rounded-xl border bg-card px-4 py-3 text-sm shadow-sm">
                            <span className="text-muted-foreground">{filteredMemcells.length} {t('memory.memcell.count')}</span>
                            <button
                                onClick={() => {
                                    if (expandedIds.size > 0) {
                                        setExpandedIds(new Set());
                                    } else {
                                        setExpandedIds(new Set(filteredMemcells.map(mc => mc.id)));
                                    }
                                }}
                                className="text-xs font-medium text-primary hover:underline"
                            >
                                {expandedIds.size > 0 ? t('memory.memcell.collapseAll') : t('memory.memcell.expandAll')}
                            </button>
                        </div>
                        {filteredMemcells.length > 0 ? (
                            filteredMemcells.map(mc => {
                                const linkedEpisodes = episodesByMemcell.get(mc.id) ?? [];
                                const source = extractSource(mc.metadata);
                                let originalDataPreview = '';
                                try {
                                    const parsed = JSON.parse(mc.original_data);
                                    if (Array.isArray(parsed) && parsed[0]?.content) {
                                        originalDataPreview = parsed[0].content.slice(0, 300);
                                    }
                                } catch {
                                    originalDataPreview = mc.original_data?.slice(0, 300) ?? '';
                                }
                                return (
                                    <div
                                        key={mc.id}
                                        id={`memcell-${mc.id}`}
                                        className="rounded-xl border bg-card shadow-sm overflow-hidden"
                                    >
                                        <button
                                            onClick={() => toggleExpand(mc.id)}
                                            className="w-full flex items-center justify-between p-4 text-left hover:bg-accent/50 transition-colors"
                                        >
                                            <div className="flex items-center gap-3">
                                                {expandedIds.has(mc.id) ? (
                                                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                                ) : (
                                                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                                )}
                                                <div>
                                                    <p className="font-medium">{mc.subject || 'MemCell'}</p>
                                                    <p className="text-sm text-muted-foreground line-clamp-2">
                                                        {mc.summary || originalDataPreview}
                                                    </p>
                                                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                                                        {mc.type && (
                                                            <span className="rounded-full border px-2 py-0.5">
                                                                {mc.type}
                                                            </span>
                                                        )}
                                                        <span className="rounded-full border px-2 py-0.5">
                                                            {linkedEpisodes.length} episodes
                                                        </span>
                                                        {mc.chunk_ordinal !== undefined && (
                                                            <span className="rounded-full border px-2 py-0.5">
                                                                Chunk #{mc.chunk_ordinal}
                                                            </span>
                                                        )}
                                                        {source?.sourceName && (
                                                            <span className="rounded-full border px-2 py-0.5">
                                                                Source: {source.sourceName}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                            <span className="text-xs text-muted-foreground">
                                                {formatDate(mc.timestamp)}
                                            </span>
                                        </button>
                                        {expandedIds.has(mc.id) && (
                                            <div className="border-t p-4 bg-muted/30 space-y-4">
                                                {/* Original content preview */}
                                                <div>
                                                    <p className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                                                        {t('memory.memcell.sourceContent')}
                                                    </p>
                                                    <p className="text-sm whitespace-pre-wrap bg-background rounded-lg border p-3 max-h-48 overflow-auto">
                                                        {originalDataPreview}
                                                        {originalDataPreview.length >= 300 && '...'}
                                                    </p>
                                                </div>

                                                {/* Keywords */}
                                                {mc.keywords && mc.keywords.length > 0 && (
                                                    <div>
                                                        <p className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                                                            {t('memory.memcell.keywords')}
                                                        </p>
                                                        <div className="flex flex-wrap gap-2">
                                                            {mc.keywords.map((kw, idx) => (
                                                                <span key={idx} className="rounded-full border bg-background px-2 py-0.5 text-xs">
                                                                    {kw}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Linked Episodes */}
                                                {linkedEpisodes.length > 0 && (
                                                    <div className="rounded-lg border bg-background p-3">
                                                        <p className="text-xs font-semibold uppercase text-muted-foreground">
                                                            {t('memory.memcell.linkedEpisodes')} ({linkedEpisodes.length})
                                                        </p>
                                                        <div className="mt-2 space-y-2">
                                                            {linkedEpisodes.slice(0, 5).map(ep => (
                                                                <button
                                                                    key={ep.id}
                                                                    onClick={() => handleJumpToEpisode(ep.id)}
                                                                    className="w-full text-left rounded-md border p-2 hover:bg-accent/50 transition-colors"
                                                                >
                                                                    <p className="text-sm font-medium">{ep.subject || 'Episode'}</p>
                                                                    <p className="text-xs text-muted-foreground line-clamp-1">
                                                                        {ep.summary}
                                                                    </p>
                                                                </button>
                                                            ))}
                                                            {linkedEpisodes.length > 5 && (
                                                                <p className="text-xs text-muted-foreground text-center">
                                                                    +{linkedEpisodes.length - 5} {t('memory.memcell.moreEpisodes')}
                                                                </p>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Source file link */}
                                                {source?.sourcePath && (
                                                    <div className="flex items-center justify-between rounded-lg border bg-background px-3 py-2 text-xs">
                                                        <div className="truncate text-muted-foreground">
                                                            {source.sourcePath}
                                                        </div>
                                                        <button
                                                            onClick={() => handleOpenSource(source.sourcePath)}
                                                            className="rounded-md border px-2 py-1 text-xs font-medium hover:bg-accent"
                                                        >
                                                            {t('memory.memcell.openFile')}
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })
                        ) : (
                            <div className="text-center py-12">
                                <Database className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                                <p className="text-muted-foreground">{t('memory.memcell.noMemcells')}</p>
                                <p className="text-xs text-muted-foreground mt-1">
                                    {t('memory.memcell.noMemcellsDesc')}
                                </p>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'episodes' && (
                    <div className="space-y-3">
                        <div className="flex items-center justify-between rounded-xl border bg-card px-4 py-3 text-sm shadow-sm">
                            <span className="text-muted-foreground">{filteredEpisodes.length} {t('memory.episode.count')}</span>
                            <button
                                onClick={() => {
                                    if (expandedIds.size > 0) {
                                        setExpandedIds(new Set());
                                    } else {
                                        setExpandedIds(new Set(filteredEpisodes.map(ep => ep.id)));
                                    }
                                }}
                                className="text-xs font-medium text-primary hover:underline"
                            >
                                {expandedIds.size > 0 ? t('memory.memcell.collapseAll') : t('memory.memcell.expandAll')}
                            </button>
                        </div>
                        {filteredEpisodes.length > 0 ? (
                            filteredEpisodes.map(ep => {
                                const relatedEvents = eventsByEpisode.get(ep.id) ?? [];
                                const relatedForesights = foresightsByEpisode.get(ep.id) ?? [];
                                const source = extractSource(ep.metadata);
                                return (
                                    <div
                                        key={ep.id}
                                        id={`episode-${ep.id}`}
                                        className="rounded-xl border bg-card shadow-sm overflow-hidden"
                                    >
                                        <button
                                            onClick={() => toggleExpand(ep.id)}
                                            className="w-full flex items-center justify-between p-4 text-left hover:bg-accent/50 transition-colors"
                                        >
                                            <div className="flex items-center gap-3">
                                                {expandedIds.has(ep.id) ? (
                                                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                                ) : (
                                                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                                )}
                                                <div>
                                                    <p className="font-medium">{ep.subject || 'Episode'}</p>
                                                    <p className="text-sm text-muted-foreground line-clamp-1">
                                                        {ep.summary}
                                                    </p>
                                                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                                                        <span className="rounded-full border px-2 py-0.5">
                                                            {relatedEvents.length} {t('memory.episode.events')}
                                                        </span>
                                                        <span className="rounded-full border px-2 py-0.5">
                                                            {relatedForesights.length} {t('memory.episode.foresights')}
                                                        </span>
                                                        {source?.sourceName && (
                                                            <span className="rounded-full border px-2 py-0.5">
                                                                {t('memory.episode.source')}: {source.sourceName}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                            <span className="text-xs text-muted-foreground">
                                                {formatDate(ep.timestamp)}
                                            </span>
                                        </button>
                                        {expandedIds.has(ep.id) && (
                                            <div className="border-t p-4 bg-muted/30 space-y-4">
                                                <p className="text-sm whitespace-pre-wrap">{ep.episode || ep.summary}</p>
                                                {(relatedEvents.length > 0 || relatedForesights.length > 0) && (
                                                    <div className="rounded-lg border bg-background p-3">
                                                        <p className="text-xs font-semibold uppercase text-muted-foreground">{t('memory.episode.linkedMemories')}</p>
                                                        <div className="mt-2 grid gap-2 md:grid-cols-2">
                                                            {relatedEvents.length > 0 && (
                                                                <div className="rounded-md border p-2">
                                                                    <p className="text-xs font-medium text-muted-foreground">{t('memory.tabs.events')}</p>
                                                                    <ul className="mt-1 space-y-1 text-xs">
                                                                        {relatedEvents.slice(0, 3).map(log => (
                                                                            <li key={log.id} className="line-clamp-1">
                                                                                {log.atomic_fact}
                                                                            </li>
                                                                        ))}
                                                                    </ul>
                                                                </div>
                                                            )}
                                                            {relatedForesights.length > 0 && (
                                                                <div className="rounded-md border p-2">
                                                                    <p className="text-xs font-medium text-muted-foreground">{t('memory.tabs.foresights')}</p>
                                                                    <ul className="mt-1 space-y-1 text-xs">
                                                                        {relatedForesights.slice(0, 3).map(fs => (
                                                                            <li key={fs.id} className="line-clamp-1">
                                                                                {fs.content}
                                                                            </li>
                                                                        ))}
                                                                    </ul>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}
                                                {source?.sourcePath && (
                                                    <div className="flex items-center justify-between rounded-lg border bg-background px-3 py-2 text-xs">
                                                        <div className="truncate text-muted-foreground">
                                                            {source.sourcePath}
                                                        </div>
                                                        <button
                                                            onClick={() => handleOpenSource(source.sourcePath)}
                                                            className="rounded-md border px-2 py-1 text-xs font-medium hover:bg-accent"
                                                        >
                                                            {t('memory.memcell.openFile')}
                                                        </button>
                                                    </div>
                                                )}
                                                {ep.parent_memcell_id && (
                                                    <div className="flex items-center gap-2">
                                                        <button
                                                            onClick={() => handleJumpToMemcell(ep.parent_memcell_id)}
                                                            className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium hover:bg-accent"
                                                        >
                                                            <Database className="h-3 w-3" />
                                                            {t('memory.episode.viewSourceMemcell')}
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })
                        ) : (
                            <div className="text-center py-12">
                                <Brain className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                                <p className="text-muted-foreground">{t('memory.episode.noEpisodes')}</p>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'events' && (
                    <div className="space-y-2">
                        {filteredEventLogs.length > 0 ? (
                            filteredEventLogs.map(log => {
                                const parent = log.parent_episode_id ? episodesById.get(log.parent_episode_id) : undefined;
                                const source = extractSource(parent?.metadata);
                                return (
                                    <div
                                        key={log.id}
                                        className="rounded-lg border bg-card p-3 shadow-sm"
                                    >
                                        <div className="flex items-start gap-3">
                                            <FileText className="h-4 w-4 text-muted-foreground mt-0.5" />
                                            <div className="flex-1 space-y-2">
                                                <p className="text-sm">{log.atomic_fact}</p>
                                                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                                    <span>{formatDate(log.timestamp)}</span>
                                                    {parent?.subject && (
                                                        <span className="rounded-full border px-2 py-0.5">
                                                            {parent.subject}
                                                        </span>
                                                    )}
                                                    {source?.sourceName && (
                                                        <span className="rounded-full border px-2 py-0.5">
                                                            Source: {source.sourceName}
                                                        </span>
                                                    )}
                                                </div>
                                                {(parent || source?.sourcePath) && (
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        {parent?.id && (
                                                            <button
                                                                onClick={() => handleJumpToEpisode(parent.id)}
                                                                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium hover:bg-accent"
                                                            >
                                                                <Link2 className="h-3 w-3" />
                                                                {t('memory.event.viewEpisode')}
                                                            </button>
                                                        )}
                                                        {source?.sourcePath && (
                                                            <button
                                                                onClick={() => handleOpenSource(source.sourcePath)}
                                                                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium hover:bg-accent"
                                                            >
                                                                {t('memory.memcell.openFile')}
                                                            </button>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        ) : (
                            <div className="text-center py-12">
                                <Clock className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                                <p className="text-muted-foreground">{t('memory.event.noEvents')}</p>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'foresights' && (
                    <div className="space-y-3">
                        {filteredForesights.length > 0 ? (
                            filteredForesights.map(fs => {
                                const parent = fs.parent_episode_id ? episodesById.get(fs.parent_episode_id) : undefined;
                                const source = extractSource(parent?.metadata);
                                return (
                                    <div
                                        key={fs.id}
                                        className="rounded-xl border bg-card p-4 shadow-sm"
                                    >
                                        <div className="flex items-start gap-3">
                                            <Lightbulb className="h-5 w-5 text-amber-500 mt-0.5" />
                                            <div className="flex-1 space-y-2">
                                                <p className="text-sm font-medium">{fs.content}</p>
                                                {fs.evidence && (
                                                    <p className="text-xs text-muted-foreground">
                                                        <span className="font-medium">{t('memory.foresight.evidence')}:</span> {fs.evidence}
                                                    </p>
                                                )}
                                                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                                    {parent?.subject && (
                                                        <span className="rounded-full border px-2 py-0.5">
                                                            {parent.subject}
                                                        </span>
                                                    )}
                                                    {source?.sourceName && (
                                                        <span className="rounded-full border px-2 py-0.5">
                                                            {t('memory.episode.source')}: {source.sourceName}
                                                        </span>
                                                    )}
                                                </div>
                                                {(parent || source?.sourcePath) && (
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        {parent?.id && (
                                                            <button
                                                                onClick={() => handleJumpToEpisode(parent.id)}
                                                                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium hover:bg-accent"
                                                            >
                                                                <Link2 className="h-3 w-3" />
                                                                {t('memory.event.viewEpisode')}
                                                            </button>
                                                        )}
                                                        {source?.sourcePath && (
                                                            <button
                                                                onClick={() => handleOpenSource(source.sourcePath)}
                                                                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium hover:bg-accent"
                                                            >
                                                                {t('memory.memcell.openFile')}
                                                            </button>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        ) : (
                            <div className="text-center py-12">
                                <Lightbulb className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                                <p className="text-muted-foreground">{t('memory.foresight.noForesights')}</p>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'timeline' && (
                    <div className="space-y-3">
                        {timelineEntries.length > 0 ? (
                            timelineEntries.map(entry => {
                                const typeLabel = entry.type === 'episode'
                                    ? t('memory.timeline.episode')
                                    : entry.type === 'event'
                                        ? t('memory.timeline.event')
                                        : t('memory.timeline.foresight');
                                const typeIcon = entry.type === 'episode'
                                    ? <Brain className="h-4 w-4 text-primary" />
                                    : entry.type === 'event'
                                        ? <Clock className="h-4 w-4 text-blue-500" />
                                        : <Lightbulb className="h-4 w-4 text-amber-500" />;
                                return (
                                    <div key={entry.id} className="rounded-xl border bg-card p-4 shadow-sm">
                                        <div className="flex items-start gap-3">
                                            <div className="mt-1">{typeIcon}</div>
                                            <div className="flex-1 space-y-2">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span className="text-xs font-semibold uppercase text-muted-foreground">
                                                        {typeLabel}
                                                    </span>
                                                    <span className="text-xs text-muted-foreground">
                                                        {formatDateShort(entry.timestamp)}
                                                    </span>
                                                </div>
                                                <p className="text-sm font-medium">{entry.title}</p>
                                                <p className="text-sm text-muted-foreground">{entry.body}</p>
                                                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                                    {entry.sourceName && (
                                                        <span className="rounded-full border px-2 py-0.5">
                                                            {t('memory.episode.source')}: {entry.sourceName}
                                                        </span>
                                                    )}
                                                </div>
                                                {(entry.parentEpisodeId || entry.sourcePath) && (
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        {entry.parentEpisodeId && entry.type !== 'episode' && (
                                                            <button
                                                                onClick={() => handleJumpToEpisode(entry.parentEpisodeId)}
                                                                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium hover:bg-accent"
                                                            >
                                                                <Link2 className="h-3 w-3" />
                                                                {t('memory.event.viewEpisode')}
                                                            </button>
                                                        )}
                                                        {entry.sourcePath && (
                                                            <button
                                                                onClick={() => handleOpenSource(entry.sourcePath)}
                                                                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium hover:bg-accent"
                                                            >
                                                                {t('memory.memcell.openFile')}
                                                            </button>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        ) : (
                            <div className="text-center py-12">
                                <Calendar className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                                <p className="text-muted-foreground">{t('memory.timeline.noEntries')}</p>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
