/**
 * Notes Plugin Backend Client
 * Handles all notes-related API calls to the backend
 * Moved from src/main/backendClient.ts for plugin modularity
 */

import { requestJson } from '@/main/backendClient';
import type {
    NoteSummary,
    NoteContent,
    NoteDraftPayload,
} from '../types';

import { API_PREFIX } from '../config';

const NOTES_PLUGIN_PREFIX = API_PREFIX;

// ==================== Mapper Functions ====================

function mapNoteSummary(payload: any): NoteSummary {
    return {
        id: String(payload.id ?? ''),
        title: payload.title ?? 'Untitled note',
        updatedAt: payload.updated_at ?? payload.updatedAt ?? new Date().toISOString(),
        preview: payload.preview ?? null
    };
}

function mapNoteContent(payload: any): NoteContent {
    return {
        id: String(payload.id ?? ''),
        title: payload.title ?? 'Untitled note',
        markdown: payload.markdown ?? '',
        createdAt: payload.created_at ?? payload.createdAt ?? new Date().toISOString(),
        updatedAt: payload.updated_at ?? payload.updatedAt ?? new Date().toISOString(),
        preview: payload.preview ?? null
    };
}

// ==================== Notes Functions ====================

export async function listNotes(): Promise<NoteSummary[]> {
    const data = await requestJson<any[]>(`${NOTES_PLUGIN_PREFIX}`, { method: 'GET' });
    const payload = Array.isArray(data) ? data : [];
    return payload.map(mapNoteSummary);
}

export async function createNote(payload: NoteDraftPayload): Promise<NoteSummary> {
    const body = {
        title: payload.title ?? null,
        body: payload.body ?? null
    };
    const data = await requestJson(`${NOTES_PLUGIN_PREFIX}`, {
        method: 'POST',
        body: JSON.stringify(body)
    });
    return mapNoteSummary(data);
}

export async function getNote(noteId: string): Promise<NoteContent> {
    const data = await requestJson(`${NOTES_PLUGIN_PREFIX}/${encodeURIComponent(noteId)}`, { method: 'GET' });
    return mapNoteContent(data);
}

export async function updateNote(noteId: string, payload: NoteDraftPayload): Promise<NoteContent> {
    const body = {
        title: payload.title ?? null,
        body: payload.body ?? null
    };
    const data = await requestJson(`${NOTES_PLUGIN_PREFIX}/${encodeURIComponent(noteId)}`, {
        method: 'PUT',
        body: JSON.stringify(body)
    });
    return mapNoteContent(data);
}

export async function deleteNote(noteId: string): Promise<void> {
    await requestJson(`${NOTES_PLUGIN_PREFIX}/${encodeURIComponent(noteId)}`, { method: 'DELETE' });
}
