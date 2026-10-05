/**
 * videoPoster — miniatura JPEG de um clip, gerada uma vez e guardada no servidor.
 *
 * Antes cada miniatura era um <video> aberto (166 na tela Ao Vivo). Cada um
 * segurava uma das 6 conexões por origem e a API ficava na fila: as páginas
 * demoravam a aparecer. Agora a tela mostra um <img> de /video/thumb/{id};
 * quando ele ainda não existe (404), o navegador decodifica UM vídeo por vez,
 * tira o quadro de 0,5 s e envia o JPEG. Da próxima vez é só a imagem.
 */
import { apiFetch } from './apiFetch';
import { apiUrl } from './api';

const FRAME_TIME_SEC = 0.5;
const POSTER_WIDTH = 240;
const GENERATE_TIMEOUT_MS = 15_000;

/** Id do clip a partir da URL de reprodução (/video/play/{id}). */
export function videoIdFromSrc(src: string): string | null {
  const match = /\/video\/play\/([^/?#]+)/.exec(src);
  return match ? decodeURIComponent(match[1]) : null;
}

export function posterUrl(videoId: string): string {
  return apiUrl(`/api/video/thumb/${encodeURIComponent(videoId)}`);
}

// Blobs gerados nesta sessão: a mesma miniatura em telas diferentes não
// decodifica o vídeo duas vezes.
const generated = new Map<string, Promise<string | null>>();
let queue: Promise<unknown> = Promise.resolve();

function grabFrame(src: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    let done = false;
    const finish = (blob: Blob | null) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      // Solta a conexão e o decodificador na hora.
      video.removeAttribute('src');
      video.load();
      resolve(blob);
    };
    const timer = window.setTimeout(() => finish(null), GENERATE_TIMEOUT_MS);
    video.addEventListener('error', () => finish(null), { once: true });
    video.addEventListener(
      'seeked',
      () => {
        const width = Math.min(POSTER_WIDTH, video.videoWidth || POSTER_WIDTH);
        const height = Math.round((width / (video.videoWidth || 9)) * (video.videoHeight || 16));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return finish(null);
        ctx.drawImage(video, 0, 0, width, height);
        canvas.toBlob((blob) => finish(blob), 'image/jpeg', 0.8);
      },
      { once: true },
    );
    video.addEventListener(
      'loadedmetadata',
      () => {
        video.currentTime = Math.min(FRAME_TIME_SEC, (video.duration || 1) / 2);
      },
      { once: true },
    );
    video.src = src;
  });
}

/** Gera (uma vez, em fila) a miniatura do clip e devolve uma URL local para ela. */
export function generatePoster(videoId: string, src: string): Promise<string | null> {
  const existing = generated.get(videoId);
  if (existing) return existing;
  const job = queue.then(async () => {
    const blob = await grabFrame(src);
    if (!blob) return null;
    void apiFetch(`/api/video/thumb/${encodeURIComponent(videoId)}`, {
      method: 'POST',
      rawBody: blob,
      headers: { 'Content-Type': 'image/jpeg' },
    }).catch(() => undefined);
    return URL.createObjectURL(blob);
  });
  queue = job.catch(() => undefined);
  generated.set(videoId, job);
  return job;
}
