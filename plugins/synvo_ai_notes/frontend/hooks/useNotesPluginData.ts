/**
 * Notes Plugin Data Hook
 * Manages notes-specific data fetching and state
 */

import { useState, useCallback, useEffect } from 'react';
import { registerPluginDataHandler, unregisterPluginDataHandler } from '@/renderer/hooks/usePluginData';
import type { IndexingItem, FolderRecord } from '@/renderer/types';

const PLUGIN_ID = 'notes';

function normalisePath(value: string | null | undefined): string {
    return (value ?? '').replace(/\\/g, '/').toLowerCase();
}

export function useNotesPluginData() {
    const [noteFolderId, setNoteFolderId] = useState<string | null>(null);
    const [noteIndexingItems, setNoteIndexingItems] = useState<IndexingItem[]>([]);
    const [loading, setLoading] = useState(false);

    const refreshData = useCallback(async () => {
        const api = window.api;
        if (!api) {
            console.warn('[NotesPlugin] No window.api available');
            return;
        }

        setLoading(true);
        try {
            // Fetch folders to find notes folder
            const folders = await api.listFolders();
            const foundNotesFolder = folders.find((folder: FolderRecord) =>
                normalisePath(folder.path).includes('/.synvo_db/notes')
            );
            setNoteFolderId(foundNotesFolder ? foundNotesFolder.id : null);

            // Fetch indexing status
            const inventory = await api.indexInventory({});

            // Filter indexing items for notes folder
            const notesFolderIds = new Set(
                folders
                    .filter((folder: FolderRecord) =>
                        normalisePath(folder.path).includes('/.synvo_db/notes')
                    )
                    .map((folder: FolderRecord) => folder.id)
            );

            const noteIndexing = inventory.indexing.filter((item: IndexingItem) =>
                notesFolderIds.has(item.folderId)
            );

            setNoteIndexingItems(noteIndexing);
        } catch (error) {
            console.error('[NotesPlugin] Failed to refresh data:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    // Register plugin data handler on mount
    useEffect(() => {
        registerPluginDataHandler({
            pluginId: PLUGIN_ID,
            refreshData,
            cleanup: () => {
                setNoteFolderId(null);
                setNoteIndexingItems([]);
            }
        });

        // Initial data fetch
        void refreshData();

        return () => {
            unregisterPluginDataHandler(PLUGIN_ID);
        };
    }, [refreshData]);

    return {
        noteFolderId,
        noteIndexingItems,
        loading,
        refreshData
    };
}
