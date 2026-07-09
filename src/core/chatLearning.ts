/**
 * chatLearning.ts — aprendizado do chat (Fase 2).
 *
 * Agrega, de forma heurística e barata, o que o chat fala/pede/gosta a partir
 * dos eventos já classificados de cada rodada da Diretora. Persiste em
 * localStorage. Dois consumidores:
 *   1. buildChatInsightsContext() → injeta um resumo no prompt da Diretora.
 *   2. AiConfigPanel (aba IA → "Aprendizado") → mostra os insights ao operador.
 *
 * Também alimenta a memória vetorial por usuário (globalRAGMemory.storeFact),
 * que já é lida pela Diretora via retrieveContext().
 *
 * O resumo em linguagem natural (summarizeChatLearning) é sob demanda (botão na
 * aba IA) para respeitar o orçamento de API.
 */

import type { LiveEvent } from '../types';
import { extractUsername } from '../lib/memory';
import { globalRAGMemory } from './longTermMemory';
import { callGeminiText } from './aiDecisionContract';

const STORAGE_KEY = 'odessa:chat-learning:v1';

export interface Counter {
  count: number;
  lastSeen: string;
  sample?: string;
}

export interface ChatLearningState {
  totalMessages: number;
  questions: number;
  topics: Record<string, Counter>;
  requests: Record<string, Counter>;
  likes: Record<string, Counter>;
  aiSummary?: { text: string; generatedAt: string };
  updatedAt: string;
}

function empty(): ChatLearningState {
  return {
    totalMessages: 0,
    questions: 0,
    topics: {},
    requests: {},
    likes: {},
    updatedAt: new Date().toISOString(),
  };
}

function canUseStorage() {
  return typeof window !== 'undefined' && Boolean(window.localStorage);
}

function load(): ChatLearningState {
  if (!canUseStorage()) return empty();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as Partial<ChatLearningState>;
    return {
      ...empty(),
      ...parsed,
      topics: parsed.topics ?? {},
      requests: parsed.requests ?? {},
      likes: parsed.likes ?? {},
    };
  } catch {
    return empty();
  }
}

function save(state: ChatLearningState): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage cheio/indisponível — silencioso
  }
}

// ── Heurísticas (PT + EN; o resumo de IA cobre os demais idiomas) ─────────────

// Pedidos: "toca X", "mostra Y", "canta", "dança", "play", "sing"...
const REQUEST_RE =
  /\b(toca|tocar|coloca|colocar|p[õo]e|poe|faz|fazer|mostra|mostrar|canta|cantar|dan[çc]a|dan[çc]ar|repete|repetir|manda|play|sing|dance|show|do|put)\b/i;

// Elogios/curtidas
const LIKE_RE =
  /\b(linda|lindona|gata|gatinha|gostosa|amo|amei|te amo|perfeita|perfeit[ao]|maravilhosa|incr[íi]vel|top|gostei|rainha|deusa|love|beautiful|cute|pretty|nice|amazing|perfect|queen|gorgeous)\b/i;

const STOPWORDS = new Set([
  // PT
  'que', 'para', 'pra', 'com', 'uma', 'uns', 'umas', 'dos', 'das', 'por', 'mais', 'mas', 'voce', 'você',
  'vocês', 'voces', 'isso', 'aqui', 'ali', 'tudo', 'todo', 'toda', 'esta', 'está', 'esse', 'essa', 'este',
  'são', 'sao', 'tem', 'ter', 'foi', 'ser', 'sou', 'nao', 'não', 'sim', 'muito', 'muita', 'bem', 'tao', 'tão',
  'agora', 'depois', 'quando', 'onde', 'como', 'porque', 'então', 'entao', 'cara', 'gente', 'live', 'pq',
  // EN
  'the', 'and', 'you', 'your', 'for', 'with', 'that', 'this', 'are', 'was', 'have', 'has', 'not', 'but',
  'just', 'what', 'when', 'where', 'how', 'why', 'they', 'them', 'here', 'there', 'very', 'much', 'now',
]);

function messageText(ev: LiveEvent): string {
  const meta = (ev.metadata || {}) as Record<string, unknown>;
  if (typeof meta.message === 'string' && meta.message.trim()) return meta.message.trim();
  // Remove prefixo de usuário ("@nome:", "nome:") se presente.
  return ev.text.replace(/^@?[\w.-]{2,25}\s*[:>]\s*/, '').trim();
}

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function bump(map: Record<string, Counter>, key: string, sample?: string): void {
  const k = key.trim();
  if (!k) return;
  const now = new Date().toISOString();
  const cur = map[k];
  map[k] = { count: (cur?.count ?? 0) + 1, lastSeen: now, sample: sample ?? cur?.sample };
  // Limita o tamanho do mapa mantendo os mais frequentes.
  const keys = Object.keys(map);
  if (keys.length > 120) {
    const sorted = keys.sort((a, b) => map[b].count - map[a].count).slice(0, 80);
    const pruned: Record<string, Counter> = {};
    for (const kk of sorted) pruned[kk] = map[kk];
    // Substitui in-place
    for (const kk of Object.keys(map)) delete map[kk];
    Object.assign(map, pruned);
  }
}

function meaningfulWords(lower: string): string[] {
  return (lower.match(/[a-záàâãéêíóôõúüç0-9]{4,}/gi) || [])
    .map((w) => w.toLowerCase())
    .filter((w) => !STOPWORDS.has(w));
}

// ── API ───────────────────────────────────────────────────────────────────────

/** Registra o que dá pra aprender de uma rodada (somente eventos de chat). */
export function recordChatLearning(events: LiveEvent[]): void {
  const chat = events.filter((e) => e.kind === 'chat');
  if (!chat.length) return;

  const s = load();
  for (const ev of chat) {
    const msg = messageText(ev);
    if (!msg) continue;
    const lower = msg.toLowerCase();

    s.totalMessages += 1;
    if (msg.includes('?')) s.questions += 1;

    const isRequest = REQUEST_RE.test(lower);
    const likeMatch = lower.match(LIKE_RE);

    if (isRequest) bump(s.requests, truncate(msg, 60), truncate(msg, 80));
    if (likeMatch) bump(s.likes, likeMatch[0].toLowerCase());
    for (const w of meaningfulWords(lower)) bump(s.topics, w);

    // Memória por usuário (alimenta retrieveContext já consumido pela Diretora).
    const user =
      (typeof ev.metadata?.user === 'string' && ev.metadata.user) || extractUsername(ev.text);
    if (user) {
      if (isRequest) globalRAGMemory.storeFact(user, 'pedido', truncate(msg, 80));
      else if (likeMatch) globalRAGMemory.storeFact(user, 'gosta', truncate(msg, 80));
    }
  }
  s.updatedAt = new Date().toISOString();
  save(s);
}

export function getChatLearning(): ChatLearningState {
  return load();
}

function topEntries(map: Record<string, Counter>, n: number): Array<[string, Counter]> {
  return Object.entries(map)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, n);
}

/** Top itens em formato pronto para a UI. */
export function getChatInsights() {
  const s = load();
  const now = Date.now();
  const topicEntries = topEntries(s.topics, 40);
  return {
    totalMessages: s.totalMessages,
    questions: s.questions,
    topRequests: topEntries(s.requests, 6),
    topTopics: topicEntries.slice(0, 12),
    workingTopics: topicEntries
      .filter(([, counter]) => now - Date.parse(counter.lastSeen) < 15 * 60_000)
      .slice(0, 6),
    coolingTopics: topicEntries
      .filter(([, counter]) => counter.count >= 2 && now - Date.parse(counter.lastSeen) >= 15 * 60_000)
      .slice(0, 6),
    topLikes: topEntries(s.likes, 6),
    aiSummary: s.aiSummary,
    updatedAt: s.updatedAt,
  };
}

/** Bloco de contexto injetado no prompt da Diretora. */
export function buildChatInsightsContext(): string {
  const s = load();
  if (s.totalMessages === 0) return '';
  const reqs = topEntries(s.requests, 5);
  const topics = topEntries(s.topics, 8);
  const likes = topEntries(s.likes, 5);
  const insights = getChatInsights();

  const lines: string[] = ['\n\n[APRENDIZADO DO CHAT]'];
  if (reqs.length) {
    lines.push(`Pedidos frequentes: ${reqs.map(([k, v]) => `"${v.sample || k}" (${v.count}x)`).join('; ')}`);
  }
  if (likes.length) {
    lines.push(`O chat costuma elogiar com: ${likes.map(([k, v]) => `${k} (${v.count}x)`).join(', ')}`);
  }
  if (topics.length) {
    lines.push(`Tópicos recorrentes: ${topics.map(([k]) => k).join(', ')}`);
  }
  if (insights.workingTopics.length) {
    lines.push(`Topicos que ainda parecem funcionar: ${insights.workingTopics.map(([k]) => k).join(', ')}`);
  }
  if (insights.coolingTopics.length) {
    lines.push(`Topicos que esfriaram: ${insights.coolingTopics.map(([k]) => k).join(', ')}. Reaqueça com cuidado ou troque de assunto.`);
  }
  if (s.aiSummary?.text) lines.push(`Resumo aprendido: ${s.aiSummary.text}`);
  return `${lines.join('\n')}\n`;
}

const SUMMARY_PROMPT = `\
Você analisa o histórico agregado de uma live. A partir dos dados, escreva um resumo curto (máx. 3
frases, em português do Brasil) sobre: o que o público mais pede, o que ele curte e os assuntos que
mais aparecem. Seja direto e útil para guiar a apresentadora. Sem markdown.`;

/**
 * Gera (sob demanda) um resumo em linguagem natural do aprendizado e o salva no
 * store. Retorna o texto, ou null se não houver chave de IA.
 */
export async function summarizeChatLearning(): Promise<string | null> {
  const s = load();
  if (s.totalMessages === 0) return null;
  const reqs = topEntries(s.requests, 10).map(([k, v]) => `- pedido (${v.count}x): ${v.sample || k}`);
  const likes = topEntries(s.likes, 10).map(([k, v]) => `- elogio (${v.count}x): ${k}`);
  const topics = topEntries(s.topics, 20).map(([k, v]) => `${k}(${v.count})`);
  const userMessage = [
    `Total de mensagens analisadas: ${s.totalMessages} (perguntas: ${s.questions}).`,
    `Pedidos:\n${reqs.join('\n') || '- nenhum'}`,
    `Elogios:\n${likes.join('\n') || '- nenhum'}`,
    `Tópicos (palavra(frequência)): ${topics.join(', ') || 'nenhum'}`,
  ].join('\n\n');

  const text = await callGeminiText(SUMMARY_PROMPT, userMessage, { temperature: 0.4, maxOutputTokens: 220 });
  if (!text) return null;

  const next = load();
  next.aiSummary = { text, generatedAt: new Date().toISOString() };
  save(next);
  return text;
}

export function clearChatLearning(): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
