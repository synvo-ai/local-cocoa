import { useCallback, useEffect, useState } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface RemoteEndpointConfig {
    base_url: string;
    api_key: string;
    model: string;
    provider_hint: string;
}

export interface ProviderConfig {
    llm_provider: 'local' | 'remote';
    rerank_provider: 'local' | 'remote';
    remote_llm: RemoteEndpointConfig;
    remote_rerank: RemoteEndpointConfig;
    remote_vision_model: string;
}

export interface TestResult {
    ok: boolean;
    latency_ms: number | null;
    model_echo: string | null;
    error: string | null;
}

const DEFAULT_REMOTE: RemoteEndpointConfig = {
    base_url: '',
    api_key: '',
    model: '',
    provider_hint: 'openai',
};

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useProviderConfig() {
    const [config, setConfig] = useState<ProviderConfig | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saveOk, setSaveOk] = useState(false);

    // Draft state for editing
    const [llmDraft, setLlmDraft] = useState<RemoteEndpointConfig>({ ...DEFAULT_REMOTE });
    const [rerankDraft, setRerankDraft] = useState<RemoteEndpointConfig>({ ...DEFAULT_REMOTE });
    const [visionModelDraft, setVisionModelDraft] = useState('');

    // Test connection state
    const [testingLlm, setTestingLlm] = useState(false);
    const [testingRerank, setTestingRerank] = useState(false);
    const [llmTestResult, setLlmTestResult] = useState<TestResult | null>(null);
    const [rerankTestResult, setRerankTestResult] = useState<TestResult | null>(null);

    // Show / hide API key
    const [showLlmKey, setShowLlmKey] = useState(false);
    const [showRerankKey, setShowRerankKey] = useState(false);

    /* ---------- Load on mount ---------- */
    useEffect(() => {
        (async () => {
            try {
                const data = await window.api.getProviderConfig();
                setConfig(data);
                setLlmDraft({ ...DEFAULT_REMOTE, ...data.remote_llm });
                setRerankDraft({ ...DEFAULT_REMOTE, ...data.remote_rerank });
                setVisionModelDraft(data.remote_vision_model ?? '');
            } catch (e: any) {
                setError(e.message ?? 'Failed to load provider config');
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    /* ---------- Persist helper ---------- */
    const save = useCallback(async (patch: Partial<ProviderConfig>) => {
        setSaving(true);
        setSaveOk(false);
        setError(null);
        try {
            const updated = await window.api.updateProviderConfig(patch);
            setConfig(updated);
            setSaveOk(true);
            setTimeout(() => setSaveOk(false), 2000);
        } catch (e: any) {
            setError(e.message ?? 'Failed to save');
        } finally {
            setSaving(false);
        }
    }, []);

    /* ---------- Global mode switch ---------- */
    const setGlobalMode = useCallback(async (mode: 'local' | 'remote') => {
        if (!config) return;
        if (config.llm_provider === mode) return;
        // Switch both LLM and reranker together
        await save({ llm_provider: mode, rerank_provider: mode });
    }, [config, save]);

    /* ---------- Reranker sub-toggle ---------- */
    const setRerankProvider = useCallback(async (mode: 'local' | 'remote') => {
        if (!config || config.rerank_provider === mode) return;
        await save({ rerank_provider: mode });
    }, [config, save]);

    /* ---------- Save remote endpoint configs ---------- */
    const saveLlmConfig = useCallback(async () => {
        await save({
            remote_llm: {
                base_url: llmDraft.base_url,
                api_key: llmDraft.api_key,
                model: llmDraft.model,
                provider_hint: llmDraft.provider_hint,
            },
            remote_vision_model: visionModelDraft || undefined,
        });
    }, [llmDraft, visionModelDraft, save]);

    const saveRerankConfig = useCallback(async () => {
        await save({
            remote_rerank: {
                base_url: rerankDraft.base_url,
                api_key: rerankDraft.api_key,
                model: rerankDraft.model,
                provider_hint: rerankDraft.provider_hint,
            },
        });
    }, [rerankDraft, save]);

    /* ---------- Test connection ---------- */
    const testConnection = useCallback(async (target: 'llm' | 'rerank') => {
        const draft = target === 'llm' ? llmDraft : rerankDraft;
        const setTesting = target === 'llm' ? setTestingLlm : setTestingRerank;
        const setResult = target === 'llm' ? setLlmTestResult : setRerankTestResult;

        if (!draft.base_url) {
            setResult({ ok: false, latency_ms: null, model_echo: null, error: 'Base URL is required' });
            return;
        }

        setTesting(true);
        setResult(null);
        try {
            const result = await window.api.testProviderConnection({
                base_url: draft.base_url,
                api_key: draft.api_key || undefined,
                model: draft.model || undefined,
                provider_hint: draft.provider_hint || undefined,
            });
            setResult(result);
        } catch (e: any) {
            setResult({ ok: false, latency_ms: null, model_echo: null, error: e.message ?? 'Test failed' });
        } finally {
            setTesting(false);
        }
    }, [llmDraft, rerankDraft]);

    /* ---------- Public API ---------- */
    return {
        // State
        config,
        loading,
        saving,
        error,
        saveOk,

        // Convenience booleans
        isCloudMode: config?.llm_provider === 'remote',
        isRerankCloud: config?.rerank_provider === 'remote',

        // LLM draft
        llmDraft,
        setLlmDraft,
        visionModelDraft,
        setVisionModelDraft,

        // Rerank draft
        rerankDraft,
        setRerankDraft,

        // Test states
        testingLlm,
        testingRerank,
        llmTestResult,
        rerankTestResult,

        // Show / hide keys
        showLlmKey,
        toggleLlmKey: () => setShowLlmKey((v) => !v),
        showRerankKey,
        toggleRerankKey: () => setShowRerankKey((v) => !v),

        // Actions
        setGlobalMode,
        setRerankProvider,
        saveLlmConfig,
        saveRerankConfig,
        testLlmConnection: () => testConnection('llm'),
        testRerankConnection: () => testConnection('rerank'),
    };
}
