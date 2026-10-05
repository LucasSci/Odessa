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
import { apiFetch } from '../lib/apiFetch';
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

/** O que a IA sabe de quem está falando (e o que a persona já contou de si). */
export interface MemoryContext {
  context: string;
  /** O que entrou no prompt, em linguagem do operador ("2 fato(s) de @ana"). */
  used: string[];
}

const EMPTY_CONTEXT: MemoryContext = { context: '', used: [] };
const memoryCache = new Map<string, { at: number; value: MemoryContext }>();
const cacheKey = (user: string, personaId = '') => `${user.toLowerCase()}|${personaId}`;

function forgetCached(user: string): void {
  const prefix = `${user.toLowerCase()}|`;
  for (const key of memoryCache.keys()) if (key.startsWith(prefix)) memoryCache.delete(key);
}

/**
 * Memória do servidor pronta para o prompt — a MESMA para qualquer IA (local ou
 * API): quem é a pessoa, o que ela já contou, a última conversa e o que a
 * persona já disse de si. Backend fora = nada entra (a conversa continua).
 */
export async function getMemoryContext(
  username: string | undefined,
  persona: { id?: string; name?: string | null } = {},
): Promise<MemoryContext> {
  const user = (username || '').trim().replace(/^@/, '');
  if (!user) return EMPTY_CONTEXT;
  const key = cacheKey(user, persona.id);
  const cached = memoryCache.get(key);
  if (cached && Date.now() - cached.at < MEMORY_CACHE_MS) return cached.value;
  try {
    const params = new URLSearchParams({ username: user, persona: persona.id || '', personaName: persona.name || '' });
    const data = await apiFetch<{ context?: string; used?: string[] }>(`/memory/context?${params}`, { timeoutMs: 1_500 });
    const value: MemoryContext = { context: String(data?.context || ''), used: Array.isArray(data?.used) ? data.used.map(String) : [] };
    memoryCache.set(key, { at: Date.now(), value });
    return value;
  } catch {
    return EMPTY_CONTEXT;
  }
}

/** Grava a fala da persona para esta pessoa: vira parte da conversa lembrada. */
export function rememberPersonaReply(viewer: string | undefined, reply: string, personaId?: string): void {
  const user = (viewer || '').trim().replace(/^@/, '');
  const text = redactPersonalData(reply.trim());
  if (!user || !text) return;
  const createdAt = new Date().toISOString();
  pending.push({
    id: `reply-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    source: 'bridge',
    zoneName: 'Chat Tango',
    text,
    kind: 'reply' as LiveEvent['kind'],
    createdAt,
    time: new Date(createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    metadata: { user, persona: personaId || '' },
  });
  forgetCached(user);
  if (!flushTimer) flushTimer = setTimeout(() => void flush(), FLUSH_DELAY_MS);
}

let learning = false;

/**
 * Pede ao servidor para transformar a conversa nova em memória (fatos + resumo),
 * com a IA que estiver ativa. Uma rodada por vez; chamado com o chat parado ou
 * no fim da live. A chave da API vai na chamada e não é guardada.
 */
export async function requestMemoryLearning(payload: {
  personaId?: string;
  personaName?: string | null;
  provider: string;
  providerKey?: string;
  localModelUrl?: string;
  localModelName?: string;
  minNew?: number;
}): Promise<void> {
  if (learning) return;
  learning = true;
  try {
    await flush();
    await apiFetch('/memory/learn', {
      method: 'POST',
      timeoutMs: 0,
      json: {
        persona_id: payload.personaId || '',
        persona_name: payload.personaName || '',
        provider: payload.provider,
        provider_key: payload.providerKey,
        local_model_url: payload.localModelUrl,
        local_model_name: payload.localModelName,
        ...(payload.minNew ? { min_new: payload.minNew } : {}),
      },
    });
    memoryCache.clear();
  } catch {
    // Aprendizado é melhor esforço: tenta de novo na próxima pausa do chat.
  } finally {
    learning = false;
  }
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
  forgetCached(profile.username);
}

/** Esquece um espectador: apaga perfil, interações e os fatos dele no navegador. */
export async function forgetMemoryProfile(profile: Pick<MemoryProfile, 'id' | 'username'>): Promise<void> {
  globalRAGMemory.forgetUser(profile.username);
  await apiFetch(`/memory/profiles/${encodeURIComponent(profile.id)}`, { method: 'DELETE' });
  forgetCached(profile.username);
}

/** Um fato que a memória guardou (sobre a pessoa ou sobre a própria persona). */
export interface MemoryFact {
  id: string;
  fact: string;
  category?: string;
  source?: string;
  createdAt: string;
}

/** O que a memória sabe de um espectador: fatos e o último resumo de conversa. */
export async function getMemoryDetails(profileId: string): Promise<{ facts: MemoryFact[]; lastSummary: string | null }> {
  const data = await apiFetch<{ facts?: Array<Record<string, unknown>>; summaries?: Array<Record<string, unknown>> }>(
    `/memory/profiles/${encodeURIComponent(profileId)}`,
  );
  return {
    facts: (data?.facts ?? []).filter((f) => !f.hidden).map(toFact),
    lastSummary: data?.summaries?.[0]?.summary ? String(data.summaries[0].summary) : null,
  };
}

function toFact(row: Record<string, unknown>): MemoryFact {
  return {
    id: String(row.id),
    fact: String(row.fact ?? ''),
    category: row.category ? String(row.category) : undefined,
    source: row.source ? String(row.source) : undefined,
    createdAt: String(row.created_at ?? ''),
  };
}

export async function deleteViewerFact(factId: string): Promise<void> {
  await apiFetch(`/memory/facts/${encodeURIComponent(factId)}`, { method: 'DELETE' });
  memoryCache.clear();
}

/** O que a persona já contou de si no chat (para ela não se contradizer). */
export async function listPersonaFacts(personaId: string): Promise<MemoryFact[]> {
  const data = await apiFetch<{ facts?: Array<Record<string, unknown>> }>(`/memory/persona-facts?persona=${encodeURIComponent(personaId)}`);
  return (data?.facts ?? []).map(toFact);
}

export async function deletePersonaFact(factId: string): Promise<void> {
  await apiFetch(`/memory/persona-facts/${encodeURIComponent(factId)}`, { method: 'DELETE' });
  memoryCache.clear();
}
