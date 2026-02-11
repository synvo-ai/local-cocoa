/**
 * ExtensionsView - Dynamic Plugin container for Activity, Email, Notes, and other extensions
 * 
 * This view dynamically displays installed and enabled plugins as tabs.
 * Plugin order and enabled state are configurable in Settings.
 */

import { useState, useCallback, useMemo, CSSProperties, ComponentType, lazy, Suspense } from 'react';
import { Activity, Mail, StickyNote, Puzzle, Brain, Link2, Mic, Loader2, Settings2, X, FolderKanban } from 'lucide-react';
import { cn } from '../lib/utils';
import { MCPConnectionPanel } from './MCPConnectionPanel';
import { PluginConfigPanel } from './PluginConfigPanel';
import { useWorkspaceData } from '../hooks/useWorkspaceData';
import { usePluginData } from '../hooks/usePluginData';
import { usePluginConfig } from '../hooks/usePluginConfig';
import type { FolderRecord } from '../types';

/**
 * Dynamic plugin component loader
 * Supports loading from multiple plugin directories:
 * - System plugins: local-cocoa/plugins/* (built-in plugins)
 * - User plugins: configured via user-plugins alias (from LOCAL_USER_PLUGINS_ROOT env var)
 */
const pluginModules = {
    // System plugins (built-in)
    ...import.meta.glob('system-plugins/*/frontend/renderer/*.tsx'),
    // User plugins (configurable via LOCAL_USER_PLUGINS_ROOT environment variable)
    ...import.meta.glob('user-plugins/*/frontend/renderer/*.tsx'),
};

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

export type MonitoredFolder = FolderRecord;
export function ExtensionsView({
    initialTab,
}: ExtensionsViewProps) {
    // Load plugin configuration - show all enabled tabs
    // Unsupported tabs will display "Unsupported yet" message when selected
    const { enabledTabs, loading: pluginsLoading } = usePluginConfig();

    const [selectedTab, setSelectedTab] = useState<string | null>(null);
    const [notification, setNotification] = useState<{ message: string; action?: { label: string; onClick: () => void } } | null>(null);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);

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
        // Use plugin data management (auto-refresh based on active tab)
    }, []);

    usePluginData(activeTab);

    const dragStyle = { WebkitAppRegion: 'drag' } as CSSProperties;
    const noDragStyle = { WebkitAppRegion: 'no-drag' } as CSSProperties;

    // Use workspace data hook
    const {
        isIndexing,
        refreshData,
        files: indexedFiles
    } = useWorkspaceData();

    // Activity tracking state
    const [isActivityTracking, setIsActivityTracking] = useState(false);
    const handleToggleActivityTracking = useCallback(() => {
        setIsActivityTracking(prev => !prev);
    }, []);

    // Get icon component for a tab
    const getTabIcon = useCallback((iconName: string) => {
        return ICON_MAP[iconName] || Puzzle;
    }, []);

    /**
     * Cache for lazy-loaded plugin components to prevent unmounting on re-render
     */
    const pluginComponentCache = useMemo(() => new Map<string, any>(), []);

    /**
     * Dynamic plugin component loader
     * Handles both system plugins and user plugins
     * Handles both default and named exports
     */
    const loadPluginComponent = useCallback((pluginId: string, componentPath: string, componentName?: string) => {
        const cacheKey = `${pluginId}:${componentPath}:${componentName || 'default'}`;

        if (pluginComponentCache.has(cacheKey)) {
            return pluginComponentCache.get(cacheKey);
        }

        // Construct the expected suffix to search for in module keys
        const expectedSuffix = `${pluginId}/${componentPath}`.replace(/\\/g, '/');

        // Find the matching module key
        const match = Object.entries(pluginModules).find(([key]) => {
            const normalizedKey = key.replace(/\\/g, '/');
            return normalizedKey.endsWith(expectedSuffix);
        });

        if (match) {
            const [fullPath, importFn] = match;
            console.log(`[ExtensionsView] Loading plugin component: ${pluginId} from ${fullPath}${componentName ? ` (export: ${componentName})` : ''}`);

            const Component = lazy(async () => {
                const module = await (importFn as any)();
                if (componentName && module[componentName]) {
                    return { default: module[componentName] };
                }
                if (module.default) {
                    return { default: module.default };
                }
                const firstExport = Object.values(module).find(val => typeof val === 'function');
                if (firstExport) {
                    return { default: firstExport as any };
                }
                throw new Error(`Could not find export for component ${componentName || 'default'} in ${fullPath}`);
            });

            pluginComponentCache.set(cacheKey, Component);
            return Component;
        }

        console.warn(`[ExtensionsView] No loader found for plugin ${pluginId} at suffix: ${expectedSuffix}`);
        return null;
    }, [pluginComponentCache]);

    /**
     * Memoized active tab content
     * computed only when active tab or shared data changes
     */
    const tabContent = useMemo(() => {
        const currentTab = enabledTabs.find(t => t.id === activeTab);

        if (!currentTab) {
            return (
                <div className="h-full w-full flex items-center justify-center text-muted-foreground">
                    <div className="text-center">
                        <Puzzle className="h-16 w-16 mx-auto mb-6 opacity-40" />
                        <h3 className="text-xl font-semibold mb-2 text-foreground/70">Tab Not Found</h3>
                        <p className="text-sm max-w-md mx-auto">
                            The selected tab could not be found.
                        </p>
                    </div>
                </div>
            );
        }

        if (activeTab === 'connections') {
            return (
                <div className="h-full w-full p-6 overflow-y-auto">
                    <MCPConnectionPanel />
                </div>
            );
        }

        // Dynamic plugin loading for all other tabs
        if (currentTab.path && currentTab.pluginId) {
            const PluginComponent = loadPluginComponent(currentTab.pluginId, currentTab.path, currentTab.component);

            if (PluginComponent) {
                return (
                    <Suspense fallback={
                        <div className="flex h-full items-center justify-center">
                            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        </div>
                    }>
                        <div className="h-full w-full overflow-hidden">
                            <PluginComponent
                                isIndexing={isIndexing}
                                refreshData={refreshData}
                                isActivityTracking={isActivityTracking}
                                onToggleActivityTracking={handleToggleActivityTracking}
                                indexedFiles={indexedFiles}
                            />
                        </div>
                    </Suspense>
                );
            }
        }

        // Fallback for plugins without proper configuration
        return (
            <div className="h-full w-full flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                    <Puzzle className="h-16 w-16 mx-auto mb-6 opacity-40" />
                    <h3 className="text-xl font-semibold mb-2 text-foreground/70">Plugin Not Configured</h3>
                    <p className="text-sm max-w-md mx-auto">
                        This plugin&apos;s frontend component could not be loaded. Please check the plugin configuration.
                    </p>
                    {currentTab.pluginId && (
                        <p className="text-xs text-muted-foreground mt-2">
                            Plugin ID: {currentTab.pluginId}
                        </p>
                    )}
                </div>
            </div>
        );
    }, [
        activeTab,
        enabledTabs,
        loadPluginComponent,
        isIndexing,
        refreshData,
        isActivityTracking,
        handleToggleActivityTracking,
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
                {tabContent}
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
