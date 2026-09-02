/**
 * personaManager.ts — Cliente do backend para perfis de IA (personas).
 *
 * Cada persona tem seus próprios vídeos, fluxo, gatilhos e personalidade.
 * Este módulo lista, cria, troca e exclui personas via /api/v1/personas.
 */
import { apiUrl } from '../lib/api';

export type PersonaMeta = {
  id: string;
  name: string;
  description?: string;
  personality?: string;
  configPath?: string;
  createdAt?: string;
};

export type PersonaListResponse = {
  activePersonaId: string;
  personas: PersonaMeta[];
};

export type PersonaActiveResponse = {
  persona: PersonaMeta;
  config: Record<string, unknown>;
};

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

export async function listPersonas(): Promise<PersonaListResponse> {
  return request<PersonaListResponse>('/personas');
}

export async function getActivePersona(): Promise<PersonaActiveResponse> {
  return request<PersonaActiveResponse>('/personas/active');
}

export async function setActivePersona(id: string): Promise<PersonaActiveResponse> {
  return request<PersonaActiveResponse>('/personas/active', {
    method: 'POST',
    body: JSON.stringify({ id }),
  });
}

export async function createPersona(meta: {
  id?: string;
  name: string;
  description?: string;
  personality?: string;
}): Promise<{ ok: boolean; persona: PersonaMeta }> {
  return request<{ ok: boolean; persona: PersonaMeta }>('/personas', {
    method: 'POST',
    body: JSON.stringify(meta),
  });
}

export async function getActivePersonality(): Promise<{
  personaId: string;
  personality: string;
}> {
  return request<{ personaId: string; personality: string }>('/personas/active/personality');
}

export async function setPersonality(
  id: string,
  personality: string,
): Promise<{ ok: boolean; personaId: string; personality: string }> {
  return request<{ ok: boolean; personaId: string; personality: string }>(
    `/personas/${id}/personality`,
    {
      method: 'PUT',
      body: JSON.stringify({ personality }),
    },
  );
}

export async function deletePersona(id: string): Promise<{ ok: boolean; activePersonaId: string }> {
  return request<{ ok: boolean; activePersonaId: string }>(`/personas/${id}`, {
    method: 'DELETE',
  });
}
