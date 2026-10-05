import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPreloaded, preloadVideos } from './videoPreload';

afterEach(() => vi.unstubAllGlobals());

describe('preloadVideos', () => {
  it('solta da memória o vídeo que saiu do fluxo', async () => {
    // jsdom transforma o Blob da Response em texto (tamanho 0 em algumas versões do
    // Node, e o vídeo não era guardado): um blob falso com tamanho explícito.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => ({ size: 1 }) })));
    let n = 0;
    vi.stubGlobal('URL', Object.assign(Object.create(URL), { createObjectURL: () => `blob:${++n}`, revokeObjectURL: vi.fn() }));
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      const first = preloadVideos([{ id: 'a' }, { id: 'b' }]);
      await vi.runAllTimersAsync();
      await first;
      expect(isPreloaded('a') && isPreloaded('b')).toBe(true);

      const second = preloadVideos([{ id: 'b' }]);
      await vi.runAllTimersAsync();
      await second;
      expect(isPreloaded('a')).toBe(false);
      expect(isPreloaded('b')).toBe(true);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:1');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('teto de memória da pré-carga', () => {
  it('para de guardar novos clipes ao passar do teto e o resto toca pelo stream', async () => {
    vi.resetModules();
    const { preloadVideos, isPreloaded, videoSrcFor, MAX_PRELOAD_BYTES } = await import('./videoPreload');
    const big = Math.ceil(MAX_PRELOAD_BYTES / 2) + 1;
    // jsdom transforma o Blob da Response em texto: um blob falso com o tamanho certo.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => ({ size: big }) })));
    let n = 0;
    vi.stubGlobal('URL', Object.assign(Object.create(URL), { createObjectURL: () => `blob:${++n}`, revokeObjectURL: vi.fn() }));
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      const run = preloadVideos([{ id: 'idle' }, { id: 'a' }, { id: 'b' }, { id: 'c' }]);
      await vi.runAllTimersAsync();
      await run;
    } finally {
      vi.useRealTimers();
    }
    const kept = ['idle', 'a', 'b', 'c'].filter(isPreloaded);
    expect(kept.length).toBeLessThan(4);
    expect(isPreloaded('idle')).toBe(true); // o idle vem primeiro e sempre fica
    expect(videoSrcFor('c')).toMatch(/\/video\/play\/c$/);
  });
});
