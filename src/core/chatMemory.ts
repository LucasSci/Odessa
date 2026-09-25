/**
 * chatMemory — memória do chat do Tango para as respostas da IA (issue #165).
 *
 * - Cada mensagem da bridge alimenta o aprendizado do chat (tópicos, pedidos,
 *   elogios) e a memória por usuário do backend (mensagens e presentes).
 * - Ao responder, a IA recebe um resumo curto de quem está falando: novo,
 *   recorrente ou presenteador — o suficiente para reconhecer recorrência sem
 *   inventar intimidade. O que entrou no prompt volta como `used`, e o painel
 *   mostra essas "memórias usadas".
 * - Nada sensível é guardado: mensagens de moderação (links, contatos, golpes)
 *   são ignoradas e e-mails/telefones/números longos são mascarados.
 */
import { apiFetch, ApiError } from '../lib/apiFetch';
import type { LiveEvent } from '../types';
import { clearChatLearning, recordChatLearning } from './chatLearning';
import { globalRAGMemory } from './longTermMemory';
import type { ChatMessageKind } from './chatConversationGovernor';

const FLUSH_DELAY_MS = 3_000;
const MEMORY_CACHE_MS = 30_000;

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]+/g;
const LONG_NUMBER_RE = /[+(]?\d[\d\s().-]{6,}\d/g;

/** Mascara e-mails, telefones e números longos antes de guardar qualquer texto. */
export function redactPersonalData(text: string): string {
  return text.replace(EMAIL_RE, '[e-mail]').replace(LONG_NUMBER_RE, '[número]');
}

let pending: LiveEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function flush(): Promise<void> {
  flushTimer = null;
  const events = pending;
  pending = [];
  if (!events.length) return;
  try {
    await apiFetch('/memory/round-context', { method: 'POST', json: { events }, timeoutMs: 5_000 });
  } catch {
    // Memória é melhor esforço: sem backend a conversa continua normalmente.
  }
}

/** Registra uma mensagem recebida pela bridge (em lote, a cada poucos segundos). */
export function rememberBridgeMessage(
  msg: { username?: string; text: string; timestamp?: string },
  kind: ChatMessageKind,
): void {
  if (kind === 'moderation') return;
  const user = (msg.username || '').trim().replace(/^@/, '');
  const message = redactPersonalData(msg.text.trim());
  if (!user || !message) return;
  const createdAt = msg.timestamp || new Date().toISOString();
  const event: LiveEvent = {
    id: `bridge-${Date.parse(createdAt) || Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    source: 'bridge',
    zoneName: 'Chat Tango',
    text: `${user}: ${message}`,
    kind,
    createdAt,
    time: new Date(createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    metadata: { user, message },
  };
  recordChatLearning([event]);
  pending.push(event);
  if (!flushTimer) flushTimer = setTimeout(() => void flush(), FLUSH_DELAY_MS);
}

export interface UserMemory {
  found: boolean;
  totalMessages: number;
  totalGifts: number;
}

const memoryCache = new Map<string, { at: number; value: UserMemory }>();

/** Perfil do usuário na memória do backend (null quando o backend não responde). */
export async function getUserMemory(username?: string): Promise<UserMemory | null> {
  const user = (username || '').trim().replace(/^@/, '');
  if (!user) return null;
  const cached = memoryCache.get(user.toLowerCase());
  if (cached && Date.now() - cached.at < MEMORY_CACHE_MS) return cached.value;
  try {
    const data = await apiFetch<{ profile?: { total_messages?: number; total_gifts?: number; hidden?: number | boolean } }>(
      `/memory/profiles/${encodeURIComponent(user)}`,
      { timeoutMs: 1_500 },
    );
    // 200 sem perfil = memória indisponível (ex.: stub do modo nuvem), não
    // "usuário novo" — senão a IA daria boas-vindas a todo mundo. Perfil
    // ocultado pelo operador também não entra no prompt (#252).
    if (!data?.profile || data.profile.hidden) return null;
    const value: UserMemory = {
      found: true,
      totalMessages: Number(data.profile.total_messages) || 0,
      totalGifts: Number(data.profile.total_gifts) || 0,
    };
    memoryCache.set(user.toLowerCase(), { at: Date.now(), value });
    return value;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      const value: UserMemory = { found: false, totalMessages: 0, totalGifts: 0 };
      memoryCache.set(user.toLowerCase(), { at: Date.now(), value });
      return value;
    }
    return null;
  }
}

/**
 * Contexto curto sobre quem está falando + a lista legível do que foi usado.
 * `memory` null (backend fora) → nada entra no prompt.
 */
export function buildUserMemoryContext(
  username: string | undefined,
  memory: UserMemory | null,
): { context: string; used: string[] } {
  const user = (username || '').trim().replace(/^@/, '');
  if (!user || !memory) return { context: '', used: [] };
  // A mensagem atual pode já ter sido registrada: 1 mensagem = primeira vez.
  if (!memory.found || memory.totalMessages <= 1) {
    return {
      context: `[QUEM ESTÁ FALANDO]: @${user} é novo(a) na live. Dê boas-vindas sem fingir que já conhece.`,
      used: [`@${user}: primeira vez na memória`],
    };
  }
  const lines = [
    `[QUEM ESTÁ FALANDO]: @${user} é recorrente (${memory.totalMessages} mensagens registradas). Pode reconhecer que já apareceu antes, sem inventar detalhes nem intimidade.`,
  ];
  const used = [`@${user}: recorrente (${memory.totalMessages} mensagens)`];
  if (memory.totalGifts > 0) {
    lines.push(`@${user} já enviou ${memory.totalGifts} presente(s): agradeça com carinho, sem pedir mais.`);
    used.push(`@${user}: presenteador (${memory.totalGifts} presente${memory.totalGifts > 1 ? 's' : ''})`);
  }
  return { context: lines.join('\n'), used };
}

/** "Resetar aprendizado": apaga tendências, fatos por espectador e a memória por usuário. */
export async function resetChatMemory(): Promise<{ usersCleared: number | null }> {
  clearChatLearning();
  globalRAGMemory.clear();
  memoryCache.clear();
  pending = [];
  try {
    const result = await apiFetch<{ usersCleared?: number }>('/memory/profiles', { method: 'DELETE' });
    return { usersCleared: typeof result?.usersCleared === 'number' ? result.usersCleared : null };
  } catch {
    return { usersCleared: null };
  }
}

/** Espectador conhecido pela memória do chat (tela de privacidade, #252). */
export interface MemoryProfile {
  id: string;
  username: string;
  lastSeen: string;
  totalMessages: number;
  totalGifts: number;
  hidden: boolean;
}

export async function listMemoryProfiles(query = ''): Promise<MemoryProfile[]> {
  const params = new URLSearchParams({ q: query.trim(), limit: '100', includeHidden: 'true' });
  const data = await apiFetch<{ profiles?: Array<Record<string, unknown>> }>(`/memory/profiles?${params}`);
  return (data?.profiles ?? []).map((row) => ({
    id: String(row.id),
    username: String(row.username ?? row.id),
    lastSeen: String(row.last_seen ?? ''),
    totalMessages: Number(row.total_messages) || 0,
    totalGifts: Number(row.total_gifts) || 0,
    hidden: Boolean(row.hidden),
  }));
}

/** Oculta (ou mostra de novo) um espectador: continua contado, mas fora do prompt. */
export async function setMemoryProfileHidden(profile: Pick<MemoryProfile, 'id' | 'username'>, hidden: boolean): Promise<void> {
  // Ocultar vale no navegador na hora (lado seguro); mostrar, só se o backend aceitar.
  if (hidden) globalRAGMemory.setHidden(profile.username, true);
  await apiFetch(`/memory/profiles/${encodeURIComponent(profile.id)}/visibility`, { method: 'POST', json: { hidden } });
  if (!hidden) globalRAGMemory.setHidden(profile.username, false);
  memoryCache.delete(profile.username.toLowerCase());
}

/** Esquece um espectador: apaga perfil, interações e os fatos dele no navegador. */
export async function forgetMemoryProfile(profile: Pick<MemoryProfile, 'id' | 'username'>): Promise<void> {
  globalRAGMemory.forgetUser(profile.username);
  await apiFetch(`/memory/profiles/${encodeURIComponent(profile.id)}`, { method: 'DELETE' });
  memoryCache.delete(profile.username.toLowerCase());
}
