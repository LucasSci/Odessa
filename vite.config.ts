/// <reference types="vitest" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import path from 'path';
import { defineConfig } from 'vite';

const isElectron = process.env.ELECTRON === 'true';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      // Only load Electron plugins when running in desktop mode
      ...(isElectron
        ? [
            electron([
              {
                // Main process entry file
                entry: 'electron/main.ts',
                vite: {
                  build: {
                    outDir: 'dist-electron',
                    rollupOptions: {
                      external: ['electron'],
                      output: {
                        // Use .mjs extension so Node treats it as ESM
                        // (needed because the root package.json has "type": "module")
                        entryFileNames: '[name].mjs',
                      },
                    },
                  },
                },
              },
              {
                // Preload script
                entry: 'electron/preload.ts',
                onstart(args) {
                  // Reload the renderer when preload changes
                  args.reload();
                },
                vite: {
                  build: {
                    outDir: 'dist-electron',
                    rollupOptions: {
                      external: ['electron'],
                      output: {
                        entryFileNames: '[name].mjs',
                      },
                    },
                  },
                },
              },
            ]),
            renderer(),
          ]
        : []),
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
          '**/captura_chat.txt',
          '**/regions.json',
          '**/*.log',
          '**/*.txt',
        ],
      },
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify: file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
    test: {
      globals: true,
      environment: 'jsdom',
    },
  };
});
