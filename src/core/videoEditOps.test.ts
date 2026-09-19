import { describe, expect, it } from 'vitest';
import {
  clampSpeed,
  duplicateSegment,
  playbackSeconds,
  snapCandidates,
  snapTime,
  splitAt,
} from './videoEditOps';

describe('splitAt', () => {
  it('sem segmentos, divide o vídeo inteiro em dois', () => {
    const r = splitAt([], 4, 10);
    expect(r?.segments).toEqual([
      { startSec: 0, endSec: 4 },
      { startSec: 4, endSec: 10 },
    ]);
    expect(r?.selectIndex).toBe(1);
  });

  it('divide o segmento que contém o ponto e mantém as propriedades', () => {
    const segs = [{ startSec: 1, endSec: 3 }, { startSec: 5, endSec: 9, speed: 2 }];
    const r = splitAt(segs, 7, 10);
    expect(r?.segments).toEqual([
      { startSec: 1, endSec: 3 },
      { startSec: 5, endSec: 7, speed: 2 },
      { startSec: 7, endSec: 9, speed: 2 },
    ]);
    expect(r?.selectIndex).toBe(2);
  });

  it('recusa pontos fora dos segmentos ou colados numa borda', () => {
    const segs = [{ startSec: 1, endSec: 3 }];
    expect(splitAt(segs, 4, 10)).toBeNull();
    expect(splitAt(segs, 1.02, 10)).toBeNull();
    expect(splitAt(segs, 2.99, 10)).toBeNull();
    expect(splitAt([], 0.01, 10)).toBeNull();
    expect(splitAt([], 5, 0)).toBeNull();
  });

  it('não muta a lista original', () => {
    const segs = [{ startSec: 0, endSec: 4 }];
    splitAt(segs, 2, 4);
    expect(segs).toEqual([{ startSec: 0, endSec: 4 }]);
  });
});

describe('duplicateSegment', () => {
  it('insere a cópia logo depois e seleciona a cópia', () => {
    const r = duplicateSegment([{ startSec: 0, endSec: 1 }, { startSec: 2, endSec: 3 }], 0);
    expect(r?.segments).toEqual([
      { startSec: 0, endSec: 1 },
      { startSec: 0, endSec: 1 },
      { startSec: 2, endSec: 3 },
    ]);
    expect(r?.selectIndex).toBe(1);
  });

  it('devolve null para índice inexistente', () => {
    expect(duplicateSegment([], 0)).toBeNull();
  });
});

describe('snapTime', () => {
  it('gruda no candidato mais próximo dentro do limiar', () => {
    expect(snapTime(2.04, [0, 2, 5], 0.1)).toBe(2);
    expect(snapTime(2.5, [0, 2, 5], 0.1)).toBe(2.5);
  });

  it('escolhe o mais perto entre dois candidatos', () => {
    expect(snapTime(1.06, [1, 1.1], 0.2)).toBe(1.1);
  });
});

describe('snapCandidates', () => {
  it('inclui início, fim, playhead e bordas, exceto o segmento arrastado', () => {
    const segs = [{ startSec: 1, endSec: 2 }, { startSec: 3, endSec: 4 }];
    const c = snapCandidates(segs, { playhead: 2.5, duration: 10, ignoreIndex: 1 });
    expect(c).toEqual([0, 2.5, 10, 1, 2]);
  });
});

describe('clampSpeed / playbackSeconds', () => {
  it('limita a velocidade e trata inválidos como 1', () => {
    expect(clampSpeed(10)).toBe(4);
    expect(clampSpeed(0.1)).toBe(0.25);
    expect(clampSpeed(undefined)).toBe(1);
    expect(clampSpeed(-2)).toBe(1);
  });

  it('soma o tempo real considerando a velocidade', () => {
    expect(playbackSeconds([{ startSec: 0, endSec: 4, speed: 2 }, { startSec: 0, endSec: 3 }])).toBe(5);
  });
});
