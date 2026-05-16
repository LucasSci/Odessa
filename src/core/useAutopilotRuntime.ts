import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { updateAutomationRule, loadAutomationRules } from './automationRules';
import { loadContentItems } from './contentLibrary';
import { clearEvents, emitEvent, getRecentEvents } from './eventBus';
import {
  clearAuditSession,
  exportAuditSession,
  loadAuditSession,
  runPersonaRound,
} from './personaRuntime';
import { loadToolRegistry, updateToolRegistry } from './toolRegistry';
import { apiUrl } from '../lib/api';
import { loadMemory } from '../lib/memory';
import type {
  AutopilotAction,
  AutopilotCycle,
  AutomationRule,
  CapturedMessage,
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

export interface AutopilotRuntimeState {
  autopilotEnabled: boolean;
  testMode: boolean;
  voiceEnabled: boolean;
  pendingEvents: LiveEvent[];
  currentRoundEvents: LiveEvent[];
  cycles: AutopilotCycle[];
  actionQueue: AutopilotAction[];
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
  completedCycles: number;
  failedCycles: number;
  averageConfidence: number;
  latestCycle?: AutopilotCycle;
  latestDecision?: PersonaDecision;
  latestAction?: AutopilotAction;
  roundCollectionMs: number;
  speechCooldownMs: number;
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
  refreshHealth: () => Promise<void>;
  refreshObsScenes: () => Promise<void>;
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
Priorize seguranca, moderacao, resgates e presentes sem pressionar a audiencia a gastar.
Use o registro de ferramentas e regras como limites operacionais.
Nunca afirme que uma acao externa real foi executada quando ela estiver simulada ou pendente de aprovacao.`;

const ROUND_COLLECTION_MS = 2500;
const MAX_EVENTS_PER_ROUND = 8;
const SPEECH_COOLDOWN_MS = 7000;
const IDLE_TIMEOUT_MS = 45000; // 45 seconds of silence triggers an idle event

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
  const queuedOrProcessedIdsRef = useRef<Set<string>>(
    new Set(capturedText.filter((event) => event.processedAt).map((event) => event.id)),
  );
  const pendingEventsRef = useRef<LiveEvent[]>([]);
  const roundTimerRef = useRef<number | null>(null);
  const lastSpeechAtRef = useRef(0);
  const lastEventAtRef = useRef(0);

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

  const enqueueEvent = useCallback((event: LiveEvent) => {
    if (event.processedAt || queuedOrProcessedIdsRef.current.has(event.id)) return;
    queuedOrProcessedIdsRef.current.add(event.id);
    lastEventAtRef.current = Date.now();
    setPendingEvents((current) => {
      const next = [...current, event].slice(-60);
      pendingEventsRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    pendingEventsRef.current = pendingEvents;
  }, [pendingEvents]);

  useEffect(() => {
    const firstRun = window.setTimeout(refreshHealth, 0);
    const obsFirstRun = window.setTimeout(refreshObsScenes, 700);
    const interval = window.setInterval(refreshHealth, 15000);
    const obsInterval = window.setInterval(refreshObsScenes, 20000);
    return () => {
      window.clearTimeout(firstRun);
      window.clearTimeout(obsFirstRun);
      window.clearInterval(interval);
      window.clearInterval(obsInterval);
    };
  }, [refreshHealth, refreshObsScenes]);

  useEffect(() => {
    capturedText.forEach(enqueueEvent);
  }, [capturedText, enqueueEvent]);

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

      const batch = pendingEventsRef.current.slice(0, MAX_EVENTS_PER_ROUND);
      if (batch.length === 0) return;
      const remaining = pendingEventsRef.current.slice(batch.length);
      pendingEventsRef.current = remaining;
      setPendingEvents(remaining);

      setCurrentRoundEvents(batch);
      setIsProcessing(true);
      setLastError(null);

      runPersonaRound(batch, {
        personaPrompt: PERSONA_AUTOPILOT_PROMPT,
        tools,
        rules,
        voiceEnabled,
        onUpdate: (cycle) => setCycles((current) => upsertCycle(current, cycle)),
        onAction: (action) => setActionQueue((current) => upsertAction(current, action)),
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

  return {
    autopilotEnabled,
    testMode,
    voiceEnabled,
    pendingEvents,
    currentRoundEvents,
    cycles,
    actionQueue,
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
    completedCycles,
    failedCycles,
    averageConfidence,
    latestCycle,
    latestDecision,
    latestAction,
    roundCollectionMs: ROUND_COLLECTION_MS,
    speechCooldownMs: SPEECH_COOLDOWN_MS,
    start,
    pause,
    toggleVoice,
    toggleTestMode,
    injectEvent,
    clearSession,
    exportSession,
    toggleTool,
    toggleRule,
    refreshHealth,
    refreshObsScenes,
  };
}
