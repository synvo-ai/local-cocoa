/**
 * ProviderConfigPanel – Composable remote-config UI building blocks.
 *
 * Exports:
 *   • RemoteConfigFields – form inputs with provider-preset auto-fill
 *   • RemoteConfigCard   – card wrapper  + header + RemoteConfigFields
 *   • LLM_PROVIDER_PRESETS / RERANKER_PROVIDER_PRESETS
 */

import { useCallback } from 'react';
import { cn } from '../lib/utils';
import {
    Loader2,
    CheckCircle2,
    XCircle,
    Zap,
    Eye,
    EyeOff,
} from 'lucide-react';
import type { RemoteEndpointConfig, TestResult } from '../hooks/useProviderConfig';

/* ------------------------------------------------------------------ */
/*  Provider Presets                                                   */
/* ------------------------------------------------------------------ */

export interface ProviderPreset {
    value: string;
    label: string;
    baseUrl: string;
    defaultModel: string;
    keyPlaceholder?: string;
}

export const LLM_PROVIDER_PRESETS: ProviderPreset[] = [
    { value: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-5.2', keyPlaceholder: 'sk-...' },
    { value: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'anthropic/claude-sonnet-4.5', keyPlaceholder: 'sk-or-...' },
    { value: 'gemini', label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/', defaultModel: 'gemini-2.0-flash-001', keyPlaceholder: 'AIza...' },
    { value: 'ollama', label: 'Ollama (Local)', baseUrl: 'http://localhost:11434/v1', defaultModel: 'llama3.2-vision', keyPlaceholder: 'ollama' },
    { value: 'lmstudio', label: 'LM Studio (Local)', baseUrl: 'http://localhost:1234/v1', defaultModel: '', keyPlaceholder: 'lm-studio' },
    { value: 'vllm', label: 'vLLM (Local)', baseUrl: 'http://localhost:8000/v1', defaultModel: '', keyPlaceholder: '' },
    { value: 'custom', label: 'Custom / Self-hosted', baseUrl: '', defaultModel: '', keyPlaceholder: 'sk-...' },
];

export const RERANKER_PROVIDER_PRESETS: ProviderPreset[] = [
    { value: 'cohere', label: 'Cohere', baseUrl: 'https://api.cohere.com/v1', defaultModel: 'rerank-v4.0-pro' },
    { value: 'jina', label: 'Jina AI', baseUrl: 'https://api.jina.ai/v1', defaultModel: 'jina-reranker-v3' },
    { value: 'voyage', label: 'Voyage AI', baseUrl: 'https://api.voyageai.com/v1', defaultModel: 'rerank-lite-1' },
    { value: 'mixedbread', label: 'Mixedbread', baseUrl: 'https://api.mixedbread.ai/v1', defaultModel: 'mxbai-rerank-large-v1' },
    { value: 'custom', label: 'Custom / Self-hosted', baseUrl: '', defaultModel: '' },
];

/** Collect all preset base URLs so we know when a URL is "preset-owned" */
function presetUrls(presets: ProviderPreset[]): Set<string> {
    return new Set(presets.map(p => p.baseUrl).filter(Boolean));
}

/* ------------------------------------------------------------------ */
/*  RemoteConfigFields – bare form (no card chrome)                    */
/* ------------------------------------------------------------------ */

export interface RemoteConfigFieldsProps {
    draft: RemoteEndpointConfig;
    onDraftChange: (d: RemoteEndpointConfig) => void;
    onSave: () => void;
    onTest: () => void;
    saving: boolean;
    testing: boolean;
    testResult: TestResult | null;
    showKey: boolean;
    onToggleKey: () => void;
    extraFields?: React.ReactNode;
    /** Which preset list to show – defaults to LLM_PROVIDER_PRESETS */
    providerPresets?: ProviderPreset[];
}

export function RemoteConfigFields({
    draft,
    onDraftChange,
    onSave,
    onTest,
    saving,
    testing,
    testResult,
    showKey,
    onToggleKey,
    extraFields,
    providerPresets = LLM_PROVIDER_PRESETS,
}: RemoteConfigFieldsProps) {
    const knownUrls = presetUrls(providerPresets);

    /** When user picks a provider, auto-fill URL & model if the current URL is empty or belongs to another preset */
    const handleProviderChange = useCallback((newHint: string) => {
        const preset = providerPresets.find(p => p.value === newHint);
        if (!preset) {
            onDraftChange({ ...draft, provider_hint: newHint });
            return;
        }
        const currentUrlIsPreset = !draft.base_url || knownUrls.has(draft.base_url);
        const currentModelIsEmpty = !draft.model;
        onDraftChange({
            ...draft,
            provider_hint: newHint,
            base_url: currentUrlIsPreset ? preset.baseUrl : draft.base_url,
            model: currentModelIsEmpty ? preset.defaultModel : draft.model,
        });
    }, [draft, onDraftChange, providerPresets, knownUrls]);

    const updateDraft = (field: keyof RemoteEndpointConfig, value: string) => {
        onDraftChange({ ...draft, [field]: value });
    };

    const activePreset = providerPresets.find(p => p.value === draft.provider_hint);
    const keyPlaceholder = activePreset?.keyPlaceholder || 'sk-...';
    const modelPlaceholder = activePreset?.defaultModel || 'model-id';

    return (
        <div className="space-y-3">
            {/* Provider */}
            <div>
                <label className="block text-[11px] text-muted-foreground mb-1">Provider</label>
                <select
                    value={draft.provider_hint}
                    onChange={(e) => handleProviderChange(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                >
                    {providerPresets.map((p) => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                </select>
            </div>

            {/* Base URL */}
            <div>
                <label className="block text-[11px] text-muted-foreground mb-1">Base URL</label>
                <input
                    type="text"
                    value={draft.base_url}
                    onChange={(e) => updateDraft('base_url', e.target.value)}
                    placeholder={activePreset?.baseUrl || 'https://api.example.com/v1'}
                    className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
            </div>

            {/* API Key */}
            <div>
                <label className="block text-[11px] text-muted-foreground mb-1">API Key</label>
                <div className="relative">
                    <input
                        type={showKey ? 'text' : 'password'}
                        value={draft.api_key}
                        onChange={(e) => updateDraft('api_key', e.target.value)}
                        placeholder={keyPlaceholder}
                        className="w-full rounded-md border border-input bg-background px-3 py-1.5 pr-8 text-xs font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                    <button
                        type="button"
                        onClick={onToggleKey}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                        {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                </div>
            </div>

            {/* Model */}
            <div>
                <label className="block text-[11px] text-muted-foreground mb-1">Model</label>
                <input
                    type="text"
                    value={draft.model}
                    onChange={(e) => updateDraft('model', e.target.value)}
                    placeholder={modelPlaceholder}
                    className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
            </div>

            {extraFields}

            {/* Actions */}
            <div className="flex items-center gap-2 pt-1">
                <button
                    onClick={onSave}
                    disabled={saving || !draft.base_url}
                    className={cn(
                        'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                        'bg-primary text-primary-foreground hover:bg-primary/90',
                        'disabled:opacity-50 disabled:cursor-not-allowed',
                    )}
                >
                    {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                    Save
                </button>
                <button
                    onClick={onTest}
                    disabled={testing || !draft.base_url}
                    className={cn(
                        'inline-flex items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-xs font-medium transition-colors',
                        'bg-background hover:bg-muted',
                        'disabled:opacity-50 disabled:cursor-not-allowed',
                    )}
                >
                    {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                    Test Connection
                </button>
            </div>

            {/* Test result */}
            {testResult && (
                <div
                    className={cn(
                        'rounded-md border px-3 py-2 text-xs',
                        testResult.ok
                            ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400'
                            : 'border-destructive/30 bg-destructive/5 text-destructive',
                    )}
                >
                    <div className="flex items-center gap-1.5">
                        {testResult.ok ? (
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                        ) : (
                            <XCircle className="h-3.5 w-3.5 shrink-0" />
                        )}
                        <span className="font-medium">
                            {testResult.ok ? 'Connected successfully' : 'Connection failed'}
                        </span>
                    </div>
                    {testResult.ok && testResult.latency_ms != null && (
                        <p className="mt-1 text-[11px] opacity-80">
                            Latency: {testResult.latency_ms}ms
                            {testResult.model_echo && ` · Model: ${testResult.model_echo}`}
                        </p>
                    )}
                    {!testResult.ok && testResult.error && (
                        <p className="mt-1 text-[11px] opacity-80">{testResult.error}</p>
                    )}
                </div>
            )}
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  RemoteConfigCard – card with header + RemoteConfigFields           */
/* ------------------------------------------------------------------ */

export interface RemoteConfigCardProps extends Omit<RemoteConfigFieldsProps, 'providerPresets'> {
    title: string;
    description?: string;
    providerPresets?: ProviderPreset[];
}

export function RemoteConfigCard({
    title,
    description,
    providerPresets,
    ...fieldProps
}: RemoteConfigCardProps) {
    return (
        <div className="rounded-lg border bg-card">
            <div className="px-4 py-3 border-b">
                <p className="text-sm font-medium">{title}</p>
                {description && (
                    <p className="text-[11px] text-muted-foreground">{description}</p>
                )}
            </div>
            <div className="px-4 py-3">
                <RemoteConfigFields {...fieldProps} providerPresets={providerPresets} />
            </div>
        </div>
    );
}

