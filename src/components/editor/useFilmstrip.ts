import { useEffect, useState } from 'react';

const SEEK_TIMEOUT_MS = 2500;

/**
 * Gera `count` miniaturas igualmente espaçadas de um vídeo (blob URL) no
 * próprio navegador — o backend só sugere "client-filmstrip". Usa um <video>
 * fora da tela, então não mexe no player do editor. Publica de 4 em 4 quadros
 * para a faixa ir aparecendo enquanto gera.
 */
const NO_FRAMES: string[] = [];

export function useFilmstrip(src: string | null, duration: number, count = 32): string[] {
  // Os quadros ficam guardados junto com a chave do vídeo que os gerou: trocar
  // de vídeo devolve lista vazia na hora, sem precisar zerar estado no efeito.
  const key = src && duration > 0 ? `${src}|${duration}|${count}` : null;
  const [strip, setStrip] = useState<{ key: string | null; frames: string[] }>({ key: null, frames: NO_FRAMES });

  useEffect(() => {
    if (!src || !(duration > 0)) return;
    const stripKey = `${src}|${duration}|${count}`;
    let cancelled = false;
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = src;
    const canvas = document.createElement('canvas');

    const seek = (t: number) =>
      new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, SEEK_TIMEOUT_MS);
        video.onseeked = () => {
          window.clearTimeout(timer);
          resolve();
        };
        video.currentTime = t;
      });

    const run = async () => {
      await new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve();
        video.onerror = () => reject(new Error('filmstrip: vídeo não carregou'));
      });
      const width = 72;
      const ratio = video.videoWidth > 0 ? video.videoHeight / video.videoWidth : 16 / 9;
      canvas.width = width;
      canvas.height = Math.max(1, Math.round(width * ratio));
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const out: string[] = [];
      for (let i = 0; i < count; i++) {
        if (cancelled) return;
        await seek(Math.min(Math.max(0, duration - 0.05), ((i + 0.5) * duration) / count));
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        out.push(canvas.toDataURL('image/jpeg', 0.6));
        if (i % 4 === 3 && !cancelled) setStrip({ key: stripKey, frames: out.slice() });
      }
      if (!cancelled) setStrip({ key: stripKey, frames: out });
    };
    run().catch(() => undefined);

    return () => {
      cancelled = true;
      video.onseeked = null;
      video.onloadeddata = null;
      video.onerror = null;
      video.removeAttribute('src');
      video.load();
    };
  }, [src, duration, count]);

  return strip.key === key ? strip.frames : NO_FRAMES;
}
