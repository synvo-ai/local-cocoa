import { spawn, ChildProcess, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { config } from './config';
import { createDebugLogger } from './debug';
import { setSessionToken } from './backendClient';

export class PythonServer {
    private process: ChildProcess | null = null;
    private executablePath: string;
    private sessionToken: string | null = null;

    constructor() {
        // On Windows it's .exe, on macOS/Linux no extension
        const exeName = `local-cocoa-server${process.platform === 'win32' ? '.exe' : ''}`;

        // look for the local cocoa service executable bundle
        this.executablePath = path.join(config.paths.backendResourceRoot, 'local-cocoa-server', exeName)
    }

    async start(envOverrides: Record<string, string> = {}): Promise<void> {
        const debugLog = createDebugLogger('PythonServer');

        // Only start Python server if LOCAL_SERVICE_LAUNCH_PYTHON_SERVER is set
        // Useful when debugging backend separately via VS Code
        if (!config.backend.launchPythonServer) {
            console.log('[Backend] Skipping Python server start (LOCAL_SERVICE_LAUNCH_PYTHON_SERVER=false)');
            return;
        }

        if (this.process) {
            console.log('[Backend] Python server already running');
            return;
        }

        const port = config.ports.backend;

        // Kill any existing process on the backend port
        try {
            if (process.platform === 'win32') {
                // Use netstat without findstr and filter in JS, to avoid findstr returning exit code 1 when no matches found
                const output = execSync('netstat -ano').toString();
                const lines = output.split('\n');
                for (const line of lines) {
                    const parts = line.trim().split(/\s+/);
                    if (parts.length >= 4 && parts[1].endsWith(`:${port}`)) {
                        const pid = parts[parts.length - 1];
                        if (pid && pid !== '0' && !isNaN(Number(pid))) {
                            execSync(`taskkill /F /PID ${pid}`);
                        }
                    }
                }
            } else {
                const pid = execSync(`lsof -t -i:${port}`).toString().trim();
                if (pid) {
                    execSync(`kill -9 ${pid}`);
                }
            }
        } catch (error: any) {
            // General error handling (e.g. command not found)
            debugLog(`Port cleanup info: ${error.message}`);
        }

        // Ensure logs directory exists
        if (!fs.existsSync(path.dirname(config.paths.electronLogPath))) {
            fs.mkdirSync(path.dirname(config.paths.electronLogPath), { recursive: true });
        }
        const env = {
            ...process.env,
            ...envOverrides,
        };

        try {
            // Use executable directly
            debugLog(`Using executable: ${this.executablePath}`);
            this.process = spawn(this.executablePath, [], {
                env,
                stdio: ['ignore', 'pipe', 'pipe']
            });
            debugLog(`Spawned PID: ${this.process?.pid}`);
        } catch (spawnError: any) {
            debugLog(`ERROR: ${spawnError.message}`);
            throw spawnError;
        }

        this.process.stdout?.on('data', (data) => {
            const str = data.toString().trim();
            debugLog(`stdout: ${str}`);

            // Check for session token
            if (str.includes('SERVER_SESSION_TOKEN:')) {
                const match = str.match(/SERVER_SESSION_TOKEN:\s*(\S+)/);
                if (match && match[1]) {
                    this.sessionToken = match[1];
                    setSessionToken(this.sessionToken!);
                    debugLog('Session token captured from stdout');
                }
            }
        });

        this.process.stderr?.on('data', (data) => {
            debugLog(`stderr: ${data.toString().trim()}`);
        });

        this.process.on('error', (err) => {
            debugLog(`ERROR: ${err.message}`);
            this.process = null;
        });

        this.process.on('close', (code) => {
            if (code !== 0) {
                debugLog(`Exited with code ${code}`);
            }
            this.process = null;
        });

        // Wait for the backend to be ready (key captured)
        await this.waitForReady(port, debugLog);
    }

    private async waitForReady(port: number, debugLog: (msg: string) => void, timeoutMs: number = 30000): Promise<void> {
        const startTime = Date.now();
        const checkInterval = 500;

        while (Date.now() - startTime < timeoutMs) {
            if (!this.process) {
                debugLog('Backend exited unexpectedly');
                throw new Error('Backend process exited unexpectedly');
            }

            if (this.sessionToken) {
                try {
                    const response = await fetch(`${config.urls.backend}/health`, {
                        method: 'GET',
                        headers: {
                            'X-API-Key': this.sessionToken
                        },
                        signal: AbortSignal.timeout(2000)
                    });
                    if (response.ok || response.status === 403) {
                        debugLog('Backend ready');
                        return;
                    }
                } catch {
                    // Server not ready yet
                }
            }

            await new Promise(resolve => setTimeout(resolve, checkInterval));
        }

        debugLog('Timeout waiting for backend');
    }

    stop() {
        if (this.process) {
            console.log('Stopping Python server...');
            try {
                if (process.platform === 'win32') {
                    // On Windows, we might need to kill the process tree
                    execSync(`taskkill /pid ${this.process.pid} /T /F`);
                } else {
                    this.process.kill('SIGKILL');
                }
            } catch (e: any) {
                // Ignore errors if process is already dead
                console.log(`[PythonServer] Error stopping server: ${e.message}`);
            }
            this.process = null;
        }
    }
}
