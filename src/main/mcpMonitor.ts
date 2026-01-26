import { IncomingMessage, request } from 'http';
import { URL } from 'url';
import { WindowManager } from './windowManager';
import { getLocalKey } from './backendClient';

export function startMCPMonitor(windowManager: WindowManager) {
    const apiBase = process.env.LOCAL_RAG_API_URL || 'http://127.0.0.1:8890';
    const apiUrl = new URL('/api/events', apiBase);

    console.log(`[MCP Monitor] Initializing monitor connecting to ${apiUrl.toString()}`);

    const connect = () => {
        const token = getLocalKey();

        const req = request({
            hostname: apiUrl.hostname,
            port: apiUrl.port,
            path: apiUrl.pathname,
            method: 'GET',
            headers: {
                'Accept': 'text/event-stream',
                'X-API-Key': token || ''
            }
        }, (res: IncomingMessage) => {
            if (res.statusCode !== 200) {
                if (res.statusCode !== 404) { // Don't spam connection refused logs if 404
                    console.error(`[MCP Monitor] Failed to connect: ${res.statusCode}`);
                }
                res.resume();
                setTimeout(connect, 5000); // Retry
                return;
            }

            console.log('[MCP Monitor] Connected to event stream');

            let buffer = '';
            res.on('data', async (chunk) => {
                const text = chunk.toString();
                buffer += text;

                // Process complete lines
                // SSE events usually end with \n\n
                // Pattern:
                // event: type\n
                // data: ...\n\n

                const parts = buffer.split(/\n\n/);
                // The last part is either empty or incomplete
                buffer = parts.pop() || '';

                for (const part of parts) {
                    if (!part.trim()) continue;

                    const eventMatch = part.match(/event: (.+)/);
                    const dataMatch = part.match(/data: (.+)/);

                    if (eventMatch && dataMatch) {
                        const eventType = eventMatch[1].trim();
                        const dataStr = dataMatch[1].trim();

                        if (eventType === 'mcp:activity') {
                            try {
                                const data = JSON.parse(dataStr);

                                // Ensure window exists
                                const win = await windowManager.ensureMCPActivityWindow();

                                // Send data
                                win.webContents.send('mcp:activity', data);

                                // If status is processing, ensure window is visible
                                if (data.status === 'processing') {
                                    if (!win.isVisible()) {
                                        // showInactive prevents stealing focus from whatever app the user is in (e.g. Claude Desktop)
                                        win.showInactive();
                                    }
                                }
                            } catch (e) {
                                console.error('[MCP Monitor] Error parsing data:', e);
                            }
                        }
                    }
                }
            });

            res.on('end', () => {
                console.log('[MCP Monitor] Stream ended, reconnecting in 5s...');
                setTimeout(connect, 5000);
            });

            res.on('error', (err) => {
                console.error('[MCP Monitor] Stream error:', err);
            });
        });

        req.on('error', (e) => {
            setTimeout(connect, 5000);
        });

        req.end();
    };

    // Delay start slightly to allow backend to come up
    setTimeout(connect, 3000);
}
