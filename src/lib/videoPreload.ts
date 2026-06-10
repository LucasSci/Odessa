/**
 * Pré-carregamento de vídeos (Fase 1 da otimização de live).
 *
 * Baixa os vídeos do fluxo no início e guarda como Blob em MEMÓRIA (object URL).
 * Assim cada reação toca NA HORA, sem depender da busca lenta no CDN — e como o
 * blob está inteiro em memória, busca/seek funciona mesmo sem "range" no servidor
 * (que hoje não tem). Isso ataca direto o trava/congela ao disparar um vídeo.
 *
 * O download é gentil (2 simultâneos + intervalo) pra não saturar a conexão e
 * atrapalhar o vídeo que já está tocando.
 */

import { apiUrl } from './api';

const preloaded = new Map<string, string>(); // videoId -> blob object URL
let running = false;

/** URL pra tocar o vídeo: o blob pré-carregado (instantâneo) ou o stream normal. */
export function videoSrcFor(videoId: string): string {
  return preloaded.get(videoId) || apiUrl(`/api/video/play/${encodeURIComponent(videoId)}`);
}

export function isPreloaded(videoId: string): boolean {
  return preloaded.has(videoId);
}

export function preloadStats(): { done: number } {
  return { done: preloaded.size };
}

/**
 * Pré-carrega a lista de vídeos em memória (idempotente). Pode ser chamada de
 * novo com a lista atualizada — só baixa o que ainda falta.
 */
export async function preloadVideos(videoIds: string[]): Promise<void> {
  if (running) return;
  running = true;
  const ids = Array.from(new Set(videoIds.filter(Boolean)));
  let i = 0;
  const worker = async () => {
    while (i < ids.length) {
      const id = ids[i++];
      if (preloaded.has(id)) continue;
      try {
        const res = await fetch(apiUrl(`/api/video/play/${encodeURIComponent(id)}`));
        if (res.ok) {
          const blob = await res.blob();
          if (blob.size > 0 && !preloaded.has(id)) {
            preloaded.set(id, URL.createObjectURL(blob));
            console.log(
              `[Odessa] vídeo pré-carregado: ${id} (${(blob.size / 1e6).toFixed(1)}MB) — ${preloaded.size}/${ids.length}`,
            );
          }
        }
      } catch {
        /* ignora — tenta os próximos; o player cai no stream normal */
      }
      // respiro pra não saturar a conexão e travar o vídeo que está no ar
      await new Promise((r) => setTimeout(r, 250));
    }
  };
  try {
    await Promise.all([worker(), worker()]); // 2 downloads simultâneos
  } finally {
    running = false;
  }
}
