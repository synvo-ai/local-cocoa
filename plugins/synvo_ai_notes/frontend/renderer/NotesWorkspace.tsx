import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { StickyNote, Plus, Trash2, RefreshCw, Database, Save, Edit, Eye, Search, Calendar, Clock, FileText } from 'lucide-react';
import { cn } from '@/renderer/lib/utils';
import type { IndexingItem } from '@/renderer/types';
import type { NoteContent, NoteSummary } from '../types';

interface NotesWorkspaceProps {
    notes: NoteSummary[];
    selectedNoteId: string | null;
    selectedNote: NoteContent | null;
    loading: boolean;
    saving: boolean;
    onSelectNote: (noteId: string) => void;
    onCreateNote: () => void;
    onDeleteNote: (noteId: string) => void;
    onSaveNote: (noteId: string, payload: { title: string; body: string }) => void;
    pendingItems?: IndexingItem[];
    onRescanIndex?: () => void;
    onReindexIndex?: () => void;
    indexingBusy?: boolean;
}

type NotesMode = 'preview' | 'edit';

export function NotesWorkspace({
    notes,
    selectedNoteId,
    selectedNote,
    loading,
    saving,
    onSelectNote,
    onCreateNote,
    onDeleteNote,
    onSaveNote,
    pendingItems = [],
    onRescanIndex,
    onReindexIndex,
    indexingBusy
}: NotesWorkspaceProps) {
    const [mode, setMode] = useState<NotesMode>('preview');
    const [localTitle, setLocalTitle] = useState('');
    const [localBody, setLocalBody] = useState('');
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        if (!selectedNote) {
            setLocalTitle('');
            setLocalBody('');
            setMode('preview');
            return;
        }
        setLocalTitle(selectedNote.title);
        setLocalBody(selectedNote.markdown);
        setMode('preview');
    }, [selectedNote]);

    const selectedSummary = useMemo(() => notes.find((note) => note.id === selectedNoteId) ?? null, [notes, selectedNoteId]);

    const filteredNotes = useMemo(() => {
        if (!searchQuery.trim()) return notes;
        const query = searchQuery.toLowerCase();
        return notes.filter(note =>
            (note.title || '').toLowerCase().includes(query) ||
            (note.preview || '').toLowerCase().includes(query)
        );
    }, [notes, searchQuery]);

    const handleToggleMode = () => {
        if (!selectedNoteId) return;
        setMode((prev) => (prev === 'preview' ? 'edit' : 'preview'));
    };

    const handleSave = () => {
        if (!selectedNoteId) return;
        onSaveNote(selectedNoteId, { title: localTitle, body: localBody });
    };

    const renderPreviewSnippet = (preview?: string | null) => {
        if (!preview) return 'No preview available yet.';
        const lines = preview.split('\n').filter(Boolean).slice(0, 2);
        return lines.join(' ');
    };

    return (
        <div className="flex h-full max-w-5xl mx-auto gap-6 min-h-0">
            {/* Sidebar */}
            <div className="w-80 flex flex-col gap-4 shrink-0 min-h-0">
                <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold tracking-tight flex items-center gap-2">
                        <StickyNote className="h-5 w-5" />
                        Notes
                    </h2>
                    <button
                        onClick={onCreateNote}
                        className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors"
                    >
                        <Plus className="mr-1.5 h-4 w-4" />
                        New Note
                    </button>
                </div>

                <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <input
                        type="text"
                        placeholder="Search notes..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full rounded-md border bg-background pl-9 pr-4 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                    />
                </div>

                <div className="flex-1 overflow-y-auto rounded-lg border bg-card min-h-0">
                    {filteredNotes.length > 0 ? (
                        <div className="divide-y">
                            {filteredNotes.map((note) => {
                                const isActive = note.id === selectedNoteId;
                                return (
                                    <button
                                        key={note.id}
                                        onClick={() => onSelectNote(note.id)}
                                        className={cn(
                                            "w-full text-left p-4 transition-colors hover:bg-accent/50",
                                            isActive && "bg-accent text-accent-foreground"
                                        )}
                                    >
                                        <div className="flex flex-col gap-1.5">
                                            <span className={cn("font-medium truncate", !note.title && "text-muted-foreground italic")}>
                                                {note.title || 'Untitled Note'}
                                            </span>
                                            <p className="text-xs text-muted-foreground line-clamp-2 h-8">
                                                {renderPreviewSnippet(note.preview)}
                                            </p>
                                            <div className="flex items-center gap-2 text-[10px] text-muted-foreground/70 pt-1">
                                                <Calendar className="h-3 w-3" />
                                                {new Date(note.updatedAt).toLocaleDateString()}
                                            </div>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full p-8 text-center text-muted-foreground">
                            <FileText className="h-10 w-10 mb-3 opacity-20" />
                            <p className="text-sm">No notes found</p>
                        </div>
                    )}
                </div>

                {(onRescanIndex || onReindexIndex) && (
                    <div className="flex gap-2 pt-2">
                        {onRescanIndex && (
                            <button
                                onClick={onRescanIndex}
                                disabled={Boolean(indexingBusy)}
                                className="flex-1 inline-flex items-center justify-center rounded-md border bg-background px-3 py-2 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
                            >
                                <RefreshCw className={cn("mr-2 h-3.5 w-3.5", indexingBusy && "animate-spin")} />
                                Rescan
                            </button>
                        )}
                        {onReindexIndex && (
                            <button
                                onClick={onReindexIndex}
                                disabled={Boolean(indexingBusy)}
                                className="flex-1 inline-flex items-center justify-center rounded-md border bg-background px-3 py-2 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
                            >
                                <Database className="mr-2 h-3.5 w-3.5" />
                                Reindex
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col gap-4 min-w-0 min-h-0">
                {selectedNoteId ? (
                    <>
                        <div className="flex items-center justify-between bg-card border rounded-lg p-2 shadow-sm">
                            <div className="flex-1 px-2">
                                <input
                                    type="text"
                                    value={localTitle}
                                    onChange={(e) => setLocalTitle(e.target.value)}
                                    placeholder="Note Title"
                                    className="w-full bg-transparent text-lg font-semibold outline-none placeholder:text-muted-foreground/50"
                                />
                            </div>
                            <div className="flex items-center gap-1 border-l pl-2 ml-2">
                                <button
                                    onClick={handleToggleMode}
                                    className="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                                    title={mode === 'preview' ? "Edit" : "Preview"}
                                >
                                    {mode === 'preview' ? <Edit className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                </button>
                                <button
                                    onClick={handleSave}
                                    disabled={saving}
                                    className={cn(
                                        "inline-flex items-center justify-center rounded-md p-2 transition-colors",
                                        saving ? "text-muted-foreground" : "text-primary hover:bg-primary/10"
                                    )}
                                    title="Save"
                                >
                                    {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                </button>
                                <div className="w-px h-4 bg-border mx-1" />
                                <button
                                    onClick={() => onDeleteNote(selectedNoteId)}
                                    className="inline-flex items-center justify-center rounded-md p-2 text-destructive hover:bg-destructive/10 transition-colors"
                                    title="Delete"
                                >
                                    <Trash2 className="h-4 w-4" />
                                </button>
                            </div>
                        </div>

                        <div className="flex-1 rounded-lg border bg-card shadow-sm overflow-hidden relative min-h-0">
                            {loading ? (
                                <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-sm">
                                    <RefreshCw className="h-8 w-8 animate-spin text-primary" />
                                </div>
                            ) : null}

                            {mode === 'edit' ? (
                                <textarea
                                    value={localBody}
                                    onChange={(e) => setLocalBody(e.target.value)}
                                    className="w-full h-full resize-none bg-transparent p-6 text-sm outline-none font-mono leading-relaxed overflow-y-auto"
                                    placeholder="Start writing..."
                                />
                            ) : (
                                <div className="h-full overflow-y-auto p-8 prose prose-sm dark:prose-invert max-w-none">
                                    {localBody.trim() ? (
                                        <ReactMarkdown>{localBody}</ReactMarkdown>
                                    ) : (
                                        <div className="flex flex-col items-center justify-center h-full text-muted-foreground opacity-50">
                                            <p>Empty note</p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
                            <div className="flex items-center gap-4">
                                <span className="flex items-center gap-1.5">
                                    <Clock className="h-3.5 w-3.5" />
                                    Created {selectedNote?.createdAt ? new Date(selectedNote.createdAt).toLocaleString() : '—'}
                                </span>
                                <span className="flex items-center gap-1.5">
                                    <Edit className="h-3.5 w-3.5" />
                                    Updated {selectedSummary?.updatedAt ? new Date(selectedSummary.updatedAt).toLocaleString() : '—'}
                                </span>
                            </div>
                            {pendingItems.length > 0 && (
                                <div className="flex items-center gap-2 text-primary">
                                    <RefreshCw className="h-3 w-3 animate-spin" />
                                    <span>Indexing {pendingItems.length} items...</span>
                                </div>
                            )}
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center rounded-lg border border-dashed bg-muted/30 text-muted-foreground">
                        <StickyNote className="h-16 w-16 mb-4 opacity-20" />
                        <h3 className="text-lg font-medium text-foreground">No Note Selected</h3>
                        <p className="text-sm mt-1">Select a note from the sidebar or create a new one.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
