/**
 * sessionHistory — cliente TS para o histórico de sessão da live.
 *
 * Registra e consulta tudo que acontece durante a live (mensagens, presentes,
 * gatilhos, vídeos gerados, respostas de IA) e exporta em JSON/CSV.
 */

import { apiUrl } from '../lib/api';

export type SessionEventType =
  | 'session.started'
  | 'session.ended'
  | 'chat.received'
  | 'gift.received'
  | 'trigger.fired'
  | 'video.generated'
  | 'ai.reply'
  | 'ai.reply.sent'
  | 'message.sent';

export interface SessionEvent {
  id: string;
  sessionId: string;
  type: SessionEventType;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface SessionSummary {
  sessionId: string | null;
  totalEvents: number;
  byType: Record<string, number>;
}

export interface SessionHistoryResponse {
  session: SessionSummary;
  events: SessionEvent[];
}

export interface SessionInfo {
  sessionId: string;
  startedAt: string;
  endedAt: string | null;
  eventCount: number;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, init);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Lista os eventos do histórico (sessão ativa por padrão). */
export async function fetchSessionHistory(opts?: {
  sessionId?: string;
  type?: string;
  limit?: number;
}): Promise<SessionHistoryResponse | null> {
  const params = new URLSearchParams();
  if (opts?.sessionId) params.set('sessionId', opts.sessionId);
  if (opts?.type) params.set('type', opts.type);
  if (opts?.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();
  return fetchJson<SessionHistoryResponse>(apiUrl(`/session-history${qs ? `?${qs}` : ''}`));
}

/** Lista as sessões registradas. */
export async function fetchSessions(): Promise<SessionInfo[] | null> {
  const data = await fetchJson<{ sessions: SessionInfo[] }>(apiUrl('/session-history/sessions'));
  return data?.sessions ?? null;
}

/** Baixa o histórico exportado em JSON ou CSV. */
export async function exportSessionHistory(
  format: 'json' | 'csv',
  sessionId?: string,
): Promise<boolean> {
  try {
    const params = new URLSearchParams({ format });
    if (sessionId) params.set('sessionId', sessionId);
    const res = await fetch(apiUrl(`/session-history/export?${params.toString()}`));
    if (!res.ok) return false;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `odessa-historico-${sessionId ?? 'sessao'}.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}

/** Registra um evento no histórico (fire-and-forget, nunca lança). */
export function recordSessionEvent(type: SessionEventType, data: Record<string, unknown>): void {
  void fetchJson(apiUrl('/session-history/events'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, data }),
  });
}
