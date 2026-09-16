import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseAutoConfig, requestSelfGeneratedPhoto } from './personaSelfConfig';

describe('parseAutoConfig', () => {
  it('extrai photo_prompt junto com os outros campos', () => {
    const reply = [
      'Claro, vou mudar!',
      '<autoconfig>{"name": "Nova Odessa", "photo_prompt": "sorrindo com luz dourada"}</autoconfig>',
    ].join('\n');

    const { cleanText, changes } = parseAutoConfig(reply);

    expect(cleanText).toBe('Claro, vou mudar!');
    expect(changes).toEqual({ name: 'Nova Odessa', photo_prompt: 'sorrindo com luz dourada' });
  });

  it('não inclui photo_prompt quando o bloco não o menciona', () => {
    const reply = '<autoconfig>{"personality_add": "adora café"}</autoconfig>';
    const { changes } = parseAutoConfig(reply);
    expect(changes).toEqual({ personality_add: 'adora café' });
    expect(changes?.photo_prompt).toBeUndefined();
  });

  it('retorna changes null quando não há bloco autoconfig', () => {
    const { changes, cleanText } = parseAutoConfig('Oi, tudo bem?');
    expect(changes).toBeNull();
    expect(cleanText).toBe('Oi, tudo bem?');
  });
});

describe('requestSelfGeneratedPhoto', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('faz POST pro endpoint de geração de foto e repassa o resultado', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, status: 'queued', jobId: 'abc123' }),
    });

    const result = await requestSelfGeneratedPhoto('odessa', 'sorrindo', 'conversation');

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (fetch as any).mock.calls[0];
    expect(url).toContain('/personas/odessa/selfconfig/generate-photo');
    const body = JSON.parse(init.body);
    expect(body).toEqual({ prompt: 'sorrindo', source: 'conversation' });
    expect(result).toEqual({ ok: true, status: 'queued', jobId: 'abc123' });
  });

  it('nunca lança exceção quando a requisição falha (best-effort)', async () => {
    (fetch as any).mockRejectedValue(new Error('network down'));

    const result = await requestSelfGeneratedPhoto('odessa', 'sorrindo');

    expect(result).toEqual({ ok: false, status: 'network_error' });
  });

  it('reporta status http_XXX quando a resposta não é ok', async () => {
    (fetch as any).mockResolvedValue({ ok: false, status: 429 });

    const result = await requestSelfGeneratedPhoto('odessa', 'sorrindo');

    expect(result).toEqual({ ok: false, status: 'http_429' });
  });
});
