/**
 * personaAssets.ts — Cliente do backend para assets de persona (imagens)
 * e templates de prompt por tipo de vídeo.
 */
import { apiUrl } from '../lib/api';

export type AssetCategory = 'faces' | 'environments' | 'wardrobe';

export type PersonaAsset = {
  id: string;
  label: string;
  filename: string;
  originalName?: string;
  category: AssetCategory;
  createdAt?: string;
  url?: string;
};

export type PersonaAssets = Record<AssetCategory, PersonaAsset[]>;

export type VideoTemplate = {
  label: string;
  prompt: string;
  description: string;
};

export type VideoTemplates = Record<string, VideoTemplate>;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(detail || `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

// ── Assets ──────────────────────────────────────────────────────────────────

export async function getPersonaAssets(personaId: string): Promise<{ assets: PersonaAssets }> {
  return request<{ assets: PersonaAssets }>(`/personas/${personaId}/assets`);
}

export async function uploadAsset(
  personaId: string,
  category: AssetCategory,
  file: File,
  label: string = '',
): Promise<{ ok: boolean; asset: PersonaAsset }> {
  const formData = new FormData();
  formData.append('file', file);
  if (label) formData.append('label', label);
  const res = await fetch(apiUrl(`/personas/${personaId}/assets/${category}`), {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(detail || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function deleteAsset(
  personaId: string,
  category: AssetCategory,
  assetId: string,
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/personas/${personaId}/assets/${category}/${assetId}`, {
    method: 'DELETE',
  });
}

export async function renameAsset(
  personaId: string,
  category: AssetCategory,
  assetId: string,
  label: string,
): Promise<{ ok: boolean; asset: PersonaAsset }> {
  return request<{ ok: boolean; asset: PersonaAsset }>(
    `/personas/${personaId}/assets/${category}/${assetId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ label }),
    },
  );
}

export function assetUrl(personaId: string, category: AssetCategory, assetId: string): string {
  return apiUrl(`/personas/${personaId}/assets/${category}/${assetId}`);
}

// ── Templates ──────────────────────────────────────────────────────────────

export async function getTemplates(
  personaId: string,
): Promise<{ templates: VideoTemplates; videoTypes: string[] }> {
  return request<{ templates: VideoTemplates; videoTypes: string[] }>(
    `/personas/${personaId}/templates`,
  );
}

export async function saveTemplates(
  personaId: string,
  templates: VideoTemplates,
): Promise<{ ok: boolean; templates: VideoTemplates }> {
  return request<{ ok: boolean; templates: VideoTemplates }>(
    `/personas/${personaId}/templates`,
    {
      method: 'PUT',
      body: JSON.stringify({ templates }),
    },
  );
}

export async function renderTemplate(
  personaId: string,
  videoType: string,
  action: string = '',
): Promise<{ ok: boolean; prompt: string; videoType: string }> {
  return request<{ ok: boolean; prompt: string; videoType: string }>(
    `/personas/${personaId}/templates/render`,
    {
      method: 'POST',
      body: JSON.stringify({ videoType, action }),
    },
  );
}

export async function getVideoTypes(): Promise<{
  videoTypes: string[];
  defaults: VideoTemplates;
}> {
  return request<{ videoTypes: string[]; defaults: VideoTemplates }>(
    '/personas/meta/video-types',
  );
}

// ── Kits de roupas e cenários ───────────────────────────────────────────────

export type WardrobeKit = {
  id: string;
  name: string;
  description?: string;
  pieceIds: string[];
  createdAt?: string;
};

export type Scenario = {
  id: string;
  name: string;
  description?: string;
  faceId?: string | null;
  environmentId?: string | null;
  wardrobeKitId?: string | null;
  createdAt?: string;
};

export type PersonaVisual = {
  activeScenarioId?: string | null;
  wardrobeKits: WardrobeKit[];
  scenarios: Scenario[];
};

export async function getPersonaVisual(personaId: string): Promise<PersonaVisual> {
  return request<PersonaVisual>(`/personas/${personaId}/visual`);
}

export async function createWardrobeKit(
  personaId: string,
  data: { name: string; description?: string; pieceIds: string[] },
): Promise<{ ok: boolean; kit: WardrobeKit }> {
  return request<{ ok: boolean; kit: WardrobeKit }>(
    `/personas/${personaId}/visual/wardrobe-kits`,
    {
      method: 'POST',
      body: JSON.stringify(data),
    },
  );
}

export async function deleteWardrobeKit(
  personaId: string,
  kitId: string,
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(
    `/personas/${personaId}/visual/wardrobe-kits/${kitId}`,
    { method: 'DELETE' },
  );
}

export async function createScenario(
  personaId: string,
  data: {
    name: string;
    description?: string;
    faceId?: string;
    environmentId?: string;
    wardrobeKitId?: string;
  },
): Promise<{ ok: boolean; scenario: Scenario }> {
  return request<{ ok: boolean; scenario: Scenario }>(
    `/personas/${personaId}/visual/scenarios`,
    {
      method: 'POST',
      body: JSON.stringify(data),
    },
  );
}

export async function deleteScenario(
  personaId: string,
  scenarioId: string,
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/personas/${personaId}/visual/scenarios/${scenarioId}`, {
    method: 'DELETE',
  });
}

export async function setActiveScenario(
  personaId: string,
  scenarioId: string,
): Promise<{ ok: boolean; activeScenarioId: string }> {
  return request<{ ok: boolean; activeScenarioId: string }>(
    `/personas/${personaId}/visual/active-scenario`,
    {
      method: 'PUT',
      body: JSON.stringify({ scenarioId }),
    },
  );
}
