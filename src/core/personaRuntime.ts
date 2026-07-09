import { executeActionQueue } from './actionExecutor';
import { applyAutomationRules } from './automationRules';
import {
  buildContentPromptContext,
  markContentUsed,
  selectContentForEvents,
} from './contentLibrary';
import { classifyEvent } from './eventClassifier';
import { markEventProcessed } from './eventBus';
import { capabilityForAction } from './toolRegistry';
import { callDirectorDecision, normalizeDirectorDecision } from './aiDecisionContract';
import { recordChatLearning, buildChatInsightsContext } from './chatLearning';
import { recordGiftLearning, buildGiftInsightsContext } from './giftLearning';
import { governPersonaDecision } from './liveAutonomyGovernor';
import { buildVideoPresetsContext, markVideoPlayed } from './videoPresets';
import { apiUrl } from '../lib/api';
import {
  addTurn,
  buildMemoryContext,
  buildUserContext,
  loadMemory,
  loadUserProfiles,
  trackUserInteraction,
} from '../lib/memory';
import type {
  AutopilotAction,
  AutopilotActionType,
  AutopilotCycle,
  AutomationRule,
  CycleLog,
  CycleStage,
  LiveEvent,
  PersonaDecision,
  PersonaTool,
  UsedContentItem,
} from '../types';

const AUDIT_KEY = 'odessa:audit-session:v1';

const ACTION_LABELS: Record<AutopilotActionType, string> = {
  speak: 'Falar via TTS',
  chat_reply: 'Resposta no chat',
  ack_gift: 'Agradecer presente',
  moderate_message: 'Moderar mensagem',
  switch_scene: 'Trocar cena',
  show_overlay: 'Exibir overlay',
  play_music: 'Tocar musica',
  play_video: 'Tocar video',
  webhook: 'Chamar webhook',
  stop_media: 'Parar midia',
  set_topic: 'Definir topico',
  suggest_topic: 'Sugerir topico',
  remember: 'Salvar memoria',
  log_event: 'Registrar evento',
};

const ACTION_TYPES = new Set<AutopilotActionType>(
  Object.keys(ACTION_LABELS) as AutopilotActionType[],
);

export interface PersonaRuntimeOptions {
  personaPrompt: string;
  tools: PersonaTool[];
  rules: AutomationRule[];
  voiceEnabled: boolean;
  /** Catálogo de vídeos que a Diretora pode escolher (play_video). */
  videos?: Array<{ id: string; label?: string; name?: string; title?: string }>;
  /** Gatilhos configurados (referência para a Diretora). */
  triggers?: Array<{ id: string; name?: string; label?: string; enabled?: boolean }>;
  /** Cenas de OBS permitidas (switch_scene). */
  scenes?: string[];
  /** Se true, o agente local pode executar clique/clipboard no chat visual. */
  localAgentReady?: boolean;
  onUpdate?: (cycle: AutopilotCycle) => void;
  onAction?: (action: AutopilotAction) => void;
}

function canUseStorage() {
  return typeof window !== 'undefined' && Boolean(window.localStorage);
}

function formatClock(date = new Date()) {
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function log(label: string, status: CycleLog['status']): CycleLog {
  return {
    id: makeId('log'),
    time: formatClock(),
    label,
    status,
  };
}

type RuleMatches = ReturnType<typeof applyAutomationRules>;

interface BackendMemoryRoundContext {
  usersRecognized: number;
  context: string;
  users: Array<Record<string, unknown>>;
  error?: string;
}

function metadataBool(event: LiveEvent, key: string) {
  return event.metadata?.[key] === true || String(event.metadata?.[key]).toLowerCase() === 'true';
}

function eventPriority(event: LiveEvent) {
  if (event.kind === 'moderation') return 100;
  if (event.kind === 'gift' && metadataBool(event, 'redeemable')) return 90;
  if (event.kind === 'gift') return 80;
  if (event.kind === 'alert') return 70;
  if (
    event.kind === 'scene' ||
    event.source === 'obs' ||
    event.source === 'media' ||
    String(event.metadata?.mappedAction || '').startsWith('obs.') ||
    String(event.metadata?.mappedAction || '').startsWith('media.')
  ) {
    return 60;
  }
  if (event.kind === 'chat') return 40;
  return 30;
}

function choosePrimaryEvent(events: LiveEvent[]) {
  return [...events].sort((a, b) => eventPriority(b) - eventPriority(a))[0] || events[0];
}

function eventBatchSummary(events: LiveEvent[]) {
  return events
    .map((event, index) => `${index + 1}. [${event.kind}/${event.source}] ${event.text}`)
    .join('\n');
}

export function loadAuditSession(): AutopilotCycle[] {
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(AUDIT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveAuditSession(cycles: AutopilotCycle[]): AutopilotCycle[] {
  const next = cycles.slice(-80);
  if (!canUseStorage()) return next;
  try {
    window.localStorage.setItem(AUDIT_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage failures.
  }
  return next;
}

export function appendAuditCycle(cycle: AutopilotCycle): AutopilotCycle[] {
  const next = [...loadAuditSession().filter((item) => item.id !== cycle.id), cycle];
  return saveAuditSession(next);
}

export function clearAuditSession(): void {
  saveAuditSession([]);
}

export function exportAuditSession(payload: {
  events: LiveEvent[];
  cycles: AutopilotCycle[];
  tools: PersonaTool[];
  rules: AutomationRule[];
  contentItems?: unknown[];
}) {
  return JSON.stringify(
    {
      product: 'Odessa',
      version: 'mvp-runtime-v1',
      exportedAt: new Date().toISOString(),
      ...payload,
    },
    null,
    2,
  );
}

function normalizeAction(
  raw: Partial<AutopilotAction>,
  index: number,
  source: AutopilotAction['source'],
): AutopilotAction {
  const rawType =
    typeof raw.type === 'string' && ACTION_TYPES.has(raw.type) ? raw.type : 'log_event';
  const action: AutopilotAction = {
    id: raw.id || makeId(`action-${index}`),
    type: rawType,
    label: raw.label || ACTION_LABELS[rawType],
    capability: raw.capability,
    payload: raw.payload || {},
    simulated: raw.simulated ?? rawType !== 'speak',
    requiresApproval: raw.requiresApproval,
    status: 'queued',
    source,
    ruleId: raw.ruleId,
    createdAt: raw.createdAt || new Date().toISOString(),
  };
  return { ...action, capability: capabilityForAction(action) };
}

function metadataText(event: LiveEvent, key: string, fallback = '') {
  const value = event.metadata?.[key];
  if (value === undefined || value === null || value === '') return fallback;
  return String(value);
}

function localAction(
  event: LiveEvent,
  index: number,
  raw: Partial<AutopilotAction>,
): AutopilotAction {
  return normalizeAction(
    {
      ...raw,
      id: raw.id || `local-${event.id}-${index}`,
      createdAt: new Date().toISOString(),
    },
    index,
    'system',
  );
}

function buildLocalChatReply(event: LiveEvent, speech: string) {
  const user = metadataText(event, 'user', '').trim();
  const message = metadataText(event, 'message', event.text).trim();
  if (user) return `@${user} vi sua mensagem, obrigada por chegar junto.`;
  if (message && message.length <= 60) return `Vi aqui: ${message}`;
  if (speech) return 'Vi sua mensagem e ja estou acompanhando daqui.';
  return 'Vi sua mensagem no chat.';
}

function buildLocalDecision(
  event: LiveEvent,
  matchedRules: RuleMatches,
  contentUsed: UsedContentItem[] = [],
  error?: unknown,
): PersonaDecision {
  const user = metadataText(event, 'user', 'chat');
  const giftName = metadataText(event, 'giftName', 'presente');
  const quantity = metadataText(event, 'quantity', '1');
  const requestedScene = metadataText(event, 'requestedScene', 'Gameplay Focus');
  const requestedTrack = metadataText(event, 'requestedTrack', 'pedido do chat');
  const mappedAction = metadataText(event, 'mappedAction');
  const isRedeem = Boolean(event.metadata?.redeemable);

  let speech = `Vi aqui, ${user}. Vou guardar isso no contexto e manter a live gostosa de acompanhar.`;
  let intent = 'respond_chat';
  let priority: PersonaDecision['priority'] = 'normal';
  const actions: AutopilotAction[] = [];

  if (event.kind === 'gift' && mappedAction === 'obs.switch_scene') {
    speech = `Fechado, ${user}. Vou separar a troca para ${requestedScene} e manter a live rodando direitinho.`;
    intent = 'redeem_switch_scene';
    priority = 'high';
  } else if (event.kind === 'gift' && mappedAction === 'media.play_music') {
    speech = `Boa, ${user}. Vou deixar ${requestedTrack} na fila e ja volto pro ritmo da live.`;
    intent = 'redeem_play_music';
    priority = 'high';
  } else if (event.kind === 'gift') {
    speech = `Ai sim, ${user}. Obrigada pelo ${giftName} x${quantity}; voce fortaleceu demais a live.`;
    intent = isRedeem ? 'ack_redeem' : 'ack_gift';
    priority = 'high';
  } else if (event.kind === 'moderation') {
    speech = 'Vou cuidar disso com calma e manter o chat seguro para todo mundo.';
    intent = 'moderate_risk';
    priority = 'urgent';
  } else if (event.kind === 'alert') {
    speech = `Bem-vindo, ${user}. Chega mais, fica a vontade e aproveita a energia da live.`;
    intent = 'welcome_alert';
  } else if (event.kind === 'system' && mappedAction === 'topic.suggest') {
    const topic = contentUsed.find((item) => item.type === 'topic' || item.type === 'script');
    speech = topic
      ? `Chat, vamos nessa: ${topic.snippet.slice(0, 120)}`
      : 'Chat, vamos puxar uma pauta nova: me conta o que voces querem ver agora.';
    intent = 'recover_quiet_chat';
  }

  actions.push(
    localAction(event, 0, {
      type: 'speak',
      label: 'Falar via TTS',
      capability: 'tts.speak',
      payload: { text: speech },
      simulated: false,
    }),
  );

  if (event.kind === 'gift' && mappedAction === 'obs.switch_scene') {
    actions.push(
      localAction(event, actions.length, {
        type: 'switch_scene',
        label: 'Trocar cena OBS',
        capability: 'obs.switch_scene',
        payload: { sceneName: requestedScene },
        simulated: true,
      }),
    );
  } else if (event.kind === 'gift' && mappedAction === 'media.play_music') {
    actions.push(
      localAction(event, actions.length, {
        type: 'play_music',
        label: 'Adicionar musica a fila',
        capability: 'media.play_music',
        payload: { track: requestedTrack },
        simulated: true,
      }),
    );
  } else if (event.kind === 'gift') {
    actions.push(
      localAction(event, actions.length, {
        type: 'ack_gift',
        label: 'Agradecer presente',
        capability: 'gift.acknowledge',
        payload: { message: `Presente ${giftName} x${quantity} de ${user}` },
        simulated: true,
      }),
    );
  } else if (event.kind === 'moderation') {
    actions.push(
      localAction(event, actions.length, {
        type: 'moderate_message',
        label: 'Sinalizar moderacao',
        capability: 'moderation.message',
        payload: { message: event.text },
        requiresApproval: true,
        simulated: true,
      }),
    );
  } else if (event.kind === 'alert') {
    actions.push(
      localAction(event, actions.length, {
        type: 'show_overlay',
        label: 'Mostrar overlay de boas-vindas',
        capability: 'obs.show_overlay',
        payload: { overlay: 'new-follower', user },
        simulated: true,
      }),
    );
  } else if (event.kind === 'system' && mappedAction === 'topic.suggest') {
    actions.push(
      localAction(event, actions.length, {
        type: 'suggest_topic',
        label: 'Sugerir novo topico',
        capability: 'topic.suggest',
        payload: { topic: 'Perguntar ao chat o que eles querem ver agora.' },
        simulated: true,
      }),
    );
  }

  if (event.kind === 'chat') {
    actions.push(
      localAction(event, 1, {
        type: 'chat_reply',
        label: 'Resposta no chat',
        capability: 'chat.reply',
        payload: {
          message: buildLocalChatReply(event, speech).slice(0, 140),
          text: event.text,
          dryRun: true,
          fallbackSource: 'director_offline',
        },
        simulated: true,
      }),
    );
  }

  const reasonSuffix = error instanceof Error ? ` Fallback local acionado: ${error.message}` : '';
  const ruleLabels = matchedRules.map((match) => match.rule.label).join(', ');
  return {
    speech,
    intent,
    confidence: matchedRules.length ? 0.82 : 0.64,
    reason: `Decisao local baseada em evento classificado, metadata e regras ativas${
      ruleLabels ? ` (${ruleLabels})` : ''
    }.${reasonSuffix}`,
    priority,
    actions,
  };
}

function actionDedupeKey(action: AutopilotAction) {
  const payload = action.payload || {};
  let payloadKey: string;
  try {
    payloadKey = JSON.stringify(payload, Object.keys(payload).sort());
  } catch {
    payloadKey = actionSummaryFallback(payload);
  }
  return `${action.capability || capabilityForAction(action)}:${action.type}:${payloadKey}`;
}

function actionSummaryFallback(payload: Record<string, unknown>) {
  return Object.entries(payload)
    .map(([key, value]) => `${key}:${String(value)}`)
    .sort()
    .join('|');
}

function mergeActions(ruleActions: AutopilotAction[], aiActions: AutopilotAction[]) {
  const merged: AutopilotAction[] = [];
  const seen = new Set<string>();
  let speakAdded = false;

  for (const action of [...ruleActions, ...aiActions]) {
    if (action.type === 'speak') {
      if (speakAdded) continue;
      speakAdded = true;
      merged.push(action);
      continue;
    }

    const key = actionDedupeKey(action);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(action);
  }

  return merged;
}

import { globalMoodEngine } from './moodEngine';
import { globalRAGMemory } from './longTermMemory';

async function requestBackendMemoryContext(
  events: LiveEvent[],
): Promise<BackendMemoryRoundContext> {
  const response = await fetch(apiUrl('/memory/round-context'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ events }),
  });
  const data = (await response.json().catch(() => ({}))) as Partial<BackendMemoryRoundContext> & {
    detail?: string;
  };
  if (!response.ok) {
    throw new Error(data.detail || 'Falha ao consultar memoria SQLite');
  }
  return {
    usersRecognized: Number(data.usersRecognized || 0),
    context: typeof data.context === 'string' ? data.context : '',
    users: Array.isArray(data.users) ? data.users : [],
  };
}

async function requestDecision(
  events: LiveEvent[],
  primaryEvent: LiveEvent,
  options: PersonaRuntimeOptions,
  _matchedRules: RuleMatches,
  contentUsed: UsedContentItem[],
  backendMemory: BackendMemoryRoundContext,
) {
  const memory = loadMemory();
  const memoryBlock = buildMemoryContext(memory);
  const profiles = loadUserProfiles();
  const usersBlock = buildUserContext(profiles);

  // Process mood
  globalMoodEngine.processEvents(events);
  const moodPrompt = globalMoodEngine.getMoodPromptInjection();

  // Retrieve RAG Context
  const activeUsers = Array.from(
    new Set(events.map((e) => metadataText(e, 'user', '')).filter(Boolean)),
  );
  const ragContext = globalRAGMemory.retrieveContext(activeUsers);

  const contentBlock = buildContentPromptContext(contentUsed);
  const contextParts = [options.personaPrompt, contentBlock, moodPrompt, ragContext];
  // Aprendizado (Fase 2): o que o chat pede/curte e os presentes mais recebidos.
  contextParts.push(buildChatInsightsContext());
  contextParts.push(buildGiftInsightsContext());
  // Pré-definições de vídeo (Fase 3): regras de reação + cooldowns por vídeo.
  contextParts.push(buildVideoPresetsContext(options.videos || []));
  if (usersBlock) contextParts.push(`\n\n[PERFIS DE USUARIOS]:\n${usersBlock}`);
  if (memoryBlock) contextParts.push(`\n\n[MEMORIA RECENTE]:\n${memoryBlock}`);
  if (backendMemory.context) {
    contextParts.push(`\n\n[MEMORIA PERSISTENTE SQLITE]:\n${backendMemory.context}`);
  }
  contextParts.push(
    '\n\n[DIRECAO DA RODADA]\n' +
      `Eventos: ${events.length}. Principal: ${primaryEvent.kind} (prioridade ${eventPriority(primaryEvent)}).\n` +
      `Resumo:\n${eventBatchSummary(events)}`,
  );

  // Cérebro único: Gemini direto no browser (multilíngue). Substitui o antigo POST
  // /ai/decide do servidor (que recebia payload incompatível e sempre caía no fallback).
  const mood = globalMoodEngine.getCurrentMood();
  const raw = await callDirectorDecision(events, {
    systemPrompt: contextParts.join(''),
    videos: options.videos,
    triggers: options.triggers,
    scenes: options.scenes,
    tools: options.tools.map(({ capability, label, enabled }) => ({ capability, label, enabled })),
    temperature: mood.temperature,
  });

  // null = sem chave de IA → lança para o chamador usar buildLocalDecision (offline).
  if (!raw) throw new Error('Diretora offline: nenhuma chave de IA configurada');
  return normalizeDirectorDecision(raw, {
    videos: options.videos,
    scenes: options.scenes,
    tools: options.tools.map(({ capability, label, enabled }) => ({ capability, label, enabled })),
    fallbackText: primaryEvent.text,
  });
}

export async function runPersonaRound(
  events: LiveEvent[],
  options: PersonaRuntimeOptions,
): Promise<AutopilotCycle> {
  if (events.length === 0) {
    throw new Error('Rodada sem eventos para processar');
  }
  const initialEvents = events.length ? events : [];
  const initialPrimary = choosePrimaryEvent(initialEvents);
  let cycle: AutopilotCycle = {
    id: makeId('cycle'),
    event: initialPrimary,
    events: initialEvents,
    stage: 'capturado',
    actions: [],
    matchedRules: [],
    contentUsed: [],
    logs: [
      log(
        `Rodada recebida com ${initialEvents.length} evento(s); prioridade inicial: ${initialPrimary.kind}`,
        'done',
      ),
    ],
    createdAt: new Date().toISOString(),
  };

  const update = (
    patch: Partial<AutopilotCycle>,
    label?: string,
    status: CycleLog['status'] = 'done',
  ) => {
    cycle = {
      ...cycle,
      ...patch,
      logs: label ? [...cycle.logs, log(label, status)] : cycle.logs,
    };
    options.onUpdate?.({ ...cycle, logs: [...cycle.logs], actions: [...cycle.actions] });
  };

  options.onUpdate?.(cycle);

  try {
    const classifiedEvents = initialEvents.map((event) => classifyEvent(event));
    const primaryEvent = choosePrimaryEvent(classifiedEvents);
    classifiedEvents.forEach((event) => markEventProcessed(event.id));
    update(
      { event: primaryEvent, events: classifiedEvents, stage: 'interpretado' },
      `Rodada classificada: ${classifiedEvents.length} evento(s), principal ${primaryEvent.kind}`,
    );

    let backendMemory: BackendMemoryRoundContext = {
      usersRecognized: 0,
      context: '',
      users: [],
    };
    try {
      backendMemory = await requestBackendMemoryContext(classifiedEvents);
      update(
        {},
        backendMemory.usersRecognized
          ? `Memoria SQLite: ${backendMemory.usersRecognized} usuario(s) reconhecido(s)`
          : 'Memoria SQLite atualizada; nenhum usuario reconhecido nesta rodada',
      );
    } catch (memoryError) {
      update(
        {},
        `Memoria SQLite indisponivel: ${
          memoryError instanceof Error ? memoryError.message : 'erro desconhecido'
        }`,
        'error',
      );
    }

    const contentUsed = selectContentForEvents(classifiedEvents);
    update(
      { contentUsed },
      contentUsed.length
        ? `Conteudo aplicado: ${contentUsed.map((item) => item.title).join(', ')}`
        : 'Nenhum conteudo da biblioteca aplicado',
    );

    const ruleMatchesByEvent = classifiedEvents.flatMap((event) =>
      applyAutomationRules(event, options.rules),
    );
    const matchedRules = ruleMatchesByEvent;
    const ruleActions = matchedRules.flatMap((match) => match.actions);
    update(
      { matchedRules: matchedRules.map((match) => match.rule.label) },
      matchedRules.length
        ? `${matchedRules.length} regra(s) aplicada(s): ${matchedRules.map((match) => match.rule.label).join(', ')}`
        : 'Nenhuma regra automatica aplicada',
    );

    let baseDecision: PersonaDecision;
    try {
      baseDecision = await requestDecision(
        classifiedEvents,
        primaryEvent,
        options,
        matchedRules,
        contentUsed,
        backendMemory,
      );
      update({}, 'Decisao de rodada gerada pela IA');
    } catch (decisionError) {
      baseDecision = buildLocalDecision(primaryEvent, matchedRules, contentUsed, decisionError);
      update(
        {},
        `IA indisponivel ou invalida; usando decisao local de rodada (${baseDecision.intent})`,
      );
    }

    const mergedActions = mergeActions(ruleActions, baseDecision.actions);
    const governed = governPersonaDecision(classifiedEvents, { ...baseDecision, actions: mergedActions }, {
      hasLocalAgent: options.localAgentReady,
    });
    const decision = governed.decision;
    update(
      {
        decision,
        actions: decision.actions,
        stage: 'decidido',
      },
      `Decisao de diretor: ${decision.intent} (${Math.round(decision.confidence * 100)}%)`,
    );
    governed.logs.forEach((entry) => update({}, entry));

    update({ stage: 'executando' }, 'Executando fila auditavel de acoes', 'running');
    const executedActions = await executeActionQueue(decision.actions, decision, {
      tools: options.tools,
      voiceEnabled: options.voiceEnabled,
      onAction: options.onAction,
    });
    for (const action of executedActions) {
      cycle.logs.push(
        log(action.result || action.label, action.status === 'error' ? 'error' : 'done'),
      );
    }

    cycle = {
      ...cycle,
      stage: 'concluido' as CycleStage,
      actions: executedActions,
      completedAt: new Date().toISOString(),
      logs: [...cycle.logs, log('Ciclo concluido e registrado', 'done')],
    };

    const currentMemory = loadMemory();
    addTurn(currentMemory, eventBatchSummary(classifiedEvents), decision.speech, 'autopilot');
    let profiles = loadUserProfiles();
    classifiedEvents.forEach((event) => {
      profiles = trackUserInteraction(profiles, event.text);
    });
    // Aprendizado (Fase 2): agrega o que o chat fala/pede e os presentes recebidos.
    recordChatLearning(classifiedEvents);
    recordGiftLearning(classifiedEvents, decision);
    // Pré-definições de vídeo (Fase 3): inicia o cooldown dos vídeos que tocaram.
    for (const action of executedActions) {
      if (action.type === 'play_video' && action.status === 'done') {
        const vid = String(action.payload?.videoId || action.payload?.video || '');
        if (vid) markVideoPlayed(vid);
      }
    }
    markContentUsed(contentUsed);
    appendAuditCycle(cycle);
    options.onUpdate?.({ ...cycle, logs: [...cycle.logs], actions: [...cycle.actions] });
    return cycle;
  } catch (err) {
    cycle = {
      ...cycle,
      stage: 'erro',
      error: err instanceof Error ? err.message : 'Erro desconhecido',
      completedAt: new Date().toISOString(),
      logs: [...cycle.logs, log(err instanceof Error ? err.message : 'Erro desconhecido', 'error')],
    };
    appendAuditCycle(cycle);
    options.onUpdate?.({ ...cycle, logs: [...cycle.logs], actions: [...cycle.actions] });
    return cycle;
  }
}

export async function runPersonaRuntime(
  event: LiveEvent,
  options: PersonaRuntimeOptions,
): Promise<AutopilotCycle> {
  return runPersonaRound([event], options);
}
