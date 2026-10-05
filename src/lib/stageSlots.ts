/**
 * As duas camadas de vídeo do palco: preparar uma escondida e revelá-la sem
 * quadro preto nem escurecer.
 *
 * Revelar = a camada que entra sobe por cima e aparece; a que sai fica inteira
 * por baixo até a de cima cobrir tudo. (Antes as duas esmaeciam juntas: no meio
 * da troca só ~75% da luz chegava à tela.)
 */

type FrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number;
};

/** Resolve quando o vídeo tem o quadro da posição atual decodificado (ou no tempo limite). */
function waitForFrame(video: HTMLVideoElement, timeoutMs = 2000): Promise<void> {
  if (video.readyState >= 2 && !video.seeking) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      window.clearTimeout(timer);
      video.removeEventListener('seeked', check);
      video.removeEventListener('loadeddata', check);
      video.removeEventListener('canplay', check);
      resolve();
    };
    const check = () => {
      if (video.readyState >= 2 && !video.seeking) done();
    };
    const timer = window.setTimeout(done, timeoutMs);
    video.addEventListener('seeked', check);
    video.addEventListener('loadeddata', check);
    video.addEventListener('canplay', check);
  });
}

/** Resolve quando o vídeo já apresentou um quadro novo depois do play (ou no tempo limite). */
export function waitForPresentedFrame(video: HTMLVideoElement, timeoutMs = 150): Promise<void> {
  const v = video as FrameCallbackVideo;
  if (!v.requestVideoFrameCallback) return new Promise((r) => window.setTimeout(r, 34));
  return new Promise((resolve) => {
    const timer = window.setTimeout(resolve, timeoutMs);
    v.requestVideoFrameCallback?.(() => {
      window.clearTimeout(timer);
      resolve();
    });
  });
}

/** Carrega `src` (se mudou) e aguarda os metadados. */
export function loadSource(video: HTMLVideoElement, src: string, timeoutMs = 4000): Promise<void> {
  if (video.dataset.src !== src) {
    video.dataset.src = src;
    video.src = src;
    video.load();
  }
  if (video.readyState >= 1) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      window.clearTimeout(timer);
      video.removeEventListener('loadedmetadata', done);
      video.removeEventListener('error', done);
      resolve();
    };
    const timer = window.setTimeout(done, timeoutMs);
    video.addEventListener('loadedmetadata', done);
    video.addEventListener('error', done);
  });
}

/** Leva o vídeo a `sec` e aguarda o quadro de lá estar pronto. */
export async function seekTo(video: HTMLVideoElement, sec: number): Promise<void> {
  try {
    if (Math.abs(video.currentTime - sec) > 0.001) video.currentTime = sec;
  } catch {
    // Metadados podem atrasar dentro da fonte de navegador do OBS.
  }
  await waitForFrame(video);
}

/** Esconde a camada na hora, sem animação. */
export function hideSlot(video: HTMLVideoElement): void {
  video.style.transition = 'none';
  video.style.opacity = '0';
  video.style.zIndex = '0';
}

/**
 * Mostra `incoming` por cima de `outgoing`. A de baixo só some (e pausa) depois
 * que a de cima está inteira, então a tela nunca passa por preto.
 */
export function revealSlot(incoming: HTMLVideoElement, outgoing: HTMLVideoElement | null, fadeMs: number): Promise<void> {
  if (outgoing) outgoing.style.zIndex = '1';
  incoming.style.zIndex = '2';
  if (fadeMs <= 0) {
    incoming.style.transition = 'none';
    incoming.style.opacity = '1';
  } else {
    incoming.style.transition = 'none';
    incoming.style.opacity = '0';
    // Força o navegador a registrar o 0 antes de animar até 1.
    void incoming.offsetWidth;
    incoming.style.transition = `opacity ${fadeMs}ms linear`;
    incoming.style.opacity = '1';
  }
  return new Promise((resolve) => {
    window.setTimeout(() => {
      if (outgoing && outgoing !== incoming) {
        outgoing.pause();
        hideSlot(outgoing);
      }
      resolve();
    }, Math.max(0, fadeMs) + 34);
  });
}
