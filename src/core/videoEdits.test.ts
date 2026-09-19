import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyVideoEdit,
  defaultVideoEdit,
  getVideoEdit,
  hasVideoEdit,
  loadVideoEdits,
  persistVideoEdit,
  removeVideoEdit,
  saveVideoEdit,
  syncVideoEditsFromServer,
  type EditableClip,
} from './videoEdits';

const STORAGE_KEY = 'odessa:video-edits:v1';

function clip(videoId = 'v1'): EditableClip {
  return { videoId, startSec: 0, endSec: null, transitionMs: 100 };
}

describe('videoEdits', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('retorna null e mantém o clipe intacto quando não há edição salva', () => {
    const c = clip();
    expect(getVideoEdit('v1')).toBeNull();
    expect(hasVideoEdit('v1')).toBe(false);
    expect(applyVideoEdit(c)).toBe(c);
  });

  it('salva e relê uma edição normalizada', () => {
    saveVideoEdit({ ...defaultVideoEdit('v1'), volume: 5, transitionMs: 99999, audioMode: 'original' });
    const e = getVideoEdit('v1');
    expect(e?.volume).toBe(1);
    expect(e?.transitionMs).toBe(4000);
    expect(e?.audioMode).toBe('original');
    expect(hasVideoEdit('v1')).toBe(true);
  });

  it('descarta segmentos inválidos e preserva a ordem de reprodução', () => {
    saveVideoEdit({
      ...defaultVideoEdit('v1'),
      segments: [
        { startSec: 8, endSec: 10 },
        { startSec: 5, endSec: 5 },
        { startSec: 1, endSec: 3 },
      ],
    });
    expect(getVideoEdit('v1')?.segments).toEqual([
      { startSec: 8, endSec: 10 },
      { startSec: 1, endSec: 3 },
    ]);
  });

  it('usa o min/max real dos segmentos como início/fim do clipe (ordem livre)', () => {
    saveVideoEdit({
      ...defaultVideoEdit('v1'),
      segments: [
        { startSec: 8, endSec: 10 },
        { startSec: 1, endSec: 3 },
      ],
    });
    const out = applyVideoEdit(clip());
    expect(out.startSec).toBe(1);
    expect(out.endSec).toBe(10);
    expect(out.segments).toHaveLength(2);
    expect(out.audio?.mode).toBe('muted');
  });

  it('remove a edição', () => {
    saveVideoEdit({ ...defaultVideoEdit('v1'), volume: 0.5 });
    removeVideoEdit('v1');
    expect(getVideoEdit('v1')).toBeNull();
  });

  describe('sincronização com o servidor', () => {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    const original = globalThis.fetch;

    function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, method: init?.method ?? 'GET', body: init?.body as string | undefined });
        return handler(url, init);
      }) as typeof fetch;
    }

    beforeEach(() => { calls.length = 0; });
    afterEach(() => { globalThis.fetch = original; });

    it('persistVideoEdit salva local e faz PUT no servidor', async () => {
      mockFetch(() => new Response('{}', { status: 200 }));
      const ok = await persistVideoEdit({ ...defaultVideoEdit('v1'), volume: 0.3 });
      expect(ok).toBe(true);
      expect(getVideoEdit('v1')?.volume).toBe(0.3);
      expect(calls[0].method).toBe('PUT');
      expect(calls[0].url).toMatch(/\/video\/v1\/edit$/);
    });

    it('persistVideoEdit devolve false se o servidor cai, mas mantém o cache local', async () => {
      mockFetch(() => { throw new TypeError('Failed to fetch'); });
      const ok = await persistVideoEdit({ ...defaultVideoEdit('v1'), volume: 0.3 });
      expect(ok).toBe(false);
      expect(getVideoEdit('v1')?.volume).toBe(0.3);
    });

    it('sync: servidor vence conflito e edições só locais são enviadas ao servidor', async () => {
      saveVideoEdit({ ...defaultVideoEdit('local-only'), volume: 0.2 });
      saveVideoEdit({ ...defaultVideoEdit('both'), volume: 0.2 });
      mockFetch((_url, init) => {
        if (init?.method === 'PUT') return new Response('{}', { status: 200 });
        return new Response(JSON.stringify({ edits: { both: { ...defaultVideoEdit('both'), volume: 0.9 } } }), { status: 200 });
      });
      const count = await syncVideoEditsFromServer();
      expect(count).toBe(1);
      expect(getVideoEdit('both')?.volume).toBe(0.9);
      expect(getVideoEdit('local-only')?.volume).toBe(0.2);
      const puts = calls.filter((c) => c.method === 'PUT');
      expect(puts).toHaveLength(1);
      expect(puts[0].url).toMatch(/\/video\/local-only\/edit$/);
    });

    it('sync: servidor fora do ar devolve null e não mexe no cache local', async () => {
      saveVideoEdit({ ...defaultVideoEdit('v1'), volume: 0.4 });
      mockFetch(() => new Response('erro', { status: 500 }));
      expect(await syncVideoEditsFromServer()).toBeNull();
      expect(getVideoEdit('v1')?.volume).toBe(0.4);
    });
  });

  it('ignora JSON corrompido no storage', () => {
    window.localStorage.setItem(STORAGE_KEY, '{nao-e-json');
    expect(loadVideoEdits()).toEqual({});
    expect(getVideoEdit('v1')).toBeNull();
  });
});
