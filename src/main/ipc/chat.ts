import { ipcMain } from 'electron';
import {
    askWorkspace,
    askWorkspaceStream,
    askAgentStream,
    confirmAgentTool,
    confirmAgentToolWithOverrides,
    cancelAgentTool,
    listEmailAccounts,
    listChatSessions,
    createChatSession,
    getChatSession,
    deleteChatSession,
    updateChatSession,
    addChatMessage,
    updateChatMessage,
} from '../backendClient';

export function registerChatHandlers() {
    ipcMain.handle('qa:ask', async (_event, payload: { query: string; limit?: number; mode?: 'qa' | 'chat'; searchMode?: 'auto' | 'knowledge' | 'direct' | 'agent' }) => {
        if (!payload?.query) {
            throw new Error('Missing question text.');
        }
        const sm = payload.searchMode === 'agent' ? 'auto' : payload.searchMode;
        return askWorkspace(payload.query, payload.limit, payload.mode, sm);
    });

    ipcMain.on('qa:ask-stream', (event, payload: { query: string; limit?: number; mode?: 'qa' | 'chat'; searchMode?: 'auto' | 'knowledge' | 'direct' | 'agent'; resumeToken?: string; useVisionForAnswer?: boolean; conversationHistory?: any[] }) => {
        console.log('[IPC chat.ts] qa:ask-stream received useVisionForAnswer:', payload.useVisionForAnswer, 'searchMode:', payload.searchMode);
        if (!payload?.query) {
            event.sender.send('qa:stream-error', 'Missing question text.');
            return;
        }

        // Route to agent stream when searchMode is 'agent'
        const onData = (chunk: string) => {
            if (!event.sender.isDestroyed()) {
                event.sender.send('qa:stream-data', chunk);
            }
        };
        const onError = (error: Error) => {
            if (!event.sender.isDestroyed()) {
                event.sender.send('qa:stream-error', error.message);
            }
        };
        const onDone = () => {
            if (!event.sender.isDestroyed()) {
                event.sender.send('qa:stream-done');
            }
        };

        const streamPromise = payload.searchMode === 'agent'
            ? askAgentStream(payload.query, payload.limit, payload.mode, onData, onError, onDone, payload.searchMode, payload.resumeToken, payload.useVisionForAnswer, payload.conversationHistory)
            : askWorkspaceStream(payload.query, payload.limit, payload.mode, onData, onError, onDone, payload.searchMode, payload.resumeToken, payload.useVisionForAnswer);

        streamPromise.catch((err) => {
            if (!event.sender.isDestroyed()) {
                event.sender.send('qa:stream-error', String(err));
            }
        });
    });

    ipcMain.handle('chat:list', async (_event, payload: { limit?: number; offset?: number }) => {
        return listChatSessions(payload?.limit, payload?.offset);
    });

    ipcMain.handle('chat:create', async (_event, payload: { title?: string }) => {
        return createChatSession(payload?.title);
    });

    ipcMain.handle('chat:get', async (_event, payload: { sessionId: string }) => {
        if (!payload?.sessionId) throw new Error('Missing session id');
        return getChatSession(payload.sessionId);
    });

    ipcMain.handle('chat:delete', async (_event, payload: { sessionId: string }) => {
        if (!payload?.sessionId) throw new Error('Missing session id');
        await deleteChatSession(payload.sessionId);
        return { id: payload.sessionId };
    });

    ipcMain.handle('chat:update', async (_event, payload: { sessionId: string; title: string }) => {
        if (!payload?.sessionId) throw new Error('Missing session id');
        return updateChatSession(payload.sessionId, payload.title);
    });

    ipcMain.handle('chat:add-message', async (_event, payload: { sessionId: string; message: any }) => {
        if (!payload?.sessionId) throw new Error('Missing session id');
        return addChatMessage(payload.sessionId, payload.message);
    });

    ipcMain.handle('chat:update-message', async (_event, payload: { sessionId: string; messageId: string; message: any }) => {
        if (!payload?.sessionId) throw new Error('Missing session id');
        if (!payload?.messageId) throw new Error('Missing message id');
        return updateChatMessage(payload.sessionId, payload.messageId, payload.message);
    });

    ipcMain.handle('agent:confirm-tool', async (_event, payload: { confirmationId: string; overrides?: Record<string, unknown> }) => {
        if (!payload?.confirmationId) throw new Error('Missing confirmation id');
        return payload.overrides
            ? confirmAgentToolWithOverrides(payload.confirmationId, payload.overrides)
            : confirmAgentTool(payload.confirmationId);
    });

    ipcMain.handle('agent:cancel-tool', async (_event, payload: { confirmationId: string }) => {
        if (!payload?.confirmationId) throw new Error('Missing confirmation id');
        return cancelAgentTool(payload.confirmationId);
    });

    ipcMain.handle('agent:list-email-accounts', async () => {
        return listEmailAccounts();
    });
}
