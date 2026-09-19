import { useEffect, useState } from 'react';

const SEEK_TIMEOUT_MS = 2500;

/**
 * Gera `count` miniaturas igualmente espaçadas de um vídeo (blob URL) no
 * próprio navegador — o backend só sugere "client-filmstrip". Usa um <video>
 * fora da tela, então não mexe no player do editor. Publica de 4 em 4 quadros
 * para a faixa ir aparecendo enquanto gera.
 */
export function useFilmstrip(src: string | null, duration: number, count = 32): string[] {
  const [frames, setFrames] = useState<string[]>([]);

  useEffect(() => {
    setFrames([]);
    if (!src || !(duration > 0)) return;
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
        if (i % 4 === 3 && !cancelled) setFrames(out.slice());
      }
      if (!cancelled) setFrames(out);
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

  return frames;
}
