import { afterEach, describe, expect, it } from 'vitest';
import { getAiConfig } from './aiConfig';

const KEY = 'odessa:ai:config:v2';

describe('aiConfig — modelo local', () => {
  afterEach(() => window.localStorage.clear());

  it('padrão é o qwen2.5:3b (leve o bastante para rodar junto com a live)', () => {
    expect(getAiConfig().localModelName).toBe('qwen2.5:3b');
  });

  it.each(['qwen2.5:latest', 'gemma4:26b', 'llama3.1:8b'])('modelo pesado salvo (%s) migra para o 3b', (heavy) => {
    window.localStorage.setItem(KEY, JSON.stringify({ localModelName: heavy }));
    expect(getAiConfig().localModelName).toBe('qwen2.5:3b');
  });

  it('respeita outro modelo leve escolhido pelo usuário', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ localModelName: 'qwen2.5:1.5b' }));
    expect(getAiConfig().localModelName).toBe('qwen2.5:1.5b');
  });
});
