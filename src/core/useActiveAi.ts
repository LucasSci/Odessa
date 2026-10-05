/**
 * Qual IA está respondendo o chat agora — para a tela mostrar sem ambiguidade.
 *
 * Atualiza na hora em que o operador troca o provedor (evento de aiConfig) ou
 * quando outra aba do Odessa troca (evento `storage`).
 */
import { useEffect, useState } from 'react';
import { AI_CONFIG_EVENT, getAiConfig, resolveEffectiveProvider, type EffectiveProvider } from './aiConfig';

export type ActiveAi = {
  provider: EffectiveProvider;
  /** Nome curto para selo: "Google Gemini", "IA local · qwen2.5:3b"… */
  label: string;
  /** Escolheu nuvem mas falta a chave: está caindo na IA local. */
  missingKey: boolean;
};

export function describeActiveAi(): ActiveAi {
  const config = getAiConfig();
  const provider = resolveEffectiveProvider(config);
  const missingKey = (config.provider === 'gemini' || config.provider === 'mistral') && provider === 'ollama';
  const label =
    provider === 'gemini'
      ? 'Google Gemini'
      : provider === 'mistral'
        ? 'Mistral'
        : provider === 'claude'
          ? 'Claude'
          : `IA local · ${config.localModelName}`;
  return { provider, label, missingKey };
}

export function useActiveAi(): ActiveAi {
  const [active, setActive] = useState<ActiveAi>(describeActiveAi);
  useEffect(() => {
    const refresh = () => setActive(describeActiveAi());
    window.addEventListener(AI_CONFIG_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(AI_CONFIG_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);
  return active;
}
