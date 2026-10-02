/**
 * tangoAiChatService.ts — Motor de Respostas de IA para o Tango Chat.
 *
 * Responsável por:
 * 1. Gerar respostas inteligentes, curtas e contextuais para mensagens do Tango.
 * 2. Aplicar filtros de segurança e termos proibidos (anti-spam, links, termos sensíveis).
 * 3. Respeitar a persona ativa e conversar como gente — do MESMO jeito com
 *    qualquer IA (local ou API): mesmo prompt, mesma conversa em turnos, mesma
 *    memória e o mesmo pós-processamento (humanizeReply.ts).
 * 4. Controlar limites de tamanho (<= 140 chars) para compatibilidade com o chat da live.
 */

import { getAiConfig, providerKeyFor, resolveEffectiveProvider } from './aiConfig';
import { apiUrl } from '../lib/api';
import { PUBLIC_REPLY_BLOCKED_TERMS } from './liveAutonomyGovernor';
import { getMemoryContext } from './chatMemory';
import { isPlatformSystemLine } from './chatConversationGovernor';
import { cleanReply, describeRejection, friendlyName, nowContextLine, personaExampleReplies, rejectReason } from './humanizeReply';

export interface TangoChatMessage {
  username: string;
  text: string;
  timestamp?: string;
  /** Eco de uma mensagem que a própria bridge enviou (não é fala de espectador). */
  own?: boolean;
  /** Já estava na tela quando o leitor do chat olhou: vai pro histórico, mas não recebe resposta. */
  backlog?: boolean;
}


export interface GeneratedReplyResult {
  ok: boolean;
  reply: string;
  reason?: string;
  blocked?: boolean;
  blockedReason?: string;
  confidence: number;
  /** Memórias (usuário e tendências do chat) que entraram no prompt. */
  memoriesUsed?: string[];
}

export interface PersonaChatOptions {
  maxLength?: number;
  conversationMode?: boolean;
  timeoutMs?: number;
  /** Cancela a espera (ex.: botão "Cancelar" do Laboratório); soma-se ao timeout. */
  signal?: AbortSignal;
  /** Persona ativa (memória do que ela já contou de si). */
  personaId?: string;
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
Você é a streamer desta live: simpática, bem-humorada e atenciosa com quem está no chat.`;

/**
 * Como ela conversa — a MESMA regra para qualquer IA (local ou API). Antes
 * havia uma regra longa para a nuvem e outra curta para a IA local, e trocar de
 * IA mudava o jeito dela. Escrita a partir das conversas reais da live: o que
 * soava artificial era fórmula ("tudo bem? e você?"), tom de atendente, cópia
 * dos exemplos, fatos inventados e gênero trocado.
 */
export const CONVERSATION_STYLE = `\
COMO VOCÊ CONVERSA NO CHAT (vale mais que qualquer outra instrução):
Você está ao vivo, lendo o chat e respondendo pelo celular. Fale como uma pessoa de verdade conversando com quem gosta, nunca como atendente ou assistente.
- Primeiro responda o que a pessoa disse ou perguntou, com algo concreto. Pergunta direta pede resposta direta.
- Curto: quase sempre de 3 a 15 palavras, no máximo 2 frases. Na maioria das vezes não termine com pergunta.
- Os exemplos da sua descrição mostram o tom: nunca copie as frases deles, crie respostas novas.
- Varie: não comece toda resposta igual, não repita frases suas, não devolva "e você?" toda hora.
- Fale de si no feminino ("obrigada", "cansada"). Use o nome da pessoa raramente; se aparecer "alguém:", não use nome.
- Conhecimento geral: responda o que uma pessoa comum sabe, numa frase leve. Se não souber, ou se for notícia, política ou eleição, diga que não acompanha. Nunca invente dados nem coisas sobre você que não estejam na sua descrição.
- Se perguntarem se você é IA, robô ou bot: leve na brincadeira, do seu jeito, sem confirmar e sem discurso.
- Pedido de foto, pé, contato ou algo íntimo: corte com charme, em poucas palavras.
- Mensagem só de risada ou emoji: reaja curto, no mesmo clima.
- Nunca fale como assistente ("quer saber mais", "posso ajudar", "é importante") e nunca fale de chat, plataforma, câmera ou vídeo.
- Responda no idioma da mensagem, com linguagem natural e correta. Sem aspas, sem hashtag, sem o seu nome no começo. No máximo 1 emoji, e quase nunca.`;

// Um emoji "visual" inteiro: pictograma + variações/modificadores/ZWJ (ex.: 🙅‍♂️).
const EMOJI_SEQUENCE = /\p{Extended_Pictographic}(?:\u{FE0F}|\p{Emoji_Modifier}|\u{200D}\p{Extended_Pictographic})*/gu;

/** Mantém só o primeiro emoji: modelos pequenos ignoram "no máximo 1 emoji". */
export function limitEmojis(text: string, max = 1): string {
  let seen = 0;
  return text
    .replace(EMOJI_SEQUENCE, (emoji) => (++seen <= max ? emoji : ''))
    .replace(/\s+([!?.,])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Nome da persona a partir da identidade ("Você é a Viktoria, …"). */
export function personaNameFromIdentity(identity: string): string | null {
  const match = identity.match(/Voc[êe] é (?:a |o )?([A-ZÀ-Ý][\p{L}]+)/u);
  return match ? match[1] : null;
}

/** Quantas mensagens recentes viram turnos (mais que isso vira ruído num modelo pequeno). */
export const CONVERSATION_WINDOW = 12;

export type ConversationTurn = { role: 'user' | 'assistant'; content: string };

/**
 * Conversa em turnos para o modelo (igual para toda IA): fala da própria
 * persona (eco da bridge, `own`) = assistant; espectadores = user ("nome:
 * texto", ou "alguém:" quando o nome não é de gente). Linhas da plataforma
 * (batalha, seguidor) ficam de fora. Falas seguidas de espectadores viram um
 * turno só, e a conversa sempre termina na mensagem atual.
 */
export function buildConversationTurns(
  recentHistory: TangoChatMessage[],
  incoming: TangoChatMessage,
  window = CONVERSATION_WINDOW,
): ConversationTurn[] {
  const history = recentHistory.filter((m) => m.own || !isPlatformSystemLine(m)).slice(-window);
  const last = history[history.length - 1];
  if (last && !last.own && last.username === incoming.username && last.text === incoming.text) history.pop();

  const turns: ConversationTurn[] = [];
  for (const msg of [...history, incoming]) {
    const role = msg.own ? 'assistant' : 'user';
    const content = msg.own ? msg.text.trim() : `${friendlyName(msg.username) ?? 'alguém'}: ${msg.text.trim()}`;
    if (!msg.text.trim()) continue;
    const prev = turns[turns.length - 1];
    if (prev && prev.role === role) prev.content += `\n${content}`;
    else turns.push({ role, content });
  }
  while (turns.length && turns[0].role !== 'user') turns.shift();
  return turns;
}

const normalizeForEcho = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * Tira da resposta o que a IA copiou do chat antes de enviar.
 *
 * Visto ao vivo: a resposta saiu "Tá ótimo! … Como foi seu dia hoje? Kungfu
 * Panda: Boa noite minha deusa deslumbrante…" — o modelo continuou a conversa
 * escrevendo as falas dos espectadores, e isso foi enviado ao chat. Corta a
 * resposta onde começa "Nome:" de alguém do chat ou uma mensagem de espectador
 * copiada; se sobrar só eco (ou nada), devolve '' e nada é enviado.
 */
export function scrubEchoedChat(reply: string, recentHistory: TangoChatMessage[], incoming: TangoChatMessage): string {
  const viewers = [...recentHistory, incoming].filter((m) => !m.own);
  const names = [...new Set(viewers.map((m) => m.username.trim()).filter((n) => n.length >= 2))];
  // Resposta que já começa com "Nome do espectador:" — o resto é fala copiada dele.
  for (const name of names) {
    if (reply.toLowerCase().startsWith(`${name.toLowerCase()}:`)) reply = reply.slice(name.length + 1).trimStart();
  }
  let cut = reply.length;
  const lower = reply.toLowerCase();

  for (const name of names) {
    const at = lower.indexOf(`${name.toLowerCase()}:`);
    if (at > 0) cut = Math.min(cut, at);
  }
  for (const msg of viewers) {
    const text = msg.text.trim();
    if (text.length < 12) continue;
    const at = lower.indexOf(text.toLowerCase());
    if (at >= 0) cut = Math.min(cut, at);
  }

  const kept = reply.slice(0, cut).replace(/[\s,;:–-]+$/u, '').trim();
  const keptNorm = normalizeForEcho(kept);
  if (keptNorm.length < 2) return '';
  // A resposta é só a mensagem da pessoa devolvida (ou um pedaço dela).
  const incomingNorm = normalizeForEcho(incoming.text);
  if (keptNorm === incomingNorm || (keptNorm.length >= 8 && incomingNorm.includes(keptNorm))) return '';
  return kept;
}

/** Nome legível de quem gerou a resposta (o servidor devolve "ollama", "mistral"…). */
export function providerDisplayName(provider: string | undefined, localModel: string): string {
  if (provider === 'mistral') return 'Mistral';
  if (provider === 'gemini') return 'Google Gemini';
  if (provider === 'claude') return 'Claude';
  if (provider === 'openai') return 'OpenAI';
  return `IA local (${localModel})`;
}

/**
 * Sanitiza o texto da resposta para garantir compatibilidade com o Tango.
 */
export function sanitizeTangoReply(text: string, maxLength = 140, personaName?: string | null): string {
  let clean = text.trim();
  clean = clean.replace(/^["'`“”«»]+|["'`“”«»]+$/g, '').trim();
  // O histórico vai para o modelo como "Nome: texto", e modelos pequenos copiam o
  // formato: a resposta vinha "Odessa: tudo bem?". Tira esse rótulo de quem fala.
  clean = clean.replace(/^@?[A-Za-zÀ-ÿ0-9_.]{2,24}\s*:\s+(?=\S)/, '');
  if (personaName) {
    // Variante sem dois-pontos: "Viktoria 🖤👀 texto".
    const escaped = personaName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    clean = clean.replace(new RegExp(`^${escaped}(?:\\s|\\p{Extended_Pictographic}|\\u{FE0F})*[:,–-]?\\s+`, 'u'), '');
  }
  clean = clean.replace(/^["'`“”«»]+|["'`“”«»]+$/g, '');
  clean = limitEmojis(clean);
  clean = clean.replace(/\s+/g, ' ').trim();

  if (clean.length > maxLength) {
    // Corta no fim da última frase que cabe; "…" no meio da palavra entrega robô.
    const head = clean.slice(0, maxLength);
    const lastStop = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '), head.lastIndexOf('… '));
    clean = lastStop >= maxLength * 0.4 ? head.slice(0, lastStop + 1).trim() : clean.slice(0, maxLength - 1).trim() + '…';
  }
  return clean;
}

// Pedido de contato fora da live. Nunca passa pela IA: um modelo pequeno às vezes
// "aceita" ("meu zap está à mão"); a recusa sai do próprio prompt da persona.
const CONTACT_REQUEST =
  /\b(?:zap|zapzap|whats?|wpp|whatsapp|telegram|insta|instagram|telefone|(?:seu|teu|o) (?:n[uú]mero|celular|contato|endere[cç]o)(?! d[aeo]s?\b)|endere[cç]o|onde (?:vc|voc[eê]) mora|(?:chama|me chama|vem|vamos) no pv|no privado)\b/i;
const DEFAULT_CONTACT_DEFLECTIONS = [
  'meu cantinho é aqui na live 😊 me conta de você!',
  'aqui na live é onde eu fico, vem conversar com a gente 💖',
  'kkkk meu contato é o chat mesmo, fica por aqui!',
];

export function isContactRequest(text: string): boolean {
  return CONTACT_REQUEST.test(text);
}

/** Recusa no tom da persona: o exemplo de "whats"/"zap" do prompt dela, ou uma padrão. */
export function contactDeflection(identity: string, seed = Date.now()): string {
  const fromPrompt = identity.match(/Mensagem "[^"]*(?:whats|zap)[^"]*" → "([^"]+)"/i);
  if (fromPrompt) return fromPrompt[1];
  return DEFAULT_CONTACT_DEFLECTIONS[Math.abs(seed) % DEFAULT_CONTACT_DEFLECTIONS.length];
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

/** Uma chamada a /ai/respond com o pacote completo (o mesmo para qualquer IA). */
async function callBackendAiRespond(
  systemPrompt: string,
  turns: ConversationTurn[],
  incoming: TangoChatMessage,
  temperature: number,
  options: PersonaChatOptions,
): Promise<{ text: string | null; error?: string; provider?: string }> {
  const config = getAiConfig();
  try {
    const res = await fetch(apiUrl('/ai/respond'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        persona_prompt: systemPrompt,
        chat_context: '',
        conversation: turns,
        // Só para IA que não aceite turnos (todas aceitam hoje).
        user_prompt: `${friendlyName(incoming.username) ?? 'alguém'}: ${incoming.text}`,
        provider_key: providerKeyFor(config),
        temperature,
        local_model_url: config.localModelUrl,
        local_model_name: config.localModelName,
        provider: resolveEffectiveProvider(config),
      }),
      // O Ollama descarrega da memória depois de ficar ocioso; um cold-start
      // leva 20-30 s+ só para carregar o modelo (o backend tem 120 s + retry).
      signal: requestSignal(options),
    });
    if (!res.ok) {
      const detail = await res.text();
      return { text: null, error: describeBackendAiFailure(res.status, detail) };
    }
    const data = (await res.json()) as { response?: string; provider?: string };
    return { text: data.response?.trim() || null, error: 'O backend retornou uma resposta vazia.', provider: data.provider };
  } catch (error) {
    return { text: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Monta o pacote do prompt de sistema: o mesmo para qualquer IA, sempre nesta ordem. */
export function buildSystemPrompt(parts: {
  identity: string;
  memory?: string;
  recentOwn?: string[];
  languageDirective?: string;
  retryNote?: string;
  now?: Date;
}): string {
  const recent = (parts.recentOwn ?? []).slice(-6);
  return [
    parts.identity.trim(),
    CONVERSATION_STYLE,
    nowContextLine(parts.now),
    parts.memory?.trim(),
    recent.length ? `[SUAS ÚLTIMAS FALAS NA LIVE] Não repita estas frases nem o jeito de começar:\n${recent.map((r) => `- ${r}`).join('\n')}` : '',
    parts.languageDirective,
    parts.retryNote,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Gera uma resposta contextual da IA para uma mensagem recebida no chat do Tango.
 * Qualquer IA (local ou API) passa por aqui com o mesmo prompt, a mesma conversa
 * em turnos, a mesma memória e o mesmo filtro de "soou como robô".
 */
export async function generateTangoChatReply(
  incoming: TangoChatMessage,
  recentHistory: TangoChatMessage[] = [],
  customPrompt?: string,
  options: PersonaChatOptions = {},
): Promise<GeneratedReplyResult> {
  const config = getAiConfig();
  const identityPrompt = customPrompt || config.systemPrompt || DEFAULT_TANGO_IDENTITY;
  const personaName = personaNameFromIdentity(identityPrompt);
  const maxLength = options.maxLength || 140;

  if (isContactRequest(incoming.text)) {
    return {
      ok: true,
      reply: sanitizeTangoReply(contactDeflection(identityPrompt), maxLength, personaName),
      confidence: 0.95,
      reason: 'Pedido de contato fora da live: recusa padrão da persona (sem IA)',
    };
  }

  const memory = await getMemoryContext(incoming.username, { id: options.personaId, name: personaName });
  const withMemories = (result: GeneratedReplyResult): GeneratedReplyResult => ({ ...result, memoriesUsed: memory.used });
  const recentOwn = recentHistory.filter((m) => m.own).map((m) => m.text.trim()).filter(Boolean);
  const examples = personaExampleReplies(identityPrompt);
  const turns = buildConversationTurns(recentHistory, incoming);
  const detectedLanguage = detectMessageLanguage(incoming.text);
  const languageDirective = detectedLanguage
    ? `[IDIOMA DA MENSAGEM] ${detectedLanguage.label}: responda em ${detectedLanguage.label}.`
    : undefined;

  let retryNote: string | undefined;
  let lastProblem = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const systemPrompt = buildSystemPrompt({ identity: identityPrompt, memory: memory.context, recentOwn, languageDirective, retryNote });
    const result = await callBackendAiRespond(systemPrompt, turns, incoming, attempt === 0 ? 0.7 : 0.9, options);
    if (!result.text) {
      return withMemories({
        ok: false,
        reply: '',
        reason: result.error ? `IA não respondeu: ${result.error}` : `IA não respondeu. Verifique se a IA escolhida está ativa.`,
        confidence: 0,
      });
    }
    const scrubbed = scrubEchoedChat(result.text, recentHistory, incoming);
    if (!scrubbed) {
      lastProblem = 'A IA só repetiu mensagens do chat';
      retryNote = '[ATENÇÃO] Sua resposta anterior só repetiu o chat. Responda com suas próprias palavras.';
      continue;
    }
    const cleanText = sanitizeTangoReply(cleanReply(scrubbed, recentOwn), maxLength, personaName);
    const rejection = rejectReason(cleanText, recentOwn, examples, incoming.text);
    if (rejection) {
      lastProblem = `Resposta descartada: ${describeRejection(rejection)}`;
      retryNote = `[ATENÇÃO] Sua resposta anterior ("${cleanText}") foi descartada porque ${describeRejection(rejection)}. Responda de outro jeito, com outras palavras, como uma pessoa falaria.`;
      continue;
    }
    const safety = checkSafetyRestrictions(cleanText);
    if (!safety.safe) {
      // A IA respondeu, quem barrou foi o filtro de segurança.
      return withMemories({
        ok: false,
        reply: '',
        blocked: true,
        blockedReason: `Termo bloqueado: ${safety.blockedTerm}`,
        reason: `A IA respondeu, mas o filtro de segurança barrou a resposta (termo "${safety.blockedTerm}").`,
        confidence: 0,
      });
    }
    return withMemories({
      ok: true,
      reply: cleanText,
      confidence: attempt === 0 ? 0.9 : 0.8,
      reason: `Resposta gerada por ${providerDisplayName(result.provider, config.localModelName)}${attempt ? ' (2ª tentativa)' : ''}`,
    });
  }
  return withMemories({
    ok: false,
    reply: '',
    blocked: true,
    blockedReason: lastProblem,
    reason: `${lastProblem} (duas tentativas). Nada foi enviado.`,
    confidence: 0,
  });
}

/**
 * Gera uma mensagem proativa para animar a live (ex: saudações gerais), pela
 * mesma IA e com o mesmo jeito de conversar das respostas.
 */
export async function generateTangoProactiveMessage(
  topic?: string,
  recentHistory: TangoChatMessage[] = [],
  customPrompt?: string,
): Promise<GeneratedReplyResult> {
  const config = getAiConfig();
  const identity = customPrompt || config.systemPrompt || DEFAULT_TANGO_IDENTITY;
  const recentOwn = recentHistory.filter((m) => m.own).map((m) => m.text.trim());
  const prompt = buildSystemPrompt({ identity, recentOwn });
  const ask: TangoChatMessage = {
    username: 'alguém',
    text: topic
      ? `(Puxe assunto com o chat sobre: ${topic}. Uma frase curta, sem perguntar "como vocês estão".)`
      : '(O chat está quieto. Puxe assunto com uma frase curta e natural sobre o que você está fazendo agora.)',
  };
  const result = await callBackendAiRespond(prompt, [{ role: 'user', content: ask.text }], ask, 0.9, {});
  const reply = result.text ? sanitizeTangoReply(cleanReply(result.text, recentOwn), 140, personaNameFromIdentity(identity)) : '';
  if (!reply || rejectReason(reply, recentOwn)) {
    return { ok: false, reply: '', confidence: 0, reason: result.error || 'A IA não gerou uma mensagem natural.' };
  }
  return { ok: true, reply, confidence: 0.85, reason: 'Mensagem proativa de engajamento' };
}
