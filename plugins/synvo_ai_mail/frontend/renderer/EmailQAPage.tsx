import { useState, useRef, useEffect, useCallback } from 'react';
import { MessageCircleQuestion, Send, Loader2, Mail, ChevronDown, AlertCircle, Sparkles, Brain, Database, FileText, Calendar, RefreshCw, CheckCircle2, XCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { cn } from '@/renderer/lib/utils';
import { API_PREFIX } from '../config';

import type { EmailAccountSummary, AccountQAResult, AccountMemoryStatus, AccountMemoryDetails } from '../types';
import { mailAPI } from './api';

const API_BASE = 'http://127.0.0.1:8890';

interface EmailQAPageProps {
    accounts: EmailAccountSummary[];
    onBack?: () => void;
}

interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    sources?: AccountQAResult['sources'];
    timestamp: Date;
}

interface MemoryItem {
    id: string;
    subject: string;
    sender: string;
    preview: string;
    timestamp?: string;
}

// Build memory progress types
interface BuildProgress {
    type: string;
    current?: number;
    total?: number;
    percentage?: number;
    message?: string;
    email_subject?: string;
    email_sender?: string;
    email_id?: string;
    force?: boolean;
    skipped?: number;
    stats?: {
        memcells: number;
        episodes: number;
        facts: number;
        skipped?: number;
    };
    email_result?: {
        email_id: string;
        email_subject: string;
        memcell_created: boolean;
        episode_created: boolean;
        episode_summary?: string;
        facts_extracted: string[];
    };
    error?: string;
}

interface ProcessedEmail {
    id: string;
    subject: string;
    sender: string;
    skipped?: boolean;
    memcellCreated: boolean;
    episodeCreated: boolean;
    episodeSummary?: string;
    facts: string[];
    error?: string;
}

interface FailedEmail {
    id: string;
    subject: string | null;
    sender: string | null;
    error: string | null;
    failedAt: string | null;
}

export function EmailQAPage({ accounts }: EmailQAPageProps) {
    const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
    const [memoryStatus, setMemoryStatus] = useState<AccountMemoryStatus | null>(null);
    const [_memoryItems, _setMemoryItems] = useState<MemoryItem[]>([]);
    const [question, setQuestion] = useState('');
    const [messages, setMessages] = useState<Message[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadingStatus, setLoadingStatus] = useState(false);
    const [buildingMemory, setBuildingMemory] = useState(false);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [activeTab, setActiveTab] = useState<'memory' | 'qa'>('memory');

    // Build progress states
    const [buildProgress, setBuildProgress] = useState<BuildProgress | null>(null);
    const [processedEmails, setProcessedEmails] = useState<ProcessedEmail[]>([]);
    const [showProgressDetails, setShowProgressDetails] = useState(true);

    // Memory details for visualization
    const [memoryDetails, setMemoryDetails] = useState<AccountMemoryDetails | null>(null);
    const [loadingDetails, setLoadingDetails] = useState(false);
    const [_expandedEpisodes, setExpandedEpisodes] = useState<Set<string>>(new Set());

    // Failed emails
    const [failedEmails, setFailedEmails] = useState<FailedEmail[]>([]);
    const [retryingEmail, setRetryingEmail] = useState<string | null>(null);

    const inputRef = useRef<HTMLInputElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const progressEndRef = useRef<HTMLDivElement>(null);

    // Auto-select first account if only one exists
    useEffect(() => {
        if (accounts.length === 1 && !selectedAccountId) {
            setSelectedAccountId(accounts[0].id);
        }
    }, [accounts, selectedAccountId]);

    // Fetch failed emails
    const fetchFailedEmails = useCallback(async (accountId: string) => {
        try {
            const apiKey = await window.api?.getLocalKey();
            if (!apiKey) return;

            const response = await fetch(
                `${API_BASE}${API_PREFIX}/accounts/${encodeURIComponent(accountId)}/failed-emails`,
                {
                    headers: {
                        'X-API-Key': apiKey,
                        'X-Request-Source': 'local_ui',
                    },
                }
            );
            if (response.ok) {
                const data = await response.json();
                setFailedEmails(
                    (data.failed_emails || []).map((e: any) => ({
                        id: e.id,
                        subject: e.subject,
                        sender: e.sender,
                        error: e.error,
                        failedAt: e.failed_at,
                    }))
                );
            }
        } catch (error) {
            console.error('Failed to fetch failed emails:', error);
        }
    }, []);

    // Fetch memory status and details when account changes
    useEffect(() => {
        if (!selectedAccountId) {
            setMemoryStatus(null);
            _setMemoryItems([]);
            setMemoryDetails(null);
            setFailedEmails([]);
            return;
        }

        const fetchStatus = async () => {
            setLoadingStatus(true);
            try {
                const status = await mailAPI.getAccountMemoryStatus(selectedAccountId);
                setMemoryStatus(status);

                // Fetch detailed memory items if memory is built
                if (status?.isBuilt) {
                    setLoadingDetails(true);
                    try {
                        const details = await mailAPI.getAccountMemoryDetails(selectedAccountId);
                        console.log('[EmailQAPage] Memory details received:', {
                            accountId: details?.accountId,
                            memcells: details?.memcells?.length ?? 0,
                            episodes: details?.episodes?.length ?? 0,
                            facts: details?.facts?.length ?? 0,
                            totalMemcells: details?.totalMemcells,
                            totalEpisodes: details?.totalEpisodes,
                            totalFacts: details?.totalFacts,
                        });
                        setMemoryDetails(details);
                    } catch (error) {
                        console.error('Failed to fetch memory details:', error);
                        setMemoryDetails(null);
                    } finally {
                        setLoadingDetails(false);
                    }
                }

                // Always fetch failed emails
                await fetchFailedEmails(selectedAccountId);
            } catch (error) {
                console.error('Failed to fetch memory status:', error);
                setMemoryStatus(null);
            } finally {
                setLoadingStatus(false);
            }
        };

        fetchStatus();
    }, [selectedAccountId, fetchFailedEmails]);

    // Toggle episode expansion
    const _toggleEpisode = useCallback((episodeId: string) => {
        setExpandedEpisodes(prev => {
            const next = new Set(prev);
            if (next.has(episodeId)) {
                next.delete(episodeId);
            } else {
                next.add(episodeId);
            }
            return next;
        });
    }, []);

    // Retry single failed email
    const handleRetryEmail = useCallback(async (messageId: string) => {
        if (!selectedAccountId || retryingEmail) return;

        setRetryingEmail(messageId);

        try {
            const apiKey = await window.api?.getLocalKey();
            if (!apiKey) {
                throw new Error('API key not found');
            }

            const response = await fetch(
                `${API_BASE}${API_PREFIX}/accounts/${encodeURIComponent(selectedAccountId)}/retry-email/${encodeURIComponent(messageId)}`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-API-Key': apiKey,
                        'X-Request-Source': 'local_ui',
                    },
                    body: JSON.stringify({ user_id: 'default_user' }),
                }
            );

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const reader = response.body?.getReader();
            if (!reader) {
                throw new Error('No response body');
            }

            const decoder = new TextDecoder();
            let buffer = '';
            let reading = true;

            while (reading) {
                const { done, value } = await reader.read();
                if (done) {
                    reading = false;
                    break;
                }

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));
                            if (data.type === 'complete') {
                                // Remove from failed list on success
                                setFailedEmails(prev => prev.filter(e => e.id !== messageId));
                                // Refresh memory status
                                const status = await mailAPI.getAccountMemoryStatus(selectedAccountId);
                                setMemoryStatus(status);
                                if (status?.isBuilt) {
                                    const details = await mailAPI.getAccountMemoryDetails(selectedAccountId);
                                    setMemoryDetails(details);
                                }
                            } else if (data.type === 'error') {
                                console.error('Retry failed:', data.error);
                            }
                        } catch (e) {
                            console.error('Failed to parse SSE data:', e);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Failed to retry email:', error);
        } finally {
            setRetryingEmail(null);
        }
    }, [selectedAccountId, retryingEmail]);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsDropdownOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Scroll to bottom when new messages arrive
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const selectedAccount = accounts.find(a => a.id === selectedAccountId);

    // Scroll to progress end when new items arrive
    useEffect(() => {
        progressEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [processedEmails]);

    // Build memory for selected account with streaming progress
    const handleBuildMemory = useCallback(async (force: boolean = false) => {
        if (!selectedAccountId || buildingMemory) return;

        setBuildingMemory(true);
        setBuildProgress(null);
        setProcessedEmails([]);
        setShowProgressDetails(true);

        try {
            // Get API key for authentication
            const apiKey = await window.api?.getLocalKey();
            if (!apiKey) {
                throw new Error('API key not found. Please restart the application.');
            }

            // Use fetch with streaming to call the SSE endpoint
            const response = await fetch(`${API_BASE}${API_PREFIX}/accounts/${encodeURIComponent(selectedAccountId)}/build-memory/stream`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': apiKey,
                    'X-Request-Source': 'local_ui',
                },
                body: JSON.stringify({ user_id: 'default_user', force }),
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const reader = response.body?.getReader();
            if (!reader) {
                throw new Error('No response body');
            }

            const decoder = new TextDecoder();
            let buffer = '';
            let streaming = true;

            while (streaming) {
                const { done, value } = await reader.read();
                if (done) {
                    streaming = false;
                    break;
                }

                buffer += decoder.decode(value, { stream: true });

                // Parse SSE events
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data: BuildProgress = JSON.parse(line.slice(6));
                            setBuildProgress(data);

                            // Update processed emails list
                            if (data.type === 'email_complete' && data.email_result) {
                                const result = data.email_result;
                                setProcessedEmails(prev => [...prev, {
                                    id: result.email_id,
                                    subject: result.email_subject,
                                    sender: data.email_sender || '',
                                    memcellCreated: result.memcell_created,
                                    episodeCreated: result.episode_created,
                                    episodeSummary: result.episode_summary,
                                    facts: result.facts_extracted,
                                }]);
                            } else if (data.type === 'skipped') {
                                // Already processed email - add to list as skipped
                                setProcessedEmails(prev => [...prev, {
                                    id: data.email_id || '',
                                    subject: data.email_subject || '',
                                    sender: data.email_sender || '',
                                    skipped: true,
                                    memcellCreated: false,
                                    episodeCreated: false,
                                    facts: [],
                                }]);
                            } else if (data.type === 'email_error') {
                                setProcessedEmails(prev => [...prev, {
                                    id: data.email_id || '',
                                    subject: data.email_subject || '',
                                    sender: data.email_sender || '',
                                    memcellCreated: false,
                                    episodeCreated: false,
                                    facts: [],
                                    error: data.error,
                                }]);
                            }
                        } catch (e) {
                            console.error('Failed to parse SSE data:', e);
                        }
                    }
                }
            }

            // Refresh status, details, and failed emails after building
            const status = await mailAPI.getAccountMemoryStatus(selectedAccountId);
            setMemoryStatus(status);

            // Fetch updated memory details
            if (status?.isBuilt) {
                try {
                    const details = await mailAPI.getAccountMemoryDetails(selectedAccountId);
                    setMemoryDetails(details);
                } catch (error) {
                    console.error('Failed to fetch memory details:', error);
                }
            }

            // Refresh failed emails list
            await fetchFailedEmails(selectedAccountId);
        } catch (error) {
            console.error('Failed to build memory:', error);
            setBuildProgress({
                type: 'error',
                message: error instanceof Error ? error.message : 'Unknown error',
            });
        } finally {
            setBuildingMemory(false);
        }
    }, [selectedAccountId, buildingMemory, fetchFailedEmails]);

    const handleAsk = useCallback(async () => {
        if (!question.trim() || loading || !selectedAccountId) return;

        const userMessage: Message = {
            id: `user-${Date.now()}`,
            role: 'user',
            content: question.trim(),
            timestamp: new Date(),
        };

        setMessages(prev => [...prev, userMessage]);
        setQuestion('');
        setLoading(true);

        try {
            const result = await mailAPI.accountQA(selectedAccountId, userMessage.content);

            const assistantMessage: Message = {
                id: `assistant-${Date.now()}`,
                role: 'assistant',
                content: result.answer,
                sources: result.sources,
                timestamp: new Date(),
            };

            setMessages(prev => [...prev, assistantMessage]);
        } catch (error) {
            const errorMessage: Message = {
                id: `error-${Date.now()}`,
                role: 'assistant',
                content: `Error: ${error instanceof Error ? error.message : 'Failed to get answer'}`,
                timestamp: new Date(),
            };
            setMessages(prev => [...prev, errorMessage]);
        } finally {
            setLoading(false);
            inputRef.current?.focus();
        }
    }, [selectedAccountId, question, loading]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleAsk();
        }
    };

    return (
        <div className="h-full flex flex-col bg-background">
            {/* Header */}
            <div className="flex-none border-b px-6 py-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-500/20 to-violet-500/5 flex items-center justify-center">
                            <Brain className="h-5 w-5 text-violet-500" />
                        </div>
                        <div>
                            <h2 className="text-lg font-semibold">Email Memory</h2>
                            <p className="text-xs text-muted-foreground">View and query your email memories</p>
                        </div>
                    </div>

                    {/* Account Selector */}
                    <div className="relative" ref={dropdownRef}>
                        <button
                            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                            className={cn(
                                "flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors",
                                "hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-primary/20",
                                isDropdownOpen && "bg-muted/50"
                            )}
                        >
                            <Mail className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm font-medium">
                                {selectedAccount?.label || 'Select Email Account'}
                            </span>
                            <ChevronDown className={cn(
                                "h-4 w-4 text-muted-foreground transition-transform",
                                isDropdownOpen && "rotate-180"
                            )} />
                        </button>

                        {isDropdownOpen && (
                            <div className="absolute right-0 top-full mt-2 w-64 bg-popover border rounded-lg shadow-lg z-50">
                                {accounts.length === 0 ? (
                                    <div className="p-4 text-center text-sm text-muted-foreground">
                                        No email accounts connected
                                    </div>
                                ) : (
                                    <div className="py-1">
                                        {accounts.map(account => (
                                            <button
                                                key={account.id}
                                                onClick={() => {
                                                    setSelectedAccountId(account.id);
                                                    setIsDropdownOpen(false);
                                                    setMessages([]); // Clear chat when switching accounts
                                                }}
                                                className={cn(
                                                    "w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/50 transition-colors",
                                                    selectedAccountId === account.id && "bg-primary/10"
                                                )}
                                            >
                                                <Mail className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-sm font-medium truncate">{account.label}</div>
                                                    <div className="text-xs text-muted-foreground truncate">{account.username}</div>
                                                </div>
                                                <span className="text-xs text-muted-foreground">
                                                    {account.totalMessages} msgs
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Content */}
            {!selectedAccountId ? (
                <div className="flex-1 flex items-center justify-center">
                    <div className="text-center">
                        <Mail className="h-16 w-16 mx-auto mb-4 text-muted-foreground/30" />
                        <h3 className="text-lg font-medium text-muted-foreground mb-2">
                            Select an Email Account
                        </h3>
                        <p className="text-sm text-muted-foreground/70 max-w-sm">
                            Choose an email account from the dropdown above to view its memory.
                        </p>
                    </div>
                </div>
            ) : (
                <>
                    {/* Memory Status Bar */}
                    <div className="flex-none border-b px-6 py-3 bg-muted/20">
                        {loadingStatus ? (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Loading memory status...
                            </div>
                        ) : memoryStatus?.isBuilt ? (
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                    <div className="flex items-center gap-2 text-sm">
                                        <Database className="h-4 w-4 text-violet-500" />
                                        <span className="font-medium">{memoryStatus.memcellCount}</span>
                                        <span className="text-muted-foreground">emails indexed</span>
                                    </div>
                                    <div className="flex items-center gap-2 text-sm">
                                        <FileText className="h-4 w-4 text-blue-500" />
                                        <span className="font-medium">{memoryStatus.episodeCount}</span>
                                        <span className="text-muted-foreground">episodes</span>
                                    </div>
                                    <div className="flex items-center gap-2 text-sm">
                                        <Sparkles className="h-4 w-4 text-amber-500" />
                                        <span className="font-medium">{memoryStatus.eventLogCount}</span>
                                        <span className="text-muted-foreground">facts</span>
                                    </div>
                                </div>
                                {memoryStatus.lastBuiltAt && (
                                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                        <Calendar className="h-3.5 w-3.5" />
                                        Built: {new Date(memoryStatus.lastBuiltAt).toLocaleDateString()}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
                                <AlertCircle className="h-4 w-4" />
                                No memory built for this account. Go to Email Accounts and click &quot;Build Memory&quot; first.
                            </div>
                        )}
                    </div>

                    {/* Tab Navigation */}
                    <div className="flex-none border-b px-6">
                        <div className="flex gap-1">
                            <button
                                onClick={() => setActiveTab('memory')}
                                className={cn(
                                    "flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px",
                                    activeTab === 'memory'
                                        ? "border-primary text-foreground"
                                        : "border-transparent text-muted-foreground hover:text-foreground"
                                )}
                            >
                                <Database className="h-4 w-4" />
                                Memory Overview
                            </button>
                            <button
                                onClick={() => setActiveTab('qa')}
                                className={cn(
                                    "flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px",
                                    activeTab === 'qa'
                                        ? "border-primary text-foreground"
                                        : "border-transparent text-muted-foreground hover:text-foreground"
                                )}
                            >
                                <MessageCircleQuestion className="h-4 w-4" />
                                Ask Questions
                            </button>
                        </div>
                    </div>

                    {/* Tab Content */}
                    <div className="flex-1 overflow-hidden">
                        {activeTab === 'memory' ? (
                            /* Memory Overview Tab */
                            <div className="h-full overflow-y-auto p-6">
                                {/* Building Progress UI - Only show progress bar during build */}
                                {buildingMemory && buildProgress && (
                                    <div className="mb-6">
                                        {/* Progress Header */}
                                        <div className="p-4 rounded-xl bg-primary/10 border border-primary/20">
                                            <div className="flex items-center justify-between mb-3">
                                                <div className="flex items-center gap-2">
                                                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                                                    <span className="font-medium">Building Memory...</span>
                                                </div>
                                                {buildProgress.percentage !== undefined && (
                                                    <span className="text-sm font-mono">
                                                        {buildProgress.current}/{buildProgress.total} ({buildProgress.percentage}%)
                                                    </span>
                                                )}
                                            </div>

                                            {/* Progress Bar */}
                                            {buildProgress.percentage !== undefined && (
                                                <div className="w-full bg-muted rounded-full h-2 mb-3">
                                                    <div
                                                        className="bg-primary h-2 rounded-full transition-all duration-300"
                                                        style={{ width: `${buildProgress.percentage}%` }}
                                                    />
                                                </div>
                                            )}

                                            {/* Current Status */}
                                            <p className="text-sm text-muted-foreground truncate">
                                                {buildProgress.message || buildProgress.email_subject}
                                            </p>

                                            {/* Running Stats */}
                                            {buildProgress.stats && (
                                                <div className="flex gap-4 mt-3 text-xs">
                                                    <span className="text-violet-500">
                                                        <Database className="h-3.5 w-3.5 inline mr-1" />
                                                        {buildProgress.stats.memcells} MemCells
                                                    </span>
                                                    <span className="text-blue-500">
                                                        <FileText className="h-3.5 w-3.5 inline mr-1" />
                                                        {buildProgress.stats.episodes} Episodes
                                                    </span>
                                                    <span className="text-amber-500">
                                                        <Sparkles className="h-3.5 w-3.5 inline mr-1" />
                                                        {buildProgress.stats.facts} Facts
                                                    </span>
                                                    {(buildProgress.stats.skipped ?? 0) > 0 && (
                                                        <span className="text-muted-foreground">
                                                            ⏭️ {buildProgress.stats.skipped} Skipped
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* Processed Emails List - Persist after build completes */}
                                {processedEmails.length > 0 && (
                                    <div className="mb-6 rounded-xl border">
                                        <button
                                            onClick={() => setShowProgressDetails(!showProgressDetails)}
                                            className="w-full flex items-center justify-between p-3 text-sm font-medium hover:bg-muted/50 bg-muted/30"
                                        >
                                            <div className="flex items-center gap-2">
                                                <Database className="h-4 w-4 text-violet-500" />
                                                <span>Processed MemCells ({processedEmails.length})</span>
                                                {!buildingMemory && buildProgress?.type === 'complete' && (
                                                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                                                )}
                                            </div>
                                            <ChevronDown className={cn(
                                                "h-4 w-4 transition-transform",
                                                showProgressDetails && "rotate-180"
                                            )} />
                                        </button>

                                        {showProgressDetails && (
                                            <div className="max-h-80 overflow-y-auto border-t">
                                                {processedEmails.map((email, idx) => (
                                                    <div
                                                        key={email.id || idx}
                                                        className={cn(
                                                            "p-3 border-b last:border-b-0 text-sm hover:bg-muted/30",
                                                            email.skipped && "opacity-60"
                                                        )}
                                                    >
                                                        <div className="flex items-start gap-2">
                                                            {email.error ? (
                                                                <XCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
                                                            ) : email.skipped ? (
                                                                <span className="text-sm flex-shrink-0 mt-0">⏭️</span>
                                                            ) : (
                                                                <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
                                                            )}
                                                            <div className="flex-1 min-w-0">
                                                                <p className="font-medium truncate">
                                                                    {email.subject}
                                                                </p>
                                                                {email.error ? (
                                                                    <p className="text-xs text-red-500 mt-1">
                                                                        {email.error}
                                                                    </p>
                                                                ) : email.skipped ? (
                                                                    <p className="text-xs text-muted-foreground mt-1">
                                                                        Already processed - skipped
                                                                    </p>
                                                                ) : (
                                                                    <div className="flex flex-wrap gap-2 mt-1">
                                                                        {email.memcellCreated && (
                                                                            <span className="text-xs px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-600 dark:text-violet-400">
                                                                                MemCell
                                                                            </span>
                                                                        )}
                                                                        {email.episodeCreated && (
                                                                            <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400">
                                                                                Episode
                                                                            </span>
                                                                        )}
                                                                        {email.facts.length > 0 && (
                                                                            <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400">
                                                                                {email.facts.length} Facts
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                )}
                                                                {email.episodeSummary && (
                                                                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                                                                        {email.episodeSummary}
                                                                    </p>
                                                                )}
                                                                {email.facts.length > 0 && (
                                                                    <ul className="text-xs text-muted-foreground mt-1 space-y-0.5">
                                                                        {email.facts.slice(0, 3).map((fact, i) => (
                                                                            <li key={i} className="truncate">• {fact}</li>
                                                                        ))}
                                                                        {email.facts.length > 3 && (
                                                                            <li className="text-muted-foreground/70">+{email.facts.length - 3} more</li>
                                                                        )}
                                                                    </ul>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                                <div ref={progressEndRef} />
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Failed Emails Section */}
                                {failedEmails.length > 0 && (
                                    <div className="mb-6 rounded-xl border border-red-500/20 bg-red-500/5">
                                        <div className="flex items-center justify-between p-3 border-b border-red-500/20">
                                            <div className="flex items-center gap-2">
                                                <AlertCircle className="h-4 w-4 text-red-500" />
                                                <span className="text-sm font-medium text-red-600 dark:text-red-400">
                                                    Failed Emails ({failedEmails.length})
                                                </span>
                                            </div>
                                        </div>
                                        <div className="max-h-48 overflow-y-auto divide-y divide-red-500/10">
                                            {failedEmails.map((email) => (
                                                <div key={email.id} className="p-3 flex items-start justify-between gap-3">
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm font-medium truncate">
                                                            {email.subject || '(No Subject)'}
                                                        </p>
                                                        {email.error && (
                                                            <p className="text-xs text-red-500 mt-1 truncate">
                                                                {email.error}
                                                            </p>
                                                        )}
                                                    </div>
                                                    <button
                                                        onClick={() => handleRetryEmail(email.id)}
                                                        disabled={retryingEmail === email.id}
                                                        className={cn(
                                                            "flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors",
                                                            "bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400",
                                                            "disabled:opacity-50 disabled:cursor-not-allowed"
                                                        )}
                                                    >
                                                        {retryingEmail === email.id ? (
                                                            <>
                                                                <Loader2 className="h-3 w-3 animate-spin" />
                                                                Retrying...
                                                            </>
                                                        ) : (
                                                            <>
                                                                <RefreshCw className="h-3 w-3" />
                                                                Retry
                                                            </>
                                                        )}
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Completion Message */}
                                {!buildingMemory && buildProgress?.type === 'complete' && (
                                    <div className="mb-6 p-4 rounded-xl bg-green-500/10 border border-green-500/20">
                                        <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                                            <CheckCircle2 className="h-5 w-5" />
                                            <span className="font-medium">Memory Build Complete!</span>
                                        </div>
                                        <p className="text-sm text-muted-foreground mt-2">
                                            {buildProgress.message}
                                        </p>
                                    </div>
                                )}

                                {/* Error Message */}
                                {!buildingMemory && buildProgress?.type === 'error' && (
                                    <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20">
                                        <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
                                            <XCircle className="h-5 w-5" />
                                            <span className="font-medium">Build Failed</span>
                                        </div>
                                        <p className="text-sm text-muted-foreground mt-2">
                                            {buildProgress.message}
                                        </p>
                                    </div>
                                )}

                                {memoryStatus?.isBuilt ? (
                                    <div className="space-y-6">
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                            <div className="p-4 rounded-xl bg-violet-500/10 border border-violet-500/20">
                                                <div className="flex items-center gap-3 mb-2">
                                                    <Database className="h-5 w-5 text-violet-500" />
                                                    <span className="text-sm font-medium">MemCells</span>
                                                </div>
                                                <div className="text-3xl font-bold text-violet-600 dark:text-violet-400">
                                                    {memoryStatus.memcellCount}
                                                </div>
                                                <p className="text-xs text-muted-foreground mt-1">
                                                    Emails processed into memory
                                                </p>
                                            </div>

                                            <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20">
                                                <div className="flex items-center gap-3 mb-2">
                                                    <FileText className="h-5 w-5 text-blue-500" />
                                                    <span className="text-sm font-medium">Episodes</span>
                                                </div>
                                                <div className="text-3xl font-bold text-blue-600 dark:text-blue-400">
                                                    {memoryStatus.episodeCount}
                                                </div>
                                                <p className="text-xs text-muted-foreground mt-1">
                                                    Narrative memories extracted
                                                </p>
                                            </div>

                                            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
                                                <div className="flex items-center gap-3 mb-2">
                                                    <Sparkles className="h-5 w-5 text-amber-500" />
                                                    <span className="text-sm font-medium">Facts</span>
                                                </div>
                                                <div className="text-3xl font-bold text-amber-600 dark:text-amber-400">
                                                    {memoryStatus.eventLogCount}
                                                </div>
                                                <p className="text-xs text-muted-foreground mt-1">
                                                    Atomic facts from emails
                                                </p>
                                            </div>
                                        </div>

                                        {/* MemCells List */}
                                        <div className="rounded-xl border border-violet-500/20">
                                            <div className="flex items-center justify-between p-4 border-b border-violet-500/20 bg-violet-500/5">
                                                <h3 className="text-sm font-semibold flex items-center gap-2">
                                                    <Database className="h-4 w-4 text-violet-500" />
                                                    MemCells ({memoryDetails?.totalMemcells ?? 0})
                                                </h3>
                                                {loadingDetails && (
                                                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                                )}
                                            </div>
                                            {memoryDetails?.memcells && memoryDetails.memcells.length > 0 ? (
                                                <div className="divide-y divide-violet-500/10 max-h-[250px] overflow-y-auto">
                                                    {memoryDetails.memcells.map((mc) => (
                                                        <div key={mc.id} className="p-3 hover:bg-violet-500/5">
                                                            <div className="flex items-center gap-2 mb-1">
                                                                <Mail className="h-3.5 w-3.5 text-violet-500 flex-shrink-0" />
                                                                <span className="text-sm font-medium truncate">{mc.emailSubject}</span>
                                                            </div>
                                                            {mc.emailSender && (
                                                                <p className="text-xs text-muted-foreground ml-5">From: {mc.emailSender}</p>
                                                            )}
                                                            {mc.preview && (
                                                                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{mc.preview}</p>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : !loadingDetails ? (
                                                <div className="p-6 text-center text-muted-foreground text-sm">
                                                    No MemCells found. Build Memory to process emails.
                                                </div>
                                            ) : null}
                                        </div>

                                        {/* Episodes List */}
                                        <div className="rounded-xl border border-blue-500/20">
                                            <div className="flex items-center justify-between p-4 border-b border-blue-500/20 bg-blue-500/5">
                                                <h3 className="text-sm font-semibold flex items-center gap-2">
                                                    <FileText className="h-4 w-4 text-blue-500" />
                                                    Episodes ({memoryDetails?.totalEpisodes ?? 0})
                                                </h3>
                                            </div>
                                            {memoryDetails?.episodes && memoryDetails.episodes.length > 0 ? (
                                                <div className="divide-y divide-blue-500/10 max-h-[250px] overflow-y-auto">
                                                    {memoryDetails.episodes.map((ep) => (
                                                        <div key={ep.id} className="p-3 hover:bg-blue-500/5">
                                                            <div className="flex items-center gap-2 mb-1">
                                                                <FileText className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
                                                                <span className="text-sm font-medium truncate">{ep.emailSubject || '(No Subject)'}</span>
                                                            </div>
                                                            {ep.summary && (
                                                                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{ep.summary}</p>
                                                            )}
                                                            {ep.episode && (
                                                                <p className="text-xs text-blue-600/70 dark:text-blue-400/70 mt-1 line-clamp-2 italic">{ep.episode}</p>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : !loadingDetails ? (
                                                <div className="p-6 text-center text-muted-foreground text-sm">
                                                    No Episodes extracted. Episodes are narrative summaries of email content.
                                                </div>
                                            ) : null}
                                        </div>

                                        {/* Facts List */}
                                        <div className="rounded-xl border border-amber-500/20">
                                            <div className="flex items-center justify-between p-4 border-b border-amber-500/20 bg-amber-500/5">
                                                <h3 className="text-sm font-semibold flex items-center gap-2">
                                                    <Sparkles className="h-4 w-4 text-amber-500" />
                                                    Atomic Facts ({memoryDetails?.totalFacts ?? 0})
                                                </h3>
                                            </div>
                                            {memoryDetails?.facts && memoryDetails.facts.length > 0 ? (
                                                <div className="divide-y divide-amber-500/10 max-h-[250px] overflow-y-auto">
                                                    {memoryDetails.facts.map((f) => (
                                                        <div key={f.id} className="p-3 hover:bg-amber-500/5">
                                                            <div className="flex items-start gap-2">
                                                                <Sparkles className="h-3.5 w-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                                                                <div className="flex-1 min-w-0">
                                                                    <p className="text-sm">{f.fact}</p>
                                                                    {f.emailSubject && (
                                                                        <p className="text-xs text-muted-foreground mt-1">From: {f.emailSubject}</p>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : !loadingDetails ? (
                                                <div className="p-6 text-center text-muted-foreground text-sm">
                                                    No Facts extracted. Facts are atomic pieces of information from emails.
                                                </div>
                                            ) : null}
                                        </div>

                                        <div className="p-6 rounded-xl bg-muted/30 border">
                                            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                                                <Brain className="h-4 w-4 text-primary" />
                                                Memory System Info
                                            </h3>
                                            <div className="space-y-2 text-sm text-muted-foreground">
                                                <p>
                                                    <strong>Account:</strong> {selectedAccount?.label} ({selectedAccount?.username})
                                                </p>
                                                <p>
                                                    <strong>Total Emails:</strong> {selectedAccount?.totalMessages}
                                                </p>
                                                {memoryStatus.lastBuiltAt && (
                                                    <p>
                                                        <strong>Last Built:</strong> {new Date(memoryStatus.lastBuiltAt).toLocaleString()}
                                                    </p>
                                                )}
                                                <p className="text-xs italic mt-2">
                                                    Note: Email memories are isolated from file system memories.
                                                </p>
                                            </div>
                                        </div>

                                        <div className="flex items-center justify-between p-4 rounded-xl bg-muted/30 border">
                                            <div>
                                                <p className="text-sm text-muted-foreground">
                                                    Switch to &quot;Ask Questions&quot; tab to query your email memories
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={() => handleBuildMemory(false)}
                                                    disabled={buildingMemory}
                                                    className={cn(
                                                        "inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-colors",
                                                        "bg-muted hover:bg-muted/80 text-muted-foreground",
                                                        "disabled:opacity-50 disabled:cursor-not-allowed"
                                                    )}
                                                    title="Only process new emails that haven't been tagged yet"
                                                >
                                                    {buildingMemory ? (
                                                        <>
                                                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                            Building...
                                                        </>
                                                    ) : (
                                                        <>
                                                            <RefreshCw className="h-3.5 w-3.5" />
                                                            Build New
                                                        </>
                                                    )}
                                                </button>
                                                <button
                                                    onClick={() => handleBuildMemory(true)}
                                                    disabled={buildingMemory}
                                                    className={cn(
                                                        "inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-colors",
                                                        "border border-destructive/30 text-destructive hover:bg-destructive/10",
                                                        "disabled:opacity-50 disabled:cursor-not-allowed"
                                                    )}
                                                    title="Force rebuild all emails, ignoring existing tags"
                                                >
                                                    <RefreshCw className="h-3.5 w-3.5" />
                                                    Force Rebuild All
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ) : !buildingMemory ? (
                                    <div className="h-full flex items-center justify-center">
                                        <div className="text-center">
                                            <AlertCircle className="h-16 w-16 mx-auto mb-4 text-amber-500/50" />
                                            <h3 className="text-lg font-medium text-muted-foreground mb-2">
                                                No Memory Built
                                            </h3>
                                            <p className="text-sm text-muted-foreground/70 max-w-sm mb-6">
                                                Build memory from your emails to enable intelligent search and Q&A.
                                            </p>
                                            <button
                                                onClick={() => handleBuildMemory(false)}
                                                disabled={buildingMemory}
                                                className={cn(
                                                    "inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-medium transition-all",
                                                    "bg-primary text-primary-foreground hover:bg-primary/90",
                                                    "disabled:opacity-50 disabled:cursor-not-allowed",
                                                    "shadow-lg hover:shadow-xl"
                                                )}
                                            >
                                                {buildingMemory ? (
                                                    <>
                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                        Building Memory...
                                                    </>
                                                ) : (
                                                    <>
                                                        <Brain className="h-4 w-4" />
                                                        Build Memory
                                                    </>
                                                )}
                                            </button>
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        ) : (
                            /* QA Tab */
                            <div className="h-full flex flex-col">
                                {/* Messages Area */}
                                <div className="flex-1 overflow-y-auto px-6 py-4">
                                    {messages.length === 0 ? (
                                        <div className="h-full flex items-center justify-center">
                                            <div className="text-center">
                                                <MessageCircleQuestion className="h-16 w-16 mx-auto mb-4 text-muted-foreground/30" />
                                                <h3 className="text-lg font-medium text-muted-foreground mb-2">
                                                    Ask About Your Emails
                                                </h3>
                                                <p className="text-sm text-muted-foreground/70 max-w-sm">
                                                    Ask questions about emails in <strong>{selectedAccount?.label}</strong>.
                                                    For example: &quot;What meetings do I have scheduled?&quot; or &quot;Summarize emails from John.&quot;
                                                </p>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="space-y-4">
                                            {messages.map(message => (
                                                <div
                                                    key={message.id}
                                                    className={cn(
                                                        "flex",
                                                        message.role === 'user' ? "justify-end" : "justify-start"
                                                    )}
                                                >
                                                    <div
                                                        className={cn(
                                                            "max-w-[80%] rounded-xl px-4 py-3",
                                                            message.role === 'user'
                                                                ? "bg-primary text-primary-foreground"
                                                                : "bg-muted"
                                                        )}
                                                    >
                                                        {message.role === 'assistant' ? (
                                                            <div className="prose prose-sm dark:prose-invert max-w-none">
                                                                <ReactMarkdown>{message.content}</ReactMarkdown>
                                                            </div>
                                                        ) : (
                                                            <p className="text-sm">{message.content}</p>
                                                        )}

                                                        {message.sources && message.sources.length > 0 && (
                                                            <div className="mt-3 pt-3 border-t border-border/50">
                                                                <p className="text-xs text-muted-foreground mb-2">
                                                                    Based on {message.sources.length} email{message.sources.length !== 1 ? 's' : ''}:
                                                                </p>
                                                                <div className="space-y-1">
                                                                    {message.sources.slice(0, 3).map((source, i) => (
                                                                        <div key={i} className="text-xs text-muted-foreground truncate">
                                                                            • {source.subject || 'Untitled'} - {source.sender || 'Unknown sender'}
                                                                        </div>
                                                                    ))}
                                                                    {message.sources.length > 3 && (
                                                                        <div className="text-xs text-muted-foreground">
                                                                            +{message.sources.length - 3} more
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}

                                            {loading && (
                                                <div className="flex justify-start">
                                                    <div className="bg-muted rounded-xl px-4 py-3">
                                                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                                            <Loader2 className="h-4 w-4 animate-spin" />
                                                            Thinking...
                                                        </div>
                                                    </div>
                                                </div>
                                            )}

                                            <div ref={messagesEndRef} />
                                        </div>
                                    )}
                                </div>

                                {/* Input Area */}
                                <div className="flex-none border-t px-6 py-4">
                                    <div className="flex gap-3">
                                        <input
                                            ref={inputRef}
                                            type="text"
                                            value={question}
                                            onChange={(e) => setQuestion(e.target.value)}
                                            onKeyDown={handleKeyDown}
                                            placeholder="Ask a question about your emails..."
                                            disabled={loading || !memoryStatus?.isBuilt}
                                            className={cn(
                                                "flex-1 px-4 py-2.5 rounded-xl border bg-background",
                                                "focus:outline-none focus:ring-2 focus:ring-primary/20",
                                                "disabled:opacity-50 disabled:cursor-not-allowed",
                                                "text-sm placeholder:text-muted-foreground"
                                            )}
                                        />
                                        <button
                                            onClick={handleAsk}
                                            disabled={!question.trim() || loading || !memoryStatus?.isBuilt}
                                            className={cn(
                                                "px-4 py-2.5 rounded-xl bg-primary text-primary-foreground",
                                                "hover:bg-primary/90 transition-colors",
                                                "disabled:opacity-50 disabled:cursor-not-allowed",
                                                "flex items-center gap-2"
                                            )}
                                        >
                                            {loading ? (
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                            ) : (
                                                <Send className="h-4 w-4" />
                                            )}
                                        </button>
                                    </div>

                                    {!memoryStatus?.isBuilt && (
                                        <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                                            Please build memory for this account first (from the Email Accounts tab).
                                        </p>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
