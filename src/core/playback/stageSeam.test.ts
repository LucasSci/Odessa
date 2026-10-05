import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FRAME_SEC,
  NATURAL_END_WINDOW_SEC,
  clipStartSec,
  isLastFrame,
  isStaleAfterSeam,
  nextFrameSec,
  sameFootage,
  seamStartSec,
  shouldWaitForNaturalEnd,
} from './stageSeam';

describe('emenda contínua do palco', () => {
  it('o próximo clipe começa no 2º quadro, porque o 1º repete o último do anterior', () => {
    const t = seamStartSec({ videoId: 'b' }, 1 / 24);
    // cai dentro do 2º quadro (entre 1/24 e 2/24 s), nunca no 1º
    expect(t).toBeGreaterThan(1 / 24);
    expect(t).toBeLessThan(2 / 24);
  });

  it('sem medida do quadro, usa 1/24 s e ainda cai no 2º quadro a 24 ou 30 fps', () => {
    const t = seamStartSec({ videoId: 'b' }, Number.NaN);
    expect(t).toBe(DEFAULT_FRAME_SEC * 1.5);
    expect(t).toBeGreaterThan(1 / 24);
    expect(t).toBeLessThan(2 / 24);
    expect(t).toBeGreaterThan(1 / 30);
    expect(t).toBeLessThan(2 / 30 + 1e-9);
  });

  it('clipe com corte no início começa no corte, sem pular quadro', () => {
    expect(seamStartSec({ videoId: 'b', startSec: 2 }, 1 / 24)).toBe(2);
    expect(seamStartSec({ videoId: 'b', segments: [{ startSec: 1.5, endSec: 3 }] }, 1 / 24)).toBe(1.5);
    expect(clipStartSec({ videoId: 'b', startSec: 0.5, segments: [{ startSec: 1, endSec: 2 }] })).toBe(1);
  });

  it('mesmo vídeo e trecho com só o "repetir" diferente é a mesma imagem (não troca de camada)', () => {
    const idle = { nodeId: 'n1', videoId: 'idle', startSec: 0, endSec: null, loop: true };
    expect(sameFootage(idle, { ...idle, loop: false })).toBe(true);
    expect(sameFootage(idle, { ...idle, videoId: 'outro' })).toBe(false);
    expect(sameFootage(idle, { ...idle, endSec: 4 })).toBe(false);
    expect(sameFootage(idle, { ...idle, segments: [{ startSec: 0, endSec: 2 }] })).toBe(false);
    expect(sameFootage(idle, null)).toBe(false);
  });

  it('servidor já no próximo (outro player avisou antes) e o atual no fim: espera o fim natural', () => {
    const base = { incomingKey: 'b', armedKey: 'b', activeLoops: false };
    expect(shouldWaitForNaturalEnd({ ...base, remainingSec: 0.4 })).toBe(true);
    expect(shouldWaitForNaturalEnd({ ...base, remainingSec: NATURAL_END_WINDOW_SEC + 1 })).toBe(false);
    // já passou do fim: não há o que esperar
    expect(shouldWaitForNaturalEnd({ ...base, remainingSec: 0 })).toBe(false);
    // um gatilho mandou outro clipe: troca na hora
    expect(shouldWaitForNaturalEnd({ ...base, incomingKey: 'gatilho', remainingSec: 0.4 })).toBe(false);
    // nada pronto aqui ainda
    expect(shouldWaitForNaturalEnd({ ...base, armedKey: null, remainingSec: 0.4 })).toBe(false);
    expect(shouldWaitForNaturalEnd({ ...base, activeLoops: true, remainingSec: 0.4 })).toBe(false);
  });

  it('o estado atrasado do clipe que acabou de sair não puxa o palco de volta', () => {
    const pending = { fromKey: 'a', at: 1000 };
    expect(isStaleAfterSeam(pending, 'a', 1500)).toBe(true);
    expect(isStaleAfterSeam(pending, 'b', 1500)).toBe(false);
    expect(isStaleAfterSeam(pending, 'a', 7000)).toBe(false);
    expect(isStaleAfterSeam(null, 'a', 1500)).toBe(false);
  });

  it('a duração do quadro fica com o menor salto visto e ignora saltos sem sentido', () => {
    let f = DEFAULT_FRAME_SEC;
    f = nextFrameSec(f, 2 / 30); // quadro pulado
    expect(f).toBe(DEFAULT_FRAME_SEC);
    f = nextFrameSec(f, 1 / 30);
    expect(f).toBeCloseTo(1 / 30);
    expect(nextFrameSec(f, 0)).toBe(f);
    expect(nextFrameSec(f, 3)).toBe(f); // busca/volta ao início
  });

  it('reconhece o último quadro do vídeo (8 s a 24 fps: o quadro de 7,958 s)', () => {
    expect(isLastFrame(8 - 1 / 24, 8, 1 / 24)).toBe(true);
    expect(isLastFrame(8 - 2 / 24, 8, 1 / 24)).toBe(false);
    expect(isLastFrame(3, Number.NaN, 1 / 24)).toBe(false);
  });
});
