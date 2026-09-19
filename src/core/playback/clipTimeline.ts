export interface TimelineSegment {
  startSec: number;
  endSec: number;
}

export interface TimelineClip {
  startSec?: number;
  endSec?: number | null;
  segments?: TimelineSegment[];
}

export const MAX_FADE_MS = 2000;

/**
 * Segmentos limitados (com fim definido) que o player toca em sequência.
 * - segments[] explícitos → usa-os;
 * - senão, trim simples (startSec/endSec) → um único segmento;
 * - senão (sem fim) → [] (vídeo inteiro; o evento 'ended' nativo encerra).
 */
export function effectiveSegments(clip: TimelineClip | null | undefined): TimelineSegment[] {
  if (!clip) return [];
  if (clip.segments && clip.segments.length) return clip.segments;
  if (clip.endSec != null) return [{ startSec: Math.max(0, clip.startSec || 0), endSec: clip.endSec }];
  return [];
}

/** Duração do crossfade de entrada de um clip; valores inválidos viram corte seco (0). */
export function clampFadeMs(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_FADE_MS, Math.round(n));
}

export interface ClipProgress {
  elapsedSec: number;
  totalSec: number;
}

/**
 * Progresso do clip no ar. Com cortes, soma só os trechos que realmente tocam
 * (os pulos entre segmentos não contam). Sem cortes usa a duração do arquivo.
 * Devolve null enquanto a duração ainda não é conhecida.
 */
export function clipProgress(
  clip: TimelineClip | null | undefined,
  segmentIndex: number,
  currentSec: number,
  durationSec: number,
): ClipProgress | null {
  const segs = effectiveSegments(clip);
  if (segs.length) {
    const idx = Math.max(0, Math.min(segs.length - 1, segmentIndex));
    const lengths = segs.map((s) => Math.max(0, s.endSec - s.startSec));
    const totalSec = lengths.reduce((a, b) => a + b, 0);
    if (totalSec <= 0) return null;
    const before = lengths.slice(0, idx).reduce((a, b) => a + b, 0);
    const within = Math.max(0, Math.min(lengths[idx], currentSec - segs[idx].startSec));
    return { elapsedSec: before + within, totalSec };
  }
  if (!Number.isFinite(durationSec) || durationSec <= 0) return null;
  const start = Math.max(0, clip?.startSec || 0);
  const totalSec = Math.max(0, durationSec - start);
  if (totalSec <= 0) return null;
  return { elapsedSec: Math.max(0, Math.min(totalSec, currentSec - start)), totalSec };
}
