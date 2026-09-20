import { safeLocal } from '../lib/safeStorage';

export type LabRole = 'user' | 'assistant' | 'system';

export interface LabMessage {
  role: LabRole;
  username: string;
  text: string;
  timestamp?: string;
  /** Mensagem de sistema que é uma falha (mostra o botão "Tentar de novo"). */
  error?: boolean;
}

const KEY_PREFIX = 'odessa.conversationLab.';
/** Guarda só o fim da conversa: localStorage é pequeno e a IA só lê as últimas mensagens. */
export const MAX_STORED_MESSAGES = 200;
/** Quantas mensagens anteriores entram no contexto enviado à IA. */
export const CONTEXT_MESSAGES = 12;

function isRole(value: unknown): value is LabRole {
  return value === 'user' || value === 'assistant' || value === 'system';
}

function sanitize(raw: unknown): LabMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: LabMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    if (!isRole(entry.role) || typeof entry.text !== 'string' || typeof entry.username !== 'string') continue;
    out.push({
      role: entry.role,
      username: entry.username,
      text: entry.text,
      timestamp: typeof entry.timestamp === 'string' ? entry.timestamp : undefined,
      error: entry.error === true ? true : undefined,
    });
  }
  return out.slice(-MAX_STORED_MESSAGES);
}

export function loadConversation(personaId: string): LabMessage[] {
  return sanitize(safeLocal.getJSON<unknown>(KEY_PREFIX + personaId, []));
}

export function saveConversation(personaId: string, messages: LabMessage[]): void {
  safeLocal.setJSON(KEY_PREFIX + personaId, messages.slice(-MAX_STORED_MESSAGES));
}

export function clearStoredConversation(personaId: string): void {
  safeLocal.remove(KEY_PREFIX + personaId);
}

/**
 * Histórico que vai para a IA: só o que foi dito de fato (usuário e persona).
 * Avisos de sistema e falhas antes entravam como "sistema: ..." no contexto.
 */
export function chatHistoryFor(messages: LabMessage[], limit = CONTEXT_MESSAGES): LabMessage[] {
  return messages.filter((message) => message.role !== 'system').slice(-limit);
}

/** "14:05" a partir do ISO; vazio se não der para ler. */
export function formatClock(timestamp?: string): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/** Texto simples da conversa para exportar/copiar. */
export function conversationToText(personaName: string, messages: LabMessage[]): string {
  const lines = messages
    .filter((message) => !message.error)
    .map((message) => {
      const clock = formatClock(message.timestamp);
      const who = message.role === 'system' ? 'sistema' : message.username;
      return `${clock ? `[${clock}] ` : ''}${who}: ${message.text}`;
    });
  return [`Conversa com ${personaName}`, '', ...lines, ''].join('\n');
}

/** Rótulo do provedor no cabeçalho (antes dizia sempre "Ollama"). */
export function providerLabel(provider: 'ollama' | 'gemini' | 'claude', localModel?: string): string {
  if (provider === 'ollama') return localModel ? `Ollama · ${localModel}` : 'Ollama';
  return provider === 'gemini' ? 'Gemini' : 'Claude';
}
