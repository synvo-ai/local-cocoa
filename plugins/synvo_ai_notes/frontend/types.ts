/**
 * Notes Plugin Types
 * Sources: plugins/notes/frontend/types/index.ts
 */

export interface NoteSummary {
    id: string;
    title: string;
    updatedAt: string;
    preview?: string | null;
}

export interface NoteContent extends NoteSummary {
    markdown: string;
    createdAt: string;
}

export interface NoteDraftPayload {
    title?: string | null;
    body?: string | null;
}
