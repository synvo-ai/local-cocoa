/**
 * Email Plugin Data Hook
 * Manages email-specific data fetching and state
 */

import { useState, useCallback, useEffect } from 'react';
import { registerPluginDataHandler, unregisterPluginDataHandler } from '@/renderer/hooks/usePluginData';
import type { EmailAccountSummary } from '../types';
import type { IndexingItem } from '@/renderer/types';

const PLUGIN_ID = 'mail';

export function useEmailPluginData() {
    const [emailAccounts, setEmailAccounts] = useState<EmailAccountSummary[]>([]);
    const [emailIndexingByAccount, setEmailIndexingByAccount] = useState<Record<string, IndexingItem[]>>({});
    const [loading, setLoading] = useState(false);

    const refreshData = useCallback(async () => {
        const api = window.api;
        if (!api) {
            console.warn('[EmailPlugin] No window.api available');
            return;
        }

        setLoading(true);
        try {
            // Fetch email accounts
            const accounts = await api.listEmailAccounts?.() ?? [];
            setEmailAccounts(accounts);

            // Fetch indexing status for each account
            const inventory = await api.indexInventory({});

            // Build account folder map
            const accountFolderMap = new Map<string, string>();
            accounts.forEach((account: EmailAccountSummary) => {
                accountFolderMap.set(account.folderId, account.id);
            });

            // Partition indexing items by account
            const emailIndexing: Record<string, IndexingItem[]> = {};
            inventory.indexing.forEach((item: IndexingItem) => {
                const accountId = accountFolderMap.get(item.folderId);
                if (accountId) {
                    if (!emailIndexing[accountId]) {
                        emailIndexing[accountId] = [];
                    }
                    emailIndexing[accountId].push(item);
                }
            });

            setEmailIndexingByAccount(emailIndexing);
        } catch (error) {
            console.error('[EmailPlugin] Failed to refresh data:', error);
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
                setEmailAccounts([]);
                setEmailIndexingByAccount({});
            }
        });

        // Initial data fetch
        void refreshData();

        return () => {
            unregisterPluginDataHandler(PLUGIN_ID);
        };
    }, [refreshData]);

    return {
        emailAccounts,
        emailIndexingByAccount,
        loading,
        refreshData
    };
}
