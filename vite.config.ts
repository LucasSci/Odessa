/// <reference types="vitest" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      watch: {
        ignored: [
          '**/archive/**',
          '**/server/runtime/**',
          '**/server/data/**',
          '**/assets/videos/**',
          '**/captura_chat.txt',
          '**/regions.json',
          '**/*.log',
          '**/*.txt',
          '**/venv/**',
          '**/.venv/**',
        ],
      },
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify: file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      proxy: {
        '/api': 'http://127.0.0.1:8000',
        '/auth': 'http://127.0.0.1:8000',
        '/obs': 'http://127.0.0.1:8000',
        '/agent': 'http://127.0.0.1:8000',
        '/webhooks': 'http://127.0.0.1:8000',
      },
    },
    optimizeDeps: {
      entries: ['index.html'],
    },
    test: {
      globals: true,
      environment: 'jsdom',
    },
  };
});
