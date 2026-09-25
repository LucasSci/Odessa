import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TangoChatSessionProvider, useTangoChatSession, type SendOutcome } from './tangoChatSession';

// Envio real pela bridge (#158): o que a bridge responde tem que chegar inteiro
// na tela — confirmação no chat, motivo do erro e o id do comando.

type Api = ReturnType<typeof useTangoChatSession>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function mountWithSendResponse(sendResponse: () => Response) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/tango-bridge/send')) return sendResponse();
    // Status/logs/config: o provider funciona sem eles.
    return json({}, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  let api!: Api;
  function Probe() {
    api = useTangoChatSession();
    return null;
  }
  render(
    <TangoChatSessionProvider>
      <Probe />
    </TangoChatSessionProvider>,
  );
  return { api: () => api, fetchMock };
}

async function send(api: () => Api, text: string): Promise<SendOutcome> {
  let outcome!: SendOutcome;
  await act(async () => {
    outcome = await api().sendWithOutcome(text);
  });
  return outcome;
}

describe('sendWithOutcome (#158)', () => {
  beforeEach(() => {
    window.localStorage.setItem('odessa:tango:autonomy:v1', JSON.stringify({ autonomyMode: 'assistido', executionMode: 'real' }));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it('enviada e confirmada no chat', async () => {
    const { api } = await mountWithSendResponse(() => json({ ok: true, confirmed: true, commandId: 'abc123' }));
    await expect(send(api, 'oi chat')).resolves.toEqual({ status: 'sent', confirmed: true, commandId: 'abc123' });
  });

  it('enviada sem aparecer no chat continua "sent", mas marcada como não confirmada', async () => {
    const { api } = await mountWithSendResponse(() => json({ ok: true, confirmed: false, commandId: 'def456' }));
    await expect(send(api, 'oi chat')).resolves.toMatchObject({ status: 'sent', confirmed: false });
  });

  it('erro da bridge (HTTP 500) traz o motivo e o comando, não uma mensagem genérica', async () => {
    const { api } = await mountWithSendResponse(() =>
      json({ ok: false, error: 'O Tango não aceitou o envio: o texto ficou no campo do chat.', stage: 'not_submitted', commandId: 'ghi789' }, 500),
    );
    await expect(send(api, 'oi chat')).resolves.toEqual({
      status: 'failed',
      error: 'O Tango não aceitou o envio: o texto ficou no campo do chat.',
      commandId: 'ghi789',
    });
  });

  it('modo teste não chama a bridge', async () => {
    window.localStorage.setItem('odessa:tango:autonomy:v1', JSON.stringify({ autonomyMode: 'assistido', executionMode: 'dry_run' }));
    const { api, fetchMock } = await mountWithSendResponse(() => json({ ok: true, confirmed: true }));
    await expect(send(api, 'oi chat')).resolves.toEqual({ status: 'simulated' });
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/send'))).toBe(false);
  });
});
