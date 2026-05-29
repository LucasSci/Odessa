/// <reference types="vitest" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';

// ── Build-time schedule config injection ─────────────────────────────────────
// During `npm run build` on the Hostinger server the KV store is on disk at
// ~/odessa-data/data/kv.json.  This plugin reads the current workflow config
// and embeds it into the JS bundle as __ODESSA_SCHEDULE_CONFIG__ so the
// PersonaOverlay can fire scheduled triggers client-side even when the Node.js
// API process is running old code (e.g. right after a static-site deploy that
// doesn't restart the process).
function odessaSchedulePlugin(): Plugin {
  return {
    name: 'odessa-schedule-inject',
    config() {
      let scheduleConfig: unknown = null;
      try {
        const homedir = os.homedir();
        const kvPath = path.join(homedir, 'odessa-data', 'data', 'kv.json');
        if (fs.existsSync(kvPath)) {
          const kv = JSON.parse(fs.readFileSync(kvPath, 'utf8')) as Record<string, { value: unknown }>;
          const personaConfig = (kv['persona_config']?.value || {}) as Record<string, unknown>;
          const wf = (personaConfig.draftWorkflow || personaConfig.publishedWorkflow || personaConfig) as Record<string, unknown>;
          scheduleConfig = {
            schedules: wf.schedules || [],
            flowNodes: wf.flowNodes || [],
            flowConnections: wf.flowConnections || [],
            triggers: wf.triggers || [],
            idleVideoId: wf.idleVideoId || null,
          };
          const count = (scheduleConfig as { schedules: unknown[] }).schedules.length;
          console.log(`[odessa-schedule-plugin] Injected ${count} schedule(s) into build`);
        } else {
          console.log(`[odessa-schedule-plugin] KV not found at ${kvPath}, schedules not injected`);
        }
      } catch (e: unknown) {
        console.warn('[odessa-schedule-plugin] Could not read KV config:', (e as Error).message);
      }
      return {
        define: {
          __ODESSA_SCHEDULE_CONFIG__: JSON.stringify(scheduleConfig),
        },
      };
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      odessaSchedulePlugin(),
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
    build: {
      rollupOptions: {
        output: {
          // Separa libs estáveis em chunks cacheáveis (melhora cache entre
          // deploys e reduz o chunk principal). NÃO captura deps carregadas
          // dinamicamente (ex.: tesseract.js no CaptureStudio) — estas devolvem
          // undefined e o Rollup mantém seus chunks lazy.
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('react-dom') || id.includes('/scheduler/') || /[\\/]react[\\/]/.test(id)) {
              return 'vendor-react';
            }
            if (id.includes('lucide-react')) return 'vendor-icons';
            return undefined;
          },
        },
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
    },
  };
});
