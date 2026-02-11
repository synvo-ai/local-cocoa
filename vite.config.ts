import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import tailwindcss from '@tailwindcss/vite';
import autoprefixer from 'autoprefixer';

// Read user plugins root from environment variable, This allows dynamic configuration of the user plugins directory
const userPluginsRoot = process.env.LOCAL_USER_PLUGINS_ROOT ? path.resolve(__dirname, process.env.LOCAL_USER_PLUGINS_ROOT) : '';

console.log('[Vite Config] User plugins root:', userPluginsRoot);

export default defineConfig({
    root: path.resolve(__dirname, 'src/renderer'),
    plugins: [react(), tailwindcss()],
    css: {
        postcss: {
            plugins: [
                autoprefixer(),
            ],
        },
    },
    base: './',
    server: {
        host: '127.0.0.1',
        port: 5173,
        strictPort: true,
        fs: {
            allow: [
                // Allow serving files from the project root and above
                path.resolve(__dirname),
                path.resolve(__dirname, '..'), // For sibling directories
                userPluginsRoot
            ].filter(Boolean)
        }
    },
    build: {
        outDir: path.resolve(__dirname, 'dist-electron/renderer'),
        emptyOutDir: true
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, 'src'),
            // Standard alias for system plugins
            'system-plugins': path.resolve(__dirname, 'plugins'),
            // Dynamic alias for user plugins directory. Can be configured via LOCAL_USER_PLUGINS_ROOT environment variable
            'user-plugins': userPluginsRoot
        }
    }
});
