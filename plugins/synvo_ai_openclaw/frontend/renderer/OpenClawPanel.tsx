import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, PlugZap } from 'lucide-react';
import { cn } from '@/renderer/lib/utils';
import { API_PREFIX } from '../config';

const API_BASE = 'http://127.0.0.1:8890';

type TelegramStatus = {
    enabled: boolean;
    running: boolean;
    paired_chats: number[];
    last_update_id: number;
    poll_interval_seconds: number;
    backend_url: string;
    token_preview?: string;
    token_source?: 'runtime' | 'env' | 'none' | string;
};

type ActionResult = { ok?: boolean; paired_chats?: number[] };
type TelegramMessage = {
    chat_id: number;
    message_id?: number;
    date?: number;
    text: string;
    role?: 'user' | 'assistant' | 'system';
    streaming?: boolean;
    from?: {
        id?: number;
        username?: string;
        first_name?: string;
        last_name?: string;
    };
    chat?: {
        title?: string;
        type?: string;
        username?: string;
    };
};

async function fetchJson<T>(key: string, path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers ?? {});
    headers.set('X-API-Key', key);
    headers.set('Content-Type', 'application/json');

    const response = await fetch(`${API_BASE}${path}`, {
        ...init,
        headers,
    });

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(text || `Request failed (${response.status}).`);
    }

    return response.json();
}

export function OpenClawPanel() {
    const [localKey, setLocalKey] = useState<string | null>(null);
    const [status, setStatus] = useState<TelegramStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [actionBusy, setActionBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [botTokenInput, setBotTokenInput] = useState('');
    const [showTokenEditor, setShowTokenEditor] = useState(false);

    const [messages, setMessages] = useState<TelegramMessage[]>([]);
    const messagesRef = useRef<HTMLDivElement | null>(null);

    const loadKey = useCallback(async (): Promise<boolean> => {
        try {
            const key = await (window as any).api?.getLocalKey?.();
            if (key) {
                setLocalKey(key);
                setError(prev => (prev === 'Local Cocoa API key unavailable.' ? null : prev));
                return true;
            }
            setLocalKey(null);
            return false;
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load API key.');
            return false;
        }
    }, []);

    useEffect(() => {
        let cancelled = false;
        let timer: ReturnType<typeof setInterval> | null = null;

        const bootstrap = async () => {
            const hasKey = await loadKey();
            if (cancelled || hasKey) return;

            setError('Local Cocoa API key unavailable.');

            // Key can appear shortly after backend startup; retry in background.
            timer = setInterval(async () => {
                if (cancelled) return;
                const found = await loadKey();
                if (found && timer) {
                    clearInterval(timer);
                    timer = null;
                }
            }, 1500);
        };

        bootstrap();
        return () => {
            cancelled = true;
            if (timer) clearInterval(timer);
        };
    }, [loadKey]);

    const loadStatus = useCallback(async () => {
        if (!localKey) {
            const hasKey = await loadKey();
            if (!hasKey) {
                setError('Local Cocoa API key unavailable.');
                setLoading(false);
                return;
            }
        }
        const key = localKey ?? (await (window as any).api?.getLocalKey?.()) ?? null;
        if (!key) {
            setError('Local Cocoa API key unavailable.');
            setLoading(false);
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const data = await fetchJson<TelegramStatus>(key, `${API_PREFIX}/telegram/status`);
            setStatus(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load status.');
        } finally {
            setLoading(false);
        }
    }, [localKey, loadKey]);

    const loadMessages = useCallback(async () => {
        const key = localKey ?? (await (window as any).api?.getLocalKey?.()) ?? null;
        if (!key) return;
        try {
            const data = await fetchJson<{ messages: TelegramMessage[] }>(
                key,
                `${API_PREFIX}/telegram/messages?limit=100`
            );
            setMessages(data.messages ?? []);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load messages.');
        }
    }, [localKey]);

    useEffect(() => {
        if (localKey) {
            loadStatus();
            loadMessages();
        }
    }, [localKey, loadStatus, loadMessages]);

    useEffect(() => {
        if (!localKey) return;
        const timer = setInterval(() => {
            loadMessages();
        }, 1200);
        return () => clearInterval(timer);
    }, [localKey, loadMessages]);

    const chatMessages = useMemo(() => messages.slice(-80), [messages]);
    const lastMessageText = chatMessages[chatMessages.length - 1]?.text;

    useEffect(() => {
        if (!messagesRef.current) return;
        messagesRef.current.scrollTo({
            top: messagesRef.current.scrollHeight,
            behavior: 'smooth',
        });
    }, [chatMessages.length, lastMessageText]);

    const formatMessageTime = (epochSeconds?: number): string => {
        if (!epochSeconds) return '';
        const d = new Date(epochSeconds * 1000);
        if (Number.isNaN(d.getTime())) return '';
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    const handleRestart = async () => {
        if (!localKey) return;
        setActionBusy(true);
        setError(null);
        try {
            await fetchJson<ActionResult>(localKey, `${API_PREFIX}/telegram/restart`, { method: 'POST' });
            await loadStatus();
            await loadMessages();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Restart failed.');
        } finally {
            setActionBusy(false);
        }
    };

    const handleSaveToken = async () => {
        if (!localKey) return;
        setActionBusy(true);
        setError(null);
        try {
            const data = await fetchJson<{ ok: boolean; status: TelegramStatus }>(
                localKey,
                `${API_PREFIX}/telegram/token`,
                {
                    method: 'POST',
                    body: JSON.stringify({ token: botTokenInput.trim() }),
                }
            );
            setStatus(data.status);
            setBotTokenInput('');
            setShowTokenEditor(false);
            await loadMessages();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save token.');
        } finally {
            setActionBusy(false);
        }
    };

    const handleClearToken = async () => {
        if (!localKey) return;
        setActionBusy(true);
        setError(null);
        try {
            const data = await fetchJson<{ ok: boolean; status: TelegramStatus }>(
                localKey,
                `${API_PREFIX}/telegram/token`,
                {
                    method: 'POST',
                    body: JSON.stringify({ token: '' }),
                }
            );
            setStatus(data.status);
            setBotTokenInput('');
            setShowTokenEditor(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to clear token.');
        } finally {
            setActionBusy(false);
        }
    };

    return (
        <div className="h-full w-full p-6 overflow-y-auto bg-background">
            <div className="max-w-4xl space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="text-xl font-semibold">Telegram Pairing</h2>
                            <div className="group relative">
                                <button
                                    type="button"
                                    aria-label="How pairing works"
                                    className="inline-flex h-5 w-5 items-center justify-center rounded-full border text-xs text-muted-foreground hover:bg-muted"
                                >
                                    ?
                                </button>
                                <div className="pointer-events-none absolute left-0 top-7 z-10 hidden w-80 rounded-md border bg-popover p-3 text-xs text-popover-foreground shadow-md group-hover:block group-focus-within:block">
                                    <div className="font-semibold mb-1">How pairing works</div>
                                    <ol className="list-decimal pl-4 space-y-1">
                                        <li>Send <code className="rounded bg-muted px-1">/newbot</code> to BotFather on Telegram.</li>
                                        <li>Click <code className="rounded bg-muted px-1">Configure Bot Token</code> and paste Telegram bot token.</li>
                                        <li>Send <code className="rounded bg-muted px-1">/pair</code> from Telegram bot.</li>
                                        <li>Once you see <code className="rounded bg-muted px-1">Paired with Local Cocoa. You can now send requests.</code> on Telegram, send messages to ask Local Cocoa.</li>
                                    </ol>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setShowTokenEditor((prev) => !prev)}
                            className={cn(
                                "inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted",
                                status?.enabled ? "text-emerald-600 border-emerald-200" : "text-destructive border-destructive/40"
                            )}
                        >
                            {showTokenEditor ? 'Hide Bot Token' : 'Configure Bot Token'}
                        </button>
                        <button
                            onClick={handleRestart}
                            disabled={actionBusy || !localKey}
                            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                        >
                            <PlugZap className="h-4 w-4" />
                            Restart Poller
                        </button>
                    </div>
                </div>

                {error && (
                    <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                        {error}
                    </div>
                )}

                {loading && (
                    <div className="rounded-md border p-4 text-sm text-muted-foreground">Loading status...</div>
                )}

                {!loading && status && showTokenEditor && (
                    <div className="grid gap-4">
                        <div className="rounded-lg border bg-card p-4 space-y-2">
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-muted-foreground">Bot Token</span>
                                <div className="flex items-center gap-2">
                                    <span className={status.enabled ? 'text-emerald-600' : 'text-destructive'}>
                                        {status.enabled ? 'Configured' : 'Missing'}
                                    </span>
                                    <button
                                        onClick={() => {
                                            setShowTokenEditor(false);
                                            setBotTokenInput('');
                                        }}
                                        className="inline-flex items-center rounded-md border px-2 py-1 text-xs hover:bg-muted"
                                    >
                                        Close
                                    </button>
                                </div>
                            </div>
                            <div className="space-y-2 pb-2">
                                <input
                                    type="password"
                                    value={botTokenInput}
                                    onChange={(e) => setBotTokenInput(e.target.value)}
                                    placeholder="Paste Telegram bot token"
                                    className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                                />
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={handleSaveToken}
                                        disabled={actionBusy || !botTokenInput.trim()}
                                        className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                                    >
                                        Save Token
                                    </button>
                                    <button
                                        onClick={handleClearToken}
                                        disabled={actionBusy || !status?.enabled}
                                        className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs hover:bg-muted disabled:opacity-50"
                                    >
                                        Clear Token
                                    </button>
                                    <button
                                        onClick={() => {
                                            setShowTokenEditor(false);
                                            setBotTokenInput('');
                                        }}
                                        disabled={actionBusy}
                                        className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs hover:bg-muted disabled:opacity-50"
                                    >
                                        Cancel
                                    </button>
                                </div>
                                <div className="text-xs text-muted-foreground">
                                    {status?.token_preview
                                        ? `Current: ${status.token_preview} (${status.token_source || 'unknown'})`
                                        : 'No token configured.'}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                <div className="rounded-lg border bg-card p-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold">Recent Messages</h3>
                        <button
                            onClick={loadMessages}
                            disabled={loading || !localKey}
                            className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
                        >
                            <RefreshCw className="h-3 w-3" />
                            Refresh
                        </button>
                    </div>
                    {chatMessages.length ? (
                        <div
                            ref={messagesRef}
                            className="max-h-[520px] overflow-y-auto pr-1 space-y-3 scroll-smooth"
                        >
                            {chatMessages.map((msg) => {
                                const isAssistant = msg.role === 'assistant';
                                const senderLabel = isAssistant
                                    ? 'Local Cocoa'
                                    : (msg.from?.username ? `@${msg.from.username}` : (msg.from?.first_name || 'Unknown'));
                                return (
                                    <div
                                        key={`${msg.chat_id}-${msg.message_id ?? msg.date ?? msg.text}`}
                                        className={cn('flex', isAssistant ? 'justify-start' : 'justify-end')}
                                    >
                                        <div
                                            className={cn(
                                                'max-w-[88%] rounded-2xl border px-4 py-3 text-sm shadow-sm transition-all',
                                                isAssistant
                                                    ? 'bg-muted/40 border-border'
                                                    : 'bg-primary/10 border-primary/20'
                                            )}
                                        >
                                            <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                                                <span>{senderLabel}</span>
                                                {msg.streaming && (
                                                    <span className="inline-flex items-center gap-1">
                                                        <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
                                                        Streaming
                                                    </span>
                                                )}
                                                {!!formatMessageTime(msg.date) && (
                                                    <span>{formatMessageTime(msg.date)}</span>
                                                )}
                                            </div>
                                            <div className="whitespace-pre-wrap leading-relaxed">{msg.text || '...'}</div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <p className="text-sm text-muted-foreground">No messages captured yet.</p>
                    )}
                </div>
            </div>
        </div>
    );
}
