import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import tailwindcss from '@tailwindcss/vite';
import autoprefixer from 'autoprefixer';

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
        strictPort: true
    },
    build: {
        outDir: 'dist/renderer',
        emptyOutDir: true
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, 'src/renderer')
        }
    }
});
