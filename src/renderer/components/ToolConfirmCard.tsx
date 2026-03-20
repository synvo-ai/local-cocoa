import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, Mail, FileEdit, Loader2, AlertTriangle } from 'lucide-react';
import type { EmailAccountOption, ToolCallInfo } from '../types';
import { cn } from '../lib/utils';

const TOOL_META: Record<string, { icon: typeof Mail; label: string; color: string }> = {
    send_email: { icon: Mail, label: 'Send Email', color: 'text-blue-500' },
    create_note: { icon: FileEdit, label: 'Create Note', color: 'text-green-500' },
};

function formatArgs(tool: string, args: Record<string, unknown>): { label: string; value: string }[] {
    if (tool === 'send_email') {
        return [
            { label: 'To', value: String(args.to || '') },
            { label: 'Subject', value: String(args.subject || '') },
            { label: 'Body', value: String(args.body || '').slice(0, 500) },
        ];
    }
    if (tool === 'create_note') {
        return [
            { label: 'Title', value: String(args.title || '') },
            { label: 'Content', value: String(args.body || '').slice(0, 300) },
        ];
    }
    // Generic fallback for future side-effect tools
    return Object.entries(args).map(([k, v]) => ({
        label: k,
        value: String(v).slice(0, 300),
    }));
}

interface ToolConfirmCardProps {
    toolCall: ToolCallInfo;
    onConfirm: (confirmationId: string, overrides?: Record<string, unknown>) => Promise<void>;
    onCancel: (confirmationId: string) => Promise<void>;
}

export function ToolConfirmCard({ toolCall, onConfirm, onCancel }: ToolConfirmCardProps) {
    const [busy, setBusy] = useState(false);
    const [accounts, setAccounts] = useState<EmailAccountOption[]>([]);
    const [accountsError, setAccountsError] = useState<string | null>(null);
    const [draft, setDraft] = useState({
        account_id: String(toolCall.args.account_id || ''),
        to: String(toolCall.args.to || ''),
        subject: String(toolCall.args.subject || ''),
        body: String(toolCall.args.body || ''),
    });
    const meta = TOOL_META[toolCall.tool] ?? { icon: AlertTriangle, label: toolCall.tool, color: 'text-orange-500' };
    const Icon = meta.icon;
    const fields = formatArgs(toolCall.tool, toolCall.args);

    const status = toolCall.confirmStatus;
    const accountLabel = accounts.find(account => account.id === draft.account_id)?.label;
    const accountUsername = accounts.find(account => account.id === draft.account_id)?.username;

    useEffect(() => {
        setDraft({
            account_id: String(toolCall.args.account_id || ''),
            to: String(toolCall.args.to || ''),
            subject: String(toolCall.args.subject || ''),
            body: String(toolCall.args.body || ''),
        });
    }, [toolCall.callId, toolCall.args]);

    useEffect(() => {
        let cancelled = false;
        if (toolCall.tool !== 'send_email' || !window.api.listEmailAccounts) {
            return () => {
                cancelled = true;
            };
        }

        void window.api.listEmailAccounts()
            .then(result => {
                if (cancelled) return;
                setAccounts(result);
                setAccountsError(null);
            })
            .catch(err => {
                if (cancelled) return;
                console.error('Failed to load email accounts', err);
                setAccountsError('Unable to load connected email accounts.');
            });

        return () => {
            cancelled = true;
        };
    }, [toolCall.tool]);

    if (status === 'confirmed') {
        return (
            <div className="rounded-xl border border-green-200 bg-green-50/80 px-4 py-3 text-sm text-green-900 shadow-sm dark:border-green-900 dark:bg-green-950/30 dark:text-green-300">
                <div className="flex items-center gap-2 font-medium">
                    <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                    <span>{meta.label} sent successfully</span>
                </div>
                {toolCall.tool === 'send_email' && (
                    <div className="mt-2 grid gap-1 text-xs text-green-800/90 dark:text-green-300/80">
                        <span><span className="font-medium">From:</span> {accountLabel && accountUsername ? `${accountLabel} (${accountUsername})` : String(toolCall.args.account_id || '')}</span>
                        <span><span className="font-medium">To:</span> {String(toolCall.args.to || '')}</span>
                        <span><span className="font-medium">Subject:</span> {String(toolCall.args.subject || '')}</span>
                    </div>
                )}
            </div>
        );
    }

    if (status === 'cancelled') {
        return (
            <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-900/30 dark:text-slate-300">
                <div className="flex items-center gap-2 font-medium">
                    <XCircle className="h-4 w-4 text-slate-500" />
                    <span>{meta.label} cancelled</span>
                </div>
            </div>
        );
    }

    if (toolCall.tool === 'send_email') {
        const canConfirm = Boolean(draft.account_id && draft.to.trim() && draft.subject.trim());

        return (
            <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/20 p-4 space-y-3 text-sm">
                <div className="flex items-center gap-2 font-medium">
                    <Icon className={cn('h-4 w-4', meta.color)} />
                    <span>{meta.label} — Confirmation Required</span>
                </div>

                <div className="grid gap-3">
                    <label className="grid gap-1.5">
                        <span className="font-medium text-foreground">From</span>
                        <select
                            value={draft.account_id}
                            onChange={(event) => setDraft(prev => ({ ...prev, account_id: event.target.value }))}
                            className="h-10 rounded-lg border bg-background px-3 text-sm shadow-sm"
                        >
                            <option value="">Select an account</option>
                            {accounts.map(account => (
                                <option key={account.id} value={account.id}>
                                    {account.label} ({account.username})
                                </option>
                            ))}
                        </select>
                        {accountsError && <span className="text-xs text-amber-700 dark:text-amber-300">{accountsError}</span>}
                    </label>

                    <label className="grid gap-1.5">
                        <span className="font-medium text-foreground">To (CSV)</span>
                        <input
                            value={draft.to}
                            onChange={(event) => setDraft(prev => ({ ...prev, to: event.target.value }))}
                            className="h-10 rounded-lg border bg-background px-3 text-sm shadow-sm"
                            placeholder="alice@example.com, bob@example.com, carol@example.com"
                        />
                        <span className="text-xs text-muted-foreground">Comma-separated recipients. Example: a@example.com, b@example.com, c@example.com.</span>
                    </label>

                    <label className="grid gap-1.5">
                        <span className="font-medium text-foreground">Subject</span>
                        <input
                            value={draft.subject}
                            onChange={(event) => setDraft(prev => ({ ...prev, subject: event.target.value }))}
                            className="h-10 rounded-lg border bg-background px-3 text-sm shadow-sm"
                            placeholder="Email subject"
                        />
                    </label>

                    <label className="grid gap-1.5">
                        <span className="font-medium text-foreground">Body</span>
                        <textarea
                            value={draft.body}
                            onChange={(event) => setDraft(prev => ({ ...prev, body: event.target.value }))}
                            className="min-h-32 rounded-lg border bg-background px-3 py-3 text-sm whitespace-pre-wrap shadow-sm"
                        />
                    </label>
                </div>

                <div className="mt-4 flex gap-2 pt-1">
                    <button
                        onClick={async () => {
                            if (!toolCall.confirmationId || busy || !canConfirm) return;
                            setBusy(true);
                            try {
                                await onConfirm(toolCall.confirmationId, draft);
                            } finally {
                                setBusy(false);
                            }
                        }}
                        disabled={busy || !canConfirm}
                        className={cn(
                            'inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors shadow-sm',
                            'bg-primary text-primary-foreground hover:bg-primary/90',
                            'disabled:opacity-50 disabled:cursor-not-allowed'
                        )}
                    >
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                        Confirm
                    </button>
                    <button
                        onClick={async () => {
                            if (!toolCall.confirmationId || busy) return;
                            setBusy(true);
                            try { await onCancel(toolCall.confirmationId); }
                            finally { setBusy(false); }
                        }}
                        disabled={busy}
                        className={cn(
                            'inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors shadow-sm',
                            'bg-muted text-muted-foreground hover:bg-muted/80',
                            'disabled:opacity-50 disabled:cursor-not-allowed'
                        )}
                    >
                        <XCircle className="h-3.5 w-3.5" />
                        Cancel
                    </button>
                </div>
            </div>
        );
    }

    // Pending confirmation
    return (
        <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/20 p-4 space-y-3 text-sm">
            <div className="flex items-center gap-2 font-medium">
                <Icon className={cn('h-4 w-4', meta.color)} />
                <span>{meta.label} — Confirmation Required</span>
            </div>

            <div className="space-y-1.5 text-muted-foreground">
                {fields.map(({ label, value }) => (
                    <div key={label}>
                        <span className="font-medium text-foreground">{label}: </span>
                        {label === 'Body' || label === 'Content' ? (
                            <div className="mt-1 rounded-md bg-background/60 p-2 text-xs whitespace-pre-wrap max-h-40 overflow-y-auto border">
                                {value}
                            </div>
                        ) : (
                            <span>{value}</span>
                        )}
                    </div>
                ))}
            </div>

            <div className="flex gap-2 pt-1">
                <button
                    onClick={async () => {
                        if (!toolCall.confirmationId || busy) return;
                        setBusy(true);
                        try { await onConfirm(toolCall.confirmationId); }
                        finally { setBusy(false); }
                    }}
                    disabled={busy}
                    className={cn(
                        'inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium transition-colors',
                        'bg-primary text-primary-foreground hover:bg-primary/90',
                        'disabled:opacity-50 disabled:cursor-not-allowed'
                    )}
                >
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                    Confirm
                </button>
                <button
                    onClick={async () => {
                        if (!toolCall.confirmationId || busy) return;
                        setBusy(true);
                        try { await onCancel(toolCall.confirmationId); }
                        finally { setBusy(false); }
                    }}
                    disabled={busy}
                    className={cn(
                        'inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium transition-colors',
                        'bg-muted text-muted-foreground hover:bg-muted/80',
                        'disabled:opacity-50 disabled:cursor-not-allowed'
                    )}
                >
                    <XCircle className="h-3.5 w-3.5" />
                    Cancel
                </button>
            </div>
        </div>
    );
}

/** Show small badges for read-only tool calls so users see what the agent did */
export function ToolCallBadges({ toolCalls, toolCallingMode, providerType, modelLabel }: {
    toolCalls: ToolCallInfo[];
    toolCallingMode?: 'native' | 'fallback';
    providerType?: 'local' | 'cloud';
    modelLabel?: string;
}) {
    const readOnly = toolCalls.filter(tc => !tc.confirmationId);
    if (readOnly.length === 0) return null;

    return (
        <div className="flex flex-wrap items-center gap-1.5 ml-1 mb-2">
            {providerType && (
                <span
                    className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider border',
                        providerType === 'local'
                            ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-400'
                            : 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-400'
                    )}
                    title={modelLabel || providerType}
                >
                    {providerType === 'local' ? '🖥️' : '☁️'} {modelLabel || providerType}
                </span>
            )}
            {toolCallingMode && (
                <span
                    className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider border',
                        toolCallingMode === 'native'
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-400'
                            : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-400'
                    )}
                >
                    {toolCallingMode === 'native' ? '🔗 native' : '📝 fallback'}
                </span>
            )}
            {readOnly.map(tc => (
                <span
                    key={tc.callId}
                    className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-medium border',
                        tc.success === false
                            ? 'border-red-200 bg-red-50 text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400'
                            : 'border-muted bg-muted/50 text-muted-foreground'
                    )}
                    title={`${tc.tool}(${JSON.stringify(tc.args)})`}
                >
                    <span className="opacity-60">⚡</span>
                    {tc.tool}
                    {tc.success === false && <span className="text-red-500">✕</span>}
                </span>
            ))}
        </div>
    );
}
