/**
 * idleStudioApi — Estúdio da IDLE (server/services/idle_studio.py): plano de
 * produção por persona, anexos com nome automático, montagem do fluxo reativo
 * e geração por API.
 */
import { apiFetch } from '../lib/apiFetch';
import { apiUrl } from '../lib/api';

/** O backend montou/alterou o rascunho do fluxo: o quadro de Automações recarrega. */
export const WORKFLOW_CHANGED_EVENT = 'odessa:workflow-changed';

export const FACE_KEY = 'foto_rosto';

export type ItemStatus = 'pendente' | 'gerado' | 'refazer' | 'aprovado';

export interface StudioAsset {
  id: string;
  type: string;
  /** Nome automático pela etapa (o escolhido sem sufixo, os outros _v2, _v3…). */
  name: string;
  originalName: string;
  at: string;
  source: string;
  url: string;
}

export interface StudioItemState {
  status: ItemStatus;
  assets: StudioAsset[];
  chosen: string | null;
  updatedAt?: string;
}

export interface StudioImage {
  step: string;
  file: string;
  ratio: string;
  inputs: string;
  why: string;
  prompt: string;
}

export interface StudioVideo {
  file: string;
  number: number;
  category: string;
  categoryLabel: string;
  start: string;
  end: string;
  lote: number;
  pingpong: boolean;
  event: string;
  duration: string;
  firstFrame: string;
  lastFrame: string;
  prompt: string;
}

export interface FlowSummary {
  at: string;
  published: boolean;
  idleVideoId: string;
  videos: number;
  cycle: number;
  outOfCycle: string[];
  triggers: number;
  alternatives: number;
}

interface StudioProviders {
  image: { name: string; ready: boolean };
  video: { name: string; ready: boolean };
}

export interface StudioView {
  persona: { id: string; name: string; ficha: Record<string, string>; negative: string };
  images: StudioImage[];
  videos: StudioVideo[];
  items: Record<string, StudioItemState>;
  lastFlow: FlowSummary | null;
  providers: StudioProviders;
}

export interface GenerationJob {
  jobId: string;
  key: string;
  status: 'generating' | 'done' | 'error';
  provider: string;
  error?: string;
}

const base = (personaId: string) => `/idle-studio/${encodeURIComponent(personaId)}`;
const item = (personaId: string, key: string) => `${base(personaId)}/items/${encodeURIComponent(key)}`;

export const EMPTY_ITEM: StudioItemState = { status: 'pendente', assets: [], chosen: null };

export function listStudioPersonas() {
  return apiFetch<{ personas: { id: string; name: string }[] }>('/idle-studio/personas');
}

export function fetchStudio(personaId: string, signal?: AbortSignal) {
  return apiFetch<StudioView>(base(personaId), { signal });
}

export function uploadAsset(personaId: string, key: string, file: File) {
  const form = new FormData();
  form.append('file', file);
  return apiFetch<StudioItemState>(`${item(personaId, key)}/assets`, { method: 'POST', rawBody: form, timeoutMs: 0 });
}

export function removeAsset(personaId: string, key: string, assetId: string) {
  return apiFetch<StudioItemState>(`${item(personaId, key)}/assets/${assetId}`, { method: 'DELETE' });
}

export function updateItem(personaId: string, key: string, patch: { status?: ItemStatus; chosen?: string }) {
  return apiFetch<StudioItemState>(item(personaId, key), { method: 'PATCH', json: patch });
}

export function buildFlow(personaId: string, publish: boolean) {
  return apiFetch<FlowSummary>(`${base(personaId)}/flow`, { method: 'POST', json: { publish }, timeoutMs: 120_000 });
}

export function startGeneration(personaId: string, key: string) {
  return apiFetch<GenerationJob>(`${item(personaId, key)}/generate`, { method: 'POST' });
}

export function fetchJob(jobId: string) {
  return apiFetch<GenerationJob>(`/idle-studio/jobs/${jobId}`);
}

export function assetSrc(asset: StudioAsset) {
  return apiUrl(asset.url.replace(/^\/api\/v1/, ''));
}

export function assetDownloadHref(asset: StudioAsset) {
  return `${assetSrc(asset)}?download=true`;
}

export function chosenAsset(state: StudioItemState): StudioAsset | null {
  return state.assets.find((a) => a.id === state.chosen) ?? state.assets[0] ?? null;
}

/** Chaves das imagens que entram numa etapa ("foto de rosto + A0_camera.png"). */
export function inputKeys(inputs: string): string[] {
  if (!inputs || inputs === 'nenhuma') return [];
  return inputs
    .split('+')
    .map((s) => s.trim())
    .map((s) => (s.startsWith('foto de rosto') ? FACE_KEY : s))
    .filter(Boolean);
}

/**
 * Copia a imagem para colar direto no gerador. A área de transferência só
 * aceita PNG: JPG/WEBP são convertidos. O item é criado já no clique (com a
 * imagem ainda carregando) para o navegador aceitar como ação do usuário.
 */
export async function copyImage(asset: StudioAsset): Promise<void> {
  const png = (async () => {
    const blob = await (await fetch(assetSrc(asset))).blob();
    if (blob.type === 'image/png') return blob;
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
    bitmap.close();
    return new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('png'))), 'image/png'),
    );
  })();
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}
