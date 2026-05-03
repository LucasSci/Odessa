export type TtsProvider = 'auto' | 'edge' | 'openai' | 'kokoro';

export interface TtsSettings {
  provider: TtsProvider;
  voice: string;
  speed: number;
  pitch: number;
}

export interface TtsVoice {
  provider: TtsProvider;
  id: string;
  label: string;
  language: string;
  gender?: string;
  enabled?: boolean;
  configured?: boolean;
  reason?: string | null;
  grade?: string;
  experimental?: boolean;
}

export interface TtsVoicesResponse {
  defaultProvider: TtsProvider;
  providers: Record<
    string,
    Record<string, unknown> & { supports?: { speed?: boolean; pitch?: boolean } }
  >;
  voices: TtsVoice[];
}

const STORAGE_KEY = 'odessa:tts-settings:v1';

export const DEFAULT_TTS_SETTINGS: TtsSettings = {
  provider: 'edge',
  voice: 'pt-BR-FranciscaNeural',
  speed: 1,
  pitch: 0,
};

const OPENAI_VOICES = new Set([
  'alloy',
  'ash',
  'ballad',
  'cedar',
  'coral',
  'echo',
  'fable',
  'marin',
  'nova',
  'onyx',
  'sage',
  'shimmer',
  'verse',
]);
const KOKORO_VOICE_RE = /^[a-z]{2}_[a-z0-9_]+$/;

export function inferTtsProvider(voice: string): TtsProvider {
  const clean = voice.replace('kokoro:', '').trim();
  if (OPENAI_VOICES.has(clean)) return 'openai';
  if (KOKORO_VOICE_RE.test(clean)) return 'kokoro';
  return 'edge';
}

function normalizeSettings(value: Partial<TtsSettings> | null | undefined): TtsSettings {
  const provider =
    value?.provider && ['auto', 'edge', 'openai', 'kokoro'].includes(value.provider)
      ? value.provider
      : inferTtsProvider(value?.voice || DEFAULT_TTS_SETTINGS.voice);
  const voice = (value?.voice || DEFAULT_TTS_SETTINGS.voice).trim();
  const speed = Number.isFinite(value?.speed) ? Number(value?.speed) : DEFAULT_TTS_SETTINGS.speed;
  const pitch = Number.isFinite(value?.pitch) ? Number(value?.pitch) : DEFAULT_TTS_SETTINGS.pitch;

  return {
    provider,
    voice,
    speed: Math.max(0.65, Math.min(1.35, speed)),
    pitch: Math.max(-12, Math.min(12, pitch)),
  };
}

export function loadTtsSettings(fallback?: Partial<TtsSettings> | null): TtsSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return normalizeSettings(fallback);
    return normalizeSettings({ ...fallback, ...JSON.parse(raw) });
  } catch {
    return normalizeSettings(fallback);
  }
}

export function saveTtsSettings(settings: TtsSettings): TtsSettings {
  const normalized = normalizeSettings(settings);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent('odessa:tts-settings-changed', { detail: normalized }));
  return normalized;
}
