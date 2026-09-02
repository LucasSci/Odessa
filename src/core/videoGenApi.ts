/**
 * videoGenApi.ts
 *
 * Cliente TS para os endpoints do pipeline de geração de vídeo em tempo real
 * (/api/video-gen/*). Tipos espelham o estado retornado pelo backend.
 */

export interface VideoGenInteraction {
  kind: string;
  user?: string;
  text?: string;
  giftName?: string;
  timestamp?: string;
}

export interface VideoGenPrompt {
  id: string;
  personaId?: string;
  prompt: string;
  source?: string;
  createdAt?: string;
  interactions?: VideoGenInteraction[];
}

export interface VideoGenQueueItem {
  id: string;
  promptId?: string;
  prompt: string;
  status: 'queued' | 'generating' | 'done' | 'error';
  framePath?: string | null;
  videoId?: string | null;
  videoPath?: string | null;
  error?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface VideoGenHistoryEntry {
  id?: string;
  promptId?: string;
  prompt?: string;
  framePath?: string | null;
  ok: boolean;
  error?: string | null;
  videoId?: string | null;
  videoPath?: string | null;
  createdAt?: string;
}

export interface VideoGenVideo {
  id: string;
  filename: string;
  path: string;
  sizeBytes: number;
  playUrl: string;
}

export interface VideoGenState {
  personaId: string;
  provider: string;
  auto: boolean;
  bufferSize: number;
  buffer: VideoGenInteraction[];
  prompts: VideoGenPrompt[];
  queue: VideoGenQueueItem[];
  history: VideoGenHistoryEntry[];
  latestFrame?: string | null;
  frameHistory: string[];
  videos: VideoGenVideo[];
  maxQueue: number;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`video-gen ${res.status}: ${body}`);
  }
  return (await res.json()) as T;
}

export async function fetchVideoGenState(personaId?: string): Promise<VideoGenState> {
  const qs = personaId ? `?personaId=${encodeURIComponent(personaId)}` : '';
  return request<VideoGenState>(`/api/video-gen/state${qs}`);
}

export async function sendFrame(dataUrl: string): Promise<{ ok: boolean; path: string }> {
  return request<{ ok: boolean; path: string }>('/api/video-gen/frame', {
    method: 'POST',
    body: JSON.stringify({ dataUrl }),
  });
}

export async function generatePrompt(
  opts: { force?: boolean; customInstruction?: string; personaId?: string } = {},
): Promise<{ ok: boolean; prompt: VideoGenPrompt }> {
  return request<{ ok: boolean; prompt: VideoGenPrompt }>('/api/video-gen/prompt', {
    method: 'POST',
    body: JSON.stringify({
      force: opts.force ?? false,
      customInstruction: opts.customInstruction,
      personaId: opts.personaId,
    }),
  });
}

export async function enqueueGeneration(
  opts: { promptId?: string; prompt?: string; personaId?: string } = {},
): Promise<{ ok: boolean; item: VideoGenQueueItem }> {
  return request<{ ok: boolean; item: VideoGenQueueItem }>('/api/video-gen/generate', {
    method: 'POST',
    body: JSON.stringify({
      promptId: opts.promptId,
      prompt: opts.prompt,
      personaId: opts.personaId,
    }),
  });
}

export async function fetchQueue(personaId?: string): Promise<VideoGenQueueItem[]> {
  const qs = personaId ? `?personaId=${encodeURIComponent(personaId)}` : '';
  const data = await request<{ queue: VideoGenQueueItem[] }>(`/api/video-gen/queue${qs}`);
  return data.queue;
}

export async function fetchPrompts(personaId?: string): Promise<VideoGenPrompt[]> {
  const qs = personaId ? `?personaId=${encodeURIComponent(personaId)}` : '';
  const data = await request<{ prompts: VideoGenPrompt[] }>(`/api/video-gen/prompts${qs}`);
  return data.prompts;
}
