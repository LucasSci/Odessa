import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch, describeErrorBody, httpErrorMessage } from './apiFetch';

function mockFetch(status: number, body: unknown, raw = false) {
  const fn = vi.fn().mockResolvedValue(
    new Response(raw ? String(body) : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

async function fail(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    return error as ApiError;
  }
  throw new Error('a chamada deveria ter falhado');
}

describe('describeErrorBody', () => {
  it('lê detail em string, objeto com code e lista de validação', () => {
    expect(describeErrorBody(400, { detail: 'inválido' }).message).toBe('inválido');
    expect(describeErrorBody(503, { detail: { code: 'ai_unavailable', message: 'A IA nao respondeu.', errors: ['Ollama: off'] } })).toEqual({
      message: 'A IA nao respondeu. — Ollama: off',
      code: 'ai_unavailable',
    });
    expect(describeErrorBody(422, { detail: [{ msg: 'campo obrigatório' }, { msg: 'tipo errado' }] }).message).toBe('campo obrigatório; tipo errado');
    expect(describeErrorBody(500, null).message).toContain('HTTP 500');
  });
});

describe('apiFetch', () => {
  it('devolve o JSON quando ok', async () => {
    mockFetch(200, { ok: true, n: 3 });
    await expect(apiFetch<{ n: number }>('/health')).resolves.toEqual({ ok: true, n: 3 });
  });

  it('envia json com Content-Type e método', async () => {
    const fn = mockFetch(200, {});
    await apiFetch('/ai/respond', { method: 'POST', json: { a: 1 } });
    const init = fn.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"a":1}');
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
  });

  it('transforma HTTP de erro em ApiError com status, code e mensagem', async () => {
    mockFetch(503, { detail: { code: 'ai_unavailable', message: 'A IA nao respondeu.', errors: ['Gemini: chave inválida'] } });
    const error = await fail(apiFetch('/ai/respond'));
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(503);
    expect(error.code).toBe('ai_unavailable');
    expect(error.message).toContain('Gemini: chave inválida');
  });

  it('corpo de erro que não é JSON vira a mensagem', async () => {
    mockFetch(502, 'Bad Gateway', true);
    const error = await fail(apiFetch('/x'));
    expect(error.status).toBe(502);
    expect(error.message).toBe('Bad Gateway');
  });

  it('falha de rede vira ApiError network', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const error = await fail(apiFetch('/x'));
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('network');
  });

  it('timeout vira ApiError timeout', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('demorou', 'TimeoutError')));
    const error = await fail(apiFetch('/x', { timeoutMs: 2000 }));
    expect(error.code).toBe('timeout');
    expect(error.message).toContain('2s');
  });

  it('cancelamento do chamador continua sendo AbortError (não vira erro de rede)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('cancelado', 'AbortError')));
    const error = await fail(apiFetch('/x'));
    expect(error.name).toBe('AbortError');
  });
});

describe('httpErrorMessage', () => {
  it('extrai o detail do FastAPI em vez de mostrar o JSON cru', async () => {
    const res = new Response(JSON.stringify({ detail: 'Backend temporarily unavailable' }), { status: 503 });
    await expect(httpErrorMessage(res)).resolves.toBe('Backend temporarily unavailable');
  });

  it('usa o texto quando o corpo não é JSON e um fallback quando é vazio', async () => {
    await expect(httpErrorMessage(new Response('Bad gateway', { status: 502 }))).resolves.toBe('Bad gateway');
    await expect(httpErrorMessage(new Response('', { status: 500 }))).resolves.toBe('Falha na chamada ao backend (HTTP 500).');
  });
});
