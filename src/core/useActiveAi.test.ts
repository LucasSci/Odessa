import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { saveAiConfig } from './aiConfig';
import { describeActiveAi, useActiveAi } from './useActiveAi';

describe('qual IA está respondendo', () => {
  afterEach(() => window.localStorage.clear());

  it('troca na hora em que o operador escolhe outro provedor', () => {
    const { result } = renderHook(() => useActiveAi());
    expect(result.current.provider).toBe('ollama');
    act(() => saveAiConfig({ provider: 'gemini', geminiKey: 'k' }));
    expect(result.current).toEqual({ provider: 'gemini', label: 'Google Gemini', missingKey: false });
    act(() => saveAiConfig({ provider: 'mistral', mistralKey: 'm' }));
    expect(result.current.label).toBe('Mistral');
  });

  it('avisa quando escolheu nuvem sem chave (está caindo na IA local)', () => {
    saveAiConfig({ provider: 'gemini', geminiKey: '' });
    expect(describeActiveAi()).toMatchObject({ provider: 'ollama', missingKey: true });
  });
});
