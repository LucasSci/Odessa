import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { updateAutomationRule, loadAutomationRules } from './automationRules';
import { executeAction } from './actionExecutor';
import { loadContentItems } from './contentLibrary';
import { clearEvents, emitEvent, getRecentEvents } from './eventBus';
import {
  clearAuditSession,
  exportAuditSession,
  loadAuditSession,
  runPersonaRound,
} from './personaRuntime';
import { loadToolRegistry, updateToolRegistry } from './toolRegistry';
import { applyAutonomyToTools } from './autonomyMatrix';
import {
  mergeChatReplyQueue,
  prepareChatReplyQueue,
  updateChatReplyQueueFromAction,
} from './chatReplyQueue';
import {
  buildLiveSupervisorSnapshot,
  type LiveSupervisorSnapshot,
  type RecoveryAction,
} from './liveReadinessSupervisor';
import { getAiConfig, saveAiConfig, type AiAutonomyLevel } from './aiConfig';
import { apiUrl } from '../lib/api';
import { isObsDirectAvailable, getObsStatus } from '../lib/obsWebSocket';
import { loadMemory } from '../lib/memory';
import { getChatAutomationConfig, loadChatAutomationTarget } from '../lib/chatAutomation';
import type {
  AutopilotAction,
  AutopilotCycle,
  AutomationRule,
  CapturedMessage,
  ChatReplyQueueItem,
  LiveEvent,
  LiveEventKind,
  PersonaDecision,
  PersonaTool,
} from '../types';

interface N8NHealth {
  configured: boolean;
  base_url?: string | null;
  base_url_configured: boolean;
  audit_webhook_configured: boolean;
  action_webhook_configured: boolean;
  event_ingest_webhook_configured: boolean;
  secret_configured: boolean;
  online: boolean;
  error?: string | null;
}

interface BackendHealth {
  status: string;
  ocr: string;
  gemini_configured: boolean;
  openai_ai_configured: boolean;
  openai_text_model?: string;
  openai_tts_configured: boolean;
  kokoro_tts_configured?: boolean;
  tts_default_provider?: string;
  n8n?: N8NHealth;
  obs?: {
    configured: boolean;
    source: string;
    scene_whitelist: string;
  };
  memory?: {
    usersRecognized: number;
    interactions: number;
    gifts: number;
    error?: string;
  };
}

interface AgentBridgeStatus {
  ok?: boolean;
  queueSize?: number;
  mode?: string;
  message?: string;
  localAgent?: {
    online?: boolean;
    lastSeenAt?: string | null;
    capabilities?: string[];
  };
}

interface VideoBridgeStatus {
  currentVideoId: string | null;
  idleVideoId: string | null;
  queueSize: number;
  updatedAt: string | null;
  error: string | null;
}

interface ChatAutomationMonitor {
  allowlistReady: boolean;
  lastSendStatus: string | null;
  lastSendError: string | null;
}

export interface AutopilotRuntimeState {
  autopilotEnabled: boolean;
  testMode: boolean;
  voiceEnabled: boolean;
  pendingEvents: LiveEvent[];
  currentRoundEvents: LiveEvent[];
  cycles: AutopilotCycle[];
  actionQueue: AutopilotAction[];
  chatReplyQueue: ChatReplyQueueItem[];
  tools: PersonaTool[];
  rules: AutomationRule[];
  health: BackendHealth | null;
  healthError: string | null;
  healthCheckedAt: string;
  isProcessing: boolean;
  lastError: string | null;
  memoryCount: number;
  recognizedUsersCount: number;
  obsScenes: string[];
  currentObsScene: string | null;
  obsError: string | null;
  localAgentReady: boolean;
  localAgentMessage: string;
  videoMonitor: VideoBridgeStatus;
  chatAutomationMonitor: ChatAutomationMonitor;
  readiness: LiveSupervisorSnapshot;
  completedCycles: number;
  failedCycles: number;
  averageConfidence: number;
  latestCycle?: AutopilotCycle;
  latestDecision?: PersonaDecision;
  latestAction?: AutopilotAction;
  roundCollectionMs: number;
  speechCooldownMs: number;
  autonomyLevel: AiAutonomyLevel;
  setAutonomyLevel: (level: AiAutonomyLevel) => void;
  start: (opts?: StartOptions) => void;
  pause: () => void;
  toggleVoice: () => void;
  toggleTestMode: () => void;
  injectEvent: (kind: LiveEventKind, text: string, source?: LiveEvent['source']) => LiveEvent;
  clearSession: () => void;
  exportSession: () => void;
  toggleTool: (
    capability: PersonaTool['capability'],
    patch: Partial<Pick<PersonaTool, 'enabled' | 'requiresApproval' | 'simulated'>>,
  ) => void;
  toggleRule: (ruleId: string, enabled: boolean) => void;
  approveChatReply: (id: string) => void;
  editChatReply: (id: string, text: string) => void;
  discardChatReply: (id: string) => void;
  sendChatReplyNow: (id: string) => Promise<void>;
  refreshHealth: () => Promise<void>;
  refreshObsScenes: () => Promise<void>;
  refreshReadiness: () => Promise<void>;
}

interface UseAutopilotRuntimeOptions {
  capturedText: CapturedMessage[];
  setCapturedText: Dispatch<SetStateAction<CapturedMessage[]>>;
}

type StartOptions = {
  voiceEnabled?: boolean;
  toolPatches?: Array<{
    capability: string;
    patch: Partial<Pick<PersonaTool, 'enabled' | 'requiresApproval' | 'simulated'>>;
  }>;
};

const PERSONA_AUTOPILOT_PROMPT = `Voce e a Odessa/Juju, anfitria de uma live social no Tango Live.
Sua funcao e dirigir a live com autonomia auditavel: observar entradas, priorizar o que importa e escolher a proxima fala e acoes.
Fale como uma anfitria calorosa, proxima, popular e energetica, com agradecimentos naturais e chamadas leves para interacao.
Regra principal: uma rodada gera no maximo UMA fala curta. Chat comum vira contexto quando houver presente, resgate, moderacao, alerta ou acao operacional mais importante.
Quando chat.reply estiver habilitada, use mensagens curtas no chat publico para cumprimentar, puxar assunto e reagir sem spam.
Priorize seguranca, moderacao, resgates e presentes sem pressionar a audiencia a gastar.
Use o registro de ferramentas e regras como limites operacionais.
Nunca afirme que uma acao externa real foi executada quando ela estiver simulada ou pendente de aprovacao.`;

const ROUND_COLLECTION_MS = 2500;
const MAX_EVENTS_PER_ROUND = 8;
const SPEECH_COOLDOWN_MS = 7000;
const IDLE_TIMEOUT_MS = 45000; // 45 seconds of silence triggers an idle event
const RECOVERY_THROTTLE_MS = 30_000;

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

function createLiveEvent(
  kind: LiveEventKind,
  text: string,
  source: LiveEvent['source'],
): LiveEvent {
  const time = formatClock();
  return {
    id: makeId('event'),
    source,
    zoneName: source === 'test' ? 'Injetor de teste' : 'Controle Live',
    text,
    kind,
    createdAt: new Date().toISOString(),
    time,
  };
}

function metadataString(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function metadataConfidence(value: unknown, fallback: number) {
  const confidence = Number(value);
  return Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : fallback;
}

export function normalizeDirectorEvent(event: LiveEvent): LiveEvent {
  const text = String(event.text || event.metadata?.message || event.metadata?.rawText || '').trim();
  const fallbackMessage = text.replace(/^[^:]{1,40}:\s*/, '').trim() || text;
  const metadata = event.metadata || {};
  const confidenceFallback = event.source === 'ocr' ? 0.85 : 1;

  return {
    ...event,
    source: event.source || 'ocr',
    zoneName: event.zoneName || (event.source === 'ocr' ? 'Chat Tango' : 'Controle Live'),
    text,
    kind: event.kind || 'chat',
    metadata: {
      ...metadata,
      ...(event.source === 'ocr' ? { platform: metadata.platform || 'tango' } : {}),
      user: metadataString(metadata.user, metadataString(metadata.author, '')),
      message: metadataString(metadata.message, fallbackMessage),
      confidence: metadataConfidence(metadata.confidence, confidenceFallback),
    },
  };
}

export function partitionDirectorEvents(events: LiveEvent[]): LiveEvent[] {
  const rank: Record<string, number> = {
    moderation: 0,
    gift: 1,
    alert: 2,
    scene: 3,
    system: 4,
    chat: 5,
  };

  return [...events].sort((a, b) => {
    const byKind = (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9);
    if (byKind !== 0) return byKind;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}

function upsertCycle(cycles: AutopilotCycle[], cycle: AutopilotCycle) {
  const next = cycles.filter((item) => item.id !== cycle.id);
  return [...next, cycle].slice(-80);
}

function upsertAction(actions: AutopilotAction[], action: AutopilotAction) {
  const next = actions.filter((item) => item.id !== action.id);
  return [...next, action].slice(-100);
}

function loadInitialActions() {
  return loadAuditSession()
    .flatMap((cycle) => cycle.actions)
    .slice(-100);
}

// Sempre executam sem aprovação (não são ações "para o público").
// No nível "assistido", apenas estas pedem aprovação.

/**
 * Deriva `requiresApproval` das ferramentas a partir do nível de autonomia da
 * Diretora — sem persistir no registry (cópia só para a rodada). Assim o cockpit
 * pode mudar a autonomia e a próxima rodada já reflete.
 */

export function useAutopilotRuntime({
  capturedText,
  setCapturedText,
}: UseAutopilotRuntimeOptions): AutopilotRuntimeState {
  const [autopilotEnabled, setAutopilotEnabled] = useState(false);
  const [testMode, setTestMode] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [pendingEvents, setPendingEvents] = useState<LiveEvent[]>([]);
  const [currentRoundEvents, setCurrentRoundEvents] = useState<LiveEvent[]>([]);
  const [cycles, setCycles] = useState<AutopilotCycle[]>(() => loadAuditSession());
  const [actionQueue, setActionQueue] = useState<AutopilotAction[]>(loadInitialActions);
  const [chatReplyQueue, setChatReplyQueue] = useState<ChatReplyQueueItem[]>([]);
  const [tools, setTools] = useState<PersonaTool[]>(() => loadToolRegistry());
  const [rules, setRules] = useState<AutomationRule[]>(() => loadAutomationRules());
  const [health, setHealth] = useState<BackendHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [healthCheckedAt, setHealthCheckedAt] = useState('Nunca');
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [memoryCount, setMemoryCount] = useState(() => loadMemory().length);
  const [recognizedUsersCount, setRecognizedUsersCount] = useState(0);
  const [obsScenes, setObsScenes] = useState<string[]>([]);
  const [currentObsScene, setCurrentObsScene] = useState<string | null>(null);
  const [obsError, setObsError] = useState<string | null>(null);
  const [localAgentReady, setLocalAgentReady] = useState(false);
  const [localAgentMessage, setLocalAgentMessage] = useState('Agente local nao verificado');
  const [videoMonitor, setVideoMonitor] = useState<VideoBridgeStatus>({
    currentVideoId: null,
    idleVideoId: null,
    queueSize: 0,
    updatedAt: null,
    error: null,
  });
  const [chatAutomationMonitor, setChatAutomationMonitor] = useState<ChatAutomationMonitor>({
    allowlistReady: false,
    lastSendStatus: null,
    lastSendError: null,
  });
  const [autonomyLevel, setAutonomyLevelState] = useState<AiAutonomyLevel>(() => getAiConfig().autonomyLevel);
  const queuedOrProcessedIdsRef = useRef<Set<string>>(
    new Set(capturedText.filter((event) => event.processedAt).map((event) => event.id)),
  );
  const pendingEventsRef = useRef<LiveEvent[]>([]);
  const roundTimerRef = useRef<number | null>(null);
  const lastSpeechAtRef = useRef(0);
  const lastEventAtRef = useRef(0);
  // Catálogo (vídeos/gatilhos) que a Diretora pode usar — buscado do servidor.
  const catalogRef = useRef<{
    videos: Array<{ id: string; label?: string; name?: string; title?: string }>;
    triggers: Array<{ id: string; name?: string; label?: string; enabled?: boolean }>;
  }>({ videos: [], triggers: [] });
  // Espelho de obsScenes para uso dentro do closure da rodada (sem disparar re-render).
  const obsScenesRef = useRef<string[]>([]);
  const lastRecoveryAtRef = useRef<Record<string, number>>({});

  const latestCycle = cycles[cycles.length - 1];
  const latestDecision = latestCycle?.decision;
  const latestAction = actionQueue[actionQueue.length - 1];
  // ⚡ Bolt: Single-pass iteration to calculate multiple stats
  const { completedCycles, failedCycles, averageConfidence } = useMemo(() => {
    let completed = 0;
    let failed = 0;
    let confidenceSum = 0;
    let decisionCount = 0;

    for (const cycle of cycles) {
      if (cycle.stage === 'concluido') completed++;
      else if (cycle.stage === 'erro') failed++;

      if (cycle.decision) {
        confidenceSum += cycle.decision.confidence || 0;
        decisionCount++;
      }
    }

    return {
      completedCycles: completed,
      failedCycles: failed,
      averageConfidence: decisionCount === 0 ? 0 : Math.round((confidenceSum / decisionCount) * 100)
    };
  }, [cycles]);

  const readiness = useMemo(() => {
    const target = loadChatAutomationTarget();
    const visualTargetReady = Boolean(
      target.mode === 'visual' &&
        target.inputPoint &&
        typeof target.inputPoint.x === 'number' &&
        typeof target.inputPoint.y === 'number' &&
        target.viewport &&
        typeof target.viewport.width === 'number' &&
        typeof target.viewport.height === 'number',
    );
    return buildLiveSupervisorSnapshot({
      now: Date.now(),
      capturedEvents: capturedText,
      healthError,
      obs: {
        connected: !obsError && (isObsDirectAvailable() || obsScenes.length > 0),
        currentScene: currentObsScene,
        scenes: obsScenes,
        error: obsError,
        hasOcrSource: obsScenes.length > 0 ? true : undefined,
        hasStageSource: obsScenes.length > 0 ? true : undefined,
        streaming: undefined,
      },
      video: videoMonitor,
      chat: {
        visualTargetReady,
        allowlistReady: chatAutomationMonitor.allowlistReady,
        localAgentReady,
        lastSendStatus: chatAutomationMonitor.lastSendStatus,
        lastSendError: chatAutomationMonitor.lastSendError,
      },
      autonomyLevel,
      autoChatEnabled: getAiConfig().autoChatReplyEnabled,
    });
  }, [
    capturedText,
    healthError,
    obsError,
    obsScenes,
    currentObsScene,
    videoMonitor,
    chatAutomationMonitor,
    localAgentReady,
    autonomyLevel,
  ]);

  const refreshHealth = useCallback(async () => {
    try {
      const response = await fetch(apiUrl('/health'));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as BackendHealth;
      setHealth(data);
      if (data.memory) setRecognizedUsersCount(Number(data.memory.usersRecognized || 0));
      setHealthError(null);
      setHealthCheckedAt(formatClock());
    } catch (err) {
      setHealth(null);
      setHealthError(err instanceof Error ? err.message : 'Backend indisponivel');
      setHealthCheckedAt(formatClock());
    }
  }, []);

  const refreshObsScenes = useCallback(async () => {
    // Prefer direct WebSocket state when connected — avoids unnecessary API calls
    if (isObsDirectAvailable()) {
      const status = getObsStatus();
      setObsScenes(status.scenes);
      setCurrentObsScene(status.currentScene);
      setObsError(null);
      return;
    }
    // Fallback: use API (cloud relay)
    try {
      const response = await fetch(apiUrl('/obs/scenes'));
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        scenes?: string[];
        currentScene?: string | null;
        error?: string | null;
      };
      if (!response.ok || !data.ok) {
        setObsError(
          data.error || `OBS indisponivel${response.ok ? '' : `: HTTP ${response.status}`}`,
        );
        setObsScenes(Array.isArray(data.scenes) ? data.scenes : []);
        setCurrentObsScene(data.currentScene || null);
        return;
      }
      setObsScenes(Array.isArray(data.scenes) ? data.scenes : []);
      setCurrentObsScene(data.currentScene || null);
      setObsError(null);
    } catch (err) {
      setObsError(err instanceof Error ? err.message : 'Falha ao consultar OBS');
      setObsScenes([]);
      setCurrentObsScene(null);
    }
  }, []);

  const refreshAgentStatus = useCallback(async () => {
    try {
      const response = await fetch(apiUrl('/agent/status'));
      const data = (await response.json().catch(() => ({}))) as AgentBridgeStatus;
      const ready = data.ok === true && data.localAgent?.online === true;
      setLocalAgentReady(ready);
      setLocalAgentMessage(
        ready
          ? `Agente local pronto${data.localAgent?.lastSeenAt ? ` (${formatClock(new Date(data.localAgent.lastSeenAt))})` : ''}`
          : data.message || 'Agente local offline',
      );
    } catch (err) {
      setLocalAgentReady(false);
      setLocalAgentMessage(err instanceof Error ? err.message : 'Falha ao consultar agente local');
    }
  }, []);

  const refreshVideoMonitor = useCallback(async () => {
    try {
      const response = await fetch(apiUrl('/video/state'));
      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) throw new Error(String(data.detail || `HTTP ${response.status}`));
      const currentClip = (data.currentClip || {}) as Record<string, unknown>;
      setVideoMonitor({
        currentVideoId: String(data.current_video_id || data.currentVideoId || currentClip.videoId || '') || null,
        idleVideoId: String(data.idleVideoId || data.idle_video_id || '') || null,
        queueSize: Number(data.queueSize || data.triggerQueueSize || data.pendingQueueSize || 0) || 0,
        updatedAt: String(data.updatedAt || data.startedAt || data.timestamp || '') || null,
        error: null,
      });
    } catch (err) {
      setVideoMonitor((current) => ({
        ...current,
        error: err instanceof Error ? err.message : 'Falha ao consultar video',
      }));
    }
  }, []);

  const refreshChatAutomationMonitor = useCallback(async () => {
    try {
      const config = await getChatAutomationConfig();
      const visualAllowed = config.allowlist.some((entry) => entry.enabled !== false && entry.mode === 'visual');
      const latest = [...config.logs].reverse()[0] as Record<string, unknown> | undefined;
      const result = (latest?.result || {}) as Record<string, unknown>;
      setChatAutomationMonitor({
        allowlistReady: visualAllowed,
        lastSendStatus: typeof result.status === 'string' ? result.status : null,
        lastSendError:
          typeof result.error === 'string'
            ? result.error
            : typeof result.reason === 'string' && ['blocked', 'failed'].includes(String(result.status))
              ? result.reason
              : null,
      });
    } catch (err) {
      setChatAutomationMonitor((current) => ({
        ...current,
        lastSendStatus: 'blocked',
        lastSendError: err instanceof Error ? err.message : 'Falha ao consultar automacao de chat',
      }));
    }
  }, []);

  const refreshReadiness = useCallback(async () => {
    await Promise.allSettled([
      refreshHealth(),
      refreshObsScenes(),
      refreshAgentStatus(),
      refreshVideoMonitor(),
      refreshChatAutomationMonitor(),
    ]);
  }, [
    refreshHealth,
    refreshObsScenes,
    refreshAgentStatus,
    refreshVideoMonitor,
    refreshChatAutomationMonitor,
  ]);

  const enqueueEvent = useCallback((event: LiveEvent) => {
    const normalizedEvent = normalizeDirectorEvent(event);
    if (normalizedEvent.processedAt || queuedOrProcessedIdsRef.current.has(normalizedEvent.id)) return;
    queuedOrProcessedIdsRef.current.add(normalizedEvent.id);
    lastEventAtRef.current = Date.now();
    setPendingEvents((current) => {
      const next = [...current, normalizedEvent].slice(-60);
      pendingEventsRef.current = next;
      return next;
    });
  }, []);

  // Busca o catálogo (vídeos/gatilhos) que a Diretora usa para escolher ações.
  const refreshCatalog = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/api/video/config'));
      if (!res.ok) return;
      const data = (await res.json()) as {
        videos?: Array<{ id: string; label?: string; name?: string; title?: string }>;
        triggers?: Array<{ id: string; name?: string; label?: string; enabled?: boolean }>;
      };
      catalogRef.current = {
        videos: Array.isArray(data?.videos) ? data.videos : [],
        triggers: Array.isArray(data?.triggers) ? data.triggers : [],
      };
    } catch {
      // Catálogo indisponível — a Diretora apenas não terá vídeos para escolher.
    }
  }, []);

  useEffect(() => {
    pendingEventsRef.current = pendingEvents;
  }, [pendingEvents]);

  useEffect(() => {
    obsScenesRef.current = obsScenes;
  }, [obsScenes]);

  useEffect(() => {
    const firstRun = window.setTimeout(refreshHealth, 0);
    const obsFirstRun = window.setTimeout(refreshObsScenes, 700);
    const catalogFirstRun = window.setTimeout(refreshCatalog, 300);
    const agentFirstRun = window.setTimeout(refreshAgentStatus, 1000);
    const videoFirstRun = window.setTimeout(refreshVideoMonitor, 1200);
    const chatAutomationFirstRun = window.setTimeout(refreshChatAutomationMonitor, 1500);
    const interval = window.setInterval(refreshHealth, 15000);
    const obsInterval = window.setInterval(refreshObsScenes, 20000);
    const catalogInterval = window.setInterval(refreshCatalog, 30000);
    const agentInterval = window.setInterval(refreshAgentStatus, 10000);
    const videoInterval = window.setInterval(refreshVideoMonitor, 10000);
    const chatAutomationInterval = window.setInterval(refreshChatAutomationMonitor, 12000);
    return () => {
      window.clearTimeout(firstRun);
      window.clearTimeout(obsFirstRun);
      window.clearTimeout(catalogFirstRun);
      window.clearTimeout(agentFirstRun);
      window.clearTimeout(videoFirstRun);
      window.clearTimeout(chatAutomationFirstRun);
      window.clearInterval(interval);
      window.clearInterval(obsInterval);
      window.clearInterval(catalogInterval);
      window.clearInterval(agentInterval);
      window.clearInterval(videoInterval);
      window.clearInterval(chatAutomationInterval);
    };
  }, [
    refreshHealth,
    refreshObsScenes,
    refreshCatalog,
    refreshAgentStatus,
    refreshVideoMonitor,
    refreshChatAutomationMonitor,
  ]);

  useEffect(() => {
    capturedText.forEach(enqueueEvent);
  }, [capturedText, enqueueEvent]);

  const runRecoveryAction = useCallback(
    async (action: RecoveryAction) => {
      const now = Date.now();
      if (now - (lastRecoveryAtRef.current[action] || 0) < RECOVERY_THROTTLE_MS) return;
      lastRecoveryAtRef.current[action] = now;

      if (action === 'pause_auto_chat') {
        const cfg = getAiConfig();
        if (cfg.autoChatReplyEnabled) {
          saveAiConfig({ autoChatReplyEnabled: false });
          setLastError('Supervisor pausou auto-chat por falha de prontidao.');
        }
        return;
      }

      if (action === 'reduce_autonomy') {
        const cfg = getAiConfig();
        if (cfg.autonomyLevel === 'auto') {
          saveAiConfig({ autonomyLevel: 'assistido' });
          setAutonomyLevelState('assistido');
          setLastError('Supervisor reduziu autonomia para Assistido.');
        }
        return;
      }

      if (action === 'reconnect_obs') {
        await refreshObsScenes();
        return;
      }

      if (action === 'return_to_idle') {
        if (videoMonitor.idleVideoId) {
          await fetch(apiUrl('/video/force'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ videoId: videoMonitor.idleVideoId, state: 'IDLE' }),
          }).catch(() => undefined);
          await refreshVideoMonitor();
        }
      }
    },
    [refreshObsScenes, refreshVideoMonitor, videoMonitor.idleVideoId],
  );

  useEffect(() => {
    if (readiness.state === 'healthy') return;
    readiness.recoveryActions.forEach((action) => {
      void runRecoveryAction(action);
    });
  }, [readiness.state, readiness.recoveryActions, runRecoveryAction]);

  useEffect(() => {
    if (!autopilotEnabled) return;
    const interval = window.setInterval(() => {
      const events = getRecentEvents();
      events.forEach(enqueueEvent);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [autopilotEnabled, enqueueEvent]);

  // Idle Timer / Autopilot Proactive Speech
  useEffect(() => {
    if (!autopilotEnabled) return;
    const interval = window.setInterval(() => {
      if (isProcessing) return;
      const now = Date.now();
      if (now - lastEventAtRef.current > IDLE_TIMEOUT_MS && pendingEventsRef.current.length === 0) {
        lastEventAtRef.current = now; // reset
        const idleEvent = emitEvent(
          createLiveEvent(
            'system',
            'A live esta quieta. Puxe um assunto novo para interagir com o chat ou faca uma pergunta instigante.',
            'system',
          ),
        );
        setCapturedText(getRecentEvents());
        enqueueEvent(idleEvent);
      }
    }, 5000);
    return () => window.clearInterval(interval);
  }, [autopilotEnabled, isProcessing, enqueueEvent, setCapturedText]);

  useEffect(() => {
    if (!autopilotEnabled || isProcessing || pendingEvents.length === 0 || roundTimerRef.current)
      return;

    const cooldownRemaining = Math.max(
      0,
      lastSpeechAtRef.current + SPEECH_COOLDOWN_MS - Date.now(),
    );
    const delay = Math.max(ROUND_COLLECTION_MS, cooldownRemaining);

    roundTimerRef.current = window.setTimeout(() => {
      roundTimerRef.current = null;

      const batch = partitionDirectorEvents(pendingEventsRef.current.slice(0, MAX_EVENTS_PER_ROUND));
      if (batch.length === 0) return;
      const remaining = pendingEventsRef.current.slice(batch.length);
      pendingEventsRef.current = remaining;
      setPendingEvents(remaining);

      setCurrentRoundEvents(batch);
      setIsProcessing(true);
      setLastError(null);

      // Autonomia atual da Diretora → define o que executa sozinho nesta rodada.
      const autonomy = getAiConfig().autonomyLevel;
      const chatConfig = getAiConfig();
      const target = loadChatAutomationTarget();
      const visualTargetReady = Boolean(
        target.mode === 'visual' &&
          target.inputPoint &&
          typeof target.inputPoint.x === 'number' &&
          typeof target.inputPoint.y === 'number' &&
          target.viewport &&
          typeof target.viewport.width === 'number' &&
          typeof target.viewport.height === 'number',
      );
      const effectiveTools = applyAutonomyToTools(tools, autonomy, {
        autoChatEnabled: chatConfig.autoChatReplyEnabled,
        chatRealRequested: chatConfig.autoChatReplyMode === 'real',
        visualTargetReady,
        localAgentReady,
      });

      runPersonaRound(batch, {
        personaPrompt: PERSONA_AUTOPILOT_PROMPT,
        tools: effectiveTools,
        rules,
        voiceEnabled,
        videos: catalogRef.current.videos,
        triggers: catalogRef.current.triggers,
        scenes: obsScenesRef.current,
        localAgentReady,
        prepareActions: (actions, decision, cycle) => {
          const prepared = prepareChatReplyQueue(actions, cycle, decision, autonomy);
          if (prepared.queueItems.length) {
            setChatReplyQueue((current) => mergeChatReplyQueue(current, prepared.queueItems));
          }
          return prepared.executableActions;
        },
        onUpdate: (cycle) => setCycles((current) => upsertCycle(current, cycle)),
        onAction: (action) => {
          setActionQueue((current) => upsertAction(current, action));
          setChatReplyQueue((current) => updateChatReplyQueueFromAction(current, action));
        },
      })
        .then((cycle) => {
          if (cycle.actions.some((action) => action.type === 'speak')) {
            lastSpeechAtRef.current = Date.now();
          }
          setCycles((current) => upsertCycle(current, cycle));
          setActionQueue((current) => {
            const cycleActionIds = new Set(cycle.actions.map((action) => action.id));
            return [
              ...current.filter((action) => !cycleActionIds.has(action.id)),
              ...cycle.actions,
            ].slice(-100);
          });
          setCapturedText(getRecentEvents());
          setMemoryCount(loadMemory().length);
          refreshObsScenes();
          if (cycle.stage === 'erro') {
            setAutopilotEnabled(false);
            setLastError(cycle.error || 'Erro ao processar rodada');
          }
          refreshHealth();
        })
        .catch((err) => {
          setAutopilotEnabled(false);
          setLastError(err instanceof Error ? err.message : 'Erro ao processar rodada');
        })
        .finally(() => {
          setCurrentRoundEvents([]);
          setIsProcessing(false);
        });
    }, delay);
  }, [
    autopilotEnabled,
    isProcessing,
    pendingEvents.length,
    refreshHealth,
    refreshObsScenes,
    rules,
    setCapturedText,
    tools,
    localAgentReady,
    voiceEnabled,
  ]);

  useEffect(() => {
    return () => {
      if (roundTimerRef.current) window.clearTimeout(roundTimerRef.current);
    };
  }, []);

  const start = useCallback((opts?: StartOptions) => {
    setLastError(null);
    if (opts?.voiceEnabled !== undefined) {
      setVoiceEnabled(opts.voiceEnabled);
    }
    if (opts?.toolPatches && opts.toolPatches.length) {
      setTools((current) => {
        let next = current;
        for (const p of opts.toolPatches || []) {
          next = updateToolRegistry(next, p.capability as any, p.patch as any);
        }
        return next;
      });
    }
    lastEventAtRef.current = Date.now();
    setAutopilotEnabled(true);
    getRecentEvents().forEach(enqueueEvent);
  }, [enqueueEvent]);

  const pause = useCallback(() => {
    setAutopilotEnabled(false);
    if (roundTimerRef.current) {
      window.clearTimeout(roundTimerRef.current);
      roundTimerRef.current = null;
    }
  }, []);

  const toggleVoice = useCallback(() => {
    setVoiceEnabled((value) => !value);
  }, []);

  const setAutonomyLevel = useCallback((level: AiAutonomyLevel) => {
    saveAiConfig({ autonomyLevel: level });
    setAutonomyLevelState(level);
  }, []);

  const toggleTestMode = useCallback(() => {
    setTestMode((value) => !value);
  }, []);

  const injectEvent = useCallback(
    (
      kind: LiveEventKind,
      text: string,
      source: LiveEvent['source'] = testMode ? 'test' : 'manual',
    ) => {
      const event = emitEvent(createLiveEvent(kind, text, source));
      setCapturedText(getRecentEvents());
      enqueueEvent(event);
      return event;
    },
    [enqueueEvent, setCapturedText, testMode],
  );

  const clearSession = useCallback(() => {
    setAutopilotEnabled(false);
    if (roundTimerRef.current) {
      window.clearTimeout(roundTimerRef.current);
      roundTimerRef.current = null;
    }
    setPendingEvents([]);
    pendingEventsRef.current = [];
    setCurrentRoundEvents([]);
    setCycles([]);
    setActionQueue([]);
    setChatReplyQueue([]);
    setLastError(null);
    lastSpeechAtRef.current = 0;
    clearEvents();
    clearAuditSession();
    setCapturedText([]);
    queuedOrProcessedIdsRef.current.clear();
    setMemoryCount(loadMemory().length);
  }, [setCapturedText]);

  const exportSession = useCallback(() => {
    const json = exportAuditSession({
      events: getRecentEvents(),
      cycles,
      tools,
      rules,
      contentItems: loadContentItems(),
    });
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `odessa-session-${new Date().toISOString().slice(0, 19).replaceAll(':', '-')}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }, [cycles, rules, tools]);

  const toggleTool = useCallback(
    (
      capability: PersonaTool['capability'],
      patch: Partial<Pick<PersonaTool, 'enabled' | 'requiresApproval' | 'simulated'>>,
    ) => {
      setTools((current) => updateToolRegistry(current, capability, patch));
    },
    [],
  );

  const toggleRule = useCallback((ruleId: string, enabled: boolean) => {
    setRules((current) => updateAutomationRule(current, ruleId, { enabled }));
  }, []);

  const approveChatReply = useCallback((id: string) => {
    const approvedAt = new Date().toISOString();
    setChatReplyQueue((current) =>
      current.map((item) =>
        item.id === id && item.status === 'approval_required'
          ? { ...item, status: 'queued', approvedAt, updatedAt: approvedAt, result: 'Aprovada pelo operador.' }
          : item,
      ),
    );
  }, []);

  const editChatReply = useCallback((id: string, text: string) => {
    const updatedAt = new Date().toISOString();
    setChatReplyQueue((current) =>
      current.map((item) =>
        item.id === id && (item.status === 'approval_required' || item.status === 'queued')
          ? {
              ...item,
              text,
              action: {
                ...item.action,
                payload: { ...item.action.payload, message: text },
              },
              updatedAt,
              result: 'Texto editado pelo operador.',
            }
          : item,
      ),
    );
  }, []);

  const discardChatReply = useCallback((id: string) => {
    const updatedAt = new Date().toISOString();
    setChatReplyQueue((current) =>
      current.map((item) =>
        item.id === id && item.status !== 'sent'
          ? { ...item, status: 'blocked', result: 'Descartada pelo operador.', updatedAt }
          : item,
      ),
    );
  }, []);

  const sendChatReplyNow = useCallback(
    async (id: string) => {
      const item = chatReplyQueue.find((entry) => entry.id === id);
      if (!item) return;
      const updatedAt = new Date().toISOString();
      if (item.status === 'approval_required' && !item.approvedAt) {
        setChatReplyQueue((current) =>
          current.map((entry) =>
            entry.id === id
              ? {
                  ...entry,
                  status: 'approval_required',
                  result: 'Aprove a resposta antes de enviar.',
                  updatedAt,
                }
              : entry,
          ),
        );
        return;
      }
      if (item.governorBlockedReason) {
        setChatReplyQueue((current) =>
          current.map((entry) =>
            entry.id === id
              ? {
                  ...entry,
                  status: 'blocked',
                  result: `Bloqueada pelo governador: ${item.governorBlockedReason}`,
                  updatedAt,
                }
              : entry,
          ),
        );
        return;
      }

      const action: AutopilotAction = {
        ...item.action,
        payload: { ...item.action.payload, message: item.text },
        requiresApproval: false,
        status: 'queued',
      };
      const executionTools = tools.map((tool) =>
        tool.capability === 'chat.reply'
          ? { ...tool, requiresApproval: false, simulated: action.simulated }
          : tool,
      );
      const cycleDecision =
        cycles.find((cycle) => cycle.id === item.cycleId)?.decision ||
        latestDecision || {
          speech: '',
          intent: 'chat_reply_manual_send',
          confidence: item.confidence,
          reason: item.reason,
          priority: 'normal' as const,
          actions: [action],
        };

      setChatReplyQueue((current) =>
        current.map((entry) =>
          entry.id === id ? { ...entry, status: 'sending', result: 'Enviando agora...', updatedAt } : entry,
        ),
      );
      const result = await executeAction(action, cycleDecision, {
        tools: executionTools,
        voiceEnabled,
      });
      setActionQueue((current) => upsertAction(current, result));
      setChatReplyQueue((current) =>
        updateChatReplyQueueFromAction(
          current.map((entry) =>
            entry.id === id
              ? {
                  ...entry,
                  action: result,
                  text: String(result.payload?.message || entry.text),
                }
              : entry,
          ),
          result,
        ),
      );
    },
    [chatReplyQueue, cycles, latestDecision, tools, voiceEnabled],
  );

  return {
    autopilotEnabled,
    testMode,
    voiceEnabled,
    pendingEvents,
    currentRoundEvents,
    cycles,
    actionQueue,
    chatReplyQueue,
    tools,
    rules,
    health,
    healthError,
    healthCheckedAt,
    isProcessing,
    lastError,
    memoryCount,
    recognizedUsersCount,
    obsScenes,
    currentObsScene,
    obsError,
    localAgentReady,
    localAgentMessage,
    videoMonitor,
    chatAutomationMonitor,
    readiness,
    completedCycles,
    failedCycles,
    averageConfidence,
    latestCycle,
    latestDecision,
    latestAction,
    roundCollectionMs: ROUND_COLLECTION_MS,
    speechCooldownMs: SPEECH_COOLDOWN_MS,
    autonomyLevel,
    setAutonomyLevel,
    start,
    pause,
    toggleVoice,
    toggleTestMode,
    injectEvent,
    clearSession,
    exportSession,
    toggleTool,
    toggleRule,
    approveChatReply,
    editChatReply,
    discardChatReply,
    sendChatReplyNow,
    refreshHealth,
    refreshObsScenes,
    refreshReadiness,
  };
}
