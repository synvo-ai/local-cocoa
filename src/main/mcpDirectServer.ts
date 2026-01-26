import http from 'http';
import { WindowManager } from './windowManager';
import { config } from './config';

export function startDirectMCPServer(windowManager: WindowManager) {
    const server = http.createServer(async (req, res) => {
        // Only accept POST /mcp/activity
        if (req.method === 'POST' && req.url === '/mcp/activity') {
            let body = '';

            req.on('data', chunk => {
                body += chunk.toString();
            });

            req.on('end', async () => {
                try {
                    const data = JSON.parse(body);

                    // 1. Send 200 OK immediately
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 'ok' }));

                    // 2. Trigger Window
                    try {
                        const win = await windowManager.ensureMCPActivityWindow();

                        // Wait for webContents to be ready if still loading
                        if (win.webContents.isLoading()) {
                            await new Promise<void>((resolve) => {
                                win.webContents.once('did-finish-load', resolve);
                                // Timeout after 2s
                                setTimeout(resolve, 2000);
                            });
                        }

                        // Send data to Renderer FIRST (before showing window)
                        win.webContents.send('mcp:activity', data);

                        // Show window if processing has started (always show, don't check visibility)
                        if (data.status === 'processing' || data.status === 'completed') {
                            win.showInactive();
                        }

                    } catch (err) {
                        console.error('[DirectMCP] Error handling window:', err);
                    }
                } catch (e) {
                    console.error('[DirectMCP] Invalid JSON:', e);
                    res.writeHead(400);
                    res.end('Invalid JSON');
                }
            });
        } else {
            // Health check or other
            if (req.url === '/health') {
                res.writeHead(200);
                res.end('OK');
                return;
            }
            res.writeHead(404);
            res.end('Not Found');
        }
    });

    server.on('error', (err) => {
        console.error('[DirectMCP] Server error:', err);
    });

    server.listen(config.ports.mcpDirect, '127.0.0.1', () => {
        console.log(`[DirectMCP] MCP Direct Server listening on http://127.0.0.1:${config.ports.mcpDirect}`);
    });

    return server;
}
