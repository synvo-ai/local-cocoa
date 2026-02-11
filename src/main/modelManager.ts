import { EventEmitter } from 'events';
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import { net } from 'electron';
import { config } from './config';
import ProxyAgent from 'proxy-agent';
import type { ModelAssetStatus, ModelDownloadEvent, ModelStatusSummary } from '../types/files';

type ModelAssetDescriptor = {
    id: string;
    label: string;
    relativePath: string;
    optional?: boolean;
    type: 'embedding' | 'reranker' | 'vlm' | 'completion' | 'whisper';
    url: string;
    mmprojId?: string;
};

// Preset types
type PresetId = 'eco' | 'balanced' | 'pro';

interface PresetModels {
    vlm: string;
    embedding: string;
    reranker: string;
    whisper: string;
}

interface Preset {
    label: string;
    description: string;
    models: PresetModels;
    estimatedVram: string;
    estimatedDownloadSize: string;
}

interface RamThreshold {
    minGB: number;
    preset: PresetId;
}

interface PresetsConfig {
    presets: Record<PresetId, Preset>;
    autoSelectRules: {
        mac: { ramThresholds: RamThreshold[] };
        windows: { vramThresholds: RamThreshold[]; cpuOnlyPreset: PresetId };
    };
}


interface ModelConfig {
    activeModelId: string;
    activeEmbeddingModelId: string;
    activeRerankerModelId: string;
    activeAudioModelId: string;  // Whisper model for speech recognition
    contextSize: number;
    visionMaxPixels: number;
    videoMaxPixels: number;
    pdfOneChunkPerPage: boolean;
    summaryMaxTokens?: number;
    searchResultLimit?: number;
    qaContextLimit?: number;
    maxSnippetLength?: number;
    embedBatchSize?: number;
    embedBatchDelayMs?: number;
    visionBatchDelayMs?: number;
    debugMode?: boolean;
    showBenchmarkViewer?: boolean;
}



export class ModelManager extends EventEmitter {
    private readonly modelRootPath: string;
    private readonly userConfigPath: string;
    private readonly modelsConfigPath: string;
    private readonly presetsConfigPath: string;
    private activeDownload: Promise<ModelStatusSummary> | null = null;
    private descriptors: ModelAssetDescriptor[] = [];
    private presetsConfig: PresetsConfig | null = null;
    private proxyAgent: any | null = null;
    private config: ModelConfig = {
        activeModelId: 'vlm',
        activeEmbeddingModelId: 'embedding-q4',
        activeRerankerModelId: 'reranker',
        activeAudioModelId: 'whisper-small',  // Multi-language whisper model
        contextSize: 8192,
        visionMaxPixels: 1003520,
        videoMaxPixels: 307200,  // ~640×480, lower than images for faster video processing
        pdfOneChunkPerPage: true,
        summaryMaxTokens: 256,
        searchResultLimit: 15,
        qaContextLimit: 5,
        maxSnippetLength: 2000,
        embedBatchSize: 10,
        embedBatchDelayMs: 10,
        visionBatchDelayMs: 200,
        debugMode: config.debugMode,
        showBenchmarkViewer: false,
    };
    public readonly initializePromise: Promise<void>;

    get modelRoot(): string {
        return this.modelRootPath;
    }

    constructor(modelRoot: string) {
        super();
        this.modelRootPath = modelRoot;

        this.userConfigPath = path.join(this.modelRootPath, 'user.config.json');
        this.modelsConfigPath = path.join(config.paths.projectRoot, 'config', 'models.config.json');
        this.presetsConfigPath = path.join(config.paths.projectRoot, 'config', 'models.preset.json');

        console.log('[ModelManager] Initialized');
        console.log('[ModelManager] Model Root:', this.modelRootPath);
        console.log('[ModelManager] Models Config:', this.modelsConfigPath);
        console.log('[ModelManager] Presets Config:', this.presetsConfigPath);

        this.initializePromise = this.initialize();
    }

    private async initialize() {
        await this.loadConfig();
        await this.loadModelDescriptors();
        await this.loadPresets();
    }

    private async loadPresets(): Promise<void> {
        try {
            const data = await fs.readFile(this.presetsConfigPath, 'utf-8');
            this.presetsConfig = JSON.parse(data);
        } catch (error) {
            console.error('[ModelManager] Failed to load models.preset.json:', error);
            this.presetsConfig = null;
        }
    }

    async getPresets(): Promise<PresetsConfig | null> {
        if (!this.presetsConfig) {
            await this.loadPresets();
        }
        return this.presetsConfig;
    }

    async getRecommendedPreset(): Promise<PresetId> {
        if (!this.presetsConfig) {
            await this.loadPresets();
        }
        if (!this.presetsConfig) {
            return 'eco'; // Fallback if config fails to load
        }

        const os = await import('os');
        const totalMemoryBytes = os.totalmem();
        const totalMemoryGB = totalMemoryBytes / (1024 ** 3);

        const rules = this.presetsConfig.autoSelectRules;

        if (process.platform === 'darwin') {
            // macOS: use RAM thresholds
            const thresholds = [...rules.mac.ramThresholds].sort((a, b) => b.minGB - a.minGB);
            for (const t of thresholds) {
                if (totalMemoryGB >= t.minGB) {
                    console.log(`[ModelManager] Auto-selected preset: ${t.preset} (Mac RAM: ${totalMemoryGB.toFixed(1)}GB)`);
                    return t.preset;
                }
            }
        } else if (process.platform === 'win32') {
            // Windows: Would need GPU VRAM detection (not available in Node.js directly)
            // For now, fall back to RAM-based selection similar to Mac
            // In production, you'd use a native module or spawn nvidia-smi
            const thresholds = [...rules.windows.vramThresholds].sort((a, b) => b.minGB - a.minGB);
            // Without GPU detection, use RAM as proxy (conservative estimate)
            for (const t of thresholds) {
                if (totalMemoryGB >= t.minGB * 2) { // RAM should be ~2x VRAM for safe operation
                    console.log(`[ModelManager] Auto-selected preset: ${t.preset} (Windows RAM-proxy: ${totalMemoryGB.toFixed(1)}GB)`);
                    return t.preset;
                }
            }
            return rules.windows.cpuOnlyPreset;
        }

        return 'eco'; // Fallback for Linux or unknown platforms
    }

    async applyPreset(presetId: PresetId): Promise<void> {
        if (!this.presetsConfig) {
            await this.loadPresets();
        }
        if (!this.presetsConfig) {
            throw new Error('Presets configuration not loaded');
        }

        const preset = this.presetsConfig.presets[presetId];
        if (!preset) {
            throw new Error(`Unknown preset: ${presetId}`);
        }

        // Update config with preset model selections
        await this.setConfig({
            activeModelId: preset.models.vlm,
            activeEmbeddingModelId: preset.models.embedding,
            activeRerankerModelId: preset.models.reranker,
            activeAudioModelId: preset.models.whisper,
        });

        console.log(`[ModelManager] Applied preset: ${presetId}`);
    }

    /**
     * Get the model IDs that need to be downloaded based on current config selection.
     * Includes mmproj dependencies for VLM models.
     */
    getSelectedModelIds(): string[] {
        const ids: string[] = [
            this.config.activeModelId,
            this.config.activeEmbeddingModelId,
            this.config.activeRerankerModelId,
            this.config.activeAudioModelId,
        ];

        // Add mmproj dependency for VLM
        const vlmDescriptor = this.descriptors.find(d => d.id === this.config.activeModelId);
        if (vlmDescriptor?.mmprojId) {
            ids.push(vlmDescriptor.mmprojId);
        }

        return ids.filter(Boolean);
    }

    private async loadModelDescriptors() {
        try {
            const data = await fs.readFile(this.modelsConfigPath, 'utf-8');
            const json = JSON.parse(data);
            if (Array.isArray(json.models)) {
                this.descriptors = json.models;
            }
        } catch (error) {
            console.error('Failed to load models.config.json:', error);
            this.descriptors = [];
        }
    }

    private async loadConfig() {
        try {
            const data = await fs.readFile(this.userConfigPath, 'utf-8');
            this.config = { ...this.config, ...JSON.parse(data) };
        } catch {
            // Ignore error, use defaults
        }
    }

    private async saveConfig() {
        try {
            await fs.mkdir(path.dirname(this.userConfigPath), { recursive: true });
            await fs.writeFile(this.userConfigPath, JSON.stringify(this.config, null, 2));
        } catch (error) {
            console.error('Failed to save model config:', error);
        }
    }

    async getConfig(): Promise<ModelConfig> {
        return this.config;
    }

    async setConfig(newConfig: Partial<ModelConfig>): Promise<void> {
        this.config = { ...this.config, ...newConfig };
        await this.saveConfig();
        await this.syncConfigToBackend();
        this.emit('config-changed', this.config);
    }

    public async syncConfigToBackend(): Promise<void> {
        // Resolve paths
        try {
            const vlmId = this.config.activeModelId || 'vlm';
            const vlmPath = this.getModelPath(vlmId);

            // Resolve mmproj
            const vlmDescriptor = this.getDescriptor(vlmId);
            let vlmMmprojPath = '';
            if (vlmDescriptor?.mmprojId) {
                vlmMmprojPath = this.getModelPath(vlmDescriptor.mmprojId);
            } else if (vlmId === 'vlm') {
                // Fallback for default
                try { vlmMmprojPath = this.getModelPath('vlm-mmproj'); } catch { /* ignore */ }
            }

            const activeEmbeddingModelId = this.config.activeEmbeddingModelId || 'embedding-q4';
            const embeddingModelPath = this.getModelPath(activeEmbeddingModelId);

            const activeRerankerModelId = this.config.activeRerankerModelId || 'reranker';
            const rerankerModelPath = this.getModelPath(activeRerankerModelId);

            const activeAudioModelId = this.config.activeAudioModelId || 'whisper-small';
            const whisperModelPath = this.getModelPath(activeAudioModelId);

            const payload = {
                vlm_model: vlmPath,
                vlm_mmproj: vlmMmprojPath,
                embedding_model: embeddingModelPath,
                rerank_model: rerankerModelPath,
                whisper_model: whisperModelPath
            };

            // Use node-fetch or built-in fetch (available in Electron main process/Node 18+)
            // We need to handle connection errors in case backend isn't running yet
            const response = await fetch(`${config.urls.backendApiBase}/models/config`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                console.log('[ModelManager] Backend config updated successfully');
            } else {
                // It's okay if backend is not running yet (e.g. during initial load), 
                // but if it is running, we want to know.
                // We can check status code.
                console.warn(`[ModelManager] Backend config update failed: ${response.status} ${response.statusText}`);
            }

        } catch (error) {
            // Backend might not be running, which is fine during startup
            console.debug('[ModelManager] Could not sync config to backend (might be offline):', error);
        }
    }

    getModelPath(id: string): string {
        const descriptor = this.descriptors.find((d) => d.id === id);
        if (!descriptor) {
            // Fallback for synchronous access if descriptors aren't loaded yet
            // This is a best-effort fallback for the known structure
            if (id === 'embedding' || id === 'embedding-q4') return path.join(this.modelRootPath, 'Qwen3-Embedding-0.6B-Q4_K_M.gguf');
            if (id === 'reranker') return path.join(this.modelRootPath, 'bge-reranker-v2-m3-q8_0.gguf');
            if (id === 'vlm') return path.join(this.modelRootPath, 'qwenvl', 'Qwen3VL-2B-Instruct-Q4_K_M.gguf');
            throw new Error(`Unknown model id: ${id}`);
        }
        return path.join(this.modelRootPath, descriptor.relativePath);
    }

    getDescriptor(id: string): ModelAssetDescriptor | undefined {
        return this.descriptors.find((d) => d.id === id);
    }

    async getStatus(): Promise<ModelStatusSummary> {
        if (this.descriptors.length === 0) {
            await this.loadModelDescriptors();
        }
        const assets = await Promise.all(
            this.descriptors.map(async (descriptor) => this.describeAsset(descriptor))
        );

        // Check only SELECTED models for ready status, not all non-optional
        const selectedIds = this.getSelectedModelIds();
        const missing = assets.filter((asset) => {
            const isSelected = selectedIds.includes(asset.id);
            return isSelected && !asset.exists;
        }).map((asset) => asset.id);

        return {
            assets,
            ready: missing.length === 0 && this.descriptors.length > 0,
            missing,
            lastCheckedAt: new Date().toISOString()
        };
    }

    /**
     * Download missing models.
     * @param modelIds Optional array of model IDs to download. If not provided, downloads ALL missing models.
     *                 If provided, only downloads the specified models (and their dependencies).
     */
    async downloadMissing(modelIds?: string[]): Promise<ModelStatusSummary> {
        if (this.activeDownload) {
            return this.activeDownload;
        }
        this.activeDownload = this.performDownload(modelIds);
        try {
            return await this.activeDownload;
        } finally {
            this.activeDownload = null;
        }
    }

    /**
     * Download only the models selected in user config.
     */
    async downloadSelectedModels(): Promise<ModelStatusSummary> {
        const selectedIds = this.getSelectedModelIds();
        console.log('[ModelManager] Downloading selected models:', selectedIds);
        return this.downloadMissing(selectedIds);
    }

    async redownloadAsset(assetId: string): Promise<ModelStatusSummary> {
        if (this.activeDownload) {
            return this.activeDownload;
        }
        if (this.descriptors.length === 0) {
            await this.loadModelDescriptors();
        }
        const descriptor = this.descriptors.find((d) => d.id === assetId);
        if (!descriptor) {
            throw new Error(`Unknown model asset: ${assetId}`);
        }

        this.activeDownload = this.performSingleAssetDownload(descriptor);
        try {
            return await this.activeDownload;
        } finally {
            this.activeDownload = null;
        }
    }

    private async performDownload(modelIds?: string[]): Promise<ModelStatusSummary> {
        await fs.mkdir(this.modelRootPath, { recursive: true });

        if (this.descriptors.length === 0) {
            await this.loadModelDescriptors();
        }

        const status = await this.getStatus();

        // Filter assets to download
        const assetsToDownload = this.descriptors.filter(d => {
            const assetStatus = status.assets.find(a => a.id === d.id);
            const isMissing = !assetStatus?.exists;
            // If modelIds provided, only download those specific models
            const isRequested = !modelIds || modelIds.includes(d.id);
            return isMissing && isRequested;
        });

        console.log('[ModelManager] Descriptors count:', this.descriptors.length);
        console.log('[ModelManager] Assets to download:', assetsToDownload.map(a => a.id));
        console.log('[ModelManager] Model Root Path:', this.modelRootPath);

        if (assetsToDownload.length === 0) {
            if (this.descriptors.length === 0) {
                const msg = 'No model descriptors found. Check models.config.json path: ' + this.modelsConfigPath;
                console.error('[ModelManager]', msg);
                this.emitProgress({ state: 'error', message: msg, statuses: status.assets });
            } else {
                this.emitProgress({ state: 'completed', percent: 100, message: 'All models ready.', statuses: status.assets });
            }
            return status;
        }

        this.emitProgress({ state: 'downloading', percent: 0, message: 'Starting download...' });

        for (const asset of assetsToDownload) {
            try {
                await this.downloadDescriptor(asset);
                // Emit status update after each successful download so UI updates incrementally
                const currentStatus = await this.getStatus();
                this.emitProgress({
                    state: 'downloading',
                    assetId: asset.id,
                    message: `${asset.label} downloaded.`,
                    statuses: currentStatus.assets
                });
            } catch (error: any) {
                this.emitProgress({ state: 'error', message: `Failed to download ${asset.label}: ${error.message}` });
                throw error;
            }
        }

        const finalStatus = await this.getStatus();
        this.emitProgress({ state: 'completed', percent: 100, statuses: finalStatus.assets, message: 'All downloads finished.' });
        return finalStatus;
    }

    private async performSingleAssetDownload(asset: ModelAssetDescriptor): Promise<ModelStatusSummary> {
        await fs.mkdir(this.modelRootPath, { recursive: true });
        this.emitProgress({ state: 'downloading', assetId: asset.id, percent: 0, message: `Preparing to redownload ${asset.label}...` });
        await this.removeAssetFiles(asset);
        try {
            await this.downloadDescriptor(asset);
        } catch (error: any) {
            this.emitProgress({ state: 'error', assetId: asset.id, message: `Failed to redownload ${asset.label}: ${error.message}` });
            throw error;
        }
        const finalStatus = await this.getStatus();
        this.emitProgress({ state: 'completed', assetId: asset.id, percent: 100, statuses: finalStatus.assets, message: `${asset.label} refreshed.` });
        return finalStatus;
    }

    private async downloadDescriptor(asset: ModelAssetDescriptor): Promise<void> {
        const destPath = path.join(this.modelRootPath, asset.relativePath);
        await fs.mkdir(path.dirname(destPath), { recursive: true });
        await this.downloadFile(asset.url, destPath, asset.id);
    }

    private async removeAssetFiles(asset: ModelAssetDescriptor): Promise<void> {
        const destPath = path.join(this.modelRootPath, asset.relativePath);
        this.emitProgress({ state: 'downloading', assetId: asset.id, message: `Removing existing ${asset.label}...` });
        try {
            await fs.rm(destPath, { force: true });
        } catch (error) {
            console.warn(`[ModelManager] Failed to remove existing asset ${asset.id}:`, error);
        }
        try {
            await fs.rm(`${destPath}.downloading`, { force: true });
        } catch {
            // Ignore cleanup failure for temp artifacts
        }
    }

    private async downloadFile(url: string, destPath: string, assetId: string): Promise<void> {
        if (!this.hasProxyEnvVars()) {
            // Electron's net stack respects system proxy settings (Clash/Shadowsocks etc.)
            // so prefer it when no explicit env proxy is configured.
            return this.downloadFileViaElectronNet(url, destPath, assetId);
        }

        return this.downloadFileViaNode(url, destPath, assetId);
    }

    private hasProxyEnvVars(): boolean {
        const env = process.env;
        return Boolean(
            env.HTTPS_PROXY || env.https_proxy ||
            env.HTTP_PROXY || env.http_proxy ||
            env.ALL_PROXY || env.all_proxy
        );
    }

    private async downloadFileViaNode(url: string, destPath: string, assetId: string): Promise<void> {
        const tempPath = `${destPath}.downloading`;
        return new Promise((resolve, reject) => {
            const cleanupTemp = async () => {
                await fs.unlink(tempPath).catch(() => { });
            };

            const request = (uri: string, redirectsLeft: number) => {
                this.emitProgress({ state: 'downloading', assetId, message: `Connecting to ${assetId}...` });

                let targetUrl: URL;
                try {
                    targetUrl = new URL(uri);
                } catch (err) {
                    reject(err);
                    return;
                }

                const client = targetUrl.protocol === 'http:' ? http : https;
                const agent = this.getProxyAgent();

                const req = client.get(
                    targetUrl,
                    {
                        agent,
                        headers: {
                            'User-Agent': 'LocalCocoa/0.1'
                        }
                    },
                    (response) => {
                        const statusCode = response.statusCode ?? 0;
                        const location = response.headers.location;

                        if (statusCode >= 300 && statusCode < 400 && location) {
                            if (redirectsLeft <= 0) {
                                reject(new Error('Too many redirects'));
                                return;
                            }
                            const nextUrl = new URL(location, targetUrl).toString();
                            response.resume();
                            request(nextUrl, redirectsLeft - 1);
                            return;
                        }

                        if (statusCode !== 200) {
                            response.resume();
                            reject(new Error(`HTTP ${statusCode}`));
                            return;
                        }

                        const totalBytes = parseInt(String(response.headers['content-length'] || '0'), 10) || 0;
                        let downloadedBytes = 0;
                        const fileStream = createWriteStream(tempPath);

                        response.pipe(fileStream);

                        response.on('data', (chunk) => {
                            downloadedBytes += chunk.length;
                            const percent = totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : null;
                            const downloadedMb = Math.round(downloadedBytes / 1024 / 1024);
                            const totalMb = totalBytes > 0 ? Math.round(totalBytes / 1024 / 1024) : null;
                            this.emitProgress({
                                state: 'downloading',
                                assetId,
                                percent,
                                message: totalMb != null
                                    ? `Downloading ${assetId} (${downloadedMb}MB / ${totalMb}MB)`
                                    : `Downloading ${assetId} (${downloadedMb}MB)`
                            });
                        });

                        fileStream.on('finish', async () => {
                            fileStream.close();
                            try {
                                await fs.rename(tempPath, destPath);
                                resolve();
                            } catch (err) {
                                await cleanupTemp();
                                reject(err);
                            }
                        });

                        fileStream.on('error', async (err) => {
                            fileStream.close();
                            await cleanupTemp();
                            reject(err);
                        });

                        response.on('error', async (err) => {
                            await cleanupTemp();
                            reject(err);
                        });
                    }
                );

                req.on('error', async (err) => {
                    await cleanupTemp();
                    reject(err);
                });
            };

            request(url, 10);
        });
    }

    private async downloadFileViaElectronNet(url: string, destPath: string, assetId: string): Promise<void> {
        const tempPath = `${destPath}.downloading`;
        return new Promise((resolve, reject) => {
            const cleanupTemp = async () => {
                await fs.unlink(tempPath).catch(() => { });
            };

            const request = (uri: string, redirectsLeft: number) => {
                this.emitProgress({ state: 'downloading', assetId, message: `Connecting to ${assetId}...` });

                const req = net.request({
                    method: 'GET',
                    url: uri,
                });

                req.on('response', (response) => {
                    const statusCode = response.statusCode ?? 0;
                    const locationHeader = (response.headers as any)?.location;
                    const location = Array.isArray(locationHeader) ? locationHeader[0] : locationHeader;

                    if (statusCode >= 300 && statusCode < 400 && location) {
                        if (redirectsLeft <= 0) {
                            reject(new Error('Too many redirects'));
                            return;
                        }
                        const nextUrl = new URL(String(location), uri).toString();
                        (response as any).resume?.();
                        request(nextUrl, redirectsLeft - 1);
                        return;
                    }

                    if (statusCode !== 200) {
                        (response as any).resume?.();
                        reject(new Error(`HTTP ${statusCode}`));
                        return;
                    }

                    const totalBytes = parseInt(String((response.headers as any)?.['content-length'] || '0'), 10) || 0;
                    let downloadedBytes = 0;
                    const fileStream = createWriteStream(tempPath);

                    (response as any).pipe(fileStream);

                    response.on('data', (chunk) => {
                        downloadedBytes += chunk.length;
                        const percent = totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : null;
                        const downloadedMb = Math.round(downloadedBytes / 1024 / 1024);
                        const totalMb = totalBytes > 0 ? Math.round(totalBytes / 1024 / 1024) : null;
                        this.emitProgress({
                            state: 'downloading',
                            assetId,
                            percent,
                            message: totalMb != null
                                ? `Downloading ${assetId} (${downloadedMb}MB / ${totalMb}MB)`
                                : `Downloading ${assetId} (${downloadedMb}MB)`
                        });
                    });

                    fileStream.on('finish', async () => {
                        fileStream.close();
                        try {
                            await fs.rename(tempPath, destPath);
                            resolve();
                        } catch (err) {
                            await cleanupTemp();
                            reject(err);
                        }
                    });

                    fileStream.on('error', async (err) => {
                        fileStream.close();
                        await cleanupTemp();
                        reject(err);
                    });

                    response.on('error', async (err: any) => {
                        await cleanupTemp();
                        reject(err);
                    });
                });

                req.on('error', async (err) => {
                    await cleanupTemp();
                    reject(err);
                });

                req.end();
            };

            request(url, 10);
        });
    }

    private getProxyAgent(): any | undefined {
        if (!this.hasProxyEnvVars()) {
            return undefined;
        }
        if (!this.proxyAgent) {
            // proxy-agent automatically respects: HTTP(S)_PROXY, ALL_PROXY, NO_PROXY (and lowercase variants)
            this.proxyAgent = new (ProxyAgent as any)();
        }
        return this.proxyAgent;
    }

    private async describeAsset(descriptor: ModelAssetDescriptor): Promise<ModelAssetStatus> {
        const filePath = path.join(this.modelRootPath, descriptor.relativePath);
        let exists = false;
        let sizeBytes: number | null = null;
        try {
            const stats = await fs.stat(filePath);
            if (stats.isFile() && stats.size > 0) {
                exists = true;
                sizeBytes = stats.size;
            }
        } catch {
            exists = false;
        }
        return {
            id: descriptor.id,
            label: descriptor.label,
            path: filePath,
            exists,
            sizeBytes,
            optional: Boolean(descriptor.optional),
            mmprojId: descriptor.mmprojId
        };
    }

    private emitProgress(event: Partial<ModelDownloadEvent>): void {
        const payload: ModelDownloadEvent = {
            state: event.state ?? 'downloading',
            message: event.message ?? null,
            percent: event.percent ?? null,
            assetId: event.assetId ?? null,
            statuses: event.statuses,
            logLine: event.logLine
        };
        this.emit('event', payload);
    }

    async addModel(descriptor: ModelAssetDescriptor): Promise<void> {
        this.descriptors.push(descriptor);
        // Save to models.config.json
        try {
            const data = await fs.readFile(this.modelsConfigPath, 'utf-8');
            const json = JSON.parse(data);
            if (!Array.isArray(json.models)) {
                json.models = [];
            }
            json.models.push(descriptor);
            await fs.writeFile(this.modelsConfigPath, JSON.stringify(json, null, 4));
        } catch (error) {
            console.error('Failed to save new model to config:', error);
        }
    }
}
