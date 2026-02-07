/**
 * ExtensionsView - Dynamic Plugin container for Activity, Email, Notes, and other extensions
 * 
 * This view dynamically displays installed and enabled plugins as tabs.
 * Plugin order and enabled state are configurable in Settings.
 */

import { useState, useCallback, useMemo, CSSProperties, ComponentType } from 'react';
import { Activity, Mail, StickyNote, Puzzle, Brain, Link2, Mic, Loader2, Settings2, X, FolderKanban } from 'lucide-react';
import { cn } from '../lib/utils';
import { EmailConnectorsPanel } from './EmailConnectorsPanel';
import { EmailBrowser } from './EmailBrowser';
import { EmailQAPage } from './EmailQAPage';
import { NotesWorkspace } from './NotesWorkspace';
import { MCPConnectionPanel } from './MCPConnectionPanel';
import { PluginConfigPanel } from './PluginConfigPanel';
import { DesktopOrganizer } from './DesktopOrganizer';
import { ActivityTimeline } from './ActivityTimeline';
import { MbtiAnalysis } from './MbtiAnalysis';
import { EarlogPanel } from './EarlogPanel';
import { useWorkspaceData } from '../hooks/useWorkspaceData';
import { useEmailData } from '../hooks/useEmailData';
import { useNotesData } from '../hooks/useNotesData';
import { usePluginConfig } from '../hooks/usePluginConfig';
import { useMbtiAnalysis } from '../hooks/useMbtiAnalysis';
import { OpenClawPanel } from './OpenClawPanel';

// Icon map for dynamic icon lookup
const ICON_MAP: Record<string, ComponentType<{ className?: string }>> = {
    'Activity': Activity,
    'Mail': Mail,
    'StickyNote': StickyNote,
    'Puzzle': Puzzle,
    'Brain': Brain,
    'Link2': Link2,
    'Mic': Mic,
    'Ear': Mic, // Fallback for Ear icon
    'FolderKanban': FolderKanban,
};

interface ExtensionsViewProps {
    // Optional props for external control
    initialTab?: string;
}

export function ExtensionsView({ 
    initialTab,
}: ExtensionsViewProps) {
    // Load plugin configuration - show all enabled tabs
    // Unsupported tabs will display "Unsupported yet" message when selected
    const { enabledTabs, loading: pluginsLoading, refresh: refreshPlugins } = usePluginConfig();
    
    const [selectedTab, setSelectedTab] = useState<string | null>(null);
    const [notification, setNotification] = useState<{ message: string; action?: { label: string; onClick: () => void } } | null>(null);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);

    // Email sub-view state: 'accounts' | 'memory'
    type EmailSubView = 'accounts' | 'memory';
    const [emailSubView, setEmailSubView] = useState<EmailSubView>('accounts');

    // Compute active tab: user selection takes precedence, otherwise use initialTab or first enabled
    const activeTab = useMemo(() => {
        if (selectedTab && enabledTabs.some(t => t.id === selectedTab)) {
            return selectedTab;
        }
        if (enabledTabs.length === 0) return '';
        const validInitialTab = initialTab && enabledTabs.some(t => t.id === initialTab);
        return validInitialTab ? initialTab : enabledTabs[0].id;
    }, [selectedTab, enabledTabs, initialTab]);

    const setActiveTab = setSelectedTab;

    // Handler for closing settings panel - refresh data when closing
    const handleCloseSettings = useCallback(() => {
        setIsSettingsOpen(false);
        // Refresh plugin data to ensure UI is in sync
        refreshPlugins();
    }, [refreshPlugins]);

    const dragStyle = { WebkitAppRegion: 'drag' } as CSSProperties;
    const noDragStyle = { WebkitAppRegion: 'no-drag' } as CSSProperties;

    // Use workspace data hook
    const {
        emailAccounts: workspaceEmailAccounts,
        isIndexing,
        emailIndexingByAccount,
        noteIndexingItems,
        noteFolderId,
        refreshData,
    } = useWorkspaceData();

    // Use email data hook
    const {
        emailAccounts,
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
        handleSelectEmailAccountView,
        handleRefreshEmailMessages,
        handleSelectEmailMessage,
        handleCloseEmailMessage,
        handleOutlookConnected
    } = useEmailData(workspaceEmailAccounts, refreshData);

    // Use notes data hook
    const {
        notes,
        selectedNoteId,
        selectedNote,
        isNoteLoading,
        isNoteSaving,
        handleSelectNote,
        handleCreateNote,
        handleSaveNote,
        handleDeleteNote
    } = useNotesData();

    // Activity tracking state
    const [isActivityTracking, setIsActivityTracking] = useState(false);
    const handleToggleActivityTracking = useCallback(() => {
        setIsActivityTracking(prev => !prev);
    }, []);

    // MBTI Analysis hook
    const {
        isAnalyzing: isMbtiAnalyzing,
        isGeneratingReport: isMbtiGeneratingReport,
        progress: mbtiProgress,
        result: mbtiResult,
        error: mbtiError,
        filterProgress: mbtiFilterProgress,
        embedProgress: mbtiEmbedProgress,
        startAnalysis: startMbtiAnalysis,
        startAnalysisWithFilter: startMbtiAnalysisWithFilter,
        stopAnalysis: stopMbtiAnalysis,
        resetAnalysis: resetMbtiAnalysis,
        setProgress: setMbtiProgress,
        files: mbtiFiles,
    } = useMbtiAnalysis();

    // Email index handlers
    const handleRescanEmailIndex = useCallback(async (folderId: string) => {
        const api = window.api;
        if (!api?.runStagedIndex) return;
        try {
            await api.runStagedIndex({ folders: [folderId] });
            await refreshData();
        } catch (error) {
            console.error('Failed to rescan email index', error);
            setNotification({ message: error instanceof Error ? error.message : 'Failed to rescan email index.' });
        }
    }, [refreshData]);

    const handleReindexEmailIndex = useCallback(async (folderId: string) => {
        const api = window.api;
        if (!api?.runStagedIndex) return;
        try {
            await api.runStagedIndex({ folders: [folderId] });
            await refreshData();
        } catch (error) {
            console.error('Failed to reindex email index', error);
            setNotification({ message: error instanceof Error ? error.message : 'Failed to reindex email index.' });
        }
    }, [refreshData]);

    // Notes index handlers
    const handleRescanNotesIndex = useCallback(async () => {
        if (!noteFolderId) return;
        const api = window.api;
        if (!api?.runStagedIndex) return;
        try {
            await api.runStagedIndex({ folders: [noteFolderId] });
            await refreshData();
        } catch (error) {
            console.error('Failed to rescan notes index', error);
            setNotification({ message: error instanceof Error ? error.message : 'Failed to rescan notes index.' });
        }
    }, [noteFolderId, refreshData]);

    const handleReindexNotesIndex = useCallback(async () => {
        if (!noteFolderId) return;
        const api = window.api;
        if (!api?.runStagedIndex) return;
        try {
            await api.runStagedIndex({ folders: [noteFolderId] });
            await refreshData();
        } catch (error) {
            console.error('Failed to reindex notes index', error);
            setNotification({ message: error instanceof Error ? error.message : 'Failed to reindex notes index.' });
        }
    }, [noteFolderId, refreshData]);

    // Get icon component for a tab
    const getTabIcon = useCallback((iconName: string) => {
        return ICON_MAP[iconName] || Puzzle;
    }, []);

    // Render the content for the active tab
    const renderTabContent = useCallback(() => {
        // Handle email tab with sub-views (accounts, memory)
        if (activeTab === 'email') {
            // Sub-tab navigation
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
                        {/* Email Browser - when account is selected from accounts list */}
                        {selectedEmailAccountId ? (
                            <EmailBrowser
                                messages={emailMessages?.[selectedEmailAccountId] ?? []}
                                selectedMessageId={selectedEmailMessageId ?? null}
                                onSelectMessage={(msgId) => handleSelectEmailMessage?.(selectedEmailAccountId, msgId)}
                                messageContent={selectedEmailMessageId ? emailMessageCache?.[selectedEmailMessageId] ?? null : null}
                                loading={loadingMessagesForAccount === selectedEmailAccountId}
                                loadingContent={!!isEmailMessageLoading}
                                onBack={() => handleSelectEmailAccountView?.('')}
                                onRefresh={() => handleRefreshEmailMessages?.(selectedEmailAccountId)}
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

        // Render based on active tab ID
        switch (activeTab) {
            case 'notes':
                return (
                    <div className="h-full w-full p-6">
                        <NotesWorkspace
                            notes={notes}
                            selectedNoteId={selectedNoteId}
                            selectedNote={selectedNote}
                            loading={isNoteLoading}
                            saving={isNoteSaving}
                            onSelectNote={handleSelectNote}
                            onCreateNote={handleCreateNote}
                            onDeleteNote={handleDeleteNote}
                            onSaveNote={handleSaveNote}
                            pendingItems={noteIndexingItems}
                            onRescanIndex={handleRescanNotesIndex}
                            onReindexIndex={handleReindexNotesIndex}
                            indexingBusy={isIndexing}
                        />
                    </div>
                );
            
            case 'connections':
                return (
                    <div className="h-full w-full p-6 overflow-y-auto">
                        <MCPConnectionPanel />
                    </div>
                );
            
            case 'desktop_organizer':
                return (
                    <div className="h-full w-full overflow-hidden">
                        <DesktopOrganizer />
                    </div>
                );
            
            case 'activity':
                return (
                    <div className="h-full w-full overflow-hidden">
                        <ActivityTimeline
                            isTracking={isActivityTracking}
                            onToggleTracking={handleToggleActivityTracking}
                        />
                    </div>
                );
            
            case 'earlog':
                return (
                    <div className="h-full w-full overflow-hidden">
                        <EarlogPanel />
                    </div>
                );
            
            case 'mbti':
                return (
                    <div className="h-full w-full overflow-hidden">
                        <MbtiAnalysis
                            isAnalyzing={isMbtiAnalyzing}
                            isGeneratingReport={isMbtiGeneratingReport}
                            progress={mbtiProgress}
                            result={mbtiResult}
                            error={mbtiError}
                            filterProgress={mbtiFilterProgress}
                            embedProgress={mbtiEmbedProgress}
                            onStartAnalysis={startMbtiAnalysis}
                            onStartAnalysisWithFilter={startMbtiAnalysisWithFilter}
                            onStopAnalysis={stopMbtiAnalysis}
                            onResetAnalysis={resetMbtiAnalysis}
                            setProgress={setMbtiProgress}
                            files={mbtiFiles}
                        />
                    </div>
                );
            
            case 'openclaw':
                return (
                    <div className="h-full w-full overflow-hidden">
                        <OpenClawPanel />
                    </div>
                );
            
            default:
                // For unknown tabs, show a placeholder
                return (
                    <div className="h-full w-full flex items-center justify-center text-muted-foreground">
                        <div className="text-center">
                            <Puzzle className="h-16 w-16 mx-auto mb-6 opacity-40" />
                            <h3 className="text-xl font-semibold mb-2 text-foreground/70">Unsupported Yet</h3>
                            <p className="text-sm max-w-md mx-auto">
                                This extension is not yet supported. Stay tuned for future updates!
                            </p>
                        </div>
                    </div>
                );
        }
    }, [
        activeTab,
        emailSubView,
        selectedEmailAccountId,
        emailMessages,
        selectedEmailMessageId,
        handleSelectEmailMessage,
        emailMessageCache,
        loadingMessagesForAccount,
        isEmailMessageLoading,
        handleSelectEmailAccountView,
        handleRefreshEmailMessages,
        handleCloseEmailMessage,
        emailAccounts,
        emailSyncStates,
        emailIndexingByAccount,
        handleAddEmailAccount,
        handleRemoveEmailAccount,
        handleSyncEmailAccount,
        handleRescanEmailIndex,
        handleReindexEmailIndex,
        handleOutlookConnected,
        isIndexing,
        notes,
        selectedNoteId,
        selectedNote,
        isNoteLoading,
        isNoteSaving,
        handleSelectNote,
        handleCreateNote,
        handleDeleteNote,
        handleSaveNote,
        noteIndexingItems,
        handleRescanNotesIndex,
        handleReindexNotesIndex,
        // Activity dependencies
        isActivityTracking,
        handleToggleActivityTracking,
        // MBTI dependencies
        isMbtiAnalyzing,
        isMbtiGeneratingReport,
        mbtiProgress,
        mbtiResult,
        mbtiError,
        mbtiFilterProgress,
        mbtiEmbedProgress,
        startMbtiAnalysis,
        startMbtiAnalysisWithFilter,
        stopMbtiAnalysis,
        resetMbtiAnalysis,
        setMbtiProgress,
        mbtiFiles,
    ]);

    // Show loading state while plugins are loading
    if (pluginsLoading) {
        return (
            <div className="flex h-full items-center justify-center bg-gradient-to-br from-background via-background to-muted/20">
                <div className="flex flex-col items-center gap-3">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">Loading extensions...</p>
                </div>
            </div>
        );
    }

    // Show empty state if no plugins enabled
    if (enabledTabs.length === 0) {
        return (
            <div className="flex h-full items-center justify-center bg-gradient-to-br from-background via-background to-muted/20">
                <div className="text-center max-w-md px-6">
                    <div className="relative mb-6">
                        <div className="h-20 w-20 mx-auto rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                            <Puzzle className="h-10 w-10 text-primary/70" />
                        </div>
                        <div className="absolute -inset-3 border-2 border-primary/10 rounded-3xl" />
                    </div>
                    <h2 className="text-xl font-bold mb-2">No Extensions Enabled</h2>
                    <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
                        Enable your extensions to unlock productivity features like email indexing, notes, and more.
                    </p>
                    <button
                        onClick={() => setIsSettingsOpen(true)}
                        className="group inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 hover:scale-105 transition-all duration-200 shadow-lg"
                    >
                        <Settings2 className="h-4 w-4 transition-transform duration-300 group-hover:rotate-90" />
                        Manage Extensions
                    </button>
                </div>

                {/* Settings Panel for empty state */}
                {isSettingsOpen && (
                    <div className="fixed inset-0 z-50">
                        <div 
                            className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200"
                            onClick={handleCloseSettings}
                        />
                        <div className="absolute right-0 top-0 h-full w-full max-w-lg bg-background border-l shadow-2xl animate-in slide-in-from-right duration-300">
                            <div className="flex items-center justify-between px-6 py-5 border-b bg-card/50">
                                <div className="flex items-center gap-3">
                                    <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                                        <Settings2 className="h-4 w-4 text-primary" />
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-semibold">Extension Settings</h3>
                                        <p className="text-xs text-muted-foreground">Manage visibility and order</p>
                                    </div>
                                </div>
                                <button
                                    onClick={handleCloseSettings}
                                    className="p-2 rounded-lg hover:bg-muted transition-colors"
                                >
                                    <X className="h-5 w-5" />
                                </button>
                            </div>
                            <div className="h-[calc(100%-80px)] overflow-y-auto p-6">
                                <PluginConfigPanel />
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="flex h-full flex-col bg-gradient-to-br from-background via-background to-muted/20">
            {/* Notification */}
            {notification && (
                <div className="absolute top-4 right-4 z-50 max-w-sm p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-sm">
                    <p className="text-destructive">{notification.message}</p>
                    {notification.action && (
                        <button
                            onClick={notification.action.onClick}
                            className="mt-2 text-xs text-destructive underline"
                        >
                            {notification.action.label}
                        </button>
                    )}
                    <button
                        onClick={() => setNotification(null)}
                        className="absolute top-2 right-2 text-destructive/50 hover:text-destructive"
                    >
                        ×
                    </button>
                </div>
            )}

            {/* Header Region - Draggable */}
            <div className="flex-none border-b border-border/50 bg-card/30 backdrop-blur-sm" style={dragStyle}>
                <div className="px-6 pt-8 pb-0">
                    {/* Title section */}
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                                <Puzzle className="h-5 w-5 text-primary" />
                            </div>
                            <div>
                                <h2 className="text-xl font-bold tracking-tight">Extensions</h2>
                                <p className="text-xs text-muted-foreground">Installed plugins and extensions</p>
                            </div>
                        </div>
                        {/* Settings Button */}
                        <button
                            onClick={() => setIsSettingsOpen(true)}
                            style={noDragStyle}
                            className="group flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all duration-200"
                        >
                            <Settings2 className="h-4 w-4 transition-transform duration-300 group-hover:rotate-90" />
                            <span className="hidden sm:inline">Manage</span>
                        </button>
                    </div>

                    {/* Dynamic Tabs - Non-draggable */}
                    <div className="flex items-center gap-1" style={noDragStyle}>
                        {enabledTabs.map(tab => {
                            const Icon = getTabIcon(tab.icon);
                            const isActive = activeTab === tab.id;
                            const isTestMode = ['desktop_organizer', 'activity', 'earlog', 'mbti'].includes(tab.id);
                            return (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={cn(
                                        "relative flex items-center gap-2 px-4 py-2.5 rounded-t-xl text-sm font-medium transition-all duration-200",
                                        isActive
                                            ? "bg-background text-foreground shadow-sm"
                                            : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                                    )}
                                >
                                    <Icon className={cn(
                                        "h-4 w-4 transition-colors",
                                        isActive ? "text-primary" : ""
                                    )} />
                                    {tab.label}
                                    {isTestMode && (
                                        <span className="ml-0.5 px-1.5 py-0.5 text-[8px] font-semibold uppercase rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                                            Test
                                        </span>
                                    )}
                                    {tab.id === 'email' && emailAccounts.length > 0 && (
                                        <span className="ml-1 px-1.5 py-0.5 text-[10px] rounded-full bg-muted">
                                            {emailAccounts.length}
                                        </span>
                                    )}
                                    {tab.id === 'notes' && notes.length > 0 && (
                                        <span className="ml-1 px-1.5 py-0.5 text-[10px] rounded-full bg-muted">
                                            {notes.length}
                                        </span>
                                    )}
                                    {isActive && (
                                        <span className="absolute bottom-0 left-4 right-4 h-0.5 bg-primary rounded-full" />
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-hidden">
                {renderTabContent()}
            </div>

            {/* Settings Slide-over Panel */}
            {isSettingsOpen && (
                <div className="fixed inset-0 z-50">
                    {/* Backdrop */}
                    <div 
                        className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200"
                        onClick={handleCloseSettings}
                    />
                    
                    {/* Panel */}
                    <div className="absolute right-0 top-0 h-full w-full max-w-lg bg-background border-l shadow-2xl animate-in slide-in-from-right duration-300">
                        {/* Panel Header */}
                        <div className="flex items-center justify-between px-6 py-5 border-b bg-card/50">
                            <div className="flex items-center gap-3">
                                <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                                    <Settings2 className="h-4 w-4 text-primary" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-semibold">Extension Settings</h3>
                                    <p className="text-xs text-muted-foreground">Manage visibility and order</p>
                                </div>
                            </div>
                            <button
                                onClick={handleCloseSettings}
                                className="p-2 rounded-lg hover:bg-muted transition-colors"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        
                        {/* Panel Content */}
                        <div className="h-[calc(100%-80px)] overflow-y-auto p-6">
                            <PluginConfigPanel />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
