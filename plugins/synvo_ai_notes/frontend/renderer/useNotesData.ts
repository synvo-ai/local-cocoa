import { useState, useCallback } from 'react';
import type { NoteSummary, NoteContent } from '../types';
import { notesAPI } from './api';

export function useNotesData() {
    const [notes, setNotes] = useState<NoteSummary[]>([]);
    const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
    const [selectedNote, setSelectedNote] = useState<NoteContent | null>(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    const loadNotes = useCallback(async () => {
        setLoading(true);
        try {
            const notesList = await notesAPI.listNotes();
            setNotes(notesList);
        } catch (error) {
            console.error('[NotesPlugin] Failed to load notes:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    const handleSelectNote = useCallback(async (noteId: string) => {
        setSelectedNoteId(noteId);
        setLoading(true);
        try {
            const note = await notesAPI.getNote(noteId);
            setSelectedNote(note);
        } catch (error) {
            console.error('[NotesPlugin] Failed to load note:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    const handleCreateNote = useCallback(async () => {
        try {
            const now = new Date();
            const defaultTitle = `${now.toLocaleDateString()} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
            const newNote = await notesAPI.createNote({ title: defaultTitle, body: '' });
            await loadNotes();
            await handleSelectNote(newNote.id);
            (window.api as any)?.notifyNotesChanged?.();
        } catch (error) {
            console.error('[NotesPlugin] Failed to create note:', error);
        }
    }, [loadNotes, handleSelectNote]);

    const handleSaveNote = useCallback(async (noteId: string, payload: { title: string; body: string }) => {
        setSaving(true);
        try {
            const updated = await notesAPI.updateNote(noteId, payload);
            setSelectedNote(updated);
            await loadNotes();
            (window.api as any)?.notifyNotesChanged?.();
        } catch (error) {
            console.error('[NotesPlugin] Failed to save note:', error);
        } finally {
            setSaving(false);
        }
    }, [loadNotes]);

    const handleDeleteNote = useCallback(async (noteId: string) => {
        try {
            await notesAPI.deleteNote(noteId);
            setSelectedNoteId(null);
            setSelectedNote(null);
            await loadNotes();
            (window.api as any)?.notifyNotesChanged?.();
        } catch (error) {
            console.error('[NotesPlugin] Failed to delete note:', error);
        }
    }, [loadNotes]);

    const handleBackToNotesList = useCallback(() => {
        setSelectedNoteId(null);
        setSelectedNote(null);
        (window.api as any)?.notifyNotesChanged?.();
    }, []);

    return {
        notes,
        selectedNoteId,
        selectedNote,
        loading,
        saving,
        loadNotes,
        handleSelectNote,
        handleCreateNote,
        handleSaveNote,
        handleDeleteNote,
        handleBackToNotesList,
        setSelectedNoteId
    };
}
