/**
 * useEarlogData - Hook for managing Earlog audio recording and transcription
 */

import { useState, useCallback, useEffect, useRef } from 'react';

// Types
export interface EarlogSession {
    id: string;
    name: string;
    started_at: string;
    ended_at: string | null;
    source: string;
    language: string;
    transcripts: EarlogTranscript[];
    total_duration_seconds: number;
    is_active: boolean;
}

export interface EarlogTranscript {
    id: string;
    text: string;
    language: string;
    source: string;
    speaker: 'self' | 'other' | 'unknown';  // 'self' = mic, 'other' = system audio
    start_time: string;
    end_time: string;
    duration_seconds: number;
    confidence: number | null;
    status: 'pending' | 'transcribing' | 'completed' | 'failed';
    error: string | null;
}

export interface EarlogDevice {
    id: number;
    name: string;
    channels: number;
    sample_rate: number;
    is_default: boolean;
}

export interface EarlogBackend {
    type: string;
    name: string;
    description: string;
    supported_languages: string[];
    supports_streaming: boolean;
    min_chunk_seconds: number;
    recommended_chunk_seconds: number;
    is_available: boolean;
    status_message: string | null;
}

export interface EarlogState {
    is_running: boolean;
    current_session_id: string | null;
    current_session_name: string | null;
    pending_transcriptions: number;
    recorder_available: boolean;
    transcription_available: boolean;
    active_backend: string | null;
    dual_track_available: boolean;
    system_audio_available: boolean;
    system_audio_status: string | null;
    available_backends: string[];
}

export interface EarlogSettings {
    auto_start: boolean;
    default_source: string;
    default_language: string;
    chunk_duration_seconds: number;
    save_audio_files: boolean;
    audio_storage_path: string | null;
    asr_backend: string;
    glm_asr_endpoint: string | null;
    moonshine_endpoint: string | null;
}

const API_BASE = 'http://127.0.0.1:8890/plugins/earlog';

async function getApiKey(): Promise<string> {
    const apiKey = await (window as any).api?.getLocalKey();
    if (!apiKey) {
        throw new Error('API key not found');
    }
    return apiKey;
}

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
    const apiKey = await getApiKey();
    const response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'X-API-Key': apiKey,
            ...options?.headers,
        },
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error: ${response.status} - ${errorText}`);
    }
    return response.json();
}

export function useEarlogData() {
    const [state, setState] = useState<EarlogState | null>(null);
    const [currentSession, setCurrentSession] = useState<EarlogSession | null>(null);
    const [sessions, setSessions] = useState<EarlogSession[]>([]);
    const [devices, setDevices] = useState<EarlogDevice[]>([]);
    const [backends, setBackends] = useState<EarlogBackend[]>([]);
    const [settings, setSettings] = useState<EarlogSettings | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    
    const pollingRef = useRef<NodeJS.Timeout | null>(null);

    // Fetch current state
    const fetchState = useCallback(async () => {
        try {
            const data = await fetchApi<EarlogState>('/state');
            setState(data);
            return data;
        } catch (err) {
            console.error('Failed to fetch Earlog state:', err);
            return null;
        }
    }, []);

    // Fetch current session
    const fetchCurrentSession = useCallback(async () => {
        try {
            const data = await fetchApi<{ session: EarlogSession }>('/sessions/current');
            setCurrentSession(data.session);
            return data.session;
        } catch {
            setCurrentSession(null);
            return null;
        }
    }, []);

    // Fetch all sessions
    const fetchSessions = useCallback(async () => {
        try {
            const data = await fetchApi<{ sessions: EarlogSession[] }>('/sessions');
            setSessions(data.sessions);
            return data.sessions;
        } catch (err) {
            console.error('Failed to fetch sessions:', err);
            return [];
        }
    }, []);

    // Fetch available devices
    const fetchDevices = useCallback(async () => {
        try {
            const data = await fetchApi<{ devices: EarlogDevice[] }>('/devices');
            setDevices(data.devices);
            return data.devices;
        } catch (err) {
            console.error('Failed to fetch devices:', err);
            return [];
        }
    }, []);

    // Fetch available backends
    const fetchBackends = useCallback(async () => {
        try {
            const data = await fetchApi<{ backends: EarlogBackend[]; active: string | null }>('/backends');
            setBackends(data.backends);
            return data.backends;
        } catch (err) {
            console.error('Failed to fetch backends:', err);
            return [];
        }
    }, []);

    // Fetch settings
    const fetchSettings = useCallback(async () => {
        try {
            const data = await fetchApi<{ settings: EarlogSettings }>('/settings');
            setSettings(data.settings);
            return data.settings;
        } catch (err) {
            console.error('Failed to fetch settings:', err);
            return null;
        }
    }, []);

    // Start recording session
    const startSession = useCallback(async (
        name?: string,
        source: string = 'microphone',
        language: string = 'auto',
        deviceId?: number,
        dualTrack: boolean = false  // Enable separate mic + system audio tracks
    ) => {
        setIsLoading(true);
        setError(null);
        try {
            const data = await fetchApi<{ session: EarlogSession }>('/sessions/start', {
                method: 'POST',
                body: JSON.stringify({ 
                    name, 
                    source, 
                    language, 
                    device_id: deviceId,
                    dual_track: dualTrack 
                }),
            });
            setCurrentSession(data.session);
            await fetchState();
            return data.session;
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to start session';
            setError(message);
            throw err;
        } finally {
            setIsLoading(false);
        }
    }, [fetchState]);

    // Stop recording session (ends session completely)
    const stopSession = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const data = await fetchApi<{ session: EarlogSession }>('/sessions/stop', {
                method: 'POST',
            });
            // Keep the stopped session as current for display until next start
            if (data.session) {
                setCurrentSession({ ...data.session, is_active: false });
            }
            await fetchState();
            await fetchSessions();
            return data.session;
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to stop session';
            setError(message);
            throw err;
        } finally {
            setIsLoading(false);
        }
    }, [fetchState, fetchSessions]);

    // Pause recording session (can be resumed)
    const pauseSession = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const data = await fetchApi<{ session: EarlogSession }>('/sessions/pause', {
                method: 'POST',
            });
            // Keep the paused session for display
            if (data.session) {
                setCurrentSession({ ...data.session, is_active: false });
            }
            await fetchState();
            return data.session;
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to pause session';
            setError(message);
            throw err;
        } finally {
            setIsLoading(false);
        }
    }, [fetchState]);

    // Resume a paused recording session
    const resumeSession = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const data = await fetchApi<{ session: EarlogSession }>('/sessions/resume', {
                method: 'POST',
            });
            setCurrentSession(data.session);
            await fetchState();
            return data.session;
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to resume session';
            setError(message);
            throw err;
        } finally {
            setIsLoading(false);
        }
    }, [fetchState]);

    // Delete session
    const deleteSession = useCallback(async (sessionId: string) => {
        try {
            await fetchApi(`/sessions/${sessionId}`, { method: 'DELETE' });
            setSessions(prev => prev.filter(s => s.id !== sessionId));
        } catch (err) {
            console.error('Failed to delete session:', err);
            throw err;
        }
    }, []);

    // Set active backend
    const setActiveBackend = useCallback(async (backend: string) => {
        try {
            await fetchApi('/backends/active', {
                method: 'POST',
                body: JSON.stringify({ backend }),
            });
            await fetchState();
            await fetchBackends();
        } catch (err) {
            console.error('Failed to set backend:', err);
            throw err;
        }
    }, [fetchState, fetchBackends]);

    // Update settings
    const updateSettings = useCallback(async (newSettings: Partial<EarlogSettings>) => {
        try {
            const merged = { ...settings, ...newSettings };
            const data = await fetchApi<{ settings: EarlogSettings }>('/settings', {
                method: 'PUT',
                body: JSON.stringify(merged),
            });
            setSettings(data.settings);
            return data.settings;
        } catch (err) {
            console.error('Failed to update settings:', err);
            throw err;
        }
    }, [settings]);

    // Search transcripts
    const searchTranscripts = useCallback(async (query: string) => {
        try {
            const data = await fetchApi<{ transcripts: EarlogTranscript[] }>(
                `/transcripts/search?q=${encodeURIComponent(query)}`
            );
            return data.transcripts;
        } catch (err) {
            console.error('Failed to search transcripts:', err);
            return [];
        }
    }, []);

    // Polling for live updates when recording
    useEffect(() => {
        if (state?.is_running) {
            pollingRef.current = setInterval(async () => {
                await fetchCurrentSession();
            }, 2000);
        } else {
            if (pollingRef.current) {
                clearInterval(pollingRef.current);
                pollingRef.current = null;
            }
        }
        return () => {
            if (pollingRef.current) {
                clearInterval(pollingRef.current);
            }
        };
    }, [state?.is_running, fetchCurrentSession]);

    // Initial load
    useEffect(() => {
        void fetchState();
        void fetchDevices();
        void fetchBackends();
        void fetchSettings();
        void fetchSessions();
    }, [fetchState, fetchDevices, fetchBackends, fetchSettings, fetchSessions]);

    return {
        // State
        state,
        currentSession,
        sessions,
        devices,
        backends,
        settings,
        isLoading,
        error,
        
        // Actions
        startSession,
        stopSession,
        pauseSession,
        resumeSession,
        deleteSession,
        setActiveBackend,
        updateSettings,
        searchTranscripts,
        
        // Refresh
        refreshState: fetchState,
        refreshSessions: fetchSessions,
        refreshDevices: fetchDevices,
        refreshBackends: fetchBackends,
    };
}

