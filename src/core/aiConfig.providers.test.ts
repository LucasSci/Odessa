import { afterEach, describe, expect, it } from 'vitest';
import { getAiConfig, providerKeyFor, resolveEffectiveProvider } from './aiConfig';

const KEY = 'odessa:ai:config:v2';
const save = (value: object) => window.localStorage.setItem(KEY, JSON.stringify(value));

describe('provedor de IA escolhido na tela', () => {
  afterEach(() => window.localStorage.clear());

  it('Gemini escolhido continua Gemini (antes voltava para Local em silêncio)', () => {
    save({ provider: 'gemini', geminiKey: 'k' });
    expect(getAiConfig().provider).toBe('gemini');
    expect(resolveEffectiveProvider()).toBe('gemini');
  });

  it('Mistral com chave é usada e a chave acompanha o pedido', () => {
    save({ provider: 'mistral', mistralKey: '  chave  ' });
    expect(resolveEffectiveProvider()).toBe('mistral');
    expect(providerKeyFor()).toBe('chave');
  });

  it('sem chave, Mistral e Gemini caem na IA local e nenhuma chave é enviada', () => {
    save({ provider: 'mistral' });
    expect(resolveEffectiveProvider()).toBe('ollama');
    expect(providerKeyFor()).toBeUndefined();
    save({ provider: 'gemini' });
    expect(resolveEffectiveProvider()).toBe('ollama');
  });
});
