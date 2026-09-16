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
import { apiUrl } from '../lib/api';

const INGEST_URL = '/api/automation/ingest';
const MIN_INTERVAL_MS = 800;
const MAX_RECENT_KEYS = 200;

let lastIngestAt = 0;
const recentKeys = new Set<string>();

function messageKey(msg: TangoChatMessage): string {
  return `${msg.username}|${msg.text}|${msg.timestamp ?? ''}`;
}

export interface RouteChatToTriggersOptions {
  /**
   * Quando false, o backend ainda alimenta o buffer de video-gen e tenta
   * sintetizar gatilhos (process_raw_text roda isso incondicionalmente),
   * mas NÃO executa ações "ao vivo" (OBS, webhook, TTS) via
   * _execute_pending_actions. Usado pelo laboratório "Conversar" — permite
   * testar a síntese de gatilho num ambiente seguro sem live/OBS/bridge.
   * Sessões ao vivo continuam com o padrão (true).
   */
  execute?: boolean;
}

/**
 * Roteia uma mensagem do chat para o trigger engine do backend.
 * Não lança exceções: falhas de rede são silenciosas para não quebrar o chat.
 */
export async function routeChatToTriggers(
  msg: TangoChatMessage,
  options: RouteChatToTriggersOptions = {},
): Promise<void> {
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
  // Precisa terminar ANTES do ingest: o backend pode decidir gerar vídeo de
  // forma síncrona dentro do próprio request de ingest (ver
  // automation_service._feed_video_gen -> video_gen_service.auto_generate,
  // que roda quase imediatamente numa thread em background). Se o frame
  // ainda não tiver sido salvo nesse momento, a geração falha com "Nenhum
  // frame base disponível" — daí o disparo em paralelo (sem await) ser uma
  // condição de corrida, não só uma otimização de latência.
  await sendActiveFrame();

  try {
    await fetch(apiUrl(INGEST_URL), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: msg.text,
        source: 'chat_api',
        kind: 'chat',
        metadata: { username: msg.username },
        execute: options.execute ?? true,
      }),
    });
  } catch {
    // silencioso — o roteamento não deve interromper o fluxo do chat
  }
}
