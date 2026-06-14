/**
 * Pré-carregamento de vídeos (Fase 1 da otimização de live) — com versão.
 *
 * Baixa os vídeos do fluxo no início e guarda como Blob em MEMÓRIA (object URL).
 * Assim cada reação toca NA HORA, sem depender da busca lenta no CDN — e como o
 * blob está inteiro em memória, busca/seek funciona mesmo sem "range" no servidor.
 *
 * CONSCIÊNCIA DE VERSÃO: cada vídeo é guardado com uma "versão" (o `uploadedAt`
 * do arquivo). Quando o operador troca um vídeo (mesmo nome → mesmo id, conteúdo
 * novo), a versão muda; aí o blob velho é descartado e o novo é baixado. Sem
 * isso, o overlay (que num live 24/7 nunca recarrega) ficaria tocando o vídeo
 * ANTIGO pra sempre. Usa `cache: 'reload'` pra furar o cache HTTP do navegador.
 *
 * O download é gentil (2 simultâneos + intervalo) pra não saturar a conexão.
 */

import { apiUrl } from './api';

type Entry = { url: string; version: string };

const preloaded = new Map<string, Entry>(); // videoId -> { blob url, versão }
let running = false;

/** URL pra tocar o vídeo: o blob pré-carregado (instantâneo) ou o stream normal. */
export function videoSrcFor(videoId: string): string {
  const hit = preloaded.get(videoId);
  return hit ? hit.url : apiUrl(`/api/video/play/${encodeURIComponent(videoId)}`);
}

/** Versão (uploadedAt) com que o vídeo está pré-carregado, ou '' se não está. */
export function videoVersion(videoId: string): string {
  return preloaded.get(videoId)?.version ?? '';
}

export function isPreloaded(videoId: string): boolean {
  return preloaded.has(videoId);
}

export function preloadStats(): { done: number } {
  return { done: preloaded.size };
}

/**
 * Pré-carrega/atualiza a lista de vídeos em memória (idempotente). Baixa só o que
 * falta OU o que mudou de versão. Pode ser chamada periodicamente com a lista
 * atualizada — vídeos trocados são re-baixados e o blob velho é liberado.
 */
export async function preloadVideos(items: Array<{ id: string; version?: string }>): Promise<void> {
  if (running) return;
  running = true;
  const seen = new Set<string>();
  const todo = items.filter((it) => {
    if (!it.id || seen.has(it.id)) return false;
    seen.add(it.id);
    const cur = preloaded.get(it.id);
    return !cur || cur.version !== (it.version || ''); // novo ou conteúdo trocado
  });
  let i = 0;
  const worker = async () => {
    while (i < todo.length) {
      const { id, version = '' } = todo[i++];
      try {
        // cache:'reload' garante bytes frescos da rede (não o cache HTTP velho do
        // navegador) — essencial quando o vídeo foi trocado mantendo o mesmo id.
        const res = await fetch(apiUrl(`/api/video/play/${encodeURIComponent(id)}`), { cache: 'reload' });
        if (res.ok) {
          const blob = await res.blob();
          if (blob.size > 0) {
            const prev = preloaded.get(id);
            preloaded.set(id, { url: URL.createObjectURL(blob), version });
            // Libera o blob velho DEPOIS de um tempo: se ele ainda for o src de um
            // <video> em transição, revogar na hora quebraria a reprodução. 15s
            // cobre qualquer transição em andamento (o player troca em <1s).
            if (prev?.url?.startsWith('blob:')) {
              const stale = prev.url;
              setTimeout(() => URL.revokeObjectURL(stale), 15000);
            }
            console.log(
              `[Odessa] vídeo pré-carregado: ${id}${version ? ` v=${version}` : ''} (${(blob.size / 1e6).toFixed(1)}MB) — ${preloaded.size} em memória`,
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
