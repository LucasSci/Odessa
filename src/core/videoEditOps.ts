import type { VideoSegment } from './videoEdits';

export const MIN_SEGMENT_SEC = 0.05;
export const MIN_SPEED = 0.25;
export const MAX_SPEED = 4;

const round2 = (n: number) => Math.round(n * 100) / 100;

export function clampSpeed(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, n));
}

/**
 * Divide o segmento que contém `time`. Sem segmentos (vídeo inteiro), cria dois
 * a partir de [0, duration]. Devolve null se o ponto cai fora de qualquer
 * segmento ou perto demais de uma borda (geraria um pedaço menor que o mínimo).
 */
export function splitAt(
  segments: VideoSegment[],
  time: number,
  duration: number,
): { segments: VideoSegment[]; selectIndex: number } | null {
  const t = round2(time);
  if (segments.length === 0) {
    if (!(duration > 0) || t < MIN_SEGMENT_SEC || t > duration - MIN_SEGMENT_SEC) return null;
    return {
      segments: [
        { startSec: 0, endSec: t },
        { startSec: t, endSec: round2(duration) },
      ],
      selectIndex: 1,
    };
  }
  const index = segments.findIndex((s) => t > s.startSec + MIN_SEGMENT_SEC && t < s.endSec - MIN_SEGMENT_SEC);
  if (index < 0) return null;
  const seg = segments[index];
  const next = segments.slice();
  next.splice(index, 1, { ...seg, endSec: t }, { ...seg, startSec: t });
  return { segments: next, selectIndex: index + 1 };
}

/** Duplica o segmento logo depois dele. */
export function duplicateSegment(
  segments: VideoSegment[],
  index: number,
): { segments: VideoSegment[]; selectIndex: number } | null {
  const seg = segments[index];
  if (!seg) return null;
  const next = segments.slice();
  next.splice(index + 1, 0, { ...seg });
  return { segments: next, selectIndex: index + 1 };
}

/**
 * Ímã: devolve o candidato mais próximo de `time` dentro do limiar (em
 * segundos), ou o próprio `time` se nenhum estiver perto.
 */
export function snapTime(time: number, candidates: number[], thresholdSec: number): number {
  let best = time;
  let bestDist = thresholdSec;
  for (const c of candidates) {
    const d = Math.abs(c - time);
    if (d <= bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}

/** Pontos de ímã: 0, fim do vídeo, playhead e bordas de todos os segmentos (menos o que está sendo arrastado). */
export function snapCandidates(
  segments: VideoSegment[],
  opts: { playhead: number; duration: number; ignoreIndex?: number },
): number[] {
  const out = [0, opts.playhead];
  if (opts.duration > 0) out.push(opts.duration);
  segments.forEach((s, i) => {
    if (i === opts.ignoreIndex) return;
    out.push(s.startSec, s.endSec);
  });
  return out;
}

/** Duração real de reprodução (segundos de relógio), considerando a velocidade de cada trecho. */
export function playbackSeconds(segments: VideoSegment[]): number {
  return segments.reduce((sum, s) => sum + Math.max(0, s.endSec - s.startSec) / clampSpeed(s.speed), 0);
}
