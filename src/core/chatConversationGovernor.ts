/**
 * chatConversationGovernor.ts
 *
 * Governança da conversa automática no chat do Tango. Aplica limites para a IA
 * responder de forma natural e sem flood:
 *  - Cooldown global entre respostas (chatReplyCooldownMs).
 *  - Limite de respostas por minuto (chatReplyMaxPerMinute) com janela deslizante.
 *  - Cooldown por usuário (evita responder a mesma pessoa em sequência).
 *  - Filtro de ruído: mensagens muito curtas, repetidas ou de baixo valor.
 *  - Mensagem duplicada (mesmo usuário + mesmo texto numa janela curta).
 *  - Moderação: spam, golpe, link/contato externo, ofensa, tema bloqueado ou
 *    pressão por gasto nunca recebem resposta pública.
 *  - Presente tem prioridade: agradece mesmo durante o cooldown de conversa
 *    casual (o limite por minuto continua valendo).
 *
 * Mantém o estado em memória (por sessão do painel). Não persiste.
 */
import type { TangoChatMessage } from './tangoAiChatService';
import { ChatDedupeCache } from './chatDedupe';
import { containsBlockedPublicTopic, pressuresSpendOrPlatformAction } from './liveAutonomyGovernor';
import { isGiftText, isModerationRisk } from './platformParsers/tangoChatParser';

const MIN_MESSAGE_LENGTH = 2;
const MAX_REPEATED_COUNT = 3;
const USER_COOLDOWN_MS = 20_000;
/** Mesma mensagem do mesmo usuário dentro desta janela = duplicada. */
const DUPLICATE_WINDOW_MS = 120_000;

const duplicates = new ChatDedupeCache(DUPLICATE_WINDOW_MS);

export type ChatMessageKind = 'chat' | 'gift' | 'moderation';

export interface ReplyDecision {
  allowed: boolean;
  /** Motivo do bloqueio (vai para o histórico e para o painel). */
  reason?: string;
  kind: ChatMessageKind;
}

/** Classifica a mensagem recebida antes de decidir se responde. */
export function classifyIncomingMessage(msg: Pick<TangoChatMessage, 'username' | 'text'>): ChatMessageKind {
  const text = String(msg.text || '');
  if (isGiftText(`${msg.username || ''} ${text}`) || isGiftText(text)) return 'gift';
  if (isModerationRisk(text) || containsBlockedPublicTopic(text) || pressuresSpendOrPlatformAction(text)) {
    return 'moderation';
  }
  return 'chat';
}

interface GovernorState {
  sentAt: number[];
  lastReplyByUser: Record<string, number>;
  recentTexts: string[];
}

const state: GovernorState = {
  sentAt: [],
  lastReplyByUser: {},
  recentTexts: [],
};

function now(): number {
  return Date.now();
}

/** Limpa janelas antigas de envio (mantém apenas os últimos 60s). */
function pruneSentWindow(): void {
  const cutoff = now() - 60_000;
  state.sentAt = state.sentAt.filter((t) => t >= cutoff);
}

/** Registra uma resposta enviada. */
export function recordChatReplySent(username?: string): void {
  pruneSentWindow();
  state.sentAt.push(now());
  if (username) state.lastReplyByUser[username] = now();
}

/** Quantas respostas foram enviadas na janela deslizante de 60s. */
export function countRepliesInWindow(): number {
  pruneSentWindow();
  return state.sentAt.length;
}

/** Cooldown restante (ms) para responder a um usuário específico. */
export function userCooldownRemaining(username: string): number {
  const last = state.lastReplyByUser[username];
  if (!last) return 0;
  return Math.max(0, last + USER_COOLDOWN_MS - now());
}

/**
 * Decide se a IA deve responder a uma mensagem, aplicando todas as regras.
 * Retorna { allowed, kind } e, quando bloqueia, `reason` legível no histórico.
 */
export function shouldReplyToMessage(
  msg: TangoChatMessage,
  opts: { cooldownMs: number; maxPerMinute: number },
): ReplyDecision {
  if (!msg || !msg.text) return { allowed: false, reason: 'empty_message', kind: 'chat' };

  const text = msg.text.trim();
  const kind = classifyIncomingMessage(msg);
  if (text.length < MIN_MESSAGE_LENGTH) {
    return { allowed: false, reason: 'too_short', kind };
  }

  // Moderação vem antes de tudo: nunca responde publicamente.
  if (kind === 'moderation') return { allowed: false, reason: 'moderation_risk', kind };

  const duplicate = duplicates.check({
    kind,
    user: msg.username || null,
    message: text,
    rawText: text,
    rowHash: `${msg.username || ''}|${text.toLowerCase()}`,
    confidence: 1,
  });
  // Só "já vista" conta como duplicada (emoji puro normaliza para vazio e não é repetição).
  if (duplicate.duplicate && duplicate.reason === 'seen_recently') {
    return { allowed: false, reason: 'duplicate_message', kind };
  }

  // Limite por minuto (janela deslizante) vale para tudo, inclusive presentes.
  if (countRepliesInWindow() >= opts.maxPerMinute) {
    return { allowed: false, reason: 'max_per_minute', kind };
  }

  // Presente passa na frente da conversa casual: ignora os cooldowns.
  if (kind === 'gift') return { allowed: true, kind };

  // Cooldown global
  const globalRemaining = Math.max(0, opts.cooldownMs - (now() - (state.sentAt[state.sentAt.length - 1] ?? 0)));
  if (globalRemaining > 0) {
    return { allowed: false, reason: `global_cooldown_${Math.ceil(globalRemaining / 1000)}s`, kind };
  }

  // Cooldown por usuário
  if (msg.username) {
    const userRemaining = userCooldownRemaining(msg.username);
    if (userRemaining > 0) {
      return { allowed: false, reason: `user_cooldown_${Math.ceil(userRemaining / 1000)}s`, kind };
    }
  }

  // Anti-flood: mensagem repetida em sequência (por usuários diferentes)
  const lower = text.toLowerCase();
  const repeated = state.recentTexts.filter((t) => t === lower).length;
  if (repeated >= MAX_REPEATED_COUNT) {
    return { allowed: false, reason: 'repeated_message', kind };
  }

  return { allowed: true, kind };
}

/** Motivo de bloqueio/pulo em linguagem do operador (histórico e Central da Live). */
export function describeReplyBlock(reason: string): string {
  const labels: Record<string, string> = {
    max_per_minute: 'limite de respostas por minuto atingido',
    repeated_message: 'mensagem repetida no chat (ignorada)',
    duplicate_message: 'mensagem duplicada (já vista há pouco)',
    moderation_risk: 'moderação: spam, link, contato externo, ofensa ou pedido de gasto',
    bridge_not_ready: 'bridge desconectada: nada pode ser enviado',
    send_failed: 'falha ao enviar pela bridge',
  };
  if (labels[reason]) return labels[reason];
  const cooldownMatch = reason.match(/^(global|user)_cooldown_(\d+)s$/);
  if (cooldownMatch) {
    const [, scope, seconds] = cooldownMatch;
    return `cooldown ${scope === 'global' ? 'geral' : 'do usuário'} (${seconds}s restantes)`;
  }
  return reason;
}

/** Só para testes: zera cooldowns, janelas e duplicadas. */
export function resetChatConversationGovernor(): void {
  state.sentAt = [];
  state.lastReplyByUser = {};
  state.recentTexts = [];
  duplicates.reset();
}

/** Registra o texto de uma mensagem recebida (para detectar repetição). */
export function recordIncomingMessage(text: string): void {
  const lower = text.trim().toLowerCase();
  if (!lower) return;
  state.recentTexts.push(lower);
  if (state.recentTexts.length > 50) state.recentTexts.shift();
}
