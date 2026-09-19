import { describe, expect, it } from 'vitest';
import { clampFadeMs, clipProgress, effectiveSegments, MAX_FADE_MS } from './clipTimeline';

describe('effectiveSegments', () => {
  it('prioriza segments explícitos, na ordem dada', () => {
    const segs = [{ startSec: 5, endSec: 6 }, { startSec: 1, endSec: 2 }];
    expect(effectiveSegments({ segments: segs, startSec: 0, endSec: 9 })).toBe(segs);
  });

  it('usa trim simples como único segmento', () => {
    expect(effectiveSegments({ startSec: 2, endSec: 7 })).toEqual([{ startSec: 2, endSec: 7 }]);
  });

  it('devolve [] para vídeo inteiro ou clip nulo', () => {
    expect(effectiveSegments({ startSec: 0, endSec: null })).toEqual([]);
    expect(effectiveSegments(null)).toEqual([]);
  });
});

describe('clampFadeMs', () => {
  it('limita ao máximo e arredonda', () => {
    expect(clampFadeMs(220.6)).toBe(221);
    expect(clampFadeMs(99999)).toBe(MAX_FADE_MS);
  });

  it('trata valores inválidos como corte seco', () => {
    for (const v of [undefined, null, NaN, -5, 0, 'abc']) expect(clampFadeMs(v)).toBe(0);
  });
});

describe('clipProgress', () => {
  const segs = [{ startSec: 10, endSec: 12 }, { startSec: 0, endSec: 3 }];

  it('soma apenas os trechos já tocados (ordem livre)', () => {
    const clip = { segments: segs };
    expect(clipProgress(clip, 0, 11, 30)).toEqual({ elapsedSec: 1, totalSec: 5 });
    expect(clipProgress(clip, 1, 1, 30)).toEqual({ elapsedSec: 3, totalSec: 5 });
  });

  it('não passa do tamanho do segmento', () => {
    expect(clipProgress({ segments: segs }, 0, 99, 30)).toEqual({ elapsedSec: 2, totalSec: 5 });
  });

  it('usa a duração do arquivo quando não há cortes', () => {
    expect(clipProgress({ startSec: 0, endSec: null }, 0, 4, 10)).toEqual({ elapsedSec: 4, totalSec: 10 });
    expect(clipProgress({ startSec: 2, endSec: null }, 0, 5, 10)).toEqual({ elapsedSec: 3, totalSec: 8 });
  });

  it('conta em tempo de relógio quando há velocidade por trecho', () => {
    const clip = { segments: [{ startSec: 0, endSec: 4, speed: 2 }, { startSec: 10, endSec: 12 }] };
    expect(clipProgress(clip, 0, 2, 30)).toEqual({ elapsedSec: 1, totalSec: 4 });
    expect(clipProgress(clip, 1, 11, 30)).toEqual({ elapsedSec: 3, totalSec: 4 });
  });

  it('devolve null enquanto a duração é desconhecida', () => {
    expect(clipProgress({ startSec: 0, endSec: null }, 0, 1, NaN)).toBeNull();
    expect(clipProgress({ startSec: 0, endSec: null }, 0, 1, 0)).toBeNull();
  });
});
