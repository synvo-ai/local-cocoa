import { useMemo, useState } from 'react';
import type { AgentContext } from './ConversationPanel';
import { ConversationPanel } from './ConversationPanel';
import type { IndexedFile, SearchHit, ChatSession, ConversationMessage } from '../types';

interface AiWorkspaceProps {
    messages: ConversationMessage[];
    loading: boolean;
    onSend: (text: string) => Promise<void>;
    model: string;
    onReferenceOpen?: (reference: SearchHit) => void;
    className?: string;
    agentContext?: AgentContext | null;
    onResetConversation?: () => void;
    sessions?: ChatSession[];
    currentSessionId?: string | null;
    onSelectSession?: (id: string) => void;
    onCreateSession?: () => void;
    onDeleteSession?: (id: string) => void;
}

function inferKind(extension: string): IndexedFile['kind'] {
    const ext = extension.toLowerCase();

    if (['pdf', 'doc', 'docx', 'txt', 'md', 'rtf'].includes(ext)) return 'document';
    if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'bmp', 'webp'].includes(ext)) return 'image';
    if (['ppt', 'pptx', 'key'].includes(ext)) return 'presentation';
    if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return 'spreadsheet';
    if (['mp3', 'wav', 'aac', 'flac'].includes(ext)) return 'audio';
    if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) return 'video';
    if (['zip', 'rar', 'tar', 'gz', '7z'].includes(ext)) return 'archive';
    return 'other';
}

function fromSearchHit(hit: SearchHit, fallback?: IndexedFile): IndexedFile {
    if (fallback) {
        return {
            ...fallback,
            summary: fallback.summary ?? hit.summary ?? null
        };
    }

    const metadata = hit.metadata ?? {};
    const pathValue = (metadata.path || metadata.file_path || metadata.full_path || '') as string;
    const rawName = (metadata.name || metadata.filename || metadata.title || pathValue.split('/').pop() || `File ${hit.fileId}`) as string;
    const extension = (metadata.extension || (rawName.includes('.') ? (rawName.split('.').pop() ?? 'other') : 'other')) as string;
    const location = pathValue && pathValue.includes('/') ? pathValue.slice(0, pathValue.lastIndexOf('/')) || '/' : '/';
    const now = new Date().toISOString();

    return {
        id: hit.fileId,
        folderId: String(metadata.folder_id ?? metadata.folderId ?? ''),
        path: pathValue || rawName,
        name: rawName,
        extension: extension.toLowerCase(),
        size: Number(metadata.size ?? 0),
        modifiedAt: (metadata.modified_at ?? metadata.modifiedAt ?? now) as string,
        createdAt: (metadata.created_at ?? metadata.createdAt ?? now) as string,
        kind: (metadata.kind as IndexedFile['kind']) ?? inferKind(extension),
        summary: hit.summary ?? null,
        metadata,
        location,
        fullPath: pathValue || rawName
    } satisfies IndexedFile;
}

export function AiWorkspace({
    messages,
    loading,
    onSend,
    model,
    onReferenceOpen,
    className,
    agentContext,
    onResetConversation,
    sessions = [],
    currentSessionId,
    onSelectSession,
    onCreateSession,
    onDeleteSession
}: AiWorkspaceProps) {
    const [previewReference, setPreviewReference] = useState<SearchHit | null>(null);

    const previewFile = useMemo(() => {
        if (!previewReference) return null;
        return fromSearchHit(previewReference);
    }, [previewReference]);

    return (
        <div className={`flex h-full bg-slate-950 ${className ?? ''}`.trim()}>
            {sessions.length > 0 || onCreateSession ? (
                <div className="flex w-64 flex-col border-r border-white/5 bg-slate-950">
                    <div className="flex items-center justify-between p-4">
                        <span className="text-xs font-semibold text-slate-400">History</span>
                        {onCreateSession ? (
                            <button
                                onClick={onCreateSession}
                                className="rounded-md p-1 text-slate-400 hover:bg-white/5 hover:text-slate-200"
                                title="New Chat"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                                    <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
                                </svg>
                            </button>
                        ) : null}
                    </div>
                    <div className="flex-1 overflow-y-auto px-2 pb-2">
                        {sessions.map((session) => {
                            const isActive = session.id === currentSessionId;
                            return (
                                <div
                                    key={session.id}
                                    className={`group relative flex cursor-pointer items-center justify-between rounded-md px-3 py-2 text-sm transition ${isActive
                                        ? 'bg-white/10 text-white'
                                        : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                                        }`}
                                    onClick={() => onSelectSession?.(session.id)}
                                >
                                    <span className="truncate pr-6">{session.title || 'New Chat'}</span>
                                    {onDeleteSession ? (
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onDeleteSession(session.id);
                                            }}
                                            className={`absolute right-2 hidden rounded p-1 hover:bg-white/10 hover:text-rose-400 group-hover:block ${isActive ? 'text-slate-300' : 'text-slate-500'}`}
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3">
                                                <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clipRule="evenodd" />
                                            </svg>
                                        </button>
                                    ) : null}
                                </div>
                            );
                        })}
                    </div>
                </div>
            ) : null}
            <div className="flex flex-1 flex-col overflow-hidden relative">
                <ConversationPanel
                    key={currentSessionId ?? 'new'}
                    className="flex-1"
                    messages={messages}
                    loading={loading}
                    onSend={onSend}
                    model={model}
                    title="Workspace Agent"
                    onPreviewReference={(reference) => setPreviewReference(reference)}
                    agentContext={agentContext}
                    onResetConversation={onResetConversation}
                    currentSessionId={currentSessionId}
                />
                {previewFile ? (
                    <div className="absolute right-4 top-4 w-80 rounded-xl border border-white/10 bg-slate-900 p-4 shadow-2xl">
                        <div className="flex items-center justify-between mb-3">
                            <span className="text-xs font-medium text-slate-400">Source Preview</span>
                            <button
                                type="button"
                                onClick={() => setPreviewReference(null)}
                                className="text-slate-400 hover:text-white"
                            >
                                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        <div className="mb-3">
                            <p className="text-sm font-medium text-white truncate" title={previewFile.name}>{previewFile.name}</p>
                            <p className="text-xs text-slate-500 truncate" title={previewFile.fullPath}>{previewFile.fullPath}</p>
                        </div>
                        {previewReference?.snippet ? (
                            <div className="max-h-60 overflow-y-auto rounded-lg bg-slate-950 p-3 text-xs leading-relaxed text-slate-300 border border-white/5">
                                {previewReference.snippet}
                            </div>
                        ) : null}
                        <div className="mt-3 flex justify-end">
                            <button
                                type="button"
                                onDoubleClick={() => previewReference && onReferenceOpen?.(previewReference)}
                                onClick={() => previewReference && onReferenceOpen?.(previewReference)}
                                className="text-xs text-blue-400 hover:text-blue-300 font-medium"
                            >
                                Open File →
                            </button>
                        </div>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
