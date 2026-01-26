import { QuickSearchShell } from './components/QuickSearchShell';
import { MainAppView } from './components/MainAppView';
import { MCPActivityShell } from './components/MCPActivityShell';
import { ThemeProvider } from './components/theme-provider';
import { SkinProvider } from './components/skin-provider';

// Import plugin system (frontend registry for dynamic plugin components)
import './plugins';

// Import i18n configuration
import '../i18n/config';

export default function App() {
    const viewParam =
        typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('view') : null;
    const hash = typeof window !== 'undefined' ? window.location.hash : '';

    // Support both `#mcp-activity` (our special window) and `#/mcp-activity` (some routers / older links)
    if (hash === '#mcp-activity' || hash === '#/mcp-activity' || viewParam === 'mcp-activity') {
        return (
            <ThemeProvider defaultTheme="system" storageKey="local-cocoa-theme">
                <SkinProvider defaultSkin="local-cocoa" storageKey="local-cocoa-skin">
                    <MCPActivityShell />
                </SkinProvider>
            </ThemeProvider>
        );
    }

    if (viewParam === 'spotlight') {
        return (
            <ThemeProvider defaultTheme="system" storageKey="local-cocoa-theme">
                <SkinProvider defaultSkin="local-cocoa" storageKey="local-cocoa-skin">
                    <QuickSearchShell />
                </SkinProvider>
            </ThemeProvider>
        );
    }

    return (
        <ThemeProvider defaultTheme="system" storageKey="local-cocoa-theme">
            <SkinProvider defaultSkin="local-cocoa" storageKey="local-cocoa-skin">
                <MainAppView />
            </SkinProvider>
        </ThemeProvider>
    );
}
