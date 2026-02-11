import { useState, useCallback } from 'react';
import { Mail, Brain } from 'lucide-react';
import { cn } from '@/renderer/lib/utils';
import { EmailBrowser } from './EmailBrowser';
import { EmailConnectorsPanel } from './EmailConnectorsPanel';
import { EmailQAPage } from './EmailQAPage';
import { useEmailData } from './useEmailData';
import { useEmailPluginData } from '../hooks/useEmailPluginData';

interface MailPluginMainProps {
    isIndexing: boolean;
    refreshData: () => Promise<void>;
}

export function MailPluginMain({
    isIndexing,
    refreshData
}: MailPluginMainProps) {
    const {
        emailAccounts,
        emailIndexingByAccount,
        refreshData: refreshPluginData
    } = useEmailPluginData();

    const [emailSubView, setEmailSubView] = useState<'accounts' | 'memory'>('accounts');

    const {
        emailSyncStates,
        emailMessages,
        selectedEmailAccountId,
        selectedEmailMessageId,
        emailMessageCache,
        loadingMessagesForAccount,
        isEmailMessageLoading,
        handleAddEmailAccount,
        handleRemoveEmailAccount,
        handleSyncEmailAccount,
        handleOutlookConnected,
        handleSelectEmailAccountView,
        handleSelectEmailMessage,
        handleRefreshEmailMessages,
        handleCloseEmailMessage,
    } = useEmailData(emailAccounts, refreshPluginData);

    // Re-implementation of handlers from ExtensionsView if they are not in useEmailData
    const handleRescanEmailIndex = useCallback(async (folderId: string) => {
        const api = (window as any).api;
        if (!api?.runStagedIndex) return;
        try {
            await api.runStagedIndex({ folders: [folderId] });
            await refreshData();
        } catch (error) {
            console.error('Failed to rescan email index', error);
        }
    }, [refreshData]);

    const handleReindexEmailIndex = useCallback(async (folderId: string) => {
        const api = (window as any).api;
        if (!api?.runStagedIndex) return;
        try {
            await api.runStagedIndex({ folders: [folderId] });
            await refreshData();
        } catch (error) {
            console.error('Failed to reindex email index', error);
        }
    }, [refreshData]);

    const subTabs = [
        { id: 'accounts' as const, label: 'Email Accounts', icon: Mail },
        { id: 'memory' as const, label: 'Email Memory', icon: Brain },
    ];

    return (
        <div className="h-full flex flex-col">
            {/* Sub-tab bar - only show when not viewing specific account emails */}
            {!selectedEmailAccountId && (
                <div className="flex-none border-b bg-muted/30 px-4">
                    <div className="flex gap-1">
                        {subTabs.map(subTab => {
                            const Icon = subTab.icon;
                            const isActive = emailSubView === subTab.id;
                            return (
                                <button
                                    key={subTab.id}
                                    onClick={() => setEmailSubView(subTab.id)}
                                    className={cn(
                                        "flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px",
                                        isActive
                                            ? "border-primary text-foreground bg-background"
                                            : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50"
                                    )}
                                >
                                    <Icon className="h-4 w-4" />
                                    {subTab.label}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Sub-view content */}
            <div className="flex-1 overflow-hidden">
                {selectedEmailAccountId ? (
                    <EmailBrowser
                        messages={emailMessages?.[selectedEmailAccountId] ?? []}
                        selectedMessageId={selectedEmailMessageId ?? null}
                        onSelectMessage={(msgId) => handleSelectEmailMessage(selectedEmailAccountId, msgId)}
                        messageContent={selectedEmailMessageId ? emailMessageCache?.[selectedEmailMessageId] ?? null : null}
                        loading={loadingMessagesForAccount === selectedEmailAccountId}
                        loadingContent={!!isEmailMessageLoading}
                        onBack={() => handleSelectEmailAccountView('')}
                        onRefresh={() => handleRefreshEmailMessages(selectedEmailAccountId)}
                        onCloseMessage={handleCloseEmailMessage}
                        accountLabel={emailAccounts.find(a => a.id === selectedEmailAccountId)?.label ?? 'Email'}
                    />
                ) : emailSubView === 'memory' ? (
                    <EmailQAPage
                        accounts={emailAccounts}
                    />
                ) : (
                    <EmailConnectorsPanel
                        accounts={emailAccounts}
                        syncStates={emailSyncStates}
                        pendingByAccount={emailIndexingByAccount}
                        onAdd={handleAddEmailAccount}
                        onRemove={handleRemoveEmailAccount}
                        onSync={handleSyncEmailAccount}
                        onRescanIndex={handleRescanEmailIndex}
                        onReindexIndex={handleReindexEmailIndex}
                        onOutlookConnected={handleOutlookConnected}
                        onSelectAccount={handleSelectEmailAccountView}
                        isIndexing={isIndexing}
                    />
                )}
            </div>
        </div>
    );
}
