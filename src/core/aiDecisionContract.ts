/**
 * Contrato de decisão da IA.
 *
 * Três caminhos de execução:
 *  1. Direct Gemini (preferencial) — usa getEffectiveGeminiKey() que verifica
 *     VITE_GEMINI_API_KEY (build) e depois localStorage (configurado na aba IA).
 *  2. Server endpoint (/api/ai/decide) — fallback para servidor.
 *  3. Mock engine — fallback final para simulação local.
 */

import type { OcrEvent } from './ocrEventContract';
import type { LiveEvent } from '../types';
import { getEffectiveGeminiKey, getEffectiveSystemPrompt, getAiConfig, hasActiveGeminiKey, getGeminiProxyUrl } from './aiConfig';
import { apiUrl } from '../lib/api';

export type AiStatus = 'offline' | 'simulated' | 'online' | 'checking';
export type AiIntentType =
  | 'gift_reaction'
  | 'greeting'
  | 'compliment_response'
  | 'question_response'
  | 'idle_maintenance'
  | 'special_event'
  | 'unknown';

export type EmotionTone =
  | 'happy'
  | 'excited'
  | 'grateful'
  | 'neutral'
  | 'shy'
  | 'playful'
  | 'surprised';

export interface AiDecision {
  /** Mensagem/evento que gerou a decisão */
  sourceEvent: OcrEvent | null;
  /** Intenção detectada */
  intent: AiIntentType;
  /** Emoção/tom sugerido para a persona */
  emotion: EmotionTone;
  /** Ação recomendada */
  recommendedAction: 'play_video' | 'queue_video' | 'wait' | 'no_action';
  /** ID do gatilho selecionado */
  selectedTriggerId: string | null;
  /** ID do vídeo selecionado */
  selectedVideoId: string | null;
  /** Label do vídeo para exibição */
  selectedVideoLabel: string | null;
  /** Confiança da decisão [0–1] */
  confidence: number;
  /** Motivo da escolha (texto legível) */
  reasoning: string;
  /** Estado da IA */
  status: AiStatus;
  /** Timestamp da decisão */
  timestamp: string;
}

/** Decisão vazia / estado inicial */
export const EMPTY_AI_DECISION: AiDecision = {
  sourceEvent: null,
  intent: 'unknown',
  emotion: 'neutral',
  recommendedAction: 'no_action',
  selectedTriggerId: null,
  selectedVideoId: null,
  selectedVideoLabel: null,
  confidence: 0,
  reasoning: 'Aguardando eventos.',
  status: 'offline',
  timestamp: new Date().toISOString(),
};

/** Labels legíveis para intenções */
export const INTENT_LABELS: Record<AiIntentType, string> = {
  gift_reaction: 'Reação a presente',
  greeting: 'Saudação',
  compliment_response: 'Resposta a elogio',
  question_response: 'Resposta a pergunta',
  idle_maintenance: 'Manutenção do idle',
  special_event: 'Evento especial',
  unknown: 'Desconhecido',
};

/** Labels legíveis para emoções */
export const EMOTION_LABELS: Record<EmotionTone, string> = {
  happy: 'Feliz',
  excited: 'Animada',
  grateful: 'Grata',
  neutral: 'Neutra',
  shy: 'Tímida',
  playful: 'Brincalhona',
  surprised: 'Surpresa',
};

/** Labels de ação */
export const ACTION_LABELS: Record<AiDecision['recommendedAction'], string> = {
  play_video: 'Tocar vídeo',
  queue_video: 'Enfileirar vídeo',
  wait: 'Aguardar',
  no_action: 'Sem ação',
};

/**
 * Decisão "checking" — placeholder enquanto a chamada assíncrona está em voo.
 */
export function checkingAiDecision(event: OcrEvent): AiDecision {
  return {
    sourceEvent: event,
    intent: 'unknown',
    emotion: 'neutral',
    recommendedAction: 'no_action',
    selectedTriggerId: null,
    selectedVideoId: null,
    selectedVideoLabel: null,
    confidence: 0,
    reasoning: 'Consultando IA...',
    status: 'checking',
    timestamp: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Gemini direct (client-side)
// ─────────────────────────────────────────────────────────────────────────────

// gemini-2.5-flash-lite: rápido, estável e sem "thinking" que estoura o
// orçamento de tokens (o 2.5-flash vinha dando 503/respostas vazias).
const GEMINI_MODEL = 'gemini-2.5-flash-lite';
const AI_TIMEOUT_MS = 10_000;

const AI_VALID_INTENTS = ['gift_reaction','greeting','compliment_response','question_response','idle_maintenance','special_event','unknown'];
const AI_VALID_EMOTIONS = ['happy','excited','grateful','neutral','shy','playful','surprised'];
const AI_VALID_ACTIONS  = ['play_video','queue_video','wait','no_action'];

export type AiConfig = {
  videos?: Array<{ id: string; label?: string; name?: string }>;
  triggers?: Array<{ id: string; name?: string; label?: string; enabled?: boolean }>;
};

export function buildAiUserMessage(event: OcrEvent, config?: AiConfig): string {
  const lines: string[] = [
    `Tipo de evento: ${event.eventType ?? 'desconhecido'}`,
    `Texto bruto: "${event.rawText ?? ''}"`,
    `Texto normalizado: "${event.normalizedText ?? ''}"`,
    `Zona: ${event.zoneName ?? 'desconhecida'} (${event.zone ?? ''})`,
    `Confiança do OCR: ${Math.round((event.confidence ?? 0) * 100)}%`,
  ];
  const meta = event.metadata as Record<string, string> | undefined;
  if (meta?.giftName || meta?.giftKey) {
    lines.push(`Presente: ${meta.giftName || meta.giftKey}`);
  }
  if (event.author) lines.push(`Autor/usuário: ${event.author}`);
  if (config?.triggers?.length) {
    const tList = config.triggers
      .filter((t) => t.enabled !== false)
      .slice(0, 10)
      .map((t) => `  - id:"${t.id}" label:"${t.name || t.label || t.id}"`)
      .join('\n');
    lines.push(`\nGatilhos disponíveis:\n${tList}`);
  } else {
    lines.push('\nGatilhos disponíveis: nenhum');
  }
  if (config?.videos?.length) {
    const vList = config.videos
      .slice(0, 10)
      .map((v) => `  - id:"${v.id}" label:"${v.label || v.name || v.id}"`)
      .join('\n');
    lines.push(`\nVídeos disponíveis:\n${vList}`);
  }
  return lines.join('\n');
}

function sanitizeAiDecision(raw: string, event: OcrEvent): AiDecision | null {
  let parsed: Record<string, unknown>;
  try {
    const clean = (raw || '').replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
    parsed = JSON.parse(clean) as Record<string, unknown>;
  } catch {
    return null;
  }
  return {
    sourceEvent: event,
    intent: AI_VALID_INTENTS.includes(parsed.intent as string) ? (parsed.intent as AiIntentType) : 'unknown',
    emotion: AI_VALID_EMOTIONS.includes(parsed.emotion as string) ? (parsed.emotion as EmotionTone) : 'neutral',
    recommendedAction: AI_VALID_ACTIONS.includes(parsed.recommendedAction as string)
      ? (parsed.recommendedAction as AiDecision['recommendedAction'])
      : 'no_action',
    selectedTriggerId: typeof parsed.selectedTriggerId === 'string' ? parsed.selectedTriggerId : null,
    selectedVideoId: typeof parsed.selectedVideoId === 'string' ? parsed.selectedVideoId : null,
    selectedVideoLabel: typeof parsed.selectedVideoLabel === 'string' ? parsed.selectedVideoLabel : null,
    confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
    reasoning: typeof parsed.reasoning === 'string' ? (parsed.reasoning as string).slice(0, 200) : 'Decisão gerada pela IA.',
    status: 'online',
    timestamp: new Date().toISOString(),
  };
}

/**
 * Encaminha uma requisição generateContent para a Gemini ATRAVÉS do proxy do
 * servidor (POST /api/ai/gemini). O browser não consegue chamar a Gemini direto
 * porque o endpoint do Google não responde o preflight CORS ("Failed to fetch"),
 * então toda chamada client-side caía em fallback local. A chave segue no corpo
 * porque é guardada no cliente (localStorage / VITE_GEMINI_API_KEY). Retorna o
 * texto do primeiro candidate, ou null se não houver chave/candidate.
 */
async function geminiGenerate(payload: Record<string, unknown>): Promise<string | null> {
  const apiKey = getEffectiveGeminiKey();
  if (!apiKey) return null;
  const reqBody = JSON.stringify({ key: apiKey, model: GEMINI_MODEL, payload });
  const proxyUrl = getGeminiProxyUrl();
  // Ponte externa (ex.: Cloudflare Worker) quando configurada; senão, o proxy
  // do próprio servidor (mesma origem). O browser não chama a Gemini direto.
  const doRequest = () =>
    proxyUrl
      ? fetch(proxyUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: reqBody,
          credentials: 'omit',
          signal: AbortSignal.timeout(25_000),
        })
      : fetch(apiUrl('/ai/gemini'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: reqBody,
          credentials: 'include',
          signal: AbortSignal.timeout(25_000),
        });
  // A Gemini às vezes responde 503 (sobrecarga) ou 429 (limite por minuto) —
  // são transitórios, então tenta de novo com um pequeno intervalo antes de desistir.
  let res = await doRequest();
  for (let attempt = 0; attempt < 2 && (res.status === 503 || res.status === 429); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
    res = await doRequest();
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(`Gemini ${res.status}: ${errText.slice(0, 180)}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    error?: { message?: string };
  };
  if (data?.error) throw new Error(`Gemini: ${data.error.message || 'erro desconhecido'}`);
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
}

/**
 * Chama a Gemini (via proxy do servidor) para uma decisão simples a partir de um
 * OcrEvent. Retorna null se nenhuma chave estiver disponível.
 * Exportada para que AiConfigPanel possa testá-la isoladamente.
 */
export async function callGeminiDirect(event: OcrEvent, config?: AiConfig): Promise<AiDecision | null> {
  const apiKey = getEffectiveGeminiKey();
  if (!apiKey) return null;

  const rawText = await geminiGenerate({
    system_instruction: { parts: [{ text: getEffectiveSystemPrompt() }] },
    contents: [{ role: 'user', parts: [{ text: buildAiUserMessage(event, config) }] }],
    generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 256, temperature: 0.3 },
  });
  if (!rawText) throw new Error('Gemini retornou resposta vazia');

  return sanitizeAiDecision(rawText, event);
}

// ─────────────────────────────────────────────────────────────────────────────
// Diretora — decisão de rodada (cérebro único)
// ─────────────────────────────────────────────────────────────────────────────
//
// Diferente de callGeminiDirect (que escolhe apenas um vídeo), a Diretora recebe
// uma RODADA de eventos + o contexto rico (persona, memória, humor, biblioteca) e
// devolve uma decisão completa no formato PersonaDecision: fala + lista de ações
// (tocar vídeo, trocar cena, responder no chat, etc.). É multilíngue por natureza:
// o modelo lê qualquer idioma e casa por significado, não por palavra exata.

/** Contexto que a Diretora recebe para decidir a rodada. */
export type DirectorContext = {
  /** Prompt de sistema completo (persona + memória + humor + biblioteca + RAG). */
  systemPrompt: string;
  /** Vídeos disponíveis para a IA escolher (id + label). */
  videos?: Array<{ id: string; label?: string; name?: string; title?: string }>;
  /** Gatilhos configurados (referência para a IA). */
  triggers?: Array<{ id: string; name?: string; label?: string; enabled?: boolean }>;
  /** Cenas de OBS permitidas (para switch_scene). */
  scenes?: string[];
  /** Ferramentas habilitadas (capabilities que a IA pode usar). */
  tools?: Array<{ capability: string; label?: string; enabled?: boolean }>;
  /** Temperatura da geração (humor). Default 0.6. */
  temperature?: number;
};

/** Decisão crua devolvida pela Diretora — passa por normalizeDecision no chamador. */
export type RawDirectorDecision = {
  context_analysis?: string;
  sentiment?: string;
  speech: string;
  intent: string;
  confidence: number;
  reason: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  actions: Array<{
    type: string;
    capability?: string;
    label?: string;
    payload?: Record<string, unknown>;
  }>;
};

const DIRECTOR_INSTRUCTION = `\
Você está dirigindo uma rodada ao vivo. Receberá um lote de eventos capturados (chat, presentes,
alertas, sistema). IMPORTANTE: o chat pode estar em QUALQUER idioma — interprete pelo SIGNIFICADO,
não pela palavra exata. Os gatilhos/vídeos podem ter nomes em português; case por intenção.

Responda SOMENTE com um objeto JSON válido (sem markdown, sem texto fora do JSON):
{
  "context_analysis": "<o que está acontecendo na rodada, 1 frase>",
  "sentiment": "positivo" | "neutro" | "negativo",
  "speech": "<UMA fala curta da persona, em português do Brasil>",
  "intent": "<intenção curta, ex: ack_gift, welcome, respond_chat, recover_quiet>",
  "confidence": <número entre 0 e 1>,
  "reason": "<por que essa decisão, curto>",
  "priority": "low" | "normal" | "high" | "urgent",
  "actions": [
    { "type": "play_video", "payload": { "videoId": "<id EXATO da lista de vídeos>" } },
    { "type": "switch_scene", "payload": { "sceneName": "<cena EXATA da lista>" } },
    { "type": "chat_reply", "payload": { "message": "<resposta curta no chat>" } }
  ]
}

Regras:
- No máximo UMA fala por rodada. Chat comum vira contexto quando houver presente/resgate/moderação.
- Só inclua "play_video" se algum vídeo da lista fizer sentido para o evento; use o id EXATO.
- Só inclua "switch_scene" se a cena estiver na lista de cenas permitidas.
- Para presente, prefira reagir (play_video) e agradecer sem pressionar a gastar.
- Se nada relevante, retorne actions: [] e uma fala leve de manutenção.
- Tipos de ação válidos: speak, chat_reply, ack_gift, moderate_message, switch_scene,
  show_overlay, play_music, play_video, webhook, stop_media, set_topic, suggest_topic, remember.`;

function buildDirectorUserMessage(events: LiveEvent[], ctx: DirectorContext): string {
  const lines: string[] = [];
  lines.push('EVENTOS DA RODADA:');
  events.forEach((ev, i) => {
    const meta = (ev.metadata || {}) as Record<string, unknown>;
    const extra: string[] = [];
    if (meta.user) extra.push(`autor:${String(meta.user)}`);
    if (meta.giftName) extra.push(`presente:${String(meta.giftName)}`);
    if (meta.quantity) extra.push(`x${String(meta.quantity)}`);
    lines.push(`  ${i + 1}. [${ev.kind}/${ev.source}] "${ev.text}"${extra.length ? ` (${extra.join(' ')})` : ''}`);
  });

  const vids = (ctx.videos || []).slice(0, 24);
  if (vids.length) {
    lines.push('\nVÍDEOS DISPONÍVEIS (use o id EXATO em play_video):');
    vids.forEach((v) => lines.push(`  - id:"${v.id}" label:"${v.label || v.name || v.title || v.id}"`));
  } else {
    lines.push('\nVÍDEOS DISPONÍVEIS: nenhum (não use play_video).');
  }

  const scenes = (ctx.scenes || []).slice(0, 16);
  if (scenes.length) {
    lines.push('\nCENAS PERMITIDAS (use o nome EXATO em switch_scene):');
    scenes.forEach((s) => lines.push(`  - "${s}"`));
  } else {
    lines.push('\nCENAS PERMITIDAS: nenhuma (não use switch_scene).');
  }

  const tools = (ctx.tools || []).filter((t) => t.enabled !== false).slice(0, 20);
  if (tools.length) {
    lines.push('\nFERRAMENTAS HABILITADAS:');
    lines.push('  ' + tools.map((t) => t.capability).join(', '));
  }

  lines.push(`\n${DIRECTOR_INSTRUCTION}`);
  return lines.join('\n');
}

function parseDirectorDecision(raw: string): RawDirectorDecision | null {
  let parsed: Record<string, unknown>;
  try {
    const clean = (raw || '').replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
    parsed = JSON.parse(clean) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof parsed.speech !== 'string' && !Array.isArray(parsed.actions)) return null;
  const rawActions = Array.isArray(parsed.actions) ? parsed.actions : [];
  const actions = rawActions
    .filter((a): a is Record<string, unknown> => Boolean(a) && typeof a === 'object')
    .map((a) => ({
      type: typeof a.type === 'string' ? a.type : 'log_event',
      capability: typeof a.capability === 'string' ? a.capability : undefined,
      label: typeof a.label === 'string' ? a.label : undefined,
      payload: (a.payload && typeof a.payload === 'object' ? a.payload : {}) as Record<string, unknown>,
    }));
  return {
    context_analysis: typeof parsed.context_analysis === 'string' ? parsed.context_analysis : undefined,
    sentiment: typeof parsed.sentiment === 'string' ? parsed.sentiment : undefined,
    speech: typeof parsed.speech === 'string' ? parsed.speech : '',
    intent: typeof parsed.intent === 'string' ? parsed.intent : 'respond_live_event',
    confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.7,
    reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 240) : 'Decisão da Diretora.',
    priority: (['low', 'normal', 'high', 'urgent'] as const).includes(parsed.priority as never)
      ? (parsed.priority as RawDirectorDecision['priority'])
      : 'normal',
    actions,
  };
}

/**
 * Chama a Diretora (Gemini direto, multilíngue) para decidir a rodada inteira.
 * Retorna null se não houver chave disponível (chamador usa fallback local).
 * Lança em erro de rede/HTTP (chamador trata).
 */
export async function callDirectorDecision(
  events: LiveEvent[],
  ctx: DirectorContext,
): Promise<RawDirectorDecision | null> {
  const apiKey = getEffectiveGeminiKey();
  if (!apiKey) return null;
  if (!events.length) return null;

  const rawText = await geminiGenerate({
    system_instruction: { parts: [{ text: ctx.systemPrompt || getEffectiveSystemPrompt() }] },
    contents: [{ role: 'user', parts: [{ text: buildDirectorUserMessage(events, ctx) }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      maxOutputTokens: 640,
      temperature: typeof ctx.temperature === 'number' ? ctx.temperature : 0.6,
    },
  });
  if (!rawText) throw new Error('Diretora: Gemini retornou resposta vazia');

  return parseDirectorDecision(rawText);
}

/**
 * Geração de texto livre via Gemini direto (browser). Reutilizável — usada pelo
 * resumo de aprendizado do chat. Retorna null se não houver chave.
 */
export async function callGeminiText(
  systemPrompt: string,
  userMessage: string,
  opts?: { temperature?: number; maxOutputTokens?: number },
): Promise<string | null> {
  const apiKey = getEffectiveGeminiKey();
  if (!apiKey) return null;

  const rawText = await geminiGenerate({
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    generationConfig: {
      maxOutputTokens: opts?.maxOutputTokens ?? 256,
      temperature: typeof opts?.temperature === 'number' ? opts.temperature : 0.4,
    },
  });
  return rawText ? rawText.trim() : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Designer de fluxo reativo — auto-montagem com IA
// ─────────────────────────────────────────────────────────────────────────────

export type FlowProposalReaction = {
  videoId: string;
  eventType?: 'gift' | 'comment' | 'follow' | 'alert';
  giftKey?: string | null;
  keyword?: string | null;
  returnToIdle?: boolean;
  reason?: string;
};
export type FlowProposal = {
  idleVideoId: string | null;
  reactions: FlowProposalReaction[];
};

const FLOW_DESIGNER_PROMPT = `\
Você projeta o FLUXO REATIVO de uma live TikTok com uma persona em vídeo.
Recebe a biblioteca de VÍDEOS e os PRESENTES disponíveis.

Tarefa:
1) Escolha o vídeo IDLE (loop de espera — o mais neutro/parado, ou um que tenha "idle/loop/base" no nome).
2) APROVEITE TODOS OS VÍDEOS: cada vídeo da lista (exceto o idle) deve aparecer em PELO MENOS UMA reação.
   Nenhum vídeo pode ficar de fora.
3) Para cada PRESENTE relevante, escolha o MELHOR vídeo de reação combinando por SIGNIFICADO
   (nome/tags/descrição — em qualquer idioma).
4) Para os vídeos que não combinarem com nenhum presente, crie uma reação por PALAVRA-CHAVE de chat
   relacionada ao próprio vídeo (algo que o público digitaria), ou por saudações/elogios comuns
   ("oi"/"hello", "linda"/"love", pergunta). O importante é que TODO vídeo tenha uma reação.

Responda SOMENTE com JSON válido (sem markdown, sem texto fora do JSON):
{"idleVideoId":"<id>","reactions":[{"videoId":"<id EXATO>","eventType":"gift"|"comment","giftKey":"<key EXATA>"|null,"keyword":"<palavra>"|null,"returnToIdle":true,"reason":"<curto>"}]}

Regras:
- Use ids de vídeo e keys de presente EXATAMENTE como nas listas.
- Presente → eventType "gift" + giftKey (e keyword null). Palavra-chave → eventType "comment" + keyword (e giftKey null).
- NUNCA use o vídeo idle como reação. No máximo uma reação por presente, mas TODO vídeo (menos o idle) precisa de reação.
- returnToIdle sempre true.`;

function buildFlowDesignerMessage(ctx: {
  videos: Array<{ id: string; label?: string; tags?: string[]; description?: string }>;
  gifts: Array<{ key: string; name: string }>;
}): string {
  const vids = ctx.videos.slice(0, 60).map((v) => {
    const extra = [v.tags?.length ? `tags:[${v.tags.join(',')}]` : '', v.description ? `desc:"${v.description.slice(0, 80)}"` : '']
      .filter(Boolean).join(' ');
    return `  - id:"${v.id}" label:"${v.label || v.id}"${extra ? ` ${extra}` : ''}`;
  }).join('\n');
  const gifts = ctx.gifts.slice(0, 60).map((g) => `  - key:"${g.key}" nome:"${g.name}"`).join('\n');
  return `VÍDEOS:\n${vids || '  (nenhum)'}\n\nPRESENTES:\n${gifts || '  (nenhum)'}`;
}

function parseFlowProposal(raw: string): FlowProposal | null {
  let parsed: Record<string, unknown>;
  try {
    const clean = (raw || '').replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
    parsed = JSON.parse(clean) as Record<string, unknown>;
  } catch {
    return null;
  }
  const rawReactions = Array.isArray(parsed.reactions) ? parsed.reactions : [];
  const reactions: FlowProposalReaction[] = rawReactions
    .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === 'object' && typeof (r as Record<string, unknown>).videoId === 'string')
    .map((r) => ({
      videoId: String(r.videoId),
      eventType: (['gift', 'comment', 'follow', 'alert'] as const).includes(r.eventType as never) ? (r.eventType as FlowProposalReaction['eventType']) : 'gift',
      giftKey: typeof r.giftKey === 'string' ? r.giftKey : null,
      keyword: typeof r.keyword === 'string' ? r.keyword : null,
      returnToIdle: r.returnToIdle !== false,
      reason: typeof r.reason === 'string' ? r.reason.slice(0, 120) : undefined,
    }));
  return {
    idleVideoId: typeof parsed.idleVideoId === 'string' ? parsed.idleVideoId : null,
    reactions,
  };
}

/**
 * Pede à IA (Gemini direto) um fluxo reativo completo a partir da biblioteca de
 * vídeos e presentes. Retorna null se não houver chave de IA.
 */
export async function callFlowDesigner(ctx: {
  videos: Array<{ id: string; label?: string; tags?: string[]; description?: string }>;
  gifts: Array<{ key: string; name: string }>;
}): Promise<FlowProposal | null> {
  const apiKey = getEffectiveGeminiKey();
  if (!apiKey) return null;

  const raw = await geminiGenerate({
    system_instruction: { parts: [{ text: FLOW_DESIGNER_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: buildFlowDesignerMessage(ctx) }] }],
    generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 8192, temperature: 0.3 },
  });
  if (!raw) throw new Error('IA retornou resposta vazia (pode ser sobrecarga momentânea da Gemini — tente de novo).');
  const proposal = parseFlowProposal(raw);
  // Importante: parseFlowProposal devolve null quando a resposta não é JSON
  // válido (ex.: cortada). Lançamos um erro claro aqui em vez de devolver null,
  // senão a tela mostra "Configure a chave" por engano (o problema não é a chave).
  if (!proposal) {
    throw new Error(`IA devolveu um formato inesperado (talvez resposta cortada). Tente de novo. Início: ${raw.slice(0, 120)}`);
  }
  return proposal;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ponto de entrada principal
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Chama o motor de decisão da IA.
 *
 * Ordem de tentativa:
 *  1. Gemini direto do browser (se chave disponível via build ou localStorage e
 *     provider !== 'mock')
 *  2. Endpoint do servidor /api/ai/decide (status 200 explícito — ignora 202)
 *  3. Mock engine (simulação local)
 */
export async function callAiDecision(
  event: OcrEvent,
  config?: AiConfig,
): Promise<AiDecision> {
  const { provider } = getAiConfig();

  // ── 1. Gemini direto ──────────────────────────────────────────────────────
  if (provider !== 'mock' && hasActiveGeminiKey()) {
    try {
      const decision = await callGeminiDirect(event, config);
      if (decision) return decision;
    } catch (err) {
      console.warn('[callAiDecision] direct Gemini error:', err instanceof Error ? err.message : err);
    }
  }

  // Se provider === 'mock', pula direto para o mock sem tentar o servidor
  if (provider === 'mock') return mockAiDecision(event);

  // ── 2. Server endpoint ────────────────────────────────────────────────────
  try {
    const res = await fetch('/api/ai/decide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ocrEvent: event, config }),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });

    // Apenas 200 é resposta válida de decisão (202 = cloud-placeholder, 503 = sem key)
    if (res.status === 200) {
      const decision = (await res.json()) as AiDecision;
      return { ...decision, sourceEvent: event };
    }

    if (res.status !== 503 && res.status !== 202) {
      const err = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as { error?: string };
      console.warn('[callAiDecision] server error:', err.error);
    }
  } catch (err) {
    console.warn('[callAiDecision] server unavailable:', err instanceof Error ? err.message : err);
  }

  // ── 3. Mock ───────────────────────────────────────────────────────────────
  return mockAiDecision(event);
}

/**
 * Mock engine — simula uma decisão de IA com base no tipo de evento OCR.
 */
export function mockAiDecision(event: OcrEvent): AiDecision {
  const base: Omit<AiDecision, 'intent' | 'emotion' | 'recommendedAction' | 'reasoning' | 'confidence'> = {
    sourceEvent: event,
    selectedTriggerId: null,
    selectedVideoId: null,
    selectedVideoLabel: null,
    status: 'simulated',
    timestamp: new Date().toISOString(),
  };

  if (event.eventType === 'gift') {
    const meta = event.metadata as Record<string, string> | undefined;
    const giftName = meta?.giftName || meta?.giftKey || 'presente';
    return {
      ...base,
      intent: 'gift_reaction',
      emotion: 'excited',
      recommendedAction: 'play_video',
      confidence: 0.92,
      reasoning: `Presente "${giftName}" detectado. Reação imediata tem alta prioridade.`,
    };
  }

  if (event.eventType === 'comment') {
    const text = event.normalizedText;
    if (/linda|bonita|gostosa|amor|amo/.test(text)) {
      return {
        ...base,
        intent: 'compliment_response',
        emotion: 'shy',
        recommendedAction: 'play_video',
        confidence: 0.78,
        reasoning: 'Elogio detectado no comentário. Resposta tímida sugerida.',
      };
    }
    if (/oi|olá|hello|boa noite|boa tarde|bom dia/.test(text)) {
      return {
        ...base,
        intent: 'greeting',
        emotion: 'happy',
        recommendedAction: 'play_video',
        confidence: 0.85,
        reasoning: 'Saudação no chat. Resposta amigável com alta confiança.',
      };
    }
  }

  if (event.eventType === 'follow') {
    return {
      ...base,
      intent: 'greeting',
      emotion: 'grateful',
      recommendedAction: 'play_video',
      confidence: 0.88,
      reasoning: 'Novo seguidor. Agradecimento programado.',
    };
  }

  return {
    ...base,
    intent: 'idle_maintenance',
    emotion: 'neutral',
    recommendedAction: 'wait',
    confidence: 0.45,
    reasoning: 'Evento de baixa prioridade. Mantendo idle.',
  };
}
