import { spawn, ChildProcess, execSync } from 'child_process';
import { config } from './config';
import { setSessionToken } from './backendClient';

export class PythonServer {
    private process: ChildProcess | null = null;
    private sessionToken: string | null = null;

    async start(envOverrides: Record<string, string> = {}): Promise<void> {
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
            console.error(`Port cleanup info: ${error.message}`);
        }

        try {
            // Use executable directly
            console.log(`Launch local cocoa server: ${config.paths.localCocoaServer}`);
            this.process = spawn(config.paths.localCocoaServer, [], {
                env: { ...process.env, ...envOverrides },
                stdio: ['ignore', 'pipe', 'pipe']
            });
            console.log(`Spawned PID: ${this.process?.pid}`);
        } catch (spawnError: any) {
            console.error(`ERROR: ${spawnError.message}`);
            throw spawnError;
        }

        this.process.stdout?.on('data', (data) => {
            const str = data.toString().trim();
            console.debug(`stdout: ${str}`);

            // Check for session token
            if (str.includes('SERVER_SESSION_TOKEN:')) {
                const match = str.match(/SERVER_SESSION_TOKEN:\s*(\S+)/);
                if (match && match[1]) {
                    this.sessionToken = match[1];
                    setSessionToken(this.sessionToken!);
                    console.info('Session token captured from stdout');
                }
            }
        });

        this.process.stderr?.on('data', (data) => {
            console.error(`stderr: ${data.toString().trim()}`);
        });

        this.process.on('error', (err) => {
            console.error(`ERROR: ${err.message}`);
            this.process = null;
        });

        this.process.on('close', (code) => {
            if (code !== 0) {
                console.error(`Exited with code ${code}`);
            }
            this.process = null;
        });

        // Wait for the backend to be ready (key captured)
        await this.waitForReady(port);
    }

    private async waitForReady(port: number, timeoutMs: number = 30000): Promise<void> {
        const startTime = Date.now();
        const checkInterval = 500;

        while (Date.now() - startTime < timeoutMs) {
            if (!this.process) {
                console.error('Backend exited unexpectedly');
                throw new Error('Backend process exited unexpectedly');
            }

            if (this.sessionToken) {
                try {
                    const response = await fetch(`${config.urls.backendApiBase}/health`, {
                        method: 'GET',
                        headers: {
                            'X-API-Key': this.sessionToken
                        },
                        signal: AbortSignal.timeout(2000)
                    });
                    if (response.ok || response.status === 403) {
                        console.log('Backend ready');
                        return;
                    }
                } catch {
                    // Server not ready yet
                }
            }

            await new Promise(resolve => setTimeout(resolve, checkInterval));
        }

        console.error('Timeout waiting for backend');
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
                console.error(`[PythonServer] Error stopping server: ${e.message}`);
            }
            this.process = null;
        }
    }
}
