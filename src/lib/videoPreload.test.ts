import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPreloaded, preloadVideos } from './videoPreload';

afterEach(() => vi.unstubAllGlobals());

describe('preloadVideos', () => {
  it('solta da memória o vídeo que saiu do fluxo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['x']))));
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
