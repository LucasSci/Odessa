/**
 * frameCapture.ts
 *
 * Captura do frame base do vídeo em reprodução para alimentar o pipeline de
 * geração de vídeo em tempo real. O ReactiveVideoPlayer registra uma função de
 * captura (via registerFrameCapture) que desenha o elemento <video> ativo num
 * canvas e devolve um data URL. O chatToTriggerBridge chama captureActiveFrame
 * ao rotear mensagens, enviando o frame para POST /api/video-gen/frame.
 */

const FRAME_ENDPOINT = '/api/video-gen/frame';

let activeCapture: (() => Promise<string | null>) | null = null;

/** Registra a função de captura do player ativo (chamado pelo ReactiveVideoPlayer). */
export function registerFrameCapture(fn: () => Promise<string | null>): void {
  activeCapture = fn;
}

/** Remove o registro quando o player desmonta. */
export function unregisterFrameCapture(): void {
  activeCapture = null;
}

/**
 * Desenha um elemento <video> num canvas e devolve um data URL.
 * Retorna null se o vídeo ainda não tiver frames decodificados.
 */
export function captureVideoFrame(video: HTMLVideoElement | null, format: 'png' | 'jpeg' = 'png'): string | null {
  if (!video || video.readyState < 2 || video.videoWidth === 0) return null;
  const width = video.videoWidth || 720;
  const height = video.videoHeight || 1280;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, width, height);
  return canvas.toDataURL(`image/${format}`);
}

/** Captura o frame do vídeo ativo (via função registrada pelo player). */
export async function captureActiveFrame(): Promise<string | null> {
  if (!activeCapture) return null;
  try {
    return await activeCapture();
  } catch {
    return null;
  }
}

/**
 * Captura o frame ativo e o envia para o backend. Silencioso em falhas para
 * não interromper o fluxo do chat. Retorna true se o frame foi enviado.
 */
export async function sendActiveFrame(): Promise<boolean> {
  const dataUrl = await captureActiveFrame();
  if (!dataUrl) return false;
  try {
    const res = await fetch(FRAME_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
