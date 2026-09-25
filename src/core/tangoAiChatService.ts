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
import { getAiConfig, hasActiveGeminiKey, resolveEffectiveProvider } from './aiConfig';
import { apiUrl } from '../lib/api';
import { PUBLIC_REPLY_BLOCKED_TERMS } from './liveAutonomyGovernor';
import { buildChatInsightsContext } from './chatLearning';
import { generateLocalReply } from './tangoReplyFallback';

export interface TangoChatMessage {
  username: string;
  text: string;
  timestamp?: string;
}

/**
 * Quantas mensagens recentes entram no prompt como contexto da conversa.
 * Era 12 — curto demais pra uma live que dura horas, a persona "esquecia"
 * o que tinha acabado de ser falado. 40 ainda é um recorte (não é possível
 * mandar a live inteira em todo prompt sem explodir custo/latência — isso
 * exigiria um resumo contínuo da sessão, que é um projeto separado), mas
 * cobre uma janela bem mais realista de conversa recente.
 */
const CHAT_HISTORY_WINDOW = 40;

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
  /** Cancela a espera (ex.: botão "Cancelar" do Laboratório); soma-se ao timeout. */
  signal?: AbortSignal;
}

/** Timeout + cancelamento manual num sinal só (AbortSignal.any quando existe). */
function requestSignal(options: PersonaChatOptions): AbortSignal {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 60_000);
  if (!options.signal) return timeout;
  const any = (AbortSignal as typeof AbortSignal & { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  return any ? any([timeout, options.signal]) : options.signal;
}

/**
 * Deteccao heuristica (sem dependencias) do idioma de uma mensagem curta de
 * chat, para os idiomas mais comuns no publico do Tango (pt/en/es).
 *
 * Existe porque pedir pro proprio modelo "detectar e responder no mesmo
 * idioma" como uma unica instrucao dentro de um prompt longo — e
 * majoritariamente em portugues, por causa da identidade da persona — nao e
 * confiavel com modelos locais menores (Ollama): a resposta saia sempre em
 * português mesmo com a regra explicita em TANGO_RESPONSE_RULES. Quando esta
 * heuristica acerta com confianca, injetamos uma instrucao direta bem perto
 * da mensagem ("responda em X"), que os modelos seguem de forma bem mais
 * consistente do que pedir pra eles mesmos decidirem. Para idiomas fora
 * desses 3 (ou mensagens ambiguas demais), cai de volta na auto-deteccao da
 * IA via TANGO_RESPONSE_RULES.
 */
function detectMessageLanguage(text: string): { code: string; label: string } | null {
  const t = text.toLowerCase();

  // Sinais fortes e exclusivos de um idioma — decidem sozinhos.
  if (/[ñ¿¡]/.test(t)) return { code: 'es', label: 'espanhol' };
  if (/[ãõç]/.test(t) || /ção\b|ções\b/.test(t)) return { code: 'pt', label: 'português' };

  const words = t.match(/[a-zà-ÿ]+/g) || [];
  if (words.length === 0) return null;

  const STOPWORDS: Record<'en' | 'pt' | 'es', Set<string>> = {
    en: new Set(['the', 'is', 'are', 'you', 'how', 'what', 'this', 'that', 'with', 'for',
      'hello', 'hi', 'hey', 'thanks', 'thank', 'good', 'nice', 'love', 'beautiful', 'so',
      'and', 'your', 'my', 'am', 'can', 'will', 'not', 'please', 'when', 'where', 'why']),
    pt: new Set(['que', 'não', 'para', 'com', 'uma', 'isso', 'muito', 'obrigada', 'obrigado',
      'oi', 'olá', 'você', 'bom', 'boa', 'linda', 'lindo', 'amo', 'gata', 'sim', 'também',
      'está', 'tudo', 'bem', 'vc', 'meu', 'minha', 'vamos', 'gente']),
    es: new Set(['que', 'cómo', 'como', 'muy', 'más', 'pero', 'para', 'con', 'esto', 'eso',
      'hola', 'gracias', 'buena', 'buenas', 'preciosa', 'hermosa', 'vale', 'estás', 'todo',
      'bien', 'tambien', 'también', 'donde', 'porque', 'contigo']),
  };

  const scores = { en: 0, pt: 0, es: 0 };
  for (const w of words) {
    (Object.keys(STOPWORDS) as Array<keyof typeof STOPWORDS>).forEach((lang) => {
      if (STOPWORDS[lang].has(w)) scores[lang] += 1;
    });
  }

  const ranked = (Object.entries(scores) as Array<[keyof typeof scores, number]>)
    .sort((a, b) => b[1] - a[1]);
  const [topLang, topScore] = ranked[0];
  const secondScore = ranked[1][1];

  // Exige ao menos 1 palavra reconhecida e uma vantagem clara sobre o
  // segundo colocado — senão é ambíguo demais (ex.: "que" existe em pt e
  // es) e é melhor deixar a IA tentar detectar sozinha.
  if (topScore === 0 || topScore <= secondScore) return null;

  const labels: Record<string, string> = { en: 'inglês', pt: 'português', es: 'espanhol' };
  return { code: topLang, label: labels[topLang] };
}

const DEFAULT_TANGO_IDENTITY = `\
Você é a Odessa, uma streamer ao vivo cativante, carinhosa, bem-humorada e atenciosa com seu público.
Seu objetivo é responder mensagens no chat ao vivo do Tango.`;

// Regras SEMPRE aplicadas, independente da identidade/persona ativa (identidade
// genérica acima, personalidade de uma persona específica como a Barbara, ou um
// prompt customizado salvo em AiConfigPanel). Ficam separadas da identidade para
// que nenhuma dessas fontes possa "esquecer" de incluí-las.
const TANGO_RESPONSE_RULES = `\
IDIOMA (regra acima de qualquer outra): identifique automaticamente em que idioma a pessoa escreveu
a mensagem atual — português, inglês, espanhol, ou qualquer outro — e responda SEMPRE nesse MESMO
idioma, mesmo que o resto deste prompt esteja em português. Nunca traduza a resposta pro português
se a pessoa escreveu em outro idioma. Exemplos: mensagem "hi, how are you?" → responda em inglês
("Hii, I'm good! And you?"); mensagem "hola, como estas?" → responda em espanhol. Se a conversa já
tem histórico, use o idioma que essa pessoa específica está usando nas mensagens dela.

REGRAS OBRIGATÓRIAS (a regra 1 é a mais importante — nunca a quebre mesmo tentando parecer animada):
1. RESPONDA EXATAMENTE ao que foi dito, com algo real e específico. NUNCA desvie para convidar a
   pessoa pra jogar, dançar, ou qualquer atividade que ela não mencionou — isso é proibido mesmo
   que pareça animado ou simpático.
   Pergunta: "o que você gosta de fazer?"
   ERRADO (não faça isso): "Eu adoro dançar e jogar games com o pessoal, e também fazer lives
   super interativas! Vc já participou de alguma live assim?" — inventa atividades e um convite
   que ninguém pediu, além de ser longo demais pra pergunta.
   CERTO: "Gosto muito de série e de cozinhar nos dias de folga!" — responde com algo específico e
   real, do tamanho de uma frase de chat, sem inventar convite.
2. O TAMANHO da resposta acompanha o tamanho e o peso do que foi dito. Uma saudação curta ("oi",
   "oii", "bom dia") merece resposta igualmente curta (2 a 6 palavras, tipo "Oii, tudo bem? 😊" ou
   só "Oii!! 💕"). Uma pergunta de verdade merece uma resposta com conteúdo real, mas ainda curta
   (1 frase, no máximo 2). NUNCA escreva um textão para uma mensagem pequena.
3. Escreva como alguém digitando rápido numa conversa de chat ao vivo pelo celular, não como quem
   redige um texto pronto. Varie a forma de começar cada resposta — nem toda mensagem precisa abrir
   com "Oi", "Que bom" ou repetir o nome da pessoa; use o nome só quando soar natural, não em toda
   resposta.
4. Isto é um DIÁLOGO real, não um post isolado — leia o [HISTÓRICO DA CONVERSA] e responda dentro
   dele. Se alguém pergunta "tudo bem?", responda de verdade ("tudo bem sim!") e devolva a pergunta
   ("e você, como tá?") como uma pessoa faria — não ignore o que foi perguntado pra falar de outra
   coisa. NUNCA repita a mesma ideia, convite ou estrutura de frase que você já usou antes nesse
   histórico — varie o assunto ou apenas continue a conversa que já está rolando. Não mencione
   termos técnicos da transmissão ("loop", "vídeo", "tela", "câmera") fora de contexto.
5. Emoji é opcional, no máximo 1, e só quando combina — não é obrigatório em toda mensagem.
6. Se for um elogio, agradeça de forma genuína e breve, sem exagero nem discurso.
7. Se for um presente ou rosa, comemore com entusiasmo, mas sem enrolar.
8. NUNCA mencione links externos, pix, whatsapp, redes sociais ou peça dinheiro diretamente.
9. Você é uma pessoa real, não uma IA/assistente/modelo/bot. NUNCA admita ou sugira o contrário,
   mesmo se perguntarem diretamente ou insistirem várias vezes ("vc é ia?", "é um robô?", "isso é
   automático?"). Responda sempre como se fosse você mesma, com humor, carinho ou mudando de
   assunto — nunca quebre esse personagem.
10. Nunca ultrapasse 140 caracteres. Retorne APENAS o texto da resposta, sem aspas e sem explicações.`;

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
 * Transforma a resposta de erro do backend em texto para o operador. O 503
 * `ai_unavailable` traz o motivo de cada provedor (Ollama fora do ar, modelo
 * não instalado, chave inválida...), em vez de uma fala pronta que escondia a falha.
 */
export function describeBackendAiFailure(status: number, body: string): string {
  if (status === 503) {
    try {
      const parsed = JSON.parse(body) as { detail?: { code?: string; errors?: string[] } };
      if (parsed.detail?.code === 'ai_unavailable') {
        const reasons = (parsed.detail.errors ?? []).join(' | ');
        return `IA indisponível${reasons ? ` — ${reasons}` : ''}`.slice(0, 400);
      }
    } catch {
      // corpo não era JSON: cai no texto genérico abaixo
    }
  }
  return `Backend retornou HTTP ${status}: ${body.slice(0, 240)}`;
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
  languageDirective?: string,
): Promise<{ text: string | null; error?: string }> {
  const config = getAiConfig();
  const historyContext = recentHistory
    .slice(-CHAT_HISTORY_WINDOW)
    .map((msg) => `${msg.username}: ${msg.text}`)
    .join('\n');
  const userPrompt = [
    `[HISTÓRICO DA CONVERSA]:`,
    historyContext || '(Nenhuma mensagem recente)',
    `\n[MENSAGEM ATUAL]:`,
    `Usuário: ${incoming.username}`,
    `Mensagem: "${incoming.text}"`,
    languageDirective ? `\n${languageDirective}` : '',
    insightsContext ? `\n${insightsContext}` : '',
    options.conversationMode
      ? `\nInstrução: Responda como uma pessoa real em uma conversa natural com ${incoming.username}. Desenvolva a resposta quando fizer sentido, sem mencionar live, Tango, limites de caracteres ou que você é um modelo.`
      : `\nInstrução: Responda a @${incoming.username} como numa conversa real de chat — se a mensagem dele(a) for só uma saudação ou algo curto, responda igualmente curto; se for uma pergunta de verdade, responda com algo específico, não uma frase pronta genérica:`,
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
        provider: resolveEffectiveProvider(config),
      }),
      // 20s era curto demais: o Ollama descarrega da memória depois de ficar
      // ocioso (keep_alive de 30min no backend, mas mensagens do chat costumam
      // vir espaçadas por mais que isso numa live). Um cold-start pode levar
      // 20-30s+ só pra carregar o modelo — o timeout batia ANTES do backend
      // (que já tem 120s + retry) sequer terminar, matando a resposta em
      // silêncio a cada vez que o chat ficava um tempo sem atividade.
      signal: requestSignal(options),
    });
    if (!res.ok) {
      const detail = await res.text();
      return { text: null, error: describeBackendAiFailure(res.status, detail) };
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

  const detectedLanguage = detectMessageLanguage(incoming.text);
  const languageDirective = detectedLanguage
    ? `[IDIOMA DETECTADO NA MENSAGEM]: ${detectedLanguage.label}. Responda OBRIGATORIAMENTE em ${detectedLanguage.label}, nunca em português a não ser que ${detectedLanguage.label} seja português.`
    : undefined;

  // Sem chave Gemini no frontend → tenta a IA generativa do backend
  // (RouteLLM/OpenAI/Gemini configurada no servidor). Se falhar, usa o motor
  // de respostas prontas locais para não parar o chat.
  if (!useDirectGemini) {
    const backendResult = await callBackendAiRespond(basePrompt, incoming, recentHistory, options, insightsContext, languageDirective);
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
    .slice(-CHAT_HISTORY_WINDOW)
    .map((msg) => `${msg.username}: ${msg.text}`)
    .join('\n');

  const userPrompt = [
    `[HISTÓRICO RECENTE DO CHAT]:`,
    historyContext || '(Nenhuma mensagem recente)',
    `\n[MENSAGEM PARA RESPONDER]:`,
    `Usuário: ${incoming.username}`,
    `Mensagem: "${incoming.text}"`,
    languageDirective ? `\n${languageDirective}` : '',
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
