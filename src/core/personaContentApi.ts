/**
 * personaContentApi.ts
 *
 * Cliente TS para o Content Studio da persona — agrega fotos (enviadas ou
 * autogeradas) e vídeos gerados (ver server/api/v1/endpoints/persona_content.py),
 * mais os disparos manuais de geração (foto via Higgsfield/Gemini, vídeo via
 * o pipeline de video-gen já existente — sem duplicar essas chamadas aqui).
 * Espelha o formato/idioma de src/core/videoGenApi.ts.
 */
import { apiUrl } from '../lib/api';
import { requestSelfGeneratedPhoto, type GeneratePhotoResult } from './personaSelfConfig';
import { generateFromTemplate, enqueueGeneration, type VideoGenQueueItem } from './videoGenApi';

export interface PersonaContentItem {
  id: string;
  kind: 'image' | 'video';
  category: string;
  url: string | null;
  label: string;
  createdAt?: string | null;
  generated: boolean;
  provider?: string | null;
  prompt?: string | null;
  sizeBytes?: number;
}

export interface PersonaContentState {
  items: PersonaContentItem[];
  total: number;
  generatedCount: number;
  countsByCategory: Record<string, number>;
}

/** Cadência de atualização do Content Studio — mesmo padrão de VideoGenPanel.tsx. */
export const CONTENT_STUDIO_POLL_MS = 3000;

export async function fetchPersonaContent(personaId: string): Promise<PersonaContentState> {
  const res = await fetch(apiUrl(`/personas/${personaId}/content`));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as PersonaContentState;
}

/** Dispara a geração manual de uma foto nova (mesmo endpoint que o autoconfig usa). */
export async function generatePersonaPhoto(personaId: string, prompt: string): Promise<GeneratePhotoResult> {
  return requestSelfGeneratedPhoto(personaId, prompt, 'conversation');
}

/**
 * Dispara a geração manual de um vídeo novo — reaproveita as chamadas já
 * existentes de src/core/videoGenApi.ts (não duplica a lógica de
 * geração/enfileiramento aqui, só expõe no contexto do Content Studio).
 */
export async function generatePersonaVideo(
  personaId: string,
  opts: { videoType?: string; action?: string; prompt?: string } = {},
): Promise<{ ok: boolean; item?: VideoGenQueueItem }> {
  if (opts.videoType) {
    const res = await generateFromTemplate({ personaId, videoType: opts.videoType, action: opts.action });
    return { ok: res.ok, item: res.item };
  }
  const res = await enqueueGeneration({ personaId, prompt: opts.prompt });
  return { ok: res.ok, item: res.item };
}
