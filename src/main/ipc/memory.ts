import { ipcMain } from 'electron';
import {
    getMemorySummary,
    getMemoryEpisodes,
    getMemoryEventLogs,
    getMemoryForesights,
    getMemoryMemcells,
    getMemcellDetail,
    getMemcellsByFile,
    getBasicProfile,
    getCachedBasicProfile,
    streamBasicProfile
} from '../backendClient';

export function registerMemoryHandlers() {
    ipcMain.handle('memory:summary', async (_event, payload: { userId: string }) => {
        if (!payload?.userId) {
            throw new Error('Missing user id.');
        }
        return getMemorySummary(payload.userId);
    });

    ipcMain.handle('memory:episodes', async (_event, payload: { userId: string; limit?: number; offset?: number }) => {
        if (!payload?.userId) {
            throw new Error('Missing user id.');
        }
        return getMemoryEpisodes(payload.userId, payload.limit ?? 50, payload.offset ?? 0);
    });

    ipcMain.handle('memory:events', async (_event, payload: { userId: string; limit?: number; offset?: number }) => {
        if (!payload?.userId) {
            throw new Error('Missing user id.');
        }
        return getMemoryEventLogs(payload.userId, payload.limit ?? 100, payload.offset ?? 0);
    });

    ipcMain.handle('memory:foresights', async (_event, payload: { userId: string; limit?: number }) => {
        if (!payload?.userId) {
            throw new Error('Missing user id.');
        }
        return getMemoryForesights(payload.userId, payload.limit ?? 50);
    });

    ipcMain.handle('memory:memcells', async (_event, payload: { userId: string; limit?: number; offset?: number }) => {
        if (!payload?.userId) {
            throw new Error('Missing user id.');
        }
        return getMemoryMemcells(payload.userId, payload.limit ?? 50, payload.offset ?? 0);
    });

    ipcMain.handle('memory:memcell-detail', async (_event, payload: { memcellId: string }) => {
        if (!payload?.memcellId) {
            throw new Error('Missing memcell id.');
        }
        return getMemcellDetail(payload.memcellId);
    });

    ipcMain.handle('memory:memcells-by-file', async (_event, payload: { fileId: string; limit?: number }) => {
        if (!payload?.fileId) {
            throw new Error('Missing file id.');
        }
        return getMemcellsByFile(payload.fileId, payload.limit ?? 100);
    });

    ipcMain.handle('memory:basic-profile', async (_event, payload: { userId: string }) => {
        if (!payload?.userId) {
            throw new Error('Missing user id.');
        }
        return getBasicProfile(payload.userId);
    });

    // Get cached basic profile (without regenerating)
    ipcMain.handle('memory:basic-profile-cached', async (_event, payload: { userId: string }) => {
        if (!payload?.userId) {
            throw new Error('Missing user id.');
        }
        return getCachedBasicProfile(payload.userId);
    });

    // Streaming basic profile generation
    // Client starts stream with 'memory:basic-profile-stream-start'
    // Server sends events via 'memory:basic-profile-stream-event'
    // Stream ends with 'memory:basic-profile-stream-end'
    ipcMain.on('memory:basic-profile-stream-start', async (event, payload: { userId: string }) => {
        if (!payload?.userId) {
            event.sender.send('memory:basic-profile-stream-event', {
                type: 'error',
                data: { error: 'Missing user id.' }
            });
            event.sender.send('memory:basic-profile-stream-end');
            return;
        }

        try {
            // Stream events from backend
            await streamBasicProfile(payload.userId, (eventData) => {
                event.sender.send('memory:basic-profile-stream-event', eventData);
            });
            event.sender.send('memory:basic-profile-stream-end');
        } catch (error) {
            event.sender.send('memory:basic-profile-stream-event', {
                type: 'error',
                data: { error: String(error) }
            });
            event.sender.send('memory:basic-profile-stream-end');
        }
    });

    // Cancel ongoing stream
    ipcMain.on('memory:basic-profile-stream-cancel', () => {
        // TODO: Implement cancellation if needed
    });
}
