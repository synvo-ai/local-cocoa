import { ipcMain } from 'electron';
import { ModelManager } from '../modelManager';
import { updateSettings } from '../backendClient';
import { setDebugMode } from '../debug';

export function registerModelHandlers(modelManager: ModelManager) {
    ipcMain.handle('models:status', async () => modelManager.getStatus());
    ipcMain.handle('models:download', async () => modelManager.downloadMissing());
    ipcMain.handle('models:redownload', async (_event, assetId: string) => modelManager.redownloadAsset(assetId));
    ipcMain.handle('models:get-config', async () => modelManager.getConfig());

    ipcMain.handle('models:set-config', async (_event, config) => {
        const oldConfig = await modelManager.getConfig();
        await modelManager.setConfig(config);
        const newConfig = await modelManager.getConfig();

        // Update Python backend settings if relevant fields changed
        const settingsToUpdate: any = {};
        if (oldConfig.visionMaxPixels !== newConfig.visionMaxPixels) {
            settingsToUpdate.vision_max_pixels = newConfig.visionMaxPixels;
        }
        if (oldConfig.videoMaxPixels !== newConfig.videoMaxPixels) {
            settingsToUpdate.video_max_pixels = newConfig.videoMaxPixels;
        }
        if (oldConfig.searchResultLimit !== newConfig.searchResultLimit) {
            settingsToUpdate.search_result_limit = newConfig.searchResultLimit;
        }
        if (oldConfig.qaContextLimit !== newConfig.qaContextLimit) {
            settingsToUpdate.qa_context_limit = newConfig.qaContextLimit;
        }
        if (oldConfig.maxSnippetLength !== newConfig.maxSnippetLength) {
            settingsToUpdate.max_snippet_length = newConfig.maxSnippetLength;
        }
        if (oldConfig.summaryMaxTokens !== newConfig.summaryMaxTokens) {
            settingsToUpdate.summary_max_tokens = newConfig.summaryMaxTokens;
        }
        if (oldConfig.embedBatchSize !== newConfig.embedBatchSize) {
            settingsToUpdate.embed_batch_size = newConfig.embedBatchSize;
        }
        if (oldConfig.embedBatchDelayMs !== newConfig.embedBatchDelayMs) {
            settingsToUpdate.embed_batch_delay_ms = newConfig.embedBatchDelayMs;
        }
        if (oldConfig.visionBatchDelayMs !== newConfig.visionBatchDelayMs) {
            settingsToUpdate.vision_batch_delay_ms = newConfig.visionBatchDelayMs;
        }
        if (oldConfig.pdfOneChunkPerPage !== newConfig.pdfOneChunkPerPage) {
            settingsToUpdate.pdf_one_chunk_per_page = newConfig.pdfOneChunkPerPage;
        }

        // New fields for internal Python service management
        if (oldConfig.activeModelId !== newConfig.activeModelId) {
            settingsToUpdate.active_model_id = newConfig.activeModelId;
        }
        if (oldConfig.activeEmbeddingModelId !== newConfig.activeEmbeddingModelId) {
            settingsToUpdate.active_embedding_model_id = newConfig.activeEmbeddingModelId;
        }
        if (oldConfig.activeRerankerModelId !== newConfig.activeRerankerModelId) {
            settingsToUpdate.active_reranker_model_id = newConfig.activeRerankerModelId;
        }
        if (oldConfig.activeAudioModelId !== newConfig.activeAudioModelId) {
            settingsToUpdate.active_audio_model_id = newConfig.activeAudioModelId;
        }
        if (oldConfig.contextSize !== newConfig.contextSize) {
            settingsToUpdate.llm_context_tokens = newConfig.contextSize;
        }

        if (Object.keys(settingsToUpdate).length > 0) {
            try {
                // Python's settings router now handles restarting services if these fields change
                await updateSettings(settingsToUpdate);
            } catch (err) {
                console.error('Failed to update backend settings:', err);
            }
        }

        // Update debug mode if changed (takes effect immediately for new logs)
        if (oldConfig.debugMode !== newConfig.debugMode) {
            setDebugMode(newConfig.debugMode ?? false);
        }

        return newConfig;
    });

    ipcMain.handle('models:add', async (_event, descriptor) => {
        await modelManager.addModel(descriptor);
        return descriptor;
    });
}
