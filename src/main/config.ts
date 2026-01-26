import path from 'path';
import { app } from 'electron';
import dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';
import pkgJson from '../../package.json';

const isDev = !app.isPackaged && process.env.NODE_ENV !== 'prod';
const projectRoot = path.resolve(__dirname, '../..');

// Rumtime Root directory, all dynamic data and files are stored here
// In dev mode, for easy access 
//    <project root>/runtime/
// In production, use Electron's userData path
//    Mac:  ~/Library/Application Support/Local Cocoa/
//    Win:  c:/Users/<user name>/AppData/Roaming/Local Cocoa/
const runtimeRoot = isDev ? path.join(projectRoot, 'runtime') : app.getPath('userData');

// Resource root directory, all static (read-only) data files are stored here. These files are created in compile phase and installed here
const resourceRoot = isDev ? projectRoot : process.resourcesPath;

const pkg = pkgJson as { name?: string; version?: string };
process.env.APP_NAME = pkg.name ?? '';
process.env.APP_VERSION = pkg.version ?? '';

const backendResourceRoot = isDev ? runtimeRoot : resourceRoot;

/**
 * Load environment variables based on the current mode
 * This should be called as early as possible in the application lifecycle
 */
export function loadEnvConfig() {
    // Determine mode and config directory
    const mode = isDev ? 'dev' : 'prod';

    const configDir = path.join(projectRoot, 'config');

    console.log(`[Env] Loading environment for mode: ${mode}`);
    console.log(`[Env] Config directory: ${configDir}`);

    // Load .env configuration
    dotenvExpand.expand(dotenv.config({ path: path.join(configDir, `.env`) }));
    dotenvExpand.expand(dotenv.config({ path: path.join(configDir, `.env.${mode}`) }));
}

export const config = {
    isDev,
    get devServerUrl() { return process.env.VITE_DEV_SERVER_URL ?? ''; },
    get ports() {
        return {
            backend: parseInt(process.env.LOCAL_RAG_PORT ?? '8890'),
            vlm: 8007,
            embedding: 8005,
            reranker: 8006,
            whisper: 8080,
            mcpDirect: 5566, // Direct HTTP server for MCP activity notifications
        };
    },
    get urls() {
        return {
            backend: process.env.LOCAL_RAG_API_URL,
        };
    },
    paths: {
        projectRoot,
        resourceRoot,
        runtimeRoot,
        backendResourceRoot,
        modelRoot: path.join(runtimeRoot, 'local-cocoa-models', 'pretrained'),
        electronLogPath: process.env.LOCAL_ELECTRON_LOG_PATH ? path.join(runtimeRoot, process.env.LOCAL_ELECTRON_LOG_PATH) : '',
        llamaServer: path.join(backendResourceRoot, 'llama-cpp', 'bin', `llama-server${process.platform === 'win32' ? '.exe' : ''}`),
        whisperServer: path.join(backendResourceRoot, 'whisper-cpp', 'bin', `whisper-server${process.platform === 'win32' ? '.exe' : ''}`),
        // Always use compiled preload.js (ts-node in preload context causes issues)
        preload: path.join(projectRoot, 'dist-electron', 'preload', 'preload.js'),
        dist: path.join(__dirname, 'dist-electron', 'renderer'),
    },
    windows: {
        main: {
            width: 1280,
            height: 820,
            backgroundColor: '#0f172a',
        },
        spotlight: {
            width: 760,
            height: 520,
        },
        quickNote: {
            width: 480,
            height: 360,
            backgroundColor: '#1e293b',
        }
    },
    // Expose app info
    appInfo: {
        name: pkg.name,
        version: pkg.version
    },
    // additional config for engineering
    get debugMode() {
        return process.env.DEBUG?.toLowerCase() === 'true';
    },
    get backend() {
        return {
            launchPythonServer: process.env.LOCAL_SERVICE_LAUNCH_PYTHON_SERVER?.toLowerCase() === 'true',
            logToFile: process.env.LOCAL_SERVICE_LOG_TO_FILE,
        }
    }
};
