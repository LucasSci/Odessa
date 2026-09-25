/// <reference types="vitest" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';

// ── __ODESSA_SCHEDULE_CONFIG__ ──────────────────────────────────────────────
// Na época da Hostinger este plugin embutia no bundle o fluxo lido de
// ~/odessa-data/data/kv.json no momento do build. No app desktop isso colava
// no overlay do OBS um fluxo velho (ou vazio) da máquina que gerou o build — e
// com ele a trava de fluxo do overlay descartava os vídeos da automação.
// O overlay busca o fluxo do backend em tempo real; aqui fica sempre null.
function odessaSchedulePlugin(): Plugin {
  return {
    name: 'odessa-schedule-inject',
    config() {
      return { define: { __ODESSA_SCHEDULE_CONFIG__: 'null' } };
    },
  };
}

// Suppress transient proxy errors so the dev server doesn't log scary
// ECONNREFUSED/ENOTFOUND messages when the API is mid-reload (uvicorn --reload)
// or the tango bridge (port 7555) hasn't started yet — it's an on-demand
// subprocess, not always running.
function suppressProxyErrors(proxy: { on: (event: string, handler: (...args: unknown[]) => void) => void }) {
  // Remove Vite's default 'error' listener so it doesn't log scary
  // ECONNREFUSED/ENOTFOUND messages during API reloads — we handle it ourselves.
  (proxy as unknown as { removeAllListeners: (e: string) => void }).removeAllListeners('error');
  proxy.on('error', (_err: unknown, _req: unknown, res: unknown) => {
    const target = res as {
      writeHead?: (statusCode: number, headers?: Record<string, string>) => void;
      end?: (body?: string) => void;
      headersSent?: boolean;
      destroy?: () => void;
    };
    // HTTP proxy: respond with 502 instead of crashing
    if (target?.writeHead && !target.headersSent) {
      target.writeHead(502, { 'Content-Type': 'application/json' });
      target.end?.(JSON.stringify({ detail: 'Backend temporarily unavailable' }));
      return;
    }
    // WebSocket proxy (tango-bridge): destroy the socket silently
    target?.destroy?.();
  });
}

export default defineConfig(() => {
  const apiTarget = process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8000';
  // Tango bridge (tango_chat.py). A bridge exige um token que só o backend
  // conhece, então em dev o Vite NÃO fala mais direto com a porta 7555: manda
  // /tango-bridge/* para o backend, que já faz esse proxy (HTTP + WebSocket)
  // acrescentando o token. VITE_BRIDGE_PROXY_TARGET continua valendo para quem
  // aponta para uma bridge direta (ex.: docker-compose com TANGO_BRIDGE_TOKEN).
  const bridgeDirectTarget = process.env.VITE_BRIDGE_PROXY_TARGET || '';
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
      allowedHosts: true as const,
      proxy: {
        '/api': {
          target: apiTarget,
          configure: suppressProxyErrors,
        },
        '/auth': {
          target: apiTarget,
          configure: suppressProxyErrors,
        },
        '/obs': {
          target: apiTarget,
          configure: suppressProxyErrors,
        },
        '/agent': {
          target: apiTarget,
          configure: suppressProxyErrors,
        },
        '/webhooks': {
          target: apiTarget,
          configure: suppressProxyErrors,
        },
        '/tango-bridge': bridgeDirectTarget
          ? {
              target: bridgeDirectTarget,
              rewrite: (path: string) => path.replace(/^\/tango-bridge/, ''),
              changeOrigin: true,
              ws: true,
              configure: suppressProxyErrors,
            }
          : {
              target: apiTarget,
              changeOrigin: true,
              ws: true,
              configure: suppressProxyErrors,
            },
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
          // dinamicamente via import() — estas devolvem undefined e o Rollup
          // mantém seus chunks lazy.
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return undefined;
            // @sentry/react casaria com /react/ abaixo e iria para o vendor
            // carregado sempre — ele é lazy (src/lib/observability.ts).
            if (id.includes('@sentry')) return undefined;
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
