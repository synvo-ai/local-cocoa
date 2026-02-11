/**
 * Notes Plugin - Main Process Entry Point
 * Registers IPC handlers for notes management functionality
 */

import { ipcMain } from 'electron';
import {
    listNotes,
    createNote,
    getNote,
    updateNote,
    deleteNote
} from './client';
import type { NoteDraftPayload } from './types';

const PLUGIN_ID = 'synvo_ai_notes';

export function registerHandlers() {
    ipcMain.handle(`plugin:${PLUGIN_ID}:list`, async () => listNotes());

    ipcMain.handle(`plugin:${PLUGIN_ID}:create`, async (_event, payload: NoteDraftPayload | undefined) => {
        return createNote(payload ?? {});
    });

    ipcMain.handle(`plugin:${PLUGIN_ID}:get`, async (_event, payload: { noteId: string }) => {
        const noteId = payload?.noteId;
        if (!noteId) {
            throw new Error('Missing note id.');
        }
        return getNote(noteId);
    });

    ipcMain.handle(`plugin:${PLUGIN_ID}:update`, async (_event, payload: { noteId: string; payload?: NoteDraftPayload }) => {
        const noteId = payload?.noteId;
        if (!noteId) {
            throw new Error('Missing note id.');
        }
        return updateNote(noteId, payload?.payload ?? {});
    });

    ipcMain.handle(`plugin:${PLUGIN_ID}:delete`, async (_event, payload: { noteId: string }) => {
        const noteId = payload?.noteId;
        if (!noteId) {
            throw new Error('Missing note id.');
        }
        await deleteNote(noteId);
        return { id: noteId };
    });

    console.log(`[Notes Plugin] IPC handlers registered with prefix plugin:${PLUGIN_ID}:`);
}

export function onStartup() {
    console.log('[Notes Plugin] onStartup');
}

export function onStop() {
    console.log('[Notes Plugin] onStop');
}
