import type { NoteSummary, NoteContent, NoteDraftPayload } from '../types';

const PLUGIN_ID = 'synvo_ai_notes';

export const notesAPI = {
    listNotes: (): Promise<NoteSummary[]> =>
        window.api.pluginInvoke(PLUGIN_ID, 'list'),

    createNote: (payload: NoteDraftPayload): Promise<NoteSummary> =>
        window.api.pluginInvoke(PLUGIN_ID, 'create', payload),

    getNote: (noteId: string): Promise<NoteContent> =>
        window.api.pluginInvoke(PLUGIN_ID, 'get', { noteId }),

    updateNote: (noteId: string, payload: NoteDraftPayload): Promise<NoteContent> =>
        window.api.pluginInvoke(PLUGIN_ID, 'update', { noteId, payload }),

    deleteNote: (noteId: string): Promise<{ id: string }> =>
        window.api.pluginInvoke(PLUGIN_ID, 'delete', { noteId })
};
