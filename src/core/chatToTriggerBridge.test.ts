import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./frameCapture', () => ({
  sendActiveFrame: vi.fn().mockResolvedValue(undefined),
}));

// routeChatToTriggers guarda estado de dedupe/cooldown a nivel de modulo
// (recentKeys, lastIngestAt) -- vi.resetModules() + import dinamico por
// teste garante um modulo fresco a cada caso, sem um teste vazar cooldown
// pro proximo.
async function freshRouteChatToTriggers() {
  vi.resetModules();
  const mod = await import('./chatToTriggerBridge');
  return mod.routeChatToTriggers;
}

describe('routeChatToTriggers', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  });

  it('envia execute:true por padrao quando nenhuma opcao e passada', async () => {
    const routeChatToTriggers = await freshRouteChatToTriggers();
    await routeChatToTriggers({ username: 'Ana', text: 'oi', timestamp: '2026-01-01T00:00:00.000Z' });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [, init] = (fetch as any).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.execute).toBe(true);
  });

  it('repassa execute:false quando o Laboratorio pede modo seguro', async () => {
    const routeChatToTriggers = await freshRouteChatToTriggers();
    await routeChatToTriggers(
      { username: 'Voce', text: 'manda uma rosa', timestamp: '2026-01-01T00:00:00.000Z' },
      { execute: false },
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    const [, init] = (fetch as any).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.execute).toBe(false);
  });
});
