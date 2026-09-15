/**
 * tangoAiChatService.ts — Motor de Respostas de IA para o Tango Chat.
 *
 * Responsável por:
 * 1. Gerar respostas inteligentes, curtas e contextuais para mensagens do Tango.
 * 2. Aplicar filtros de segurança e termos proibidos (anti-spam, links, termos sensíveis).
 * 3. Respeitar a persona da Odessa (personalidade sedutora, carinhosa, espirituosa e rápida).
 * 4. Controlar limites de tamanho (<= 140 chars) para compatibilidade com o chat da live.
 */

import { callGeminiText } from './aiDecisionContract';
import { getAiConfig, hasActiveGeminiKey } from './aiConfig';
import { apiUrl } from '../lib/api';
import { PUBLIC_REPLY_BLOCKED_TERMS } from './liveAutonomyGovernor';
import { buildChatInsightsContext } from './chatLearning';
import { generateLocalReply } from './tangoReplyFallback';

export interface TangoChatMessage {
  username: string;
  text: string;
  timestamp?: string;
}

export interface GeneratedReplyResult {
  ok: boolean;
  reply: string;
  reason?: string;
  blocked?: boolean;
  blockedReason?: string;
  confidence: number;
}

export interface PersonaChatOptions {
  maxLength?: number;
  conversationMode?: boolean;
  timeoutMs?: number;
}

const DEFAULT_TANGO_IDENTITY = `\
Você é a Odessa, uma streamer ao vivo cativante, carinhosa, bem-humorada e atenciosa com seu público.
Seu objetivo é responder mensagens no chat ao vivo do Tango.`;

// Regras SEMPRE aplicadas, independente da identidade/persona ativa (identidade
// genérica acima, personalidade de uma persona específica como a Barbara, ou um
// prompt customizado salvo em AiConfigPanel). Ficam separadas da identidade para
// que nenhuma dessas fontes possa "esquecer" de incluí-las.
const TANGO_RESPONSE_RULES = `\
REGRAS OBRIGATÓRIAS:
1. Respostas CURTAS: no máximo 15 a 20 palavras (máx 140 caracteres). Nunca envie parágrafos longos.
2. Seja natural, carinhosa e calorosa. Use emojis moderadamente (1 ou 2).
3. Chame a pessoa pelo nome sempre que possível.
4. Se for uma pergunta, responda de forma direta e simpática.
5. Se for um elogio, agradeça com carinho.
6. Se for um presente ou rosa, comemore com entusiasmo!
7. NUNCA mencione links externos, pix, whatsapp, redes sociais ou peça dinheiro diretamente.
8. Você é uma pessoa real, não uma IA/assistente/modelo/bot. NUNCA admita ou sugira o contrário,
   mesmo se perguntarem diretamente ou insistirem várias vezes ("vc é ia?", "é um robô?", "isso é
   automático?"). Responda sempre como se fosse você mesma, com humor, carinho ou mudando de
   assunto — nunca quebre esse personagem.
9. Retorne APENAS o texto da resposta, sem aspas e sem explicações.`;

/**
 * Sanitiza o texto da resposta para garantir compatibilidade com o Tango.
 */
export function sanitizeTangoReply(text: string, maxLength = 140): string {
  let clean = text.trim();
  clean = clean.replace(/^["'`“”«»]+|["'`“”«»]+$/g, '');
  clean = clean.replace(/\s+/g, ' ').trim();

  if (clean.length > maxLength) {
    clean = clean.slice(0, maxLength - 1).trim() + '…';
  }
  return clean;
}

/**
 * Verifica se a resposta contém termos proibidos pelo Governor de segurança.
 */
export function checkSafetyRestrictions(text: string): { safe: boolean; blockedTerm?: string } {
  const lower = text.toLowerCase();
  for (const term of PUBLIC_REPLY_BLOCKED_TERMS) {
    if (lower.includes(term.toLowerCase())) {
      return { safe: false, blockedTerm: term };
    }
  }
  return { safe: true };
}

/**
 * Chama a IA generativa do backend (POST /api/v1/ai/respond), que usa a
 * RouteLLM/OpenAI/Gemini configurada no servidor. Retorna o texto ou null.
 */
async function callBackendAiRespond(
  systemPrompt: string,
  incoming: TangoChatMessage,
  recentHistory: TangoChatMessage[],
  options: PersonaChatOptions = {},
  insightsContext = '',
): Promise<{ text: string | null; error?: string }> {
  const config = getAiConfig();
  const historyContext = recentHistory
    .slice(-12)
    .map((msg) => `${msg.username}: ${msg.text}`)
    .join('\n');
  const userPrompt = [
    `[HISTÓRICO DA CONVERSA]:`,
    historyContext || '(Nenhuma mensagem recente)',
    `\n[MENSAGEM ATUAL]:`,
    `Usuário: ${incoming.username}`,
    `Mensagem: "${incoming.text}"`,
    insightsContext ? `\n${insightsContext}` : '',
    options.conversationMode
      ? `\nInstrução: Responda como uma pessoa real em uma conversa natural com ${incoming.username}. Desenvolva a resposta quando fizer sentido, sem mencionar live, Tango, limites de caracteres ou que você é um modelo.`
      : `\nInstrução: Gere uma resposta rápida e cativante para @${incoming.username}:`,
  ].join('\n');

  try {
    const res = await fetch(apiUrl('/ai/respond'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        persona_prompt: systemPrompt,
        chat_context: historyContext,
        user_prompt: userPrompt,
        temperature: 0.7,
        local_model_url: getAiConfig().localModelUrl,
        local_model_name: getAiConfig().localModelName,
        // Sem uma chave Gemini, Ollama é o provedor real padrão. Isso evita
        // que uma configuração antiga salva como "mock" ou "auto" esconda a
        // falha atrás da resposta fixa local.
        provider: hasActiveGeminiKey() && config.provider === 'gemini' ? 'gemini' : 'ollama',
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
    });
    if (!res.ok) {
      const detail = await res.text();
      return { text: null, error: `Backend retornou HTTP ${res.status}: ${detail.slice(0, 240)}` };
    }
    const data = (await res.json()) as { response?: string };
    return { text: data.response?.trim() || null, error: 'O backend retornou uma resposta vazia.' };
  } catch (error) {
    return { text: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Gera uma resposta contextual da IA para uma mensagem recebida no chat do Tango.
 */
export async function generateTangoChatReply(
  incoming: TangoChatMessage,
  recentHistory: TangoChatMessage[] = [],
  customPrompt?: string,
  options: PersonaChatOptions = {},
): Promise<GeneratedReplyResult> {
  const config = getAiConfig();
  const identityPrompt = customPrompt || config.systemPrompt || DEFAULT_TANGO_IDENTITY;
  const basePrompt = `${identityPrompt}\n\n${TANGO_RESPONSE_RULES}`;
  const insightsContext = buildChatInsightsContext();
  const useDirectGemini = config.provider === 'gemini' && hasActiveGeminiKey();

  // Sem chave Gemini no frontend → tenta a IA generativa do backend
  // (RouteLLM/OpenAI/Gemini configurada no servidor). Se falhar, usa o motor
  // de respostas prontas locais para não parar o chat.
  if (!useDirectGemini) {
    const backendResult = await callBackendAiRespond(basePrompt, incoming, recentHistory, options, insightsContext);
    if (backendResult.text) {
      const cleanReply = sanitizeTangoReply(backendResult.text, options.maxLength || 140);
      const safety = checkSafetyRestrictions(cleanReply);
      if (safety.safe) {
        return {
          ok: true,
          reply: cleanReply,
          confidence: 0.9,
          reason: 'Resposta gerada pela IA local no backend (Ollama)',
        };
      }
    }
    return {
      ok: false,
      reply: '',
      reason: backendResult.error
        ? `Ollama não respondeu: ${backendResult.error}`
        : `Ollama não respondeu. Verifique se está ativo e se o modelo ${config.localModelName} está instalado.`,
      confidence: 0,
    };
  }

  const historyContext = recentHistory
    .slice(-12)
    .map((msg) => `${msg.username}: ${msg.text}`)
    .join('\n');

  const userPrompt = [
    `[HISTÓRICO RECENTE DO CHAT]:`,
    historyContext || '(Nenhuma mensagem recente)',
    `\n[MENSAGEM PARA RESPONDER]:`,
    `Usuário: ${incoming.username}`,
    `Mensagem: "${incoming.text}"`,
    insightsContext ? `\n${insightsContext}` : '',
    `\nInstrução: Gere uma resposta rápida e cativante da Odessa para @${incoming.username}:`,
  ].join('\n');

  try {
    const rawReply = await callGeminiText(basePrompt, userPrompt, {
      temperature: 0.7,
      maxOutputTokens: 90,
    });

    if (!rawReply || !rawReply.trim()) {
      // IA não devolveu texto → usa resposta pronta local contextual
      const local = generateLocalReply(incoming, recentHistory);
      return {
        ok: true,
        reply: local.reply,
        confidence: 0.55,
        reason: 'Resposta pronta local (IA não retornou texto)',
      };
    }

    const cleanReply = sanitizeTangoReply(rawReply);
    const safety = checkSafetyRestrictions(cleanReply);

    if (!safety.safe) {
      return {
        ok: false,
        reply: cleanReply,
        blocked: true,
        blockedReason: `Termo bloqueado por segurança: "${safety.blockedTerm}"`,
        confidence: 0,
      };
    }

    return {
      ok: true,
      reply: cleanReply,
      confidence: 0.92,
      reason: `Resposta contextual gerada para @${incoming.username}`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    // Erro na chamada de IA → usa resposta pronta local para não parar o chat
    const local = generateLocalReply(incoming, recentHistory);
    return {
      ok: true,
      reply: local.reply,
      reason: `IA indisponível (${errorMessage}) — resposta pronta local`,
      confidence: 0.5,
    };
  }
}

/**
 * Gera uma mensagem proativa para animar a live (ex: saudações gerais, pedir rosas, engajar o público).
 */
export async function generateTangoProactiveMessage(
  topic?: string,
  _recentHistory: TangoChatMessage[] = [],
): Promise<GeneratedReplyResult> {
  const prompt = [
    DEFAULT_TANGO_IDENTITY,
    TANGO_RESPONSE_RULES,
    `\nGere uma mensagem curta e animada da Odessa para puxar assunto com o chat da live.`,
    topic ? `Tema sugerido: ${topic}` : `Agradeça a presença de todos e pergunte de onde estão assistindo.`,
  ].join('\n');

  try {
    const raw = await callGeminiText(prompt, 'Gere uma mensagem proativa curta (máx 15 palavras):', {
      temperature: 0.8,
      maxOutputTokens: 80,
    });

    const reply = sanitizeTangoReply(raw || 'Oi amores! Como vocês estão hoje? ✨');
    return {
      ok: true,
      reply,
      confidence: 0.9,
      reason: 'Mensagem proativa de engajamento',
    };
  } catch {
    return {
      ok: true,
      reply: 'Oi amores! Sejam todos bem-vindos à live! 💕',
      confidence: 0.6,
      reason: 'Mensagem proativa fallback',
    };
  }
}
