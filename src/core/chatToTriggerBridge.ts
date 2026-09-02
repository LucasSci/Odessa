/**
 * chatToTriggerBridge.ts
 *
 * Ponte entre as mensagens do chat da bridge do Tango e o trigger engine do
 * backend (camada reativa determinística: palavra-chave/presente -> vídeo do
 * fluxo publicado). Roteia cada mensagem para POST /api/automation/ingest,
 * com dedupe por mensagem e cooldown mínimo para não floodar o backend.
 *
 * O texto cru da mensagem é enviado como está (sem prefixo "@user:") para que
 * o parser do backend continue detectando presentes ("X sent Y") além de
 * comentários comuns.
 */
import type { TangoChatMessage } from './tangoAiChatService';
import { sendActiveFrame } from './frameCapture';

const INGEST_URL = '/api/automation/ingest';
const MIN_INTERVAL_MS = 800;
const MAX_RECENT_KEYS = 200;

let lastIngestAt = 0;
const recentKeys = new Set<string>();

function messageKey(msg: TangoChatMessage): string {
  return `${msg.username}|${msg.text}|${msg.timestamp ?? ''}`;
}

/**
 * Roteia uma mensagem do chat para o trigger engine do backend.
 * Não lança exceções: falhas de rede são silenciosas para não quebrar o chat.
 */
export async function routeChatToTriggers(msg: TangoChatMessage): Promise<void> {
  if (!msg || !msg.text) return;

  const key = messageKey(msg);
  if (recentKeys.has(key)) return;
  recentKeys.add(key);
  if (recentKeys.size > MAX_RECENT_KEYS) {
    const oldest = recentKeys.values().next().value;
    if (oldest) recentKeys.delete(oldest);
  }

  const now = Date.now();
  if (now - lastIngestAt < MIN_INTERVAL_MS) return;
  lastIngestAt = now;

  // Captura o frame base do vídeo em reprodução para o pipeline de geração.
  void sendActiveFrame();

  try {
    await fetch(INGEST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: msg.text,
        source: 'chat_api',
        kind: 'chat',
        metadata: { username: msg.username },
        execute: true,
      }),
    });
  } catch {
    // silencioso — o roteamento não deve interromper o fluxo do chat
  }
}
