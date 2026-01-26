import { app, BrowserWindow, nativeImage } from 'electron';
import path from 'path';
import { loadEnvConfig, config } from './config';

// Set app name early for macOS menu bar and About panel
app.setName('Local Cocoa');

if (process.platform === 'darwin') {
    app.setAboutPanelOptions({
        applicationName: 'Local Cocoa',
        applicationVersion: app.getVersion(),
        version: app.getVersion(),
        copyright: '© 2025 Synvo AI'
    });
}

// Load environment variables first before loading other modules (works in both dev and prod)
loadEnvConfig();

import './logger'; // Initialize logger
import { initializeRuntime } from './runtimeMigration';
import { WindowManager } from './windowManager';
import { ModelManager } from './modelManager';
import { PythonServer } from './pythonServer';
import { ensureBackendSpawnsReady } from './backendClient';
import { TrayManager } from './trayManager';
import { setDebugMode, createDebugLogger } from './debug';
import { registerFileHandlers } from './ipc/files';
import { registerEmailHandlers } from './ipc/email';
import { registerNotesHandlers } from './ipc/notes';
import { registerChatHandlers } from './ipc/chat';
import { registerActivityHandlers } from './ipc/activity';
import { registerModelHandlers } from './ipc/models';
import { registerSystemHandlers } from './ipc/system';
import { registerScanHandlers } from './ipc/scan';
import { registerMemoryHandlers } from './ipc/memory';
import { registerMCPHandlers, initMCPServer } from './ipc/mcp';
import { initPluginManager } from './plugins';
import { startDirectMCPServer } from './mcpDirectServer';
import { ModelDownloadEvent } from './types';

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection:', reason);
});

const windowManager = new WindowManager();
const modelManager = new ModelManager(config.paths.modelRoot);
const pythonServer = new PythonServer();
let trayManager: TrayManager | null = null;

// Initialize plugin manager
const pluginManager = initPluginManager();

function broadcastModelEvent(event: ModelDownloadEvent) {
    windowManager.broadcast('models:progress', event);
}

modelManager.on('event', (event: ModelDownloadEvent) => {
    broadcastModelEvent(event);
    if (event.state === 'completed') {
        console.log('[Main] Model download completed. Ensuring backend spawns are started...');
        ensureBackendSpawnsReady().catch(console.error);
    }
});

async function startServices() {
    await modelManager.initializePromise;
    const modelConfig = await modelManager.getConfig();

    // Initialize debug mode from config
    setDebugMode(modelConfig.debugMode ?? false);

    const debugLog = createDebugLogger('Main');
    debugLog('startServices() called');
    debugLog(`app.isPackaged: ${app.isPackaged}, isDev: ${config.isDev}, debugMode: ${config.debugMode}`);

    // We pass the models.config.json path so Python can resolve model relative paths
    const modelsConfigPath = path.join(config.paths.projectRoot, 'config', 'models.config.json');

    await pythonServer.start({
        LOCAL_RUNTIME_ROOT: config.paths.runtimeRoot,
        LOCAL_MODEL_ROOT_PATH: config.paths.modelRoot,
        LOCAL_MODELS_CONFIG_PATH: modelsConfigPath,
        LOCAL_ACTIVE_MODEL_ID: modelConfig.activeModelId,
        LOCAL_ACTIVE_EMBEDDING_MODEL_ID: modelConfig.activeEmbeddingModelId,
        LOCAL_ACTIVE_RERANKER_MODEL_ID: modelConfig.activeRerankerModelId,
        LOCAL_ACTIVE_AUDIO_MODEL_ID: modelConfig.activeAudioModelId,
        LOCAL_SERVICE_LOG_TO_FILE: config.backend.logToFile ?? 'false'
    });

    try {
        // Start MCP Direct Server (port 5566)
        startDirectMCPServer(windowManager);

        await ensureBackendSpawnsReady();
    } catch (err) {
        console.error('Failed to ensure backend spawns are ready:', err);
    }
}

app.whenReady().then(async () => {
    if (process.platform === 'darwin' && app.dock) {
        const iconPath = path.join(config.paths.projectRoot, 'assets', 'icon.png');
        app.dock.setIcon(nativeImage.createFromPath(iconPath));
    }

    windowManager.createApplicationMenu();

    // Validate and migrate runtime before starting services
    try {
        const runtimeValidation = await initializeRuntime();
        if (!runtimeValidation.valid) {
            console.error('[Main] Runtime validation failed. Some features may not work correctly.');
            // Continue anyway - services will report their own errors if binaries are missing
        }
    } catch (error) {
        console.error('[Main] Runtime initialization error:', error);
    }

    // Start backend services FIRST, then create window
    // This ensures API key is available before frontend makes requests
    try {
        await startServices();
    } catch (error) {
        console.error('Failed to start services:', error);
    }

    windowManager.createMainWindow().catch((error) => {
        console.error('Failed to create window', error);
    });

    windowManager.registerSpotlightShortcut();
    windowManager.registerQuickNoteShortcut();

    // Initialize plugin system
    try {
        await pluginManager.initialize();
        pluginManager.registerIPCHandlers();

        // Set main window reference for plugin notifications
        if (windowManager.mainWindow) {
            pluginManager.setMainWindow(windowManager.mainWindow);
        }

        console.log('[Main] Plugin system initialized');
    } catch (error) {
        console.error('[Main] Failed to initialize plugin system:', error);
    }

    // Create system tray
    trayManager = new TrayManager(windowManager);
    trayManager.createTray();

    app.on('activate', () => {
        if (windowManager.mainWindow) {
            if (!windowManager.mainWindow.isVisible()) {
                windowManager.mainWindow.show();
            } else {
                windowManager.mainWindow.focus();
            }
            return;
        }
        if (BrowserWindow.getAllWindows().length === 0) {
            windowManager.createMainWindow().catch((error) => console.error('Failed to recreate window', error));
        }
    });
});

app.on('window-all-closed', () => {
    console.log('App window-all-closed');
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

let isQuitting = false;

app.on('before-quit', async (event) => {
    if (isQuitting) return;

    event.preventDefault();
    console.log('App before-quit: Stopping services...');

    try {
        // We only need to stop the Python server, which will clean up its subprocesses
        pythonServer.stop();
    } catch (error) {
        console.error('Error stopping services:', error);
    } finally {
        isQuitting = true;
        app.quit();
    }
});

// Register IPC Handlers
registerFileHandlers(windowManager);
registerEmailHandlers();
registerNotesHandlers();
registerChatHandlers();
registerActivityHandlers();
registerModelHandlers(modelManager);
registerSystemHandlers(windowManager);
registerScanHandlers();
registerMemoryHandlers();
registerMCPHandlers(windowManager);

// Initialize MCP server (for Claude Desktop integration)
initMCPServer();
