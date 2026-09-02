/**
 * chatConversationGovernor.ts
 *
 * Governança da conversa automática no chat do Tango. Aplica limites para a IA
 * responder de forma natural e sem flood:
 *  - Cooldown global entre respostas (chatReplyCooldownMs).
 *  - Limite de respostas por minuto (chatReplyMaxPerMinute) com janela deslizante.
 *  - Cooldown por usuário (evita responder a mesma pessoa em sequência).
 *  - Filtro de ruído: mensagens muito curtas, repetidas ou de baixo valor.
 *
 * Mantém o estado em memória (por sessão do painel). Não persiste.
 */
import type { TangoChatMessage } from './tangoAiChatService';

const MIN_MESSAGE_LENGTH = 2;
const MAX_REPEATED_COUNT = 3;
const USER_COOLDOWN_MS = 20_000;

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
 * Retorna { allowed: true } ou { allowed: false, reason }.
 */
export function shouldReplyToMessage(
  msg: TangoChatMessage,
  opts: { cooldownMs: number; maxPerMinute: number },
): { allowed: boolean; reason?: string } {
  if (!msg || !msg.text) return { allowed: false, reason: 'empty_message' };

  const text = msg.text.trim();
  if (text.length < MIN_MESSAGE_LENGTH) {
    return { allowed: false, reason: 'too_short' };
  }

  // Cooldown global
  const globalRemaining = Math.max(0, opts.cooldownMs - (now() - (state.sentAt[state.sentAt.length - 1] ?? 0)));
  if (globalRemaining > 0) {
    return { allowed: false, reason: `global_cooldown_${Math.ceil(globalRemaining / 1000)}s` };
  }

  // Limite por minuto (janela deslizante)
  if (countRepliesInWindow() >= opts.maxPerMinute) {
    return { allowed: false, reason: 'max_per_minute' };
  }

  // Cooldown por usuário
  if (msg.username) {
    const userRemaining = userCooldownRemaining(msg.username);
    if (userRemaining > 0) {
      return { allowed: false, reason: `user_cooldown_${Math.ceil(userRemaining / 1000)}s` };
    }
  }

  // Anti-flood: mensagem repetida em sequência
  const lower = text.toLowerCase();
  const repeated = state.recentTexts.filter((t) => t === lower).length;
  if (repeated >= MAX_REPEATED_COUNT) {
    return { allowed: false, reason: 'repeated_message' };
  }

  return { allowed: true };
}

/** Registra o texto de uma mensagem recebida (para detectar repetição). */
export function recordIncomingMessage(text: string): void {
  const lower = text.trim().toLowerCase();
  if (!lower) return;
  state.recentTexts.push(lower);
  if (state.recentTexts.length > 50) state.recentTexts.shift();
}
