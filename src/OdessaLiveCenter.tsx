import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import {
  Brain,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  Database,
  FastForward,
  Film,
  Home,
  Link2,
  ListVideo,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RadioTower,
  RefreshCw,
  Rewind,
  Route,
  Save,
  Settings,
  ShieldAlert,
  Scissors,
  SlidersHorizontal,
  StickyNote,
  Trash2,
  Upload,
  Video,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { emitEvent } from './core/eventBus';
import { apiUrl } from './lib/api';
import {
  routeSetupLiveScene,
  routeShowStart,
  routeShowStage,
  routeStartTransmission,
  routeStopTransmission,
  type CommandResult,
} from './lib/obsCommandRouter';
import { cn } from './lib/utils';
import type { AutopilotRuntimeState } from './core/useAutopilotRuntime';
import type { CapturedMessage } from './types';
import { Badge, Button, Card, ConfirmButton, Input, StatusDot, Tooltip } from './components/ui';
import { AiDecisionPanel } from './components/AiDecisionPanel';
import { AiConfigPanel } from './components/AiConfigPanel';
import VideoEditor from './components/VideoEditor';
import { DebugLogPanel, logEntry } from './components/DebugLogPanel';
import { StatusBadge, deriveStageStatus } from './components/StatusBadge';
import { ValidationChecklist, buildFlowValidationChecks } from './components/ValidationChecklist';

import type { AiDecision, AiIntentType } from './core/aiDecisionContract';
import { EMPTY_AI_DECISION, callAiDecision, checkingAiDecision } from './core/aiDecisionContract';
import type { PersonaDecision } from './types';
import { applyVideoEdit, getVideoEdit, saveVideoEdit, defaultVideoEdit, type VideoSegment } from './core/videoEdits';
import { getAiConfig, hasActiveGeminiKey, type AiAutonomyLevel } from './core/aiConfig';
import { globalMoodEngine } from './core/moodEngine';
import type { LogEntry } from './components/DebugLogPanel';
import { buildOcrEvent } from './core/ocrEventContract';
import type { OcrEvent, OcrEventType } from './core/ocrEventContract';

const CaptureStudio = lazy(() => import('./CaptureStudio'));
const ReactiveFlowBoard = lazy(() => import('./ReactiveFlowBoard'));
const PlanningCanvas = lazy(() => import('./PlanningCanvas'));
// VideoEditor é importado de forma normal (não-lazy): no Palco o stream de vídeo
// ao vivo segura conexões HTTP/1.1 e o chunk lazy ficava "pending" para sempre.

// ─── Gift detection ───────────────────────────────────────────────────────────
// isGiftEvent is imported from ocrPipeline — single source of truth.

export type AdvancedPanel =
  | 'overview'
  | 'capture'
  | 'persona'
  | 'content'
  | 'runtime'
  | 'settings'
  | 'overlay'
  | 'canvas';

type LiveConfig = {
  voiceEnabled?: boolean;
  enableChat?: boolean;
  prepareObs?: boolean;
  showStage?: boolean;
  startAutomation?: boolean;
  startCapture?: boolean;
  startTransmission?: boolean;
  actionMode?: 'simulated' | 'approval_required' | 'real';
};

type AgentStatus = {
  ok?: boolean;
  agentConnected?: boolean;
  queueSize?: number;
  message?: string;
  agent?: {
    agentId?: string;
    host?: string;
    version?: string;
    lastSeenAt?: string;
    capabilities?: string[];
    health?: {
      obsConnected?: boolean;
      obs?: { ok?: boolean; connected?: boolean; error?: string | null };
    };
  } | null;
};

interface OdessaLiveCenterProps {
  capturedText: CapturedMessage[];
  setCapturedText: Dispatch<SetStateAction<CapturedMessage[]>>;
  runtime: AutopilotRuntimeState;
  requestedPanel: AdvancedPanel;
  liveConfig?: LiveConfig;
  liveConfigOpen?: boolean;
  liveStartError?: string | null;
  agentStatus?: AgentStatus | null;
  onLiveConfigOpenChange?: Dispatch<SetStateAction<boolean>>;
  onLiveConfigChange?: Dispatch<SetStateAction<LiveConfig>>;
  onStartLive?: () => void | Promise<void>;
  onRefreshAgentStatus?: () => void | Promise<void>;
  obsDirectStatus?: import('./lib/obsWebSocket').ObsDirectStatus | null;
  obsSettingsFromApp?: Record<string, unknown> | null;
  onObsSettingsChanged?: (settings: Record<string, unknown>) => void;
}

type TabKey = 'home' | 'stage' | 'ai' | 'flow' | 'canvas' | 'library' | 'sources' | 'logs' | 'settings';

type VideoEntry = {
  id: string;
  label?: string;
  group?: string;
  description?: string;
  loop?: boolean;
  tags?: string[];
  src?: string;
  url?: string;
  title?: string;
};

type PlaybackSettings = {
  startSec: number;
  endSec: number | null;
  transitionMs: number;
};

type ConnectionSettings = {
  transitionMs?: number;
  fadeMode?: 'cut' | 'fade' | 'crossfade';
  previewTailSec?: number;
  previewHeadSec?: number;
};

type ClipAudioSettings = {
  mode?: 'muted' | 'original' | 'track';
  volume?: number;
  trackId?: string;
  trackUrl?: string;
  trackLoop?: boolean;
};

type FlowNode = {
  nodeId: string;
  videoId: string;
  label?: string;
  position?: { x: number; y: number };
  playback: PlaybackSettings;
  audio?: ClipAudioSettings;
};

type VideoClip = {
  nodeId?: string | null;
  videoId: string;
  label?: string;
  startSec: number;
  endSec: number | null;
  transitionMs: number;
  returnToIdle?: boolean;
  loop?: boolean;
  playback?: PlaybackSettings;
  audio?: ClipAudioSettings;
  /** Cortes (Fase 4): trechos a tocar em ordem. Ausente/vazio = trim simples start/end. */
  segments?: VideoSegment[];
};

type TriggerEntry = {
  id: string;
  name: string;
  enabled: boolean;
  eventType: string;
  conditions?: { giftKey?: string; keyword?: string };
  actions?: Array<{
    type: string;
    capability?: string;
    videoId?: string;
    payload?: { videoId?: string; sceneName?: string; webhookId?: string };
  }>;
};

type PersonaConfig = {
  videos: VideoEntry[];
  triggers: TriggerEntry[];
  idleVideoId?: string;
  action_map?: Record<string, string[]>;
  flowNodes?: FlowNode[];
  flowConnections?: Array<{
    id: string;
    fromNodeId?: string;
    toNodeId?: string;
    fromVideoId: string;
    toVideoId: string;
    triggerId: string;
    returnToIdle?: boolean;
    connectionSettings?: ConnectionSettings;
  }>;
};

type VideoState = {
  current_video_id?: string;
  state?: string;
  queue_len?: number;
  update_ts?: number;
  start_ts?: number;
  server_time?: number;
  currentClip?: VideoClip | null;
  nextClip?: VideoClip | null;
  upcoming?: VideoClip[];
  activeNodeId?: string | null;
  activeConnectionId?: string | null;
  nextConnectionIds?: string[];
  blockedConnectionIds?: string[];
  executionMode?: 'live' | 'test' | 'dry-run' | 'editing';
  lastTransitionAt?: number | null;
};

type LivePlanStep = {
  id: string;
  label: string;
  enabled: boolean;
  mode: 'simulated' | 'approval_required' | 'real';
  description?: string;
  status?: 'ready' | 'blocked' | 'warning';
};

type LivePlan = {
  ok?: boolean;
  dryRun?: boolean;
  actionMode?: LiveConfig['actionMode'];
  settings?: Record<string, unknown>;
  steps?: LivePlanStep[];
  risks?: string[];
  health?: ObsHealthResult | null;
  error?: string | null;
};

type AutomationLogEntry = {
  timestamp: string;
  stage: string;
  message: string;
  data?: Record<string, unknown>;
};

type AutomationTestResponse = {
  status: string;
  text?: string;
  events?: Array<Record<string, unknown>>;
  matchedTriggers?: Array<Record<string, unknown>>;
  actions?: Array<Record<string, unknown>>;
  queuedActions?: Array<Record<string, unknown>>;
  logs?: AutomationLogEntry[];
  queue?: Array<Record<string, unknown>>;
};

type AutomationExecutionResponse = {
  status: string;
  action?: Record<string, unknown>;
  result?: Record<string, unknown>;
  videoState?: VideoState;
};

type ObsSettings = {
  enabled: boolean;
  websocketUrl: string;
  websocketPassword?: string;
  passwordConfigured?: boolean;
  ocrSourceName: string;
  chatSourceName: string;
  stageSourceName: string;
  stageUrl: string;
  startupSceneName: string;
  liveSceneName: string;
  transmissionMode: 'stream' | 'virtual_camera' | 'none';
  canvasWidth: number;
  canvasHeight: number;
  sceneWhitelist: string[];
  allowedScenes: string[];
};

type ObsConnectionFields = {
  host: string;
  port: string;
  authenticationEnabled: boolean;
};

type WorkspaceSettings = {
  apiBudgetMode: 'economico' | 'normal' | 'agressivo';
  automationMode: 'manual' | 'assistido' | 'automatico';
  errorReports: boolean;
  telemetry: boolean;
};

type ObsHealthResult = {
  ok?: boolean;
  connected?: boolean;
  sourceReady?: boolean;
  sourceName?: string;
  currentScene?: string | null;
  screenshotReady?: boolean;
  sceneSwitchReady?: boolean;
  availableScenes?: string[];
  allowedScenes?: string[];
  imageWidth?: number | null;
  imageHeight?: number | null;
  layout?: Partial<ObsSettings>;
  chatSourceReady?: boolean;
  stageSourceReady?: boolean;
  startupSceneReady?: boolean;
  liveSceneReady?: boolean;
  transmission?: {
    ok?: boolean;
    mode?: string;
    streamActive?: boolean;
    virtualCameraActive?: boolean;
    error?: string | null;
  } | null;
  error?: string | null;
};

type WebhookConfig = {
  id: string;
  name: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  enabled: boolean;
  timeoutMs: number;
  bodyTemplate: string;
};

type WebhookDraft = Omit<WebhookConfig, 'id'> & { id?: string };

type ReactiveRunResult = {
  input: string;
  source: string;
  createdAt: string;
  test: AutomationTestResponse;
  executions: AutomationExecutionResponse[];
};

/**
 * Converte a decisão da Diretora (PersonaDecision, do runtime) para o formato
 * AiDecision que o painel do Palco exibe. Só para exibição — a execução real das
 * ações acontece no executor do runtime.
 */
function personaDecisionToAiDecision(decision: PersonaDecision): AiDecision {
  const actions = Array.isArray(decision.actions) ? decision.actions : [];
  const playAction = actions.find((a) => a.type === 'play_video');
  const videoId = playAction?.payload?.videoId as string | undefined;
  const videoLabelRaw = playAction?.payload?.label as string | undefined;
  const recommendedAction: AiDecision['recommendedAction'] = playAction
    ? 'play_video'
    : actions.some((a) => a.type !== 'speak' && a.type !== 'log_event')
      ? 'queue_video'
      : 'wait';
  return {
    sourceEvent: null,
    intent: decision.intent as AiIntentType,
    emotion: 'neutral',
    recommendedAction,
    selectedTriggerId: (playAction?.ruleId as string) ?? null,
    selectedVideoId: videoId ?? null,
    selectedVideoLabel: videoLabelRaw ?? videoId ?? null,
    confidence: typeof decision.confidence === 'number' ? decision.confidence : 0.7,
    reasoning: decision.reason || decision.speech || 'Decisão da Diretora.',
    status: 'online',
    timestamp: new Date().toISOString(),
  };
}

function tabFromPanel(panel: AdvancedPanel): TabKey {
  if (panel === 'capture') return 'sources';
  if (panel === 'content') return 'library';
  if (panel === 'runtime') return 'logs';
  if (panel === 'settings') return 'settings';
  if (panel === 'canvas') return 'canvas';
  return 'home';
}

function videoLabel(video?: VideoEntry) {
  if (!video) return 'Nenhum video';
  return (
    video.label ||
    video.id
      .replace(/^grok-/, '')
      .replace(/-/g, ' ')
      .slice(0, 42)
  );
}

function eventLabel(trigger: TriggerEntry) {
  if (trigger.eventType === 'gift') return trigger.conditions?.giftKey || 'gift.*';
  if (trigger.eventType === 'comment') return trigger.conditions?.keyword || 'comentario';
  return trigger.eventType;
}

function textValue(value: unknown, fallback = '-') {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

export default function OdessaLiveCenter({
  capturedText,
  setCapturedText,
  runtime,
  requestedPanel,
  liveConfig = { voiceEnabled: false, enableChat: false },
  liveStartError = null,
  agentStatus = null,
  onLiveConfigOpenChange,
  onLiveConfigChange,
  onStartLive,
  onRefreshAgentStatus,
  obsDirectStatus = null,
  obsSettingsFromApp = null,
  onObsSettingsChanged,
}: OdessaLiveCenterProps) {
  const [activeTab, setActiveTab] = useState<TabKey>(() => tabFromPanel(requestedPanel));
  const [config, setConfig] = useState<PersonaConfig | null>(null);
  const [videoState, setVideoState] = useState<VideoState | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [automationLogs, setAutomationLogs] = useState<AutomationLogEntry[]>([]);
  const [latestReactiveRun, setLatestReactiveRun] = useState<ReactiveRunResult | null>(null);
  const [reactiveError, setReactiveError] = useState<string | null>(null);
  const [reactiveBusy, setReactiveBusy] = useState(false);

  // ── Decisão da IA — estado exibido no Palco ─────────────────────────────────
  // Fora do ar: prévia (callAiDecision, sem executar). Ao vivo: espelha a decisão
  // real da Diretora (runtime.latestDecision).
  const [aiDecision, setAiDecision] = useState<AiDecision>(EMPTY_AI_DECISION);

  const loadConfig = useCallback(async () => {
    try {
      const response = await fetch(apiUrl('/api/video/config'));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as PersonaConfig;
      setConfig(data);
      console.log('[VIDEO_DEBUG] config_loaded', {
        videoCount: data?.videos?.length || 0,
        idleVideoId: data?.idleVideoId,
        availableVideos: data?.videos?.map((video) => video.id),
      });
      if (!data?.videos?.length) {
        console.warn('[VIDEO_ERROR] no_videos_found_in_library');
      }
      setConfigError(null);
    } catch (err) {
      console.error('[VIDEO_ERROR] backend_offline_or_invalid_config', err);
      setConfigError(err instanceof Error ? err.message : 'Backend indisponivel');
    }
  }, []);

  const refreshVideoState = useCallback(async () => {
    try {
      const response = await fetch(apiUrl('/api/video/state'));
      if (!response.ok) return;
      const next = (await response.json()) as VideoState;
      // Only update when something visible changed — the response includes a
      // volatile server_time that would otherwise re-render every poll.
      setVideoState((prev) => {
        const sig = (s: VideoState | null) =>
          s
            ? `${s.current_video_id || ''}|${s.state || ''}|${s.activeNodeId || ''}|${s.activeConnectionId || ''}|${JSON.stringify(s.currentClip || null)}`
            : '';
        return sig(prev) === sig(next) ? prev : next;
      });
    } catch {
      // The shell keeps working when the backend is offline.
    }
  }, []);

  const refreshAutomationLogs = useCallback(async () => {
    try {
      const response = await fetch(apiUrl('/api/automation/logs'));
      if (!response.ok) return;
      const data = (await response.json()) as { logs?: AutomationLogEntry[] };
      setAutomationLogs(Array.isArray(data.logs) ? data.logs : []);
    } catch {
      // Logs are diagnostic; the main controls stay usable if polling fails.
    }
  }, []);

  const processedGiftIdsRef = useRef<Set<string>>(new Set(capturedText.map((event) => event.id)));

  const drainReactiveQueue = useCallback(async () => {
    const executions: AutomationExecutionResponse[] = [];
    for (let index = 0; index < 6; index += 1) {
      const response = await fetch(apiUrl('/api/automation/next-action'));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as AutomationExecutionResponse;
      if (payload.status === 'empty') break;
      executions.push(payload);
      if (payload.videoState) setVideoState(payload.videoState);
    }
    return executions;
  }, []);

  const runReactiveFlow = useCallback(
    async (text: string, source = 'manual') => {
      const cleanText = text.trim();
      if (!cleanText) return null;

      setReactiveBusy(true);
      setReactiveError(null);
      try {
        if (source === 'manual' || source === 'test') {
          const emitted = emitEvent({
            id: `test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            source: source === 'test' ? 'test' : 'manual',
            zoneName: 'Teste manual',
            text: cleanText,
            kind: 'chat',
            createdAt: new Date().toISOString(),
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            metadata: { triggerTest: true },
          });
          processedGiftIdsRef.current.add(emitted.id);
          setCapturedText((current) => [...current.filter((event) => event.id !== emitted.id), emitted].slice(-100));
        }

        const response = await fetch(apiUrl('/api/automation/ingest'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: cleanText,
            source,
            zoneName: source === 'test' ? 'Teste manual' : 'Entrada manual',
            kind: 'chat',
            execute: true,
            maxActions: 6,
          }),
        });
        const ingest = (await response.json()) as {
          summary?: AutomationTestResponse;
          executions?: AutomationExecutionResponse[];
        };
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const test = ingest.summary || {
          status: 'processed',
          text: cleanText,
          events: [],
          matchedTriggers: [],
          actions: [],
          queuedActions: [],
          logs: [],
        };
        const executions = Array.isArray(ingest.executions)
          ? ingest.executions
          : await drainReactiveQueue();
        const run = {
          input: cleanText,
          source,
          createdAt: new Date().toISOString(),
          test,
          executions,
        };
        setLatestReactiveRun(run);
        await refreshAutomationLogs();
        await refreshVideoState();
        return run;
      } catch (err) {
        setReactiveError(err instanceof Error ? err.message : 'Falha no fluxo reativo');
        return null;
      } finally {
        setReactiveBusy(false);
      }
    },
    [drainReactiveQueue, refreshAutomationLogs, refreshVideoState, setCapturedText],
  );

  useEffect(() => {
    const initialLoadTimer = window.setTimeout(() => {
      void loadConfig();
      void refreshVideoState();
      void refreshAutomationLogs();
    }, 0);

    // Poll video state continuously, on every tab, so Início, Palco e Fluxo
    // Reativo refletem a mesma reproducao em tempo real.
    const videoTimer = window.setInterval(() => {
      void refreshVideoState();
    }, 600);
    const logsTimer =
      activeTab === 'logs'
        ? window.setInterval(() => {
            void refreshAutomationLogs();
          }, 5000)
        : null;

    return () => {
      window.clearTimeout(initialLoadTimer);
      window.clearInterval(videoTimer);
      if (logsTimer !== null) window.clearInterval(logsTimer);
    };
  }, [activeTab, loadConfig, refreshAutomationLogs, refreshVideoState]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setActiveTab(tabFromPanel(requestedPanel));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [requestedPanel]);

  /**
   * playVideoById — the SINGLE reliable function to play a video.
   * Validates video exists, logs steps, and calls backend.
   */
  const playVideoById = async (videoId: string, reason = 'unknown') => {
    console.log('[VIDEO_PLAY] requested', { videoId, reason });
    if (reason === 'manual_click') {
      console.log('[VIDEO_DEBUG] manual_click_received');
    }

    const video = config?.videos.find((item) => item.id === videoId);
    if (!video) {
      console.error('[VIDEO_ERROR] video_not_found', { videoId });
      return { ok: false, reason: 'video_not_found' };
    }

    const src = video.src || video.url || apiUrl(`/api/video/play/${video.id}`);
    console.log('[VIDEO_DEBUG] selectedVideoId:', videoId);
    console.log('[VIDEO_DEBUG] video_found: true');
    console.log('[VIDEO_DEBUG] video_src:', src);
    console.log('[VIDEO_DEBUG] setCurrentVideo_called');

    try {
      const response = await fetch(apiUrl('/api/video/force'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId, state: 'ACTION' }),
      });

      if (!response.ok) {
        console.error('[VIDEO_ERROR] playback_failed - HTTP', response.status);
        return { ok: false, reason: 'playback_failed' };
      }

      console.log('[VIDEO_PLAY] current_video_set', {
        videoId: video.id,
        title: video.title || video.id,
        src,
        reason,
      });
      console.log('[VIDEO_DEBUG] play_attempted');
      console.log('[VIDEO_DEBUG] play_success');
      refreshVideoState();
      return { ok: true, video };
    } catch (err) {
      console.error('[VIDEO_ERROR] playback_failed', err);
      return { ok: false, reason: 'exception' };
    }
  };

  const patchFlowNodePlayback = useCallback(
    async (nodeId: string, patch: Partial<PlaybackSettings>) => {
      if (!config?.flowNodes?.length) return;
      const nextConfig: PersonaConfig = {
        ...config,
        flowNodes: config.flowNodes.map((node) =>
          node.nodeId === nodeId
            ? {
                ...node,
                playback: {
                  ...node.playback,
                  ...patch,
                  startSec: Math.max(0, Number(patch.startSec ?? node.playback.startSec ?? 0)),
                  endSec:
                    patch.endSec === null
                      ? null
                      : patch.endSec === undefined
                        ? node.playback.endSec
                        : Math.max(0, Number(patch.endSec)),
                  transitionMs: Math.max(0, Number(patch.transitionMs ?? node.playback.transitionMs ?? 220)),
                },
              }
            : node,
        ),
      };
      const response = await fetch(apiUrl('/api/video/config'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextConfig),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setConfig(nextConfig);
      await fetch(apiUrl('/api/automation/refresh'), { method: 'POST' }).catch(() => undefined);
      await refreshVideoState();
    },
    [config, refreshVideoState],
  );

  const patchFlowConnectionSettings = useCallback(
    async (connectionId: string, patch: Partial<ConnectionSettings>) => {
      if (!config?.flowConnections?.length) return;
      const nextConfig: PersonaConfig = {
        ...config,
        flowConnections: config.flowConnections.map((connection) =>
          connection.id === connectionId
            ? {
                ...connection,
                connectionSettings: {
                  ...(connection.connectionSettings || {}),
                  ...patch,
                  transitionMs: Math.max(
                    0,
                    Math.min(
                      2000,
                      Number(patch.transitionMs ?? connection.connectionSettings?.transitionMs ?? 220),
                    ),
                  ),
                  fadeMode:
                    patch.fadeMode === 'cut' || patch.fadeMode === 'fade' || patch.fadeMode === 'crossfade'
                      ? patch.fadeMode
                      : connection.connectionSettings?.fadeMode || 'crossfade',
                  previewTailSec: Math.max(
                    0.5,
                    Math.min(
                      8,
                      Number(patch.previewTailSec ?? connection.connectionSettings?.previewTailSec ?? 2),
                    ),
                  ),
                  previewHeadSec: Math.max(
                    0.5,
                    Math.min(
                      8,
                      Number(patch.previewHeadSec ?? connection.connectionSettings?.previewHeadSec ?? 2),
                    ),
                  ),
                },
              }
            : connection,
        ),
      };
      const response = await fetch(apiUrl('/api/video/config'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextConfig),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setConfig(nextConfig);
      await fetch(apiUrl('/api/automation/refresh'), { method: 'POST' }).catch(() => undefined);
      await refreshVideoState();
    },
    [config, refreshVideoState],
  );

  // view precisa ser declarado antes do pipeline principal porque o useEffect
  // referencia view.videos e view.triggers nas dependências.
  const view = useMemo(() => {
    const videos = config?.videos || [];
    const triggers = config?.triggers || [];
    const idleVideoId =
      config?.idleVideoId ||
      config?.action_map?.idle?.[0] ||
      videos.find((item) => item.loop)?.id ||
      '';
    const currentVideo = videos.find((item) => item.id === videoState?.current_video_id);
    const idleVideo = videos.find((item) => item.id === idleVideoId);
    const activeTriggers = triggers.filter((item) => item.enabled);
    const connections = config?.flowConnections || [];
    const flowNodes = config?.flowNodes || [];

    // ⚡ Bolt: Avoid O(N) memory allocation on every render
    // Instead of `[...capturedText].reverse().find(...)` which shallow copies
    // the continuously growing array, we use a backward loop to find the last match.
    // Impact: Reduces GC pressure and memory allocations to O(1).
    let lastOcr;
    for (let i = capturedText.length - 1; i >= 0; i--) {
      if (capturedText[i].source === 'ocr') {
        lastOcr = capturedText[i];
        break;
      }
    }
    return {
      videos,
      triggers,
      activeTriggers,
      connections,
      flowNodes,
      idleVideoId,
      idleVideo,
      currentVideo,
      lastOcr,
      isLive: runtime.autopilotEnabled,
      readyScore: [
        runtime.health?.status === 'ok',
        Boolean(idleVideoId),
        activeTriggers.length > 0,
      ].filter(Boolean).length,
    };
  }, [
    capturedText,
    config,
    runtime.autopilotEnabled,
    runtime.health?.status,
    videoState?.current_video_id,
  ]);

  // ── Prévia da IA (apenas fora do ar) ────────────────────────────────────────
  // Quando a live está NO AR, quem conduz é a Diretora única (useAutopilotRuntime →
  // runPersonaRound), que decide fala + vídeo + cena numa rodada só e executa pelo
  // executor. Para NÃO duplicar o processamento (double-ingest), este efeito só roda
  // FORA do ar: mostra no Palco o que a IA decidiria, SEM executar nada.
  // O disparo real de vídeo fora do ar continua nos botões manuais (runReactiveFlow).
  useEffect(() => {
    if (runtime.autopilotEnabled) return; // ao vivo → a Diretora cuida (sem prévia paralela)

    const previewEvent = async (event: CapturedMessage) => {
      if (!event.text?.trim()) return;
      if (event.metadata?.backendIngested) return;

      const prebuilt = event.metadata?.ocrEvent as OcrEvent | undefined;
      const srcMap: Record<string, OcrEvent['source']> = { ocr: 'ocr', test: 'test', manual: 'manual' };
      const kindMap: Record<string, OcrEventType> = { gift: 'gift', chat: 'comment', alert: 'system', system: 'system' };
      const ocrEvent: OcrEvent = prebuilt ?? buildOcrEvent(event.text, {
        source: srcMap[event.source] ?? 'manual',
        eventType: kindMap[event.kind] ?? 'unknown',
        zoneName: event.zoneName || 'chat',
        confidence: (event.metadata?.confidence as number | undefined) ?? 0.85,
        metadata: {
          giftName: (event.metadata?.giftName as string | null) ?? null,
          giftKey:  (event.metadata?.giftKey  as string | null) ?? null,
          giftValue: null,
        },
      });

      setAiDecision(checkingAiDecision(ocrEvent));
      const decision = await callAiDecision(ocrEvent, {
        videos:   view.videos,
        triggers: view.triggers,
      });
      setAiDecision(decision); // somente exibição — sem runReactiveFlow aqui
    };

    for (const event of capturedText) {
      if (processedGiftIdsRef.current.has(event.id)) continue;
      if (!event.text?.trim()) continue;
      if (event.metadata?.backendIngested) {
        processedGiftIdsRef.current.add(event.id);
        continue;
      }
      processedGiftIdsRef.current.add(event.id);
      void previewEvent(event);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturedText, runtime.autopilotEnabled, view.videos, view.triggers]);

  // ── Espelho da decisão da Diretora no Palco (ao vivo) ───────────────────────
  // Ao vivo, o painel "Decisão da IA" do Palco reflete a última decisão real da
  // Diretora (vinda do runtime), convertida para o formato do painel.
  useEffect(() => {
    if (!runtime.autopilotEnabled) return;
    if (!runtime.latestDecision) return;
    setAiDecision(personaDecisionToAiDecision(runtime.latestDecision));
  }, [runtime.autopilotEnabled, runtime.latestDecision]);

  return (
    <main className="odessa-shell odsa-v2 flex h-screen w-screen min-h-0 overflow-hidden text-[var(--t1)]">
      {/* Sidebar (desktop) — navegação agrupada + card fixo da Diretora */}
      <aside className="odsa-sidebar hidden lg:flex">
        <div className="odsa-brand">
          <span className="odsa-brand-mark">
            <svg viewBox="0 0 1024 1024" aria-label="Odessa" style={{ width: 28, height: 28 }}>
              <defs>
                <linearGradient id="oring" x1="256" y1="208" x2="792" y2="832" gradientUnits="userSpaceOnUse">
                  <stop offset="0" stopColor="#f8fafc"/>
                  <stop offset="0.38" stopColor="#93c5fd"/>
                  <stop offset="0.72" stopColor="#22d3ee"/>
                  <stop offset="1" stopColor="#38bdf8"/>
                </linearGradient>
              </defs>
              <circle cx="512" cy="512" r="326" fill="none" stroke="#0f172a" strokeWidth="46"/>
              <circle cx="512" cy="512" r="278" fill="none" stroke="url(#oring)" strokeWidth="118"/>
              <circle cx="512" cy="512" r="168" fill="#07111f"/>
              <path d="M704 286c36 26 66 59 88 98" fill="none" stroke="#e0f2fe" strokeWidth="34" strokeLinecap="round" opacity="0.86"/>
              <circle cx="742" cy="284" r="34" fill="#67e8f9"/>
              <circle cx="742" cy="284" r="58" fill="none" stroke="#22d3ee" strokeWidth="14" opacity="0.35"/>
            </svg>
          </span>
          <div className="odsa-brand-text">
            <div className="odsa-brand-name">Odessa</div>
            <div className="odsa-brand-sub">Studio</div>
          </div>
        </div>

        <nav className="odsa-side-nav">
          <div className="odsa-nav-group">
            <span className="odsa-nav-label">Operação</span>
            <SideNavButton icon={<Home />}       label="Início"       active={activeTab === 'home'}     onClick={() => setActiveTab('home')} />
            <SideNavButton icon={<Video />}      label="Palco"        active={activeTab === 'stage'}    onClick={() => setActiveTab('stage')} />
            <SideNavButton icon={<Brain />}      label="Diretora IA"  active={activeTab === 'ai'}       onClick={() => setActiveTab('ai')} />
          </div>
          <div className="odsa-nav-group">
            <span className="odsa-nav-label">Conteúdo</span>
            <SideNavButton icon={<Film />}       label="Biblioteca"   active={activeTab === 'library'}  onClick={() => setActiveTab('library')} />
            <SideNavButton icon={<Link2 />}      label="Fluxo"        active={activeTab === 'flow'}     onClick={() => setActiveTab('flow')} />
            <SideNavButton icon={<StickyNote />} label="Mural"        active={activeTab === 'canvas'}   onClick={() => setActiveTab('canvas')} />
          </div>
          <div className="odsa-nav-group">
            <span className="odsa-nav-label">Sistema</span>
            <SideNavButton icon={<Camera />}     label="Fontes / OCR" active={activeTab === 'sources'}  onClick={() => setActiveTab('sources')} />
            <SideNavButton icon={<ListVideo />}  label="Logs"         active={activeTab === 'logs'}     onClick={() => setActiveTab('logs')} />
            <SideNavButton icon={<Settings />}   label="Config"       active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
          </div>
        </nav>

        <DirectorStatusCard runtime={runtime} onOpen={() => setActiveTab('ai')} />
      </aside>

      {/* Coluna principal: topbar + conteúdo */}
      <div className="odsa-main flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="odsa-topbar">
          <div className="odsa-topbar-title">
            <span className="odsa-crumb">{TAB_META[activeTab].group}</span>
            <h1>{TAB_META[activeTab].title}</h1>
          </div>

        {/* Right side: status + CTA */}
        <div className="odsa-header-end">
          {/* Live / Pronta pill */}
          <span className={cn('odsa-live-pill hidden sm:inline-flex', runtime.autopilotEnabled && 'is-on')}>
            <span className="d" />
            {runtime.autopilotEnabled ? 'AO VIVO' : 'PRONTA'}
          </span>

          {/* Settings icon button */}
          <button
            className="odsa-btn odsa-btn-secondary odsa-btn-md odsa-btn-icon"
            onClick={() => { onLiveConfigOpenChange?.(false); setActiveTab('settings'); }}
            title="Configurações"
          >
            <Settings style={{ width: 16, height: 16 }} />
          </button>

          {/* Primary CTA */}
          <button
            className={cn('odsa-btn odsa-btn-md', runtime.autopilotEnabled ? 'odsa-btn-secondary' : 'odsa-btn-primary')}
            onClick={() => {
              if (runtime.autopilotEnabled) { runtime.pause(); return; }
              if (onStartLive) { void onStartLive(); return; }
              runtime.start();
            }}
          >
            {runtime.autopilotEnabled
              ? <Pause style={{ width: 15, height: 15 }} />
              : <Play  style={{ width: 15, height: 15 }} />}
            {runtime.autopilotEnabled ? 'Pausar live' : 'Iniciar live'}
          </button>
        </div>

        {liveStartError && (
          <div className="odsa-toast">
            {liveStartError}
          </div>
        )}
      </header>

      <div className="flex gap-1 overflow-x-auto border-b border-[var(--border)] px-3 py-1.5 lg:hidden" style={{ background: 'rgba(6,7,10,0.86)', backdropFilter: 'blur(20px)' }}>
        {([
          { id: 'home', label: 'Início' }, { id: 'stage', label: 'Palco' },
          { id: 'ai', label: 'IA' }, { id: 'flow', label: 'Fluxo' }, { id: 'canvas', label: 'Mural' },
          { id: 'library', label: 'Biblioteca' }, { id: 'sources', label: 'Fontes' },
          { id: 'logs', label: 'Logs' }, { id: 'settings', label: 'Config' },
        ] as { id: TabKey; label: string }[]).map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={cn('od-tab od-tab-sm shrink-0', activeTab === id && 'is-active')}
            style={{ height: 28, fontSize: 11.5, padding: '0 10px' }}
          >
            {label}
          </button>
        ))}
      </div>

      <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {activeTab === 'home' && (
          <HomeDashboard
            configError={configError}
            capturedText={capturedText}
            runtime={runtime}
            videoState={videoState}
            view={view}
            go={setActiveTab}
            onRefresh={refreshVideoState}
            onSimulateGift={() => void runReactiveFlow('Lucas enviou Rosa', 'test')}
          />
        )}
        {activeTab === 'stage' && (
          <StagePanel
            runtime={runtime}
            capturedText={capturedText}
            view={view}
            videoState={videoState}
            obsDirectStatus={obsDirectStatus}
            obsSettingsFromApp={obsSettingsFromApp}
            onRefresh={refreshVideoState}
            onPlayVideoById={playVideoById}
            onPatchFlowNodePlayback={patchFlowNodePlayback}
            onPatchFlowConnectionSettings={patchFlowConnectionSettings}
            onStartLive={onStartLive}
            onRunReactiveFlow={runReactiveFlow}
            aiDecision={aiDecision}
          />
        )}
        {activeTab === 'ai' && (
          <AiConfigPanel videos={view.videos} triggers={view.triggers} runtime={runtime} />
        )}
        {activeTab === 'flow' && (
          <Suspense fallback={<PanelLoading label="Carregando fluxo reativo" />}>
            <ReactiveFlowBoard
              onSaved={() => {
                loadConfig();
                refreshVideoState();
              }}
            />
          </Suspense>
        )}
        {activeTab === 'canvas' && (
          <Suspense fallback={<PanelLoading label="Carregando canvas" />}>
            <div className="flex-1 min-h-0 h-full overflow-hidden">
              <PlanningCanvas />
            </div>
          </Suspense>
        )}
        {activeTab === 'library' && <VideoLibraryPanel config={config} onChanged={loadConfig} />}
        {/*
          CaptureStudio stays mounted on every tab so screen capture / OCR
          keeps running when the user navigates away from "Fontes / OCR".
          When inactive it is moved off-screen (NOT display:none) so the
          <video> element keeps decoding frames for the OCR pipeline.
        */}
        <div
          className={cn(
            'flex min-h-0 flex-col',
            activeTab === 'sources'
              ? 'flex-1'
              : 'pointer-events-none fixed -left-[9999px] top-0 h-px w-px overflow-hidden opacity-0',
          )}
          aria-hidden={activeTab !== 'sources'}
        >
          <PageSurface
            icon={<Camera className="h-4 w-4" />}
            title="Fontes e OCR"
            description="Calibre captura, texto bruto, eventos parseados e testes manuais no mesmo console visual."
          >
            <Suspense fallback={<PanelLoading label="Carregando fontes OCR" />}>
              <CaptureStudio
                capturedText={capturedText}
                setCapturedText={setCapturedText}
                autopilotEnabled={runtime.autopilotEnabled}
                pendingAutopilotEvents={runtime.pendingEvents.length}
                latestAutopilotActionStatus={runtime.latestAction?.status}
                onStartAutopilot={runtime.start}
              />
            </Suspense>
          </PageSurface>
        </div>
        {activeTab === 'logs' && (
          <PageSurface
            icon={<ListVideo className="h-4 w-4" />}
            title="Logs da operacao"
            description="Teste o caminho real: chat/OCR, gatilho salvo no fluxo, fila e video."
          >
            <ReactiveFlowLogLab
              capturedText={capturedText}
              logs={automationLogs}
              latestRun={latestReactiveRun}
              error={reactiveError}
              busy={reactiveBusy}
              videoState={videoState}
              onRefreshLogs={refreshAutomationLogs}
              onRun={runReactiveFlow}
            />
          </PageSurface>
        )}
        {activeTab === 'settings' && (
          <SettingsPanel
            health={runtime.health}
            onRefreshHealth={runtime.refreshHealth}
            liveConfig={liveConfig}
            onLiveConfigChange={onLiveConfigChange}
            agentStatus={agentStatus}
            onObsSettingsChanged={onObsSettingsChanged}
            onSaved={() => {
              void runtime.refreshObsScenes();
            }}
          />
        )}
      </section>
      </div>
    </main>
  );
}

function PanelLoading({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-[320px] items-center justify-center bg-[#07080a] text-sm font-semibold text-slate-400">
      <RefreshCw className="mr-2 h-4 w-4 animate-spin text-[var(--gold)]" />
      {label}
    </div>
  );
}

function PageSurface({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden p-4 lg:p-5">
      <div className="mb-4 shrink-0 rounded-[34px] border border-white/10 bg-[#101114] p-5">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-sky-200/70">
          {icon}
          Odessa console
        </div>
        <h1 className="mt-2 text-4xl font-semibold tracking-[-0.04em] text-white">{title}</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-400">{description}</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-[34px] border border-white/10 bg-[#07080a]">
        {children}
      </div>
    </div>
  );
}

const DEFAULT_OBS_SETTINGS: ObsSettings = {
  enabled: true,
  websocketUrl: 'ws://localhost:4455',
  websocketPassword: '',
  passwordConfigured: false,
  ocrSourceName: 'Odessa Chat OCR',
  chatSourceName: 'Odessa Chat OCR',
  stageSourceName: 'Odessa Stage Overlay',
  stageUrl: 'http://localhost:3000/#overlay',
  startupSceneName: 'Odessa START',
  liveSceneName: 'Odessa LIVE',
  transmissionMode: 'stream',
  canvasWidth: 1080,
  canvasHeight: 1920,
  sceneWhitelist: [],
  allowedScenes: [],
};

const WORKSPACE_SETTINGS_KEY = 'odessa:workspace-settings:v1';

const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  apiBudgetMode: 'normal',
  automationMode: 'assistido',
  errorReports: true,
  telemetry: false,
};

function normalizeObsSettings(settings?: Partial<ObsSettings>): ObsSettings {
  const rawWhitelist = settings?.allowedScenes || settings?.sceneWhitelist;
  const scenes = Array.isArray(rawWhitelist)
    ? rawWhitelist.map((scene) => String(scene).trim()).filter(Boolean)
    : [];
  return {
    ...DEFAULT_OBS_SETTINGS,
    ...settings,
    ocrSourceName: settings?.ocrSourceName || settings?.chatSourceName || DEFAULT_OBS_SETTINGS.ocrSourceName,
    chatSourceName: settings?.chatSourceName || settings?.ocrSourceName || DEFAULT_OBS_SETTINGS.chatSourceName,
    transmissionMode:
      settings?.transmissionMode === 'virtual_camera' || settings?.transmissionMode === 'none'
        ? settings.transmissionMode
        : 'stream',
    canvasWidth: Math.max(1, Number(settings?.canvasWidth || DEFAULT_OBS_SETTINGS.canvasWidth)),
    canvasHeight: Math.max(1, Number(settings?.canvasHeight || DEFAULT_OBS_SETTINGS.canvasHeight)),
    sceneWhitelist: scenes,
    allowedScenes: scenes,
  };
}

function loadWorkspaceSettings(): WorkspaceSettings {
  if (typeof window === 'undefined') return DEFAULT_WORKSPACE_SETTINGS;
  try {
    const stored = window.localStorage.getItem(WORKSPACE_SETTINGS_KEY);
    if (!stored) return DEFAULT_WORKSPACE_SETTINGS;
    return { ...DEFAULT_WORKSPACE_SETTINGS, ...JSON.parse(stored) };
  } catch {
    return DEFAULT_WORKSPACE_SETTINGS;
  }
}

function parseObsConnection(settings: ObsSettings): ObsConnectionFields {
  try {
    const url = new URL(settings.websocketUrl || DEFAULT_OBS_SETTINGS.websocketUrl);
    return {
      host: url.hostname || 'localhost',
      port: url.port || '4455',
      authenticationEnabled: Boolean(settings.passwordConfigured || settings.websocketPassword),
    };
  } catch {
    const withoutProtocol = (settings.websocketUrl || DEFAULT_OBS_SETTINGS.websocketUrl)
      .replace(/^wss?:\/\//i, '')
      .replace(/\/.*$/, '');
    const [host, port] = withoutProtocol.split(':');
    return {
      host: host || 'localhost',
      port: port || '4455',
      authenticationEnabled: Boolean(settings.passwordConfigured || settings.websocketPassword),
    };
  }
}

function buildObsWebsocketUrl(connection: ObsConnectionFields) {
  const host = connection.host.trim().replace(/^wss?:\/\//i, '').replace(/\/.*$/, '') || 'localhost';
  const port = String(connection.port || '4455').replace(/\D/g, '') || '4455';
  return `ws://${host}:${port}`;
}

const EMPTY_WEBHOOK_DRAFT: WebhookDraft = {
  name: 'Novo webhook',
  url: '',
  method: 'POST',
  headers: {},
  enabled: true,
  timeoutMs: 2500,
  bodyTemplate:
    '{\n  "product": "Odessa",\n  "event": "{event.text}",\n  "action": "{action.type}"\n}',
};

function headersToText(headers: Record<string, string>) {
  return Object.entries(headers || {})
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
}

function parseHeadersText(value: string) {
  return Object.fromEntries(
    value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [key, ...rest] = line.split(':');
        return [key.trim(), rest.join(':').trim()];
      })
      .filter(([key]) => Boolean(key)),
  );
}

function SettingsPanel({
  health,
  onRefreshHealth,
  liveConfig,
  onLiveConfigChange,
  onSaved,
  agentStatus,
  onObsSettingsChanged,
}: {
  health: AutopilotRuntimeState['health'];
  onRefreshHealth: () => Promise<void>;
  liveConfig: LiveConfig;
  onLiveConfigChange?: Dispatch<SetStateAction<LiveConfig>>;
  onSaved: () => void;
  agentStatus?: AgentStatus | null;
  onObsSettingsChanged?: (settings: Record<string, unknown>) => void;
}) {
  const [obsSettings, setObsSettings] = useState<ObsSettings>(DEFAULT_OBS_SETTINGS);
  const [obsConnection, setObsConnection] = useState<ObsConnectionFields>(() =>
    parseObsConnection(DEFAULT_OBS_SETTINGS),
  );
  const [workspace, setWorkspace] = useState<WorkspaceSettings>(() => loadWorkspaceSettings());
  const [passwordInput, setPasswordInput] = useState('');
  const [obsHealth, setObsHealth] = useState<ObsHealthResult | null>(null);
  const [availableScenes, setAvailableScenes] = useState<string[]>([]);
  const [selectedSceneTest, setSelectedSceneTest] = useState('');
  const [webhooks, setWebhooks] = useState<WebhookConfig[]>([]);
  const [webhookDraft, setWebhookDraft] = useState<WebhookDraft>(EMPTY_WEBHOOK_DRAFT);
  const [webhookHeaderText, setWebhookHeaderText] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sceneTesting, setSceneTesting] = useState(false);
  const [webhookSaving, setWebhookSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [webhookMessage, setWebhookMessage] = useState<string | null>(null);
  const [livePlan, setLivePlan] = useState<LivePlan | null>(null);
  const [livePlanLoading, setLivePlanLoading] = useState(false);
  const [livePlanMessage, setLivePlanMessage] = useState<string | null>(null);
  const [obsProfiles, setObsProfiles] = useState<Array<{ id: string; name: string; updatedAt?: string }>>([]);
  const [obsProfileName, setObsProfileName] = useState('');
  const [activeObsProfileId, setActiveObsProfileId] = useState('');

  const loadObsSettings = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch(apiUrl('/obs/settings'));
      const data = (await response.json()) as {
        ok?: boolean;
        settings?: Partial<ObsSettings>;
        error?: string | null;
      };
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
      const normalized = normalizeObsSettings(data.settings);
      setObsSettings(normalized);
      setObsConnection(parseObsConnection(normalized));
      setSelectedSceneTest((current) => current || normalized.allowedScenes[0] || '');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Falha ao carregar configuracoes do OBS');
    } finally {
      setLoading(false);
    }
  }, []);

  // OBS profiles persisted in localStorage (per-device).
  const OBS_PROFILES_KEY = 'odessa:obs-profiles:v1';

  const readObsProfilesFromStorage = () => {
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem(OBS_PROFILES_KEY) : null;
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  };

  const writeObsProfilesToStorage = (list: typeof obsProfiles) => {
    try { if (typeof window !== 'undefined') window.localStorage.setItem(OBS_PROFILES_KEY, JSON.stringify(list)); } catch { /* ignore */ }
  };

  const loadObsProfiles = useCallback(async () => {
    setObsProfiles(readObsProfilesFromStorage());
  }, []);

  const saveObsProfile = async (name: string) => {
    if (!name.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      // Build the snapshot from the LIVE form state (obsConnection holds the
      // host/port the user typed; passwordInput holds a freshly typed password).
      // obsSettings.websocketUrl can be stale until "Salvar OBS" is clicked.
      const snapshot: ObsSettings = {
        ...obsSettings,
        websocketUrl: buildObsWebsocketUrl(obsConnection),
        passwordConfigured: obsConnection.authenticationEnabled,
        websocketPassword: passwordInput.trim() || obsSettings.websocketPassword || '',
      };
      const existing = readObsProfilesFromStorage();
      const existingIdx = existing.findIndex((p) => p.name === name);
      const profile = {
        id: existingIdx >= 0 ? existing[existingIdx].id : `obs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        settings: snapshot,
        createdAt: existingIdx >= 0 ? existing[existingIdx].createdAt : new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const next = existingIdx >= 0 ? existing.map((p, i) => i === existingIdx ? profile : p) : [...existing, profile];
      writeObsProfilesToStorage(next);
      setObsProfiles(next);
      setActiveObsProfileId(profile.id);
      setObsProfileName('');
      const hasPwd = Boolean(snapshot.websocketPassword);
      setMessage(
        snapshot.passwordConfigured && !hasPwd
          ? `Perfil "${name}" salvo. Dica: digite a senha do OBS antes de salvar para guarda-la no perfil.`
          : `Perfil "${name}" salvo (local).`,
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Falha ao salvar perfil');
    } finally {
      setSaving(false);
    }
  };

  const applyObsProfile = async (id: string) => {
    const profile = readObsProfilesFromStorage().find((p) => p.id === id);
    if (!profile?.settings) {
      setMessage('Perfil nao encontrado.');
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      // Only fill the form — never reconnect here. Reconnecting with a profile
      // that has no stored password would drop the OBS connection. The user
      // reviews the form and clicks "Salvar OBS" to apply + reconnect safely.
      const normalized = normalizeObsSettings(profile.settings);
      setObsSettings(normalized);
      setObsConnection(parseObsConnection(normalized));
      setActiveObsProfileId(id);
      const storedPwd = (profile.settings as Partial<ObsSettings>).websocketPassword || '';
      if (storedPwd) setPasswordInput(storedPwd);
      setMessage(
        storedPwd
          ? `Perfil "${profile.name}" carregado. Clique em "Salvar OBS" para conectar.`
          : `Perfil "${profile.name}" carregado. Confira a senha do OBS e clique em "Salvar OBS".`,
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Falha ao aplicar perfil');
    } finally {
      setSaving(false);
    }
  };

  const deleteObsProfile = async (id: string) => {
    try {
      const next = readObsProfilesFromStorage().filter((p) => p.id !== id);
      writeObsProfilesToStorage(next);
      setObsProfiles(next);
      if (activeObsProfileId === id) setActiveObsProfileId('');
    } catch { /* ignore */ }
  };

  const loadWebhooks = useCallback(async () => {
    try {
      const response = await fetch(apiUrl('/webhooks'));
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        webhooks?: WebhookConfig[];
        error?: string | null;
      };
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setWebhooks(Array.isArray(data.webhooks) ? data.webhooks : []);
    } catch (err) {
      setWebhookMessage(err instanceof Error ? err.message : 'Falha ao carregar webhooks');
    }
  }, []);

  const testObs = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const query = new URLSearchParams({
        sourceName: obsSettings.chatSourceName || obsSettings.ocrSourceName,
      });
      const response = await fetch(apiUrl(`/obs/health?${query.toString()}`));
      const data = (await response.json()) as ObsHealthResult;
      setObsHealth(data);
      setAvailableScenes(Array.isArray(data.availableScenes) ? data.availableScenes : []);
      if (Array.isArray(data.allowedScenes)) {
        setObsSettings((current) => ({
          ...current,
          sceneWhitelist: data.allowedScenes || current.sceneWhitelist,
          allowedScenes: data.allowedScenes || current.allowedScenes,
        }));
      }
      if (!response.ok || !data.ok) {
        setMessage(data.error || 'OBS/source ainda nao esta pronto para iniciar a live');
        return;
      }
      setMessage('OBS pronto para captura OCR persistente.');
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Falha ao testar OBS';
      setObsHealth({ ok: false, connected: false, sourceReady: false, screenshotReady: false, error });
      setMessage(error);
    } finally {
      setLoading(false);
    }
  }, [obsSettings.chatSourceName, obsSettings.ocrSourceName]);

  const loadLivePlan = useCallback(async () => {
    setLivePlanLoading(true);
    setLivePlanMessage(null);
    try {
      const query = new URLSearchParams({
        voiceEnabled: String(!!liveConfig.voiceEnabled),
        enableChat: String(!!liveConfig.enableChat),
        prepareObs: String(liveConfig.prepareObs !== false),
        showStage: String(liveConfig.showStage !== false),
        startAutomation: String(liveConfig.startAutomation !== false),
        startCapture: String(!!liveConfig.startCapture),
        startTransmission: String(!!liveConfig.startTransmission),
        actionMode: liveConfig.actionMode || 'simulated',
      });
      const response = await fetch(apiUrl(`/obs/live-plan?${query.toString()}`));
      const data = (await response.json().catch(() => ({}))) as LivePlan;
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setLivePlan(data);
    } catch (err) {
      setLivePlanMessage(err instanceof Error ? err.message : 'Falha ao carregar plano da live');
    } finally {
      setLivePlanLoading(false);
    }
  }, [liveConfig]);

  const simulateLiveStart = async () => {
    setLivePlanLoading(true);
    setLivePlanMessage(null);
    try {
      const response = await fetch(apiUrl('/obs/start-live/dry-run'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(liveConfig),
      });
      const data = (await response.json().catch(() => ({}))) as LivePlan;
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setLivePlan(data);
      setLivePlanMessage('Simulacao concluida sem afetar OBS, chat, TTS ou transmissao.');
    } catch (err) {
      setLivePlanMessage(err instanceof Error ? err.message : 'Falha ao simular Iniciar Live');
    } finally {
      setLivePlanLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadObsSettings();
      void loadObsProfiles();
      void loadWebhooks();
      void loadLivePlan();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadLivePlan, loadObsSettings, loadWebhooks]);

  useEffect(() => {
    window.localStorage.setItem(WORKSPACE_SETTINGS_KEY, JSON.stringify(workspace));
  }, [workspace]);

  const saveObsSettings = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const payload: Partial<ObsSettings> = {
        enabled: obsSettings.enabled,
        websocketUrl: buildObsWebsocketUrl(obsConnection),
        ocrSourceName: obsSettings.chatSourceName || obsSettings.ocrSourceName,
        chatSourceName: obsSettings.chatSourceName || obsSettings.ocrSourceName,
        stageSourceName: obsSettings.stageSourceName,
        stageUrl: obsSettings.stageUrl,
        startupSceneName: obsSettings.startupSceneName,
        liveSceneName: obsSettings.liveSceneName,
        transmissionMode: obsSettings.transmissionMode,
        canvasWidth: obsSettings.canvasWidth,
        canvasHeight: obsSettings.canvasHeight,
        sceneWhitelist: obsSettings.allowedScenes,
        allowedScenes: obsSettings.allowedScenes,
      };
      if (obsConnection.authenticationEnabled && passwordInput.trim()) {
        payload.websocketPassword = passwordInput;
      }
      if (!obsConnection.authenticationEnabled) {
        payload.websocketPassword = '';
      }
      const response = await fetch(apiUrl('/obs/settings'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        settings?: Partial<ObsSettings>;
        error?: string | null;
      };
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
      const normalized = normalizeObsSettings(data.settings);
      setObsSettings(normalized);
      setObsConnection(parseObsConnection(normalized));
      setSelectedSceneTest((current) => current || normalized.allowedScenes[0] || '');
      setPasswordInput('');
      setMessage('Configuracoes do OBS salvas.');
      onSaved();
      if (onObsSettingsChanged) {
        onObsSettingsChanged(payload as Record<string, unknown>);
      }
      void onRefreshHealth();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Falha ao salvar configuracoes');
    } finally {
      setSaving(false);
    }
  };

  const updateWorkspace = (patch: Partial<WorkspaceSettings>) => {
    setWorkspace((current) => ({ ...current, ...patch }));
  };

  const syncObsScenes = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch(apiUrl('/obs/scenes'));
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        scenes?: string[];
        currentScene?: string | null;
        allowedScenes?: string[];
        error?: string | null;
      };
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
      const scenes = Array.isArray(data.scenes) ? data.scenes : [];
      setAvailableScenes(scenes);
      setObsHealth((current) => ({
        ...(current || {}),
        connected: true,
        availableScenes: scenes,
        allowedScenes: data.allowedScenes || obsSettings.allowedScenes,
        currentScene: data.currentScene || current?.currentScene || null,
        sceneSwitchReady: Boolean((data.allowedScenes || obsSettings.allowedScenes).length),
      }));
      setMessage(`Cenas sincronizadas: ${scenes.length}. Marque as cenas que as automacoes podem usar.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Falha ao sincronizar cenas do OBS');
    } finally {
      setLoading(false);
    }
  };

  const toggleAllowedScene = (scene: string) => {
    setObsSettings((current) => {
      const exists = current.allowedScenes.some((item) => item.toLowerCase() === scene.toLowerCase());
      const next = exists
        ? current.allowedScenes.filter((item) => item.toLowerCase() !== scene.toLowerCase())
        : [...current.allowedScenes, scene];
      return { ...current, sceneWhitelist: next, allowedScenes: next };
    });
    setSelectedSceneTest((current) => current || scene);
  };

  const testSceneSwitch = async () => {
    const sceneName = selectedSceneTest || obsSettings.allowedScenes[0] || '';
    if (!sceneName) {
      setMessage('Selecione uma cena permitida para testar a troca.');
      return;
    }
    setSceneTesting(true);
    setMessage(null);
    try {
      const response = await fetch(apiUrl('/obs/switch-scene'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sceneName }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        currentScene?: string;
        sceneName?: string;
        scene?: string;
        error?: string;
      };
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setMessage(`Cena alterada no OBS: ${data.currentScene || data.sceneName || data.scene || sceneName}`);
      void testObs();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Falha ao trocar cena no OBS');
    } finally {
      setSceneTesting(false);
    }
  };

  const saveWebhook = async () => {
    setWebhookSaving(true);
    setWebhookMessage(null);
    try {
      const payload = {
        ...webhookDraft,
        headers: parseHeadersText(webhookHeaderText),
      };
      const response = await fetch(apiUrl('/webhooks'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        webhook?: WebhookConfig;
        webhooks?: WebhookConfig[];
        error?: string | null;
      };
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setWebhooks(Array.isArray(data.webhooks) ? data.webhooks : []);
      setWebhookDraft({ ...payload, id: data.webhook?.id || payload.id });
      setWebhookMessage('Webhook salvo.');
    } catch (err) {
      setWebhookMessage(err instanceof Error ? err.message : 'Falha ao salvar webhook');
    } finally {
      setWebhookSaving(false);
    }
  };

  const editWebhook = (webhook: WebhookConfig) => {
    setWebhookDraft(webhook);
    setWebhookHeaderText(headersToText(webhook.headers));
    setWebhookMessage(null);
  };

  const deleteWebhook = async (webhookId: string) => {
    setWebhookSaving(true);
    setWebhookMessage(null);
    try {
      const response = await fetch(apiUrl(`/webhooks/${encodeURIComponent(webhookId)}`), {
        method: 'DELETE',
      });
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        webhooks?: WebhookConfig[];
        error?: string | null;
      };
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setWebhooks(Array.isArray(data.webhooks) ? data.webhooks : []);
      if (webhookDraft.id === webhookId) {
        setWebhookDraft(EMPTY_WEBHOOK_DRAFT);
        setWebhookHeaderText('');
      }
      setWebhookMessage('Webhook removido.');
    } catch (err) {
      setWebhookMessage(err instanceof Error ? err.message : 'Falha ao remover webhook');
    } finally {
      setWebhookSaving(false);
    }
  };

  const testWebhook = async (webhookId: string) => {
    setWebhookSaving(true);
    setWebhookMessage(null);
    try {
      const response = await fetch(apiUrl(`/webhooks/${encodeURIComponent(webhookId)}/test`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: { text: 'Teste manual do Centro de Acoes', kind: 'test' },
          action: { type: 'webhook', capability: 'webhook.call', payload: { webhookId } },
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        statusCode?: number;
        error?: string | null;
      };
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setWebhookMessage(`Webhook executado: HTTP ${data.statusCode || 'ok'}.`);
    } catch (err) {
      setWebhookMessage(err instanceof Error ? err.message : 'Falha ao testar webhook');
    } finally {
      setWebhookSaving(false);
    }
  };

  const obsReady =
    !!obsHealth?.ok && !!obsHealth.connected && !!obsHealth.sourceReady && !!obsHealth.screenshotReady;
  const sceneSwitchReady = !!obsHealth?.connected && !!obsHealth.sceneSwitchReady;
  const apiRows = [
    { label: 'Gemini', ok: !!health?.gemini_configured },
    { label: 'OpenAI texto', ok: !!health?.openai_ai_configured },
    { label: 'OpenAI TTS', ok: !!health?.openai_tts_configured },
    { label: 'Kokoro TTS', ok: !!health?.kokoro_tts_configured },
  ];

  return (
    <PageSurface
      icon={<Settings className="h-4 w-4" />}
      title="Configuracoes"
      description="OBS WebSocket, fontes persistentes, consumo de APIs, automacoes e diagnosticos ficam centralizados aqui."
    >
      <div className="h-full overflow-y-auto p-4">
        <div className="grid gap-4 xl:grid-cols-[minmax(560px,1fr)_360px]">
          <section className="space-y-4">
            <div className="rounded-[28px] border border-white/10 bg-[#101114] p-4">
              <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <SectionTitle icon={<Settings />} title="OBS WebSocket" />
                  <p className="mt-2 text-sm text-slate-400">
                    A live assistida usa uma source dedicada do OBS para OCR, sem depender da aba ativa.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusDot status={obsReady ? 'online' : obsHealth ? 'error' : 'idle'} />
                  <Badge variant={obsReady ? 'success' : obsHealth ? 'danger' : 'default'}>
                    {obsReady ? 'pronto' : obsHealth ? 'pendente' : 'nao testado'}
                  </Badge>
                </div>
              </div>

              <div className="mb-4 flex items-center gap-2">
                {obsProfiles.length > 0 ? (
                  <>
                    <select
                      className="h-9 cursor-pointer rounded-xl border border-white/10 bg-white/[0.06] px-3 pr-7 text-sm text-white outline-none focus:border-sky-400/40"
                      value={activeObsProfileId}
                      onChange={(e) => { if (e.target.value) void applyObsProfile(e.target.value); else setActiveObsProfileId(''); }}
                    >
                      <option value="">Selecionar perfil...</option>
                      {obsProfiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    {activeObsProfileId && (
                      <button
                        onClick={() => void deleteObsProfile(activeObsProfileId)}
                        className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-red-500/15 hover:text-red-400"
                        title="Excluir perfil"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                    <div className="mx-1 h-5 w-px bg-white/10" />
                  </>
                ) : (
                  <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">Perfis</span>
                )}
                <Input
                  value={obsProfileName}
                  onChange={(e) => setObsProfileName(e.target.value)}
                  placeholder="Novo perfil..."
                  className="max-w-[200px]"
                  onKeyDown={(e) => { if (e.key === 'Enter') void saveObsProfile(obsProfileName); }}
                />
                <Button size="sm" variant="secondary" disabled={!obsProfileName.trim() || saving} onClick={() => void saveObsProfile(obsProfileName)}>
                  <Save className="h-4 w-4" />
                </Button>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="flex h-10 items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.045] px-3 text-sm text-slate-200">
                  <span>Exigir OBS WebSocket na live</span>
                  <input
                    type="checkbox"
                    checked={obsSettings.enabled}
                    onChange={(event) =>
                      setObsSettings((current) => ({ ...current, enabled: event.target.checked }))
                    }
                  />
                </label>
                <label className="flex h-10 items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.045] px-3 text-sm text-slate-200">
                  <span>Habilitar autenticacao</span>
                  <input
                    type="checkbox"
                    checked={obsConnection.authenticationEnabled}
                    onChange={(event) =>
                      setObsConnection((current) => ({
                        ...current,
                        authenticationEnabled: event.target.checked,
                      }))
                    }
                  />
                </label>
                <Input
                  label="Host do servidor"
                  value={obsConnection.host}
                  placeholder="localhost"
                  onChange={(event) =>
                    setObsConnection((current) => ({ ...current, host: event.target.value }))
                  }
                />
                <Input
                  label="Porta do servidor"
                  type="number"
                  min="1"
                  max="65535"
                  value={obsConnection.port}
                  placeholder="4455"
                  onChange={(event) =>
                    setObsConnection((current) => ({ ...current, port: event.target.value }))
                  }
                />
                <Input
                  label="Source do chat/OCR"
                  value={obsSettings.chatSourceName}
                  onChange={(event) =>
                    setObsSettings((current) => ({
                      ...current,
                      chatSourceName: event.target.value,
                      ocrSourceName: event.target.value,
                    }))
                  }
                />
                <Input
                  label="Senha do servidor"
                  type="password"
                  value={passwordInput}
                  disabled={!obsConnection.authenticationEnabled}
                  placeholder={
                    !obsConnection.authenticationEnabled
                      ? 'Autenticacao desativada'
                      : obsSettings.passwordConfigured
                        ? 'Senha configurada - deixe vazio para manter'
                        : 'Senha do OBS WebSocket'
                  }
                  onChange={(event) => setPasswordInput(event.target.value)}
                />
                <Input
                  label="Source do palco"
                  value={obsSettings.stageSourceName}
                  onChange={(event) =>
                    setObsSettings((current) => ({ ...current, stageSourceName: event.target.value }))
                  }
                />
                <Input
                  label="URL do palco"
                  value={obsSettings.stageUrl}
                  onChange={(event) =>
                    setObsSettings((current) => ({ ...current, stageUrl: event.target.value }))
                  }
                />
                <Input
                  label="Cena inicial"
                  value={obsSettings.startupSceneName}
                  onChange={(event) =>
                    setObsSettings((current) => ({ ...current, startupSceneName: event.target.value }))
                  }
                />
                <Input
                  label="Cena ao vivo"
                  value={obsSettings.liveSceneName}
                  onChange={(event) =>
                    setObsSettings((current) => ({ ...current, liveSceneName: event.target.value }))
                  }
                />
                <Input
                  label="Largura palco"
                  type="number"
                  min="1"
                  value={obsSettings.canvasWidth}
                  onChange={(event) =>
                    setObsSettings((current) => ({
                      ...current,
                      canvasWidth: Math.max(1, Number(event.target.value) || current.canvasWidth),
                    }))
                  }
                />
                <Input
                  label="Altura palco"
                  type="number"
                  min="1"
                  value={obsSettings.canvasHeight}
                  onChange={(event) =>
                    setObsSettings((current) => ({
                      ...current,
                      canvasHeight: Math.max(1, Number(event.target.value) || current.canvasHeight),
                    }))
                  }
                />
              </div>

              <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto] md:items-center">
                <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-2 text-xs text-slate-400">
                  URL gerada:{' '}
                  <span className="font-mono font-semibold text-slate-200">
                    {buildObsWebsocketUrl(obsConnection)}
                  </span>
                </div>
                <Badge variant={obsConnection.authenticationEnabled ? 'gold' : 'default'}>
                  {obsConnection.authenticationEnabled ? 'auth ligada' : 'sem auth'}
                </Badge>
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
                <label className="block">
                  <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-[var(--t3)]">
                    Transmissao
                  </span>
                  <select
                    value={obsSettings.transmissionMode}
                    onChange={(event) =>
                      setObsSettings((current) => ({
                        ...current,
                        transmissionMode: event.target.value as ObsSettings['transmissionMode'],
                      }))
                    }
                    className="h-10 w-full rounded-2xl border border-[var(--border2)] bg-[var(--bg3)] px-3 text-sm text-[var(--t1)] outline-none focus:border-[var(--gold)]"
                  >
                    <option value="stream">OBS Stream</option>
                    <option value="virtual_camera">Camera virtual</option>
                    <option value="none">Nao iniciar automaticamente</option>
                  </select>
                </label>
                <Button
                  variant="secondary"
                  loading={loading}
                  onClick={async () => {
                    setLoading(true);
                    setMessage(null);
                    try {
                      const response = await fetch(apiUrl('/obs/setup-live-scene'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          chatSourceName: obsSettings.chatSourceName,
                          stageSourceName: obsSettings.stageSourceName,
                          stageUrl: obsSettings.stageUrl,
                          startupSceneName: obsSettings.startupSceneName,
                          liveSceneName: obsSettings.liveSceneName,
                          transmissionMode: obsSettings.transmissionMode,
                          canvasWidth: obsSettings.canvasWidth,
                          canvasHeight: obsSettings.canvasHeight,
                        }),
                      });
                      const data = (await response.json().catch(() => ({}))) as {
                        ok?: boolean;
                        layout?: Partial<ObsSettings>;
                        allowedScenes?: string[];
                        error?: string | null;
                      };
                      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
                      if (data.layout) setObsSettings((current) => normalizeObsSettings({ ...current, ...data.layout }));
                      if (Array.isArray(data.allowedScenes)) {
                        setObsSettings((current) => ({
                          ...current,
                          allowedScenes: data.allowedScenes || current.allowedScenes,
                          sceneWhitelist: data.allowedScenes || current.sceneWhitelist,
                        }));
                      }
                      setMessage('Mesa OBS preparada: cenas, palco e chat foram sincronizados.');
                      void testObs();
                    } catch (err) {
                      setMessage(err instanceof Error ? err.message : 'Falha ao preparar Mesa OBS');
                    } finally {
                      setLoading(false);
                    }
                  }}
                >
                  <RadioTower className="h-4 w-4" />
                  Preparar mesa OBS
                </Button>
              </div>

              <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-3">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-widest text-[var(--t3)]">
                      Cenas permitidas para automacoes
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                      Sincronize do OBS e marque apenas as cenas que podem ser acionadas por gatilhos.
                    </div>
                  </div>
                  <Button variant="secondary" loading={loading} onClick={() => void syncObsScenes()}>
                    <RefreshCw className="h-4 w-4" />
                    Sincronizar cenas
                  </Button>
                </div>

                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {availableScenes.length ? (
                    availableScenes.map((scene) => {
                      const allowed = obsSettings.allowedScenes.some(
                        (item) => item.toLowerCase() === scene.toLowerCase(),
                      );
                      return (
                        <label
                          key={scene}
                          className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.045] px-3 py-2 text-sm text-slate-200"
                        >
                          <span className="truncate">{scene}</span>
                          <input
                            type="checkbox"
                            checked={allowed}
                            onChange={() => toggleAllowedScene(scene)}
                          />
                        </label>
                      );
                    })
                  ) : (
                    <div className="rounded-2xl border border-dashed border-white/10 px-3 py-4 text-sm text-slate-500 md:col-span-2">
                      Nenhuma cena sincronizada ainda. Use o botao acima com o OBS aberto.
                    </div>
                  )}
                </div>

                <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto]">
                  <select
                    value={selectedSceneTest}
                    onChange={(event) => setSelectedSceneTest(event.target.value)}
                    className="h-10 rounded-2xl border border-[var(--border2)] bg-[var(--bg3)] px-3 text-sm text-[var(--t1)] outline-none focus:border-[var(--gold)]"
                  >
                    <option value="">Selecionar cena para teste</option>
                    {obsSettings.allowedScenes.map((scene) => (
                      <option key={scene} value={scene}>
                        {scene}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="secondary"
                    loading={sceneTesting}
                    onClick={() => void testSceneSwitch()}
                  >
                    <RadioTower className="h-4 w-4" />
                    Testar troca
                  </Button>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="primary" loading={saving} onClick={() => void saveObsSettings()}>
                  <CheckCircle2 className="h-4 w-4" />
                  Salvar OBS
                </Button>
                <Button variant="secondary" loading={loading} onClick={() => void testObs()}>
                  <RefreshCw className="h-4 w-4" />
                  Testar source
                </Button>
                <Button variant="secondary" loading={loading} onClick={() => void loadObsSettings()}>
                  <RefreshCw className="h-4 w-4" />
                  Recarregar
                </Button>
              </div>

              {message && (
                <div
                  className={cn(
                    'mt-4 rounded-2xl border px-3 py-2 text-sm',
                    obsReady
                      ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200'
                      : 'border-amber-400/25 bg-amber-500/10 text-amber-100',
                  )}
                >
                  {message}
                </div>
              )}
            </div>

            <div className="rounded-[28px] border border-white/10 bg-[#101114] p-4">
              <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <SectionTitle icon={<ClipboardCheck />} title="Configuracao do Iniciar Live" />
                  <p className="mt-2 text-sm text-slate-400">
                    O botao do topo executa este plano. Use a simulacao para conferir tudo sem afetar a live.
                  </p>
                </div>
                <Badge variant={liveConfig.actionMode === 'real' ? 'danger' : 'success'}>
                  {liveConfig.actionMode === 'real' ? 'acoes reais' : 'seguro por padrao'}
                </Badge>
              </div>

              <div className="grid gap-2 md:grid-cols-2">
                {[
                  ['prepareObs', 'Verificar/preparar OBS'],
                  ['showStage', 'Colocar palco na cena live'],
                  ['startAutomation', 'Iniciar automacao do fluxo'],
                  ['startCapture', 'Disparar captura do chat'],
                  ['voiceEnabled', 'Habilitar Voz IA / TTS'],
                  ['enableChat', 'Habilitar resposta no chat'],
                  ['startTransmission', 'Iniciar transmissao/camera'],
                ].map(([key, label]) => (
                  <label
                    key={key}
                    className="flex h-10 items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.045] px-3 text-sm text-slate-200"
                  >
                    <span>{label}</span>
                    <input
                      type="checkbox"
                      checked={
                        key === 'prepareObs' || key === 'showStage' || key === 'startAutomation'
                          ? liveConfig[key as keyof LiveConfig] !== false
                          : !!liveConfig[key as keyof LiveConfig]
                      }
                      onChange={(event) =>
                        onLiveConfigChange?.((current) => ({
                          ...current,
                          [key]: event.target.checked,
                        }))
                      }
                    />
                  </label>
                ))}
                <label className="block">
                  <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-[var(--t3)]">
                    Modo das acoes
                  </span>
                  <select
                    value={liveConfig.actionMode || 'simulated'}
                    onChange={(event) =>
                      onLiveConfigChange?.((current) => ({
                        ...current,
                        actionMode: event.target.value as LiveConfig['actionMode'],
                      }))
                    }
                    className="h-10 w-full rounded-2xl border border-[var(--border2)] bg-[var(--bg3)] px-3 text-sm text-[var(--t1)] outline-none focus:border-[var(--gold)]"
                  >
                    <option value="simulated">Simulado por padrao</option>
                    <option value="approval_required">Exigir aprovacao</option>
                    <option value="real">Real ao clicar</option>
                  </select>
                </label>
              </div>

              <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                  <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                    Plano ativo
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    {(livePlan?.steps || []).map((step) => (
                      <div
                        key={step.id}
                        className={cn(
                          'rounded-xl border px-3 py-2 text-xs',
                          step.enabled
                            ? step.status === 'blocked'
                              ? 'border-rose-400/25 bg-rose-500/10 text-rose-200'
                              : 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200'
                            : 'border-white/10 bg-white/[0.035] text-slate-500',
                        )}
                      >
                        <div className="font-semibold">{step.label}</div>
                        <div className="mt-0.5 text-[10px] uppercase tracking-widest opacity-70">
                          {step.enabled ? step.mode : 'desativado'}
                        </div>
                      </div>
                    ))}
                    {!livePlan?.steps?.length && (
                      <div className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-sm text-slate-500 md:col-span-2">
                        Carregue o plano para ver a ordem exata das acoes.
                      </div>
                    )}
                  </div>
                  {!!livePlan?.risks?.length && (
                    <div className="mt-3 rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                      {livePlan.risks.join(' | ')}
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <Button variant="secondary" loading={livePlanLoading} onClick={() => void loadLivePlan()}>
                    <RefreshCw className="h-4 w-4" />
                    Atualizar plano
                  </Button>
                  <Button variant="success" loading={livePlanLoading} onClick={() => void simulateLiveStart()}>
                    <ShieldAlert className="h-4 w-4" />
                    Simular Iniciar Live
                  </Button>
                </div>
              </div>

              {livePlanMessage && (
                <div className="mt-3 rounded-2xl border border-emerald-400/25 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
                  {livePlanMessage}
                </div>
              )}
            </div>

            <div className="rounded-[28px] border border-white/10 bg-[#101114] p-4">
              <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <SectionTitle icon={<Link2 />} title="Webhooks" />
                  <p className="mt-2 text-sm text-slate-400">
                    Cadastre endpoints genericos para gatilhos. n8n entra aqui como um webhook comum.
                  </p>
                </div>
                <Badge variant={webhooks.length ? 'success' : 'default'}>
                  {webhooks.length ? `${webhooks.length} configurado(s)` : 'sem webhooks'}
                </Badge>
              </div>

              <div className="grid gap-4 lg:grid-cols-[minmax(280px,360px)_1fr]">
                <div className="space-y-2">
                  {webhooks.length ? (
                    webhooks.map((webhook) => (
                      <div
                        key={webhook.id}
                        className="rounded-2xl border border-white/10 bg-white/[0.045] p-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <button
                            className="min-w-0 text-left"
                            onClick={() => editWebhook(webhook)}
                          >
                            <div className="truncate text-sm font-semibold text-white">
                              {webhook.name}
                            </div>
                            <div className="mt-1 truncate text-xs text-slate-500">
                              {webhook.id}
                            </div>
                          </button>
                          <Badge variant={webhook.enabled ? 'success' : 'warning'}>
                            {webhook.enabled ? 'ativo' : 'pausado'}
                          </Badge>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            loading={webhookSaving}
                            onClick={() => void testWebhook(webhook.id)}
                          >
                            Testar
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            loading={webhookSaving}
                            onClick={() => void deleteWebhook(webhook.id)}
                          >
                            Remover
                          </Button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed border-white/10 px-3 py-4 text-sm text-slate-500">
                      Nenhum webhook salvo.
                    </div>
                  )}
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <Input
                    label="Nome"
                    value={webhookDraft.name}
                    onChange={(event) =>
                      setWebhookDraft((current) => ({ ...current, name: event.target.value }))
                    }
                  />
                  <label className="block">
                    <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-[var(--t3)]">
                      Metodo
                    </span>
                    <select
                      value={webhookDraft.method}
                      onChange={(event) =>
                        setWebhookDraft((current) => ({ ...current, method: event.target.value }))
                      }
                      className="h-10 w-full rounded-2xl border border-[var(--border2)] bg-[var(--bg3)] px-3 text-sm text-[var(--t1)] outline-none focus:border-[var(--gold)]"
                    >
                      <option value="POST">POST</option>
                      <option value="PUT">PUT</option>
                      <option value="PATCH">PATCH</option>
                    </select>
                  </label>
                  <Input
                    label="URL"
                    value={webhookDraft.url}
                    placeholder="https://..."
                    className="md:col-span-2"
                    onChange={(event) =>
                      setWebhookDraft((current) => ({ ...current, url: event.target.value }))
                    }
                  />
                  <Input
                    label="Timeout ms"
                    type="number"
                    min="500"
                    max="15000"
                    value={webhookDraft.timeoutMs}
                    onChange={(event) =>
                      setWebhookDraft((current) => ({
                        ...current,
                        timeoutMs: Number(event.target.value) || 2500,
                      }))
                    }
                  />
                  <label className="flex h-10 items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.045] px-3 text-sm text-slate-200">
                    <span>Ativo</span>
                    <input
                      type="checkbox"
                      checked={webhookDraft.enabled}
                      onChange={(event) =>
                        setWebhookDraft((current) => ({
                          ...current,
                          enabled: event.target.checked,
                        }))
                      }
                    />
                  </label>
                  <label className="block md:col-span-2">
                    <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-[var(--t3)]">
                      Headers
                    </span>
                    <textarea
                      value={webhookHeaderText}
                      onChange={(event) => setWebhookHeaderText(event.target.value)}
                      className="min-h-20 w-full resize-y rounded-2xl border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-sm text-[var(--t1)] outline-none focus:border-[var(--gold)]"
                      placeholder="Authorization: Bearer ..."
                    />
                  </label>
                  <label className="block md:col-span-2">
                    <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-[var(--t3)]">
                      Body template
                    </span>
                    <textarea
                      value={webhookDraft.bodyTemplate}
                      onChange={(event) =>
                        setWebhookDraft((current) => ({
                          ...current,
                          bodyTemplate: event.target.value,
                        }))
                      }
                      className="min-h-28 w-full resize-y rounded-2xl border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 font-mono text-xs text-[var(--t1)] outline-none focus:border-[var(--gold)]"
                    />
                  </label>
                  <div className="flex flex-wrap gap-2 md:col-span-2">
                    <Button variant="primary" loading={webhookSaving} onClick={() => void saveWebhook()}>
                      <CheckCircle2 className="h-4 w-4" />
                      Salvar webhook
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setWebhookDraft(EMPTY_WEBHOOK_DRAFT);
                        setWebhookHeaderText('');
                        setWebhookMessage(null);
                      }}
                    >
                      Novo
                    </Button>
                  </div>
                  {webhookMessage && (
                    <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-slate-300 md:col-span-2">
                      {webhookMessage}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-[28px] border border-white/10 bg-[#101114] p-4">
                <SectionTitle icon={<Database />} title="Consumo de APIs" />
                <div className="mt-4 grid gap-3">
                  <label className="block">
                    <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-[var(--t3)]">
                      Perfil de custo
                    </span>
                    <select
                      value={workspace.apiBudgetMode}
                      onChange={(event) =>
                        updateWorkspace({
                          apiBudgetMode: event.target.value as WorkspaceSettings['apiBudgetMode'],
                        })
                      }
                      className="h-10 w-full rounded-2xl border border-[var(--border2)] bg-[var(--bg3)] px-3 text-sm text-[var(--t1)] outline-none focus:border-[var(--gold)]"
                    >
                      <option value="economico">Economico</option>
                      <option value="normal">Normal</option>
                      <option value="agressivo">Agressivo</option>
                    </select>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {apiRows.map((row) => (
                      <div
                        key={row.label}
                        className="flex items-center justify-between gap-2 rounded-2xl border border-white/10 bg-white/[0.045] px-3 py-2 text-sm"
                      >
                        <span className="truncate text-slate-300">{row.label}</span>
                        <StatusDot status={row.ok ? 'online' : 'idle'} />
                      </div>
                    ))}
                  </div>
                  <Button variant="secondary" onClick={() => void onRefreshHealth()}>
                    <RefreshCw className="h-4 w-4" />
                    Atualizar health
                  </Button>
                </div>
              </div>

              <div className="rounded-[28px] border border-white/10 bg-[#101114] p-4">
                <SectionTitle icon={<RadioTower />} title="Automacoes" />
                <div className="mt-4 grid gap-3">
                  <label className="block">
                    <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-[var(--t3)]">
                      Modo operacional
                    </span>
                    <select
                      value={workspace.automationMode}
                      onChange={(event) =>
                        updateWorkspace({
                          automationMode: event.target.value as WorkspaceSettings['automationMode'],
                        })
                      }
                      className="h-10 w-full rounded-2xl border border-[var(--border2)] bg-[var(--bg3)] px-3 text-sm text-[var(--t1)] outline-none focus:border-[var(--gold)]"
                    >
                      <option value="manual">Manual</option>
                      <option value="assistido">Assistido</option>
                      <option value="automatico">Automatico</option>
                    </select>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <Metric label="Regras" value={health ? 'online' : 'aguardando'} />
                    <Metric label="Cenas permitidas" value={obsSettings.allowedScenes.length} />
                  </div>
                </div>
              </div>
            </div>
          </section>

          <aside className="space-y-4">
            <div className="rounded-[28px] border border-white/10 bg-[#101114] p-4">
              <SectionTitle icon={<ShieldAlert />} title="Relatorio de erros" />
              <div className="mt-4 space-y-3">
                <label className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.045] px-3 py-3 text-sm text-slate-200">
                  <span>Salvar diagnosticos locais</span>
                  <input
                    type="checkbox"
                    checked={workspace.errorReports}
                    onChange={(event) => updateWorkspace({ errorReports: event.target.checked })}
                  />
                </label>
                <label className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.045] px-3 py-3 text-sm text-slate-200">
                  <span>Telemetria de uso</span>
                  <input
                    type="checkbox"
                    checked={workspace.telemetry}
                    onChange={(event) => updateWorkspace({ telemetry: event.target.checked })}
                  />
                </label>
                <div className="rounded-2xl border border-white/10 bg-black/25 p-3 text-xs leading-5 text-slate-400">
                  Estas preferencias ficam locais por enquanto. A estrutura ja deixa o painel pronto para
                  plugar provedores de erro, custos de API e novas automacoes.
                </div>
              </div>
            </div>


            <div className="rounded-[28px] border border-white/10 bg-[#101114] p-4">
              <SectionTitle icon={<ListVideo />} title="Diagnostico OBS" />
              <div className="mt-4 space-y-2 text-sm">
                <FlowDatum label="Conectado" value={obsHealth?.connected ? 'sim' : 'nao'} />
                <FlowDatum label="Source pronta" value={obsHealth?.sourceReady ? 'sim' : 'nao'} />
                <FlowDatum label="Screenshot" value={obsHealth?.screenshotReady ? 'sim' : 'nao'} />
                <FlowDatum label="Troca de cena" value={sceneSwitchReady ? 'sim' : 'nao'} />
                <FlowDatum
                  label="Cenas OBS"
                  value={String(availableScenes.length || obsHealth?.availableScenes?.length || 0)}
                />
                <FlowDatum label="Cenas permitidas" value={String(obsSettings.allowedScenes.length)} />
                <FlowDatum
                  label="Resolucao"
                  value={
                    obsHealth?.imageWidth && obsHealth?.imageHeight
                      ? `${obsHealth.imageWidth}x${obsHealth.imageHeight}`
                      : '-'
                  }
                />
                <FlowDatum label="Cena atual" value={obsHealth?.currentScene || '-'} />
                <FlowDatum label="Erro" value={obsHealth?.error || '-'} />
              </div>
            </div>
          </aside>
        </div>
      </div>
    </PageSurface>
  );
}

function ReactiveFlowLogLab({
  capturedText,
  logs,
  latestRun,
  error,
  busy,
  videoState,
  onRefreshLogs,
  onRun,
}: {
  capturedText: CapturedMessage[];
  logs: AutomationLogEntry[];
  latestRun: ReactiveRunResult | null;
  error: string | null;
  busy: boolean;
  videoState: VideoState | null;
  onRefreshLogs: () => Promise<void>;
  onRun: (text: string, source?: string) => Promise<ReactiveRunResult | null>;
}) {
  const [text, setText] = useState('Lucas enviou Rosa');
  const parsedEvent = latestRun?.test.events?.[0];
  const matched = latestRun?.test.matchedTriggers || [];
  const queued = latestRun?.test.queuedActions || [];
  const executed = latestRun?.executions.filter((item) => item.status !== 'empty') || [];
  const quickInputs = [
    'Lucas enviou Rosa',
    '@Viewer: oi',
    '@AnaStarlight: Boa! Mandou muito bem',
    'xXSpamXx: COMPRE SEGUIDORES BARATO www.fake.com',
  ];

  const submit = (nextText = text) => {
    setText(nextText);
    void onRun(nextText, 'test');
  };

  return (
    <div className="grid min-h-full gap-4 p-4 xl:grid-cols-[minmax(520px,1fr)_360px]">
      <section className="flex min-h-0 flex-col gap-4">
        <div className="rounded-[28px] border border-white/10 bg-[#101114] p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.26em] text-sky-200/70">
                Laboratorio do fluxo
              </div>
              <div className="mt-1 text-sm text-slate-400">
                O texto entra no backend e drena a fila ate o video mudar.
              </div>
            </div>
            <Button variant="secondary" onClick={() => void onRefreshLogs()}>
              <RefreshCw className="h-4 w-4" />
              Atualizar
            </Button>
          </div>

          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="min-h-28 w-full resize-none rounded-2xl border border-white/10 bg-black/30 p-3 text-sm text-white outline-none focus:border-sky-200/45"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" loading={busy} onClick={() => submit()}>
              <Play className="h-4 w-4" />
              Testar fluxo
            </Button>
            {quickInputs.map((sample) => (
              <Button key={sample} variant="secondary" onClick={() => submit(sample)}>
                {sample.length > 24 ? `${sample.slice(0, 24)}...` : sample}
              </Button>
            ))}
          </div>
          {error && (
            <div className="mt-3 rounded-2xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">
              {error}
            </div>
          )}
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <Metric label="Evento" value={textValue(parsedEvent?.kind)} />
          <Metric label="Gatilhos" value={matched.length} />
          <Metric label="Fila" value={queued.length} />
          <Metric label="Execucoes" value={executed.length} />
        </div>

        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
          <div className="min-h-[260px] overflow-y-auto rounded-[28px] border border-white/10 bg-[#101114] p-4">
            <SectionTitle icon={<RadioTower />} title="Ultimo teste" />
            <div className="mt-4 space-y-3 text-sm">
              <FlowDatum label="Entrada" value={latestRun?.input || 'aguardando teste'} />
              <FlowDatum label="Tipo parseado" value={textValue(parsedEvent?.kind)} />
              <FlowDatum label="Gift key" value={textValue(parsedEvent?.gift_key)} />
              <FlowDatum label="Mensagem" value={textValue(parsedEvent?.message || parsedEvent?.text)} />
              <FlowDatum label="Gatilho" value={textValue(matched[0]?.name || matched[0]?.id)} />
              <FlowDatum label="Video enfileirado" value={textValue(queued[0]?.videoId)} />
              <FlowDatum
                label="Video atual"
                value={textValue(videoState?.current_video_id || latestRun?.executions[0]?.videoState?.current_video_id)}
              />
            </div>
          </div>

          <div className="min-h-[260px] overflow-y-auto rounded-[28px] border border-white/10 bg-[#101114] p-4">
            <SectionTitle icon={<ListVideo />} title="Eventos capturados" />
            <div className="mt-4 space-y-2 pr-1">
              {capturedText.slice(-10).reverse().map((event) => (
                <div key={event.id} className="rounded-2xl border border-white/10 bg-white/[0.045] p-3">
                  <div className="mb-1 flex items-center justify-between gap-2 text-[10px] uppercase tracking-wide text-[var(--t3)]">
                    <span>{event.kind}</span>
                    <span>{event.time}</span>
                  </div>
                  <div className="line-clamp-2 text-sm text-slate-200">{event.text}</div>
                </div>
              ))}
              {!capturedText.length && <div className="text-sm text-slate-500">Nenhum evento capturado.</div>}
            </div>
          </div>
        </div>
      </section>

      <aside className="min-h-[320px] overflow-y-auto rounded-[28px] border border-white/10 bg-[#101114] p-4">
        <SectionTitle icon={<ListVideo />} title="Timeline backend" />
        <div className="mt-4 space-y-2 pr-1">
          {logs.map((entry, index) => (
            <div key={`${entry.timestamp}-${index}`} className="rounded-2xl border border-white/10 bg-white/[0.045] p-3">
              <div className="mb-1 flex items-center justify-between gap-2">
                <Badge variant={entry.stage === 'EXECUTOR' ? 'success' : entry.stage === 'FILTER' ? 'warning' : 'lavender'}>
                  {entry.stage}
                </Badge>
                <span className="text-[10px] text-slate-500">
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <div className="text-sm text-slate-200">{entry.message}</div>
              {entry.data && (
                <pre className="mt-2 max-h-24 overflow-auto rounded-xl bg-black/35 p-2 text-[10px] text-slate-400">
                  {JSON.stringify(entry.data, null, 2)}
                </pre>
              )}
            </div>
          ))}
          {!logs.length && <div className="text-sm text-slate-500">Sem logs do backend ainda.</div>}
        </div>
      </aside>
    </div>
  );
}

function FlowDatum({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-3">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-[var(--t3)]">{label}</div>
      <div className="mt-1 break-words text-sm font-semibold text-white">{value}</div>
    </div>
  );
}

function NavButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn('odsa-tab', active && 'is-active')}
    >
      <span className="odsa-tab-ico [&_svg]:h-[14px] [&_svg]:w-[14px] [&_svg]:stroke-[1.75]">
        {icon}
      </span>
      {label}
    </button>
  );
}

// Metadados de cada aba para o cabeçalho/sidebar (redesign Studio 2.0).
const TAB_META: Record<TabKey, { group: string; title: string }> = {
  home:     { group: 'Operação', title: 'Início' },
  stage:    { group: 'Operação', title: 'Palco' },
  ai:       { group: 'Operação', title: 'Diretora IA' },
  flow:     { group: 'Conteúdo', title: 'Fluxo Reativo' },
  canvas:   { group: 'Conteúdo', title: 'Mural' },
  library:  { group: 'Conteúdo', title: 'Biblioteca' },
  sources:  { group: 'Sistema',  title: 'Fontes / OCR' },
  logs:     { group: 'Sistema',  title: 'Logs' },
  settings: { group: 'Sistema',  title: 'Config' },
};

function SideNavButton({ icon, label, active, onClick }: { icon: ReactNode; label: string; active: boolean; onClick: () => void; }) {
  return (
    <button onClick={onClick} className={cn('odsa-side-item', active && 'is-active')}>
      <span className="odsa-side-ico [&_svg]:h-[17px] [&_svg]:w-[17px] [&_svg]:stroke-[1.75]">{icon}</span>
      {label}
    </button>
  );
}

const AUTONOMY_LABEL: Record<AiAutonomyLevel, string> = { manual: 'Manual', assistido: 'Assistido', auto: 'Autônomo' };

/** Card fixo da Diretora na sidebar — estado ao vivo, provedor e autonomia. */
function DirectorStatusCard({ runtime, onOpen }: { runtime: AutopilotRuntimeState; onOpen: () => void; }) {
  const provider = getAiConfig().provider;
  const live = runtime.autopilotEnabled;
  const mode = provider === 'mock' ? 'mock' : hasActiveGeminiKey() ? 'gemini' : 'nokey';
  const providerPill = mode === 'gemini' ? 'Gemini' : mode === 'mock' ? 'Mock' : 'Sem chave';
  const meta = live
    ? 'No ar · conduzindo a live.'
    : mode === 'gemini' ? 'Pronta · IA real (Gemini).'
    : mode === 'mock' ? 'Conduzindo por regras locais.'
    : 'Sem chave — regras locais.';
  return (
    <div className="odsa-director-card" onClick={onOpen} role="button" tabIndex={0}>
      <div className="odsa-dc-top">
        <span className={cn('odsa-dc-dot', live ? 'is-live' : 'is-warn')} />
        <span className="odsa-dc-title">Diretora</span>
        <span className={cn('odsa-dc-pill', mode === 'gemini' ? 'is-violet' : 'is-gold')}>{providerPill}</span>
      </div>
      <div className="odsa-dc-meta">{meta}</div>
      <div className="odsa-dc-row">
        <span className="odsa-dc-pill is-violet">{AUTONOMY_LABEL[runtime.autonomyLevel]}</span>
        <button
          className="odsa-dc-btn"
          onClick={(e) => { e.stopPropagation(); if (live) runtime.pause(); else runtime.start(); }}
        >
          {live ? <Pause style={{ width: 12, height: 12 }} /> : <Play style={{ width: 12, height: 12 }} />}
          {live ? 'Pausar' : 'Iniciar'}
        </button>
      </div>
    </div>
  );
}

function HomeDashboard({
  configError,
  capturedText,
  runtime,
  videoState,
  view,
  go,
  onRefresh,
  onSimulateGift,
}: {
  configError: string | null;
  capturedText: CapturedMessage[];
  runtime: AutopilotRuntimeState;
  videoState: VideoState | null;
  view: HomeViewData;
  go: (tab: TabKey) => void;
  onRefresh: () => void;
  onSimulateGift: () => void;
}) {
  const latestEvents = capturedText.slice(-6).reverse();
  const activeConnections = view.connections
    .map((connection) => ({
      connection,
      trigger: view.triggers.find((item) => item.id === connection.triggerId),
      video: view.videos.find((item) => item.id === connection.toVideoId),
    }))
    .slice(0, 5);
  const currentLabel = view.currentVideo
    ? videoLabel(view.currentVideo)
    : videoLabel(view.idleVideo);
  const pipeline = [
    { label: 'Captura OCR', value: view.lastOcr?.text || 'aguardando texto bruto', tone: 'sky' },
    {
      label: 'Agente',
      value: runtime.pendingEvents.length
        ? `${runtime.pendingEvents.length} evento(s)`
        : 'normalizador pronto',
      tone: 'lime',
    },
    { label: 'Gatilho', value: `${view.activeTriggers.length} regras ativas`, tone: 'rose' },
    { label: 'Video', value: currentLabel, tone: videoState?.state === 'ACTION' ? 'rose' : 'sky' },
    {
      label: 'Retorno',
      value: videoState?.state === 'ACTION' ? 'volta ao Idle' : videoLabel(view.idleVideo),
      tone: 'slate',
    },
  ];

  // Derive the active clip exactly like StagePanel so both players stay in sync.
  // applyVideoEdit sobrepõe a edição por vídeo (cortes/volume/áudio) também nos
  // clipes vindos do servidor (fluxo), não só nos forçados pela Diretora.
  const homeActiveClip =
    (videoState?.currentClip ? applyVideoEdit(videoState.currentClip) : null) ||
    (videoState?.current_video_id
      ? clipFromVideoId(videoState.current_video_id, view.videos)
      : view.idleVideoId
        ? clipFromVideoId(view.idleVideoId, view.videos)
        : null);

  const homeDecision = runtime.latestDecision;
  const homeMood = globalMoodEngine.getCurrentMood();
  const homeMoodLabel = ({ cozy: 'Aconchego', hype: 'Hype', focused: 'Focada', chaotic: 'Caótica' } as Record<string, string>)[homeMood.state] || 'Calma';
  const homeStats = [
    { v: view.activeTriggers.length, l: 'Gatilhos ativos', accent: true },
    { v: videoState?.queue_len ?? 0, l: 'Clipes na fila' },
    { v: capturedText.length, l: 'Eventos' },
    { v: runtime.obsScenes.length, l: 'Cenas OK' },
  ];

  return (
    <div className="h-full overflow-y-auto bg-[#07080a] p-4 lg:p-5">
      <div className="grid gap-4 lg:grid-cols-[348px_1fr]" style={{ alignItems: 'start' }}>
        {/* Preview do palco */}
        <div className="relative overflow-hidden rounded-2xl border border-white/12 bg-black" style={{ aspectRatio: '9 / 16', maxHeight: 592 }}>
          <ContinuityPlayer
            clip={homeActiveClip}
            nextClip={videoState?.nextClip ? applyVideoEdit(videoState.nextClip) : null}
            videos={view.videos}
            onEnded={async () => { await advanceReactiveFlow(videoState ?? null); onRefresh(); }}
            fit="contain"
            className="h-full w-full"
          />
          <div className="pointer-events-none absolute right-3 top-3 flex items-center gap-2">
            <span className="rounded-full border border-white/15 bg-black/60 px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest text-[var(--gold)]">{videoState?.state === 'ACTION' ? 'reação no ar' : 'em ensaio'}</span>
            <span className="rounded-full border border-white/10 bg-black/60 px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest text-slate-400">1080×1920</span>
          </div>
        </div>

        {/* Coluna direita */}
        <div className="flex flex-col gap-4">
          {/* Diretora ao vivo */}
          <div className="odessa-panel-surface p-4">
            <div className="mb-3 flex items-center gap-2">
              <Brain style={{ width: 15, height: 15 }} className="text-[var(--violet)]" />
              <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">Diretora ao vivo</span>
              <button className="ml-auto text-[11px] text-slate-500 hover:text-slate-300" onClick={() => go('ai')}>ver tudo →</button>
            </div>
            <div className="flex gap-4">
              <div className="min-w-0 flex-1">
                {homeDecision ? (
                  <>
                    <p className="text-[13px] italic text-sky-200/90">“{homeDecision.speech}”</p>
                    <p className="mt-1 text-[11px] text-slate-500">{homeDecision.reason}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {homeDecision.actions.slice(0, 4).map((a) => (
                        <span key={a.id} className="rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[9px] text-emerald-300">{a.type}</span>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-[13px] text-slate-500">Aguardando eventos — inicie a Diretora para vê-la conduzir.</p>
                )}
              </div>
              <div className="w-[136px] shrink-0 space-y-2">
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Humor</div>
                <div className="heading-serif text-2xl text-[var(--gold)]">{homeMoodLabel}</div>
                <div className="h-1.5 overflow-hidden rounded-full bg-[#171a1f]"><div className="h-full rounded-full" style={{ width: `${Math.round(homeMood.energy)}%`, background: 'var(--accent-grad)' }} /></div>
                <div className="text-[11px] text-slate-500">energia {Math.round(homeMood.energy)} · acolhimento {Math.round(homeMood.warmth)}</div>
              </div>
            </div>
          </div>

          {/* Métricas */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {homeStats.map((s) => (
              <div key={s.l} className="odessa-panel-surface p-4">
                <div className="heading-serif text-3xl leading-none" style={s.accent ? { color: 'transparent', backgroundImage: 'var(--accent-grad)', WebkitBackgroundClip: 'text', backgroundClip: 'text' } : undefined}>{s.v}</div>
                <div className="mt-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">{s.l}</div>
              </div>
            ))}
          </div>

          {/* Eventos ao vivo */}
          <div className="odessa-panel-surface p-4">
            <div className="mb-2 flex items-center gap-2">
              <RadioTower style={{ width: 15, height: 15 }} className="text-[var(--violet)]" />
              <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">Eventos · ao vivo</span>
              <span className="ml-auto text-[10px] text-slate-600">captura ●</span>
            </div>
            {latestEvents.length === 0 ? (
              <p className="text-xs text-slate-500">Aguardando OCR ou teste manual.</p>
            ) : (
              <div className="divide-y divide-white/5">
                {latestEvents.map((event) => (
                  <div key={event.id} className="flex items-start gap-3 py-2.5">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[#171a1f] text-[13px]">{event.kind === 'gift' ? '🎁' : event.kind === 'alert' ? '👋' : '💬'}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12.5px] text-slate-200">{event.text}</div>
                      <div className="text-[10px] text-slate-600">{event.kind}/{event.source}</div>
                    </div>
                    <span className="shrink-0 font-mono text-[10px] text-slate-600">{event.time}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

}

type HomeViewData = {
  videos: VideoEntry[];
  triggers: TriggerEntry[];
  activeTriggers: TriggerEntry[];
  flowNodes: FlowNode[];
  connections: Array<{
    id: string;
    fromNodeId?: string;
    toNodeId?: string;
    fromVideoId: string;
    toVideoId: string;
    triggerId: string;
    returnToIdle?: boolean;
    connectionSettings?: ConnectionSettings;
  }>;
  idleVideoId: string;
  idleVideo?: VideoEntry;
  currentVideo?: VideoEntry;
  lastOcr?: CapturedMessage;
};

function clipFromVideoId(videoId: string, videos: VideoEntry[] = []): VideoClip {
  const video = videos.find((item) => item.id === videoId);
  // applyVideoEdit mescla a edição por vídeo (cortes/volume/áudio) salva no
  // editor — assim vídeos forçados pela Diretora honram a edição sem mexer no
  // servidor (o player já respeita startSec/endSec/segments/audio).
  return applyVideoEdit({
    nodeId: null,
    videoId,
    label: videoLabel(video),
    startSec: 0,
    endSec: null,
    transitionMs: 220,
    returnToIdle: false,
    playback: { startSec: 0, endSec: null, transitionMs: 220 },
  });
}

function segmentsKey(segments?: VideoSegment[]) {
  if (!segments?.length) return '';
  return '|seg:' + segments.map((s) => `${s.startSec}-${s.endSec}`).join(',');
}

function clipKey(clip?: VideoClip | null) {
  if (!clip) return 'none';
  // Identity only — nodeId + video + trimmed range (+ segments). transitionMs is
  // a transition setting, not part of the clip's identity, so it is excluded
  // (it differs between currentClip and the preloaded nextClip).
  return `${clip.nodeId || 'video'}:${clip.videoId}:${clip.startSec}:${clip.endSec ?? 'end'}${segmentsKey(clip.segments)}`;
}

/**
 * Segmentos limitados (com fim definido) que o player deve tocar em sequência.
 * - segments[] explícitos → usa-os;
 * - senão, trim simples (startSec/endSec) → um único segmento;
 * - senão (sem fim) → [] (vídeo inteiro; o evento 'ended' nativo encerra).
 */
function effectiveSegments(clip: VideoClip | null): VideoSegment[] {
  if (!clip) return [];
  if (clip.segments && clip.segments.length) return clip.segments;
  if (clip.endSec != null) return [{ startSec: Math.max(0, clip.startSec || 0), endSec: clip.endSec }];
  return [];
}

/**
 * Reports that the active clip ended so the backend advances the reactive
 * flow to the next node. Idempotent on the server via fromNodeId/fromVideoId,
 * so several players can call it for the same clip without double-advancing.
 */
async function advanceReactiveFlow(state: VideoState | null): Promise<void> {
  await fetch(apiUrl('/api/video/advance'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fromNodeId: state?.activeNodeId || state?.currentClip?.nodeId || null,
      fromVideoId: state?.current_video_id || null,
    }),
  }).catch(() => undefined);
}

function clipDisplayName(clip: VideoClip, videos: VideoEntry[]) {
  const video = videos.find((item) => item.id === clip.videoId);
  return clip.label || videoLabel(video);
}

function formatClipTime(value: number | null | undefined) {
  if (value === null || value === undefined) return 'fim';
  return `${Number(value).toFixed(1)}s`;
}

export function ContinuityPlayer({
  clip,
  nextClip = null,
  videos,
  onEnded,
  className,
  fit = 'cover',
  showLabel = true,
}: {
  clip: VideoClip | null;
  nextClip?: VideoClip | null;
  videos: VideoEntry[];
  onEnded: () => Promise<void>;
  className?: string;
  fit?: 'cover' | 'contain';
  showLabel?: boolean;
}) {
  const firstVideoRef = useRef<HTMLVideoElement>(null);
  const secondVideoRef = useRef<HTMLVideoElement>(null);
  const refs = useMemo(() => [firstVideoRef, secondVideoRef] as const, []);
  const [activeSlot, setActiveSlot] = useState<0 | 1>(0);
  const activeSlotRef = useRef<0 | 1>(0);
  // Which clip each <video> slot currently holds. A ref (not state) because
  // playback is driven imperatively for frame-accurate, gap-free cuts.
  const slotClipRef = useRef<[VideoClip | null, VideoClip | null]>([null, null]);
  // Índice do segmento atual em cada slot (Fase 4: cortes multi-segmento).
  const slotSegmentRef = useRef<[number, number]>([0, 0]);
  // Trilha/efeito sonoro do clipe ativo (Fase 4: audio.mode === 'track').
  const trackAudioRef = useRef<HTMLAudioElement>(null);
  const endedRef = useRef('');

  // Switch the active slot. activeSlotRef MUST update synchronously here —
  // a deferred (useEffect) update lets a preload effect compute the wrong
  // idle slot and overwrite the src of the video that just started playing.
  const activateSlot = useCallback((slot: 0 | 1) => {
    activeSlotRef.current = slot;
    setActiveSlot(slot);
  }, []);

  const primeElement = useCallback((element: HTMLVideoElement, slotClip: VideoClip, slot: 0 | 1) => {
    element.muted = (slotClip.audio?.mode || 'muted') !== 'original';
    element.volume = Math.max(0, Math.min(1, slotClip.audio?.volume ?? 1));
    // Reinicia no primeiro segmento (cortes multi-segmento da Fase 4).
    slotSegmentRef.current[slot] = 0;
    const segs = effectiveSegments(slotClip);
    const start = segs.length ? segs[0].startSec : Math.max(0, slotClip.startSec || 0);
    try {
      if (Math.abs(element.currentTime - start) > 0.25) element.currentTime = start;
    } catch {
      // Seeking can fail before metadata is ready — handled on loadedmetadata.
    }
  }, []);

  // Load a clip into a slot. autoplay=true plays + activates it; autoplay=false
  // just buffers it (first frame decoded, paused) so a later cut is instant.
  const loadSlot = useCallback(
    (slot: 0 | 1, slotClip: VideoClip, autoplay: boolean) => {
      const element = refs[slot].current;
      if (!element) return;
      const alreadyLoaded = clipKey(slotClipRef.current[slot]) === clipKey(slotClip);
      if (!alreadyLoaded) {
        slotClipRef.current[slot] = slotClip;
        // Loop ONLY when the clip is explicitly a looping clip (the idle).
        // returnToIdle is a flow setting ("go back to idle after"), not a
        // loop flag — using it here made sequence clips loop forever.
        element.loop = !slotClip.endSec && slotClip.loop === true;
        element.src = apiUrl(`/api/video/play/${slotClip.videoId}`);
        element.load();
      }
      const ready = () => {
        if (autoplay) {
          primeElement(element, slotClip, slot);
          void element.play().catch(() => undefined);
          activateSlot(slot);
          return;
        }
        // Preload only. But metadata loads asynchronously — if a cut promoted
        // this slot to active while we waited, it is now playing the clip and
        // must NOT be paused or re-seeked, or the flow freezes.
        if (activeSlotRef.current === slot) return;
        primeElement(element, slotClip, slot);
        element.pause();
      };
      if (element.readyState >= 1) ready();
      else element.addEventListener('loadedmetadata', ready, { once: true });
    },
    [activateSlot, primeElement, refs],
  );

  // Instant hard-cut to a slot whose clip is already buffered. No fade.
  const cutToSlot = useCallback(
    (slot: 0 | 1) => {
      // Cutting to the slot that is already active would re-seek a video
      // mid-playback and visibly restart/jump it — never do that.
      if (activeSlotRef.current === slot) return;
      const element = refs[slot].current;
      const slotClip = slotClipRef.current[slot];
      if (!element || !slotClip) return;
      primeElement(element, slotClip, slot);
      void element.play().catch(() => undefined);
      const other = refs[slot === 0 ? 1 : 0].current;
      if (other) other.pause();
      activateSlot(slot);
    },
    [activateSlot, primeElement, refs],
  );

  // Keep the active slot playing the current clip.
  useEffect(() => {
    if (!clip) return;
    endedRef.current = '';
    const active = activeSlotRef.current;
    const idle: 0 | 1 = active === 0 ? 1 : 0;
    if (clipKey(slotClipRef.current[active]) === clipKey(clip)) return; // already playing
    if (clipKey(slotClipRef.current[idle]) === clipKey(clip)) {
      cutToSlot(idle); // preloaded in the idle slot → seamless cut
      return;
    }
    // Not loaded anywhere — use the active slot on first run, otherwise the
    // idle slot (the old video stays visible until the new one can play).
    loadSlot(slotClipRef.current[active] ? idle : active, clip, true);
  }, [clip, cutToSlot, loadSlot]);

  // Preload the next clip into the idle slot so the end-of-video cut is gapless.
  useEffect(() => {
    if (!nextClip) return;
    const idle: 0 | 1 = activeSlotRef.current === 0 ? 1 : 0;
    if (clipKey(slotClipRef.current[idle]) === clipKey(nextClip)) return;
    if (clipKey(slotClipRef.current[idle]) === clipKey(clip)) return; // idle is mid-cut
    loadSlot(idle, nextClip, false);
  }, [nextClip, clip, loadSlot]);

  // The active clip ended → instantly cut to the preloaded next slot, advance.
  const handleClipEnd = useCallback(
    (endedClip: VideoClip | null) => {
      if (!endedClip) return;
      const key = clipKey(endedClip);
      if (endedRef.current === key) return;
      endedRef.current = key;
      const idle: 0 | 1 = activeSlotRef.current === 0 ? 1 : 0;
      if (slotClipRef.current[idle]) cutToSlot(idle);
      void onEnded();
    },
    [cutToSlot, onEnded],
  );

  const handleProgress = (slot: 0 | 1, element: HTMLVideoElement) => {
    const slotClip = slotClipRef.current[slot];
    if (!slotClip) return;
    const segs = effectiveSegments(slotClip);
    if (!segs.length) return; // vídeo inteiro → encerra pelo evento 'ended' nativo
    let idx = slotSegmentRef.current[slot];
    if (idx >= segs.length) idx = segs.length - 1;
    const seg = segs[idx];
    if (element.currentTime < seg.endSec) return;
    if (idx + 1 < segs.length) {
      // Próximo corte: pula para o início do segmento seguinte (mesma fonte).
      slotSegmentRef.current[slot] = idx + 1;
      try {
        element.currentTime = segs[idx + 1].startSec;
      } catch {
        /* seek pode falhar momentaneamente — re-tenta no próximo timeupdate */
      }
    } else {
      handleClipEnd(slotClip); // último segmento → cut p/ próximo clipe + avança fluxo
    }
  };

  // Watchdog — recover a stalled active video (e.g. inside OBS Browser Source).
  useEffect(() => {
    const interval = window.setInterval(() => {
      const element = refs[activeSlotRef.current].current;
      if (element && element.paused && !element.ended && element.readyState >= 2) {
        void element.play().catch(() => undefined);
      }
    }, 1500);
    return () => window.clearInterval(interval);
  }, [refs]);

  // Trilha/efeito sonoro do clipe ativo (Fase 4). Assinatura estável evita
  // reiniciar o áudio a cada render (o clip é recriado por applyVideoEdit).
  const trackSig = clip
    ? `${clipKey(clip)}|${clip.audio?.mode ?? ''}|${clip.audio?.trackUrl ?? ''}|${clip.audio?.trackLoop ? 1 : 0}|${clip.audio?.volume ?? 1}`
    : 'none';
  useEffect(() => {
    const a = trackAudioRef.current;
    if (!a) return;
    const mode = clip?.audio?.mode;
    const url = clip?.audio?.trackUrl;
    if (clip && mode === 'track' && url) {
      if (a.getAttribute('src') !== url) a.src = url;
      a.loop = Boolean(clip.audio?.trackLoop);
      a.volume = Math.max(0, Math.min(1, clip.audio?.volume ?? 1));
      try { a.currentTime = 0; } catch { /* pré-metadata */ }
      void a.play().catch(() => undefined);
    } else {
      a.pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackSig]);

  // Pausa a trilha ao desmontar o player.
  useEffect(() => () => trackAudioRef.current?.pause(), []);

  return (
    <div className={cn('relative h-full w-full overflow-hidden bg-black', className)}>
      {/* Trilha/efeito sonoro do clipe (Fase 4) — fora da tela, áudio apenas. */}
      <audio ref={trackAudioRef} preload="auto" />
      {[0, 1].map((index) => (
        <video
          key={index}
          ref={refs[index]}
          muted
          playsInline
          disablePictureInPicture
          preload="auto"
          onTimeUpdate={(event) => handleProgress(index as 0 | 1, event.currentTarget)}
          onEnded={(event) => {
            if (!event.currentTarget.loop) handleClipEnd(slotClipRef.current[index]);
          }}
          className={cn(
            'absolute inset-0 h-full w-full',
            fit === 'contain' ? 'object-contain' : 'object-cover',
            activeSlot === index ? 'opacity-100' : 'opacity-0',
          )}
        />
      ))}
      {!clip && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950 text-slate-500">
          <Play className="mb-3 h-12 w-12 opacity-20" />
          <p className="text-sm font-medium uppercase tracking-widest">Sem sinal de video</p>
          <p className="mt-1 text-xs opacity-50">Aguardando configuracao ou backend</p>
        </div>
      )}
      {showLabel && clip && (
        <div className="pointer-events-none absolute bottom-4 left-4 rounded-lg bg-black/60 px-2 py-1 text-[10px] font-mono text-white/45">
          {clipDisplayName(clip, videos)} | {formatClipTime(clip.startSec)} {'->'} {formatClipTime(clip.endSec)}
        </div>
      )}
    </div>
  );
}

function TimelineThumbnail({ clip }: { clip: VideoClip }) {
  return (
    <video
      src={apiUrl(`/api/video/play/${clip.videoId}`)}
      muted
      playsInline
      preload="metadata"
      className="h-full w-full object-cover opacity-75"
    />
  );
}

function FilmstripFrames({ clip, zoom }: { clip: VideoClip; zoom: number }) {
  const frameCount = Math.max(8, Math.min(28, Math.round(zoom / 8)));
  return (
    <div className="absolute inset-0 flex overflow-hidden">
      {Array.from({ length: frameCount }).map((_, index) => (
        <div key={index} className="h-full min-w-[54px] flex-1 border-r border-black/30">
          <TimelineThumbnail clip={clip} />
        </div>
      ))}
    </div>
  );
}

function workflowClipFromNode(node: FlowNode): VideoClip {
  return {
    nodeId: node.nodeId,
    videoId: node.videoId,
    label: node.label,
    startSec: node.playback?.startSec ?? 0,
    endSec: node.playback?.endSec ?? null,
    transitionMs: node.playback?.transitionMs ?? 220,
    playback: node.playback,
    audio: node.audio,
    returnToIdle: true,
  };
}

function ClipTimeline({
  current,
  upcoming,
  view,
  mode,
  zoom,
  selectedClipId,
  selectedConnectionId,
  activeNodeId,
  activeConnectionId,
  nextConnectionIds,
  blockedConnectionIds,
  onModeChange,
  onZoomChange,
  onSelectClip,
  onSelectConnection,
  onPatchClip,
  onPatchConnection,
  onPreviewConnection,
}: {
  current: VideoClip | null;
  upcoming: VideoClip[];
  view: HomeViewData;
  mode: 'sequence' | 'workflow';
  zoom: number;
  selectedClipId: string;
  selectedConnectionId: string;
  activeNodeId?: string | null;
  activeConnectionId?: string | null;
  nextConnectionIds?: string[];
  blockedConnectionIds?: string[];
  onModeChange: (mode: 'sequence' | 'workflow') => void;
  onZoomChange: (zoom: number) => void;
  onSelectClip: (nodeId: string) => void;
  onSelectConnection: (connectionId: string) => void;
  onPatchClip: (nodeId: string, patch: Partial<PlaybackSettings>) => Promise<void>;
  onPatchConnection: (connectionId: string, patch: Partial<ConnectionSettings>) => Promise<void>;
  onPreviewConnection: () => void;
}) {
  const sequenceClips = ([current, ...upcoming].filter(Boolean) as VideoClip[]).slice(0, 12);
  const workflowClips = view.flowNodes.map(workflowClipFromNode);
  const clips = mode === 'sequence' ? sequenceClips : workflowClips;
  const selectedClip = clips.find((clip) => clip.nodeId === selectedClipId) || clips[0] || null;
  const selectedConnection =
    view.connections.find((connection) => connection.id === selectedConnectionId) ||
    view.connections.find((connection) => connection.fromNodeId === selectedClip?.nodeId) ||
    null;
  const nextIds = new Set(nextConnectionIds || []);
  const blockedIds = new Set(blockedConnectionIds || []);

  if (!clips.length) {
    return (
      <div className="border-t border-white/10 bg-[#101114] px-4 py-4 text-sm text-slate-500">
        Nenhum clipe carregado para a timeline.
      </div>
    );
  }

  return (
    <div className="grid shrink-0 border-t border-white/10 bg-[#101114] lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 px-4 pb-4 pt-3">
        <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="inline-flex w-fit rounded-xl border border-white/10 bg-black/25 p-1">
            <button
              type="button"
              onClick={() => onModeChange('sequence')}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-semibold',
                mode === 'sequence' ? 'bg-[var(--gold)] text-black' : 'text-slate-400 hover:text-white',
              )}
            >
              Sequencia atual
            </button>
            <button
              type="button"
              onClick={() => onModeChange('workflow')}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-semibold',
                mode === 'workflow' ? 'bg-[var(--gold)] text-black' : 'text-slate-400 hover:text-white',
              )}
            >
              Workflow completo
            </button>
          </div>
          <div className="flex items-center gap-3 text-[10px] uppercase tracking-[0.2em] text-slate-500">
            <span>{clips.length} clipes</span>
            <span>{view.connections.length} conexoes</span>
            <input
              type="range"
              min="80"
              max="260"
              value={zoom}
              onChange={(event) => onZoomChange(Number(event.target.value))}
              className="h-1 w-28 accent-[var(--gold)]"
              aria-label="Zoom da timeline"
            />
          </div>
        </div>

        <div className="mb-2 grid h-7 grid-cols-8 border-b border-white/10 text-[10px] text-slate-500">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="relative border-l border-white/10 pl-1">
              0:{String(index).padStart(2, '0')}
            </div>
          ))}
        </div>

        <div className="relative overflow-x-auto pb-2">
          <div className="absolute bottom-0 top-0 z-20 w-0.5 bg-orange-500 shadow-[0_0_12px_rgba(249,115,22,0.7)]" />
          <div className="flex min-h-[104px] gap-2">
            {clips.map((clip, index) => {
              const nodeId = clip.nodeId || '';
              const isActive = nodeId && nodeId === activeNodeId;
              const isSelected = nodeId && nodeId === selectedClip?.nodeId;
              const connection = view.connections.find((item) => item.fromNodeId === nodeId);
              const connectionState = connection?.id
                ? connection.id === activeConnectionId
                  ? 'ativa'
                  : nextIds.has(connection.id)
                    ? 'proxima'
                    : blockedIds.has(connection.id)
                      ? 'bloqueada'
                      : 'configurada'
                : '';
              return (
                <div key={`${clipKey(clip)}-${index}`} className="flex shrink-0 items-stretch gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      onSelectClip(nodeId);
                      if (connection?.id) onSelectConnection(connection.id);
                    }}
                    className={cn(
                      'relative h-24 overflow-hidden rounded-md border bg-black text-left',
                      isSelected ? 'border-[var(--gold)] ring-2 ring-[var(--gold)]/55' : 'border-white/10',
                      isActive && 'shadow-[0_0_0_2px_rgba(56,189,248,0.55)]',
                    )}
                    style={{ width: `${zoom}px` }}
                  >
                    <FilmstripFrames clip={clip} zoom={zoom} />
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/75 to-transparent px-2 pb-2 pt-5">
                      <div className="truncate text-[11px] font-semibold text-white">
                        {index === 0 && mode === 'sequence' ? 'Agora: ' : ''}
                        {clipDisplayName(clip, view.videos)}
                      </div>
                      <div className="mt-0.5 truncate font-mono text-[10px] text-slate-300">
                        {formatClipTime(clip.startSec)} {'->'} {formatClipTime(clip.endSec)} | {clip.audio?.mode || 'muted'}
                      </div>
                    </div>
                    <span className="absolute left-0 top-0 h-full w-2 cursor-ew-resize border-r border-[var(--gold)]/70 bg-[var(--gold)]/20" />
                    <span className="absolute right-0 top-0 h-full w-2 cursor-ew-resize border-l border-[var(--gold)]/70 bg-[var(--gold)]/20" />
                  </button>
                  {connection && (
                    <button
                      type="button"
                      onClick={() => onSelectConnection(connection.id)}
                      className={cn(
                        'group flex w-14 shrink-0 flex-col items-center justify-center gap-1 text-[9px] uppercase tracking-widest text-slate-500',
                        connection.id === selectedConnectionId && 'text-[var(--gold)]',
                      )}
                      title={`Conexao ${connectionState || connection.id}`}
                    >
                      <span
                        className={cn(
                          'h-0.5 w-10 rounded-full bg-slate-700 transition group-hover:bg-[var(--gold)]',
                          connection.id === activeConnectionId && 'animate-pulse bg-sky-300',
                          nextIds.has(connection.id) && 'bg-emerald-300',
                          blockedIds.has(connection.id) && 'bg-rose-400',
                        )}
                      />
                      <Route className="h-3.5 w-3.5" />
                      <span>{connectionState || 'link'}</span>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <aside className="border-t border-white/10 p-4 lg:border-l lg:border-t-0">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
          <SlidersHorizontal className="h-4 w-4 text-[var(--gold)]" />
          Propriedades
        </div>
        {selectedClip?.nodeId ? (
          <div className="space-y-3">
            <div>
              <div className="truncate text-sm font-semibold text-white">
                {clipDisplayName(selectedClip, view.videos)}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {selectedClip.nodeId === activeNodeId ? 'Clipe ativo no palco' : 'Clipe selecionado'}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input
                label="Inicio"
                type="number"
                step="0.1"
                value={selectedClip.startSec}
                onChange={(event) =>
                  void onPatchClip(selectedClip.nodeId || '', { startSec: Number(event.target.value) || 0 })
                }
              />
              <Input
                label="Fim"
                type="number"
                step="0.1"
                value={selectedClip.endSec ?? ''}
                onChange={(event) =>
                  void onPatchClip(selectedClip.nodeId || '', {
                    endSec: event.target.value === '' ? null : Number(event.target.value) || null,
                  })
                }
              />
            </div>
            <Input
              label="Fade do clipe (ms)"
              type="number"
              min="0"
              max="2000"
              value={selectedClip.transitionMs}
              onChange={(event) =>
                void onPatchClip(selectedClip.nodeId || '', { transitionMs: Number(event.target.value) || 0 })
              }
            />
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-white/10 p-4 text-sm text-slate-500">
            Selecione um clipe com no no workflow para editar cortes.
          </div>
        )}

        <div className="mt-4 border-t border-white/10 pt-4">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
            Conexao
          </div>
          {selectedConnection ? (
            <div className="space-y-3">
              <div className="rounded-2xl border border-white/10 bg-black/25 p-3 text-xs text-slate-300">
                {selectedConnection.fromVideoId} {'->'} {selectedConnection.toVideoId}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  label="Saida A"
                  type="number"
                  step="0.5"
                  value={selectedConnection.connectionSettings?.previewTailSec ?? 2}
                  onChange={(event) =>
                    void onPatchConnection(selectedConnection.id, {
                      previewTailSec: Number(event.target.value) || 2,
                    })
                  }
                />
                <Input
                  label="Entrada B"
                  type="number"
                  step="0.5"
                  value={selectedConnection.connectionSettings?.previewHeadSec ?? 2}
                  onChange={(event) =>
                    void onPatchConnection(selectedConnection.id, {
                      previewHeadSec: Number(event.target.value) || 2,
                    })
                  }
                />
              </div>
              <label className="block">
                <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-[var(--t3)]">
                  Transicao
                </span>
                <select
                  value={selectedConnection.connectionSettings?.fadeMode || 'crossfade'}
                  onChange={(event) =>
                    void onPatchConnection(selectedConnection.id, {
                      fadeMode: event.target.value as ConnectionSettings['fadeMode'],
                    })
                  }
                  className="h-10 w-full rounded-2xl border border-[var(--border2)] bg-[var(--bg3)] px-3 text-sm text-[var(--t1)] outline-none focus:border-[var(--gold)]"
                >
                  <option value="cut">Corte seco</option>
                  <option value="fade">Fade</option>
                  <option value="crossfade">Crossfade</option>
                </select>
              </label>
              <Input
                label="Duracao transicao (ms)"
                type="number"
                min="0"
                max="2000"
                value={selectedConnection.connectionSettings?.transitionMs ?? 220}
                onChange={(event) =>
                  void onPatchConnection(selectedConnection.id, {
                    transitionMs: Number(event.target.value) || 0,
                  })
                }
              />
              <Button size="sm" variant="secondary" onClick={onPreviewConnection}>
                <Play className="h-4 w-4" />
                Previa da conexao
              </Button>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-white/10 p-4 text-sm text-slate-500">
              Selecione uma conexao entre clipes.
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function SelectionHandle({ className }: { className: string }) {
  return (
    <span
      className={cn(
        'pointer-events-none absolute h-2.5 w-2.5 border-2 border-[var(--gold)] bg-[#101114]',
        className,
      )}
    />
  );
}

function EditorIconButton({
  children,
  title,
  onClick,
  disabled,
}: {
  children: ReactNode;
  title: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-slate-300 transition hover:border-white/10 hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
    >
      {children}
    </button>
  );
}

function formatEditorTimestamp(seconds: number | null | undefined) {
  const safeSeconds = Math.max(0, seconds || 0);
  const minutes = Math.floor(safeSeconds / 60);
  const wholeSeconds = Math.floor(safeSeconds % 60);
  const centiseconds = Math.floor((safeSeconds % 1) * 100);
  return `${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
}

function StagePanel({
  runtime,
  capturedText,
  view,
  videoState,
  obsDirectStatus,
  obsSettingsFromApp,
  onRefresh,
  onPlayVideoById,
  onPatchFlowNodePlayback,
  onPatchFlowConnectionSettings,
  onStartLive,
  // onRunReactiveFlow mantido na interface pública por compatibilidade futura
  // (Fase 3 — conversa: a Odessa pode precisar enfileirar respostas via este canal)
  onRunReactiveFlow: _onRunReactiveFlow,
  aiDecision: aiDecisionProp,
}: {
  runtime: AutopilotRuntimeState;
  capturedText: CapturedMessage[];
  view: HomeViewData;
  videoState: VideoState | null;
  obsDirectStatus?: import('./lib/obsWebSocket').ObsDirectStatus | null;
  obsSettingsFromApp?: Record<string, unknown> | null;
  onRefresh: () => void;
  onPlayVideoById: (videoId: string, reason?: string) => Promise<unknown>;
  onPatchFlowNodePlayback: (nodeId: string, patch: Partial<PlaybackSettings>) => Promise<void>;
  onPatchFlowConnectionSettings: (
    connectionId: string,
    patch: Partial<ConnectionSettings>,
  ) => Promise<void>;
  onStartLive?: () => void | Promise<void>;
  onRunReactiveFlow?: (text: string, source?: string) => Promise<unknown>;
  /** Decisão da IA vinda do pipeline principal (OdessaLiveCenter).
   *  O StagePanel mantém um estado local apenas para as simulações manuais —
   *  o estado externo tem prioridade enquanto houver um evento ao vivo. */
  aiDecision?: AiDecision;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [manualVideoId, setManualVideoId] = useState('');
  const [triggering, setTriggering] = useState(false);
  const [obsBusy, setObsBusy] = useState('');
  const [obsMessage, setObsMessage] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [timelineMode, setTimelineMode] = useState<'sequence' | 'workflow'>('sequence');
  const [timelineZoom, setTimelineZoom] = useState(140);
  // ── AI Decision Panel state ──────────────────────────────────────────────────
  // Estado local usado exclusivamente pelas simulações manuais (botão "Simular
  // presente"). Para eventos ao vivo, o estado vem do pipeline principal via prop.
  const [aiDecisionLocal, setAiDecisionLocal] = useState<AiDecision>(EMPTY_AI_DECISION);
  // A prop tem prioridade; fallback para local quando estiver offline/vazio.
  const aiDecision = aiDecisionProp ?? aiDecisionLocal;
  const [showAiPanel, setShowAiPanel] = useState(false);
  // ── Simulation / event log ───────────────────────────────────────────────────
  const [simLogs, setSimLogs] = useState<LogEntry[]>([]);
  const [showSimLog, setShowSimLog] = useState(false);
  const addSimLog = useCallback((entry: LogEntry) => {
    setSimLogs((prev) => [...prev.slice(-99), entry]);
  }, []);
  // ── Validation panel ────────────────────────────────────────────────────────
  const [showValidation, setShowValidation] = useState(false);
  const [selectedClipId, setSelectedClipId] = useState('');
  const [selectedConnectionId, setSelectedConnectionId] = useState('');
  const [previewMessage, setPreviewMessage] = useState<string | null>(null);
  const [connectionPreviewClip, setConnectionPreviewClip] = useState<VideoClip | null>(null);
  const previewTimersRef = useRef<number[]>([]);

  const runRoutedCommand = async (label: string, fn: () => Promise<CommandResult>) => {
    setObsBusy(label);
    setObsMessage(null);
    try {
      const result = await fn();
      setObsMessage(`${label}: ${result.ok ? 'ok' : result.error} (${result.route})`);
      onRefresh();
    } catch (err) {
      setObsMessage(`${label}: ${err instanceof Error ? err.message : 'falha'}`);
    } finally {
      setObsBusy('');
    }
  };

  useEffect(() => {
    const syncFullscreen = () => {
      setIsFullscreen(document.fullscreenElement === stageRef.current);
    };
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  const forceVideo = async (videoId: string) => {
    if (!videoId) return;
    setTriggering(true);
    try {
      await onPlayVideoById(videoId, 'manual_click');
    } finally {
      setTriggering(false);
    }
  };

  const runObsCommand = async (label: string, path: string) => {
    setObsBusy(label);
    setObsMessage(null);
    try {
      const response = await fetch(apiUrl(path), { method: 'POST' });
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        status?: string;
        sceneName?: string;
        currentScene?: string;
        mode?: string;
        error?: string | null;
      };
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setObsMessage(
        `${label}: ${data.currentScene || data.sceneName || data.status || data.mode || 'ok'}`,
      );
      onRefresh();
    } catch (err) {
      setObsMessage(`${label}: ${err instanceof Error ? err.message : 'falha'}`);
    } finally {
      setObsBusy('');
    }
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      await stageRef.current?.requestFullscreen();
    } catch (err) {
      setObsMessage(`Tela cheia: ${err instanceof Error ? err.message : 'falha'}`);
    }
  };

  // ── Core event → AI pipeline (shared by real OCR events + simulation) ────────
  const runCapturedEventThroughAi = useCallback(async (msg: CapturedMessage) => {
    if (!msg.text?.trim()) return;

    // If CaptureStudio already built a canonical OcrEvent, reuse it directly.
    // This preserves gift keys, author, zone, and confidence from the ingest result
    // without any reconstruction. Falls back to building from scratch for events
    // that don't carry the canonical event (simulations, external sources, etc.).
    const prebuilt = msg.metadata?.ocrEvent as OcrEvent | undefined;

    // Map LiveEventKind → OcrEventType (fallback path)
    const kindMap: Record<string, OcrEventType> = {
      gift: 'gift', chat: 'comment', alert: 'system', system: 'system',
    };
    const eventType: OcrEventType = prebuilt?.eventType ?? kindMap[msg.kind] ?? 'unknown';

    // Map LiveEventSource → OcrEvent source (fallback path)
    const sourceMap: Record<string, OcrEvent['source']> = {
      ocr: 'ocr', test: 'test', manual: 'manual',
    };
    const ocrSource = sourceMap[msg.source] ?? 'manual';

    const sourceLabel =
      msg.source === 'ocr' ? 'OCR ao vivo'
      : msg.source === 'test' ? 'simulação'
      : msg.source;

    addSimLog(logEntry('captura', `Texto capturado (${sourceLabel})`, { detail: msg.text, status: 'info' }));
    const zoneDetail = prebuilt
      ? `${prebuilt.zoneName} · confiança ${Math.round(prebuilt.confidence * 100)}%`
      : (msg.zoneName || '');
    addSimLog(logEntry('parser', `Parseado como ${eventType}`, { detail: zoneDetail, status: 'ok' }));

    const ocrEvent: OcrEvent = prebuilt ?? buildOcrEvent(msg.text, {
      source: ocrSource,
      eventType,
      zoneName: msg.zoneName || 'chat',
      confidence: (msg.metadata?.confidence as number | undefined) ?? (msg.source === 'ocr' ? 0.85 : 0.95),
      metadata: {
        giftName: (msg.metadata?.giftName as string | null) ?? null,
        giftKey: (msg.metadata?.giftKey as string | null) ?? null,
        giftValue: (msg.metadata?.giftValue as number | null) ?? null,
      },
    });

    // Mostra estado de loading no painel de simulação enquanto a chamada está em voo.
    // Para eventos ao vivo o estado "checking" é controlado pelo pipeline principal
    // (OdessaLiveCenter) via prop — aqui só atualizamos o estado local de simulação.
    setAiDecisionLocal(checkingAiDecision(ocrEvent));
    addSimLog(logEntry('ia', 'Consultando motor de decisão…', { status: 'info' }));

    const decision = await callAiDecision(ocrEvent, {
      videos: view.videos,
      triggers: view.triggers,
    });
    setAiDecisionLocal(decision);
    const iaLabel = decision.status === 'online' ? '🟢 IA real' : '🟡 IA simulada';
    addSimLog(logEntry('ia', `${iaLabel}: ${decision.reasoning}`, {
      detail: `confiança ${Math.round(decision.confidence * 100)}%`,
      status: 'ok',
    }));

    // Simulação: mostra o que a IA decidiu, mas não dispara gatilho real.
    // O disparo real acontece apenas pelo pipeline principal em OdessaLiveCenter,
    // que aplica o filtro de confiança e chama runReactiveFlow de forma controlada.
    if (decision.selectedVideoId) {
      addSimLog(logEntry('gatilho', `Simulação: IA escolheria → ${decision.selectedVideoId}`, { status: 'info' }));
    }
    const actionLabel: Record<AiDecision['recommendedAction'], string> = {
      play_video: 'tocar vídeo', queue_video: 'enfileirar', wait: 'aguardar', no_action: 'sem ação',
    };
    addSimLog(logEntry('palco', `Simulação concluída (${actionLabel[decision.recommendedAction]}, confiança ${Math.round(decision.confidence * 100)}%)`, { status: 'ok' }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addSimLog, runtime, view.videos, view.triggers]);

  // Nota: o useEffect que processava capturedText aqui foi removido.
  // O pipeline de eventos ao vivo agora vive inteiramente em OdessaLiveCenter,
  // garantindo que rode em todas as abas e sem double-ingest.

  // ── Simulation shortcut ────────────────────────────────────────────────────
  const simulateGift = () => {
    const text = 'Lucas enviou Rosa';
    void runCapturedEventThroughAi({
      id: `sim-${Date.now()}`,
      source: 'test',
      zoneName: 'Simulação',
      text,
      kind: 'gift',
      createdAt: new Date().toISOString(),
      time: new Date().toISOString(),
      metadata: { giftName: 'Rosa', simulated: true },
    });
  };
  const activeClip =
    (videoState?.currentClip ? applyVideoEdit(videoState.currentClip) : null) ||
    (videoState?.current_video_id
      ? clipFromVideoId(videoState.current_video_id, view.videos)
      : view.idleVideoId
        ? clipFromVideoId(view.idleVideoId, view.videos)
        : null);
  const displayClip = connectionPreviewClip || activeClip;
  const upcomingClips = Array.isArray(videoState?.upcoming) ? videoState.upcoming : [];
  const latestSignals = capturedText.slice(-3).reverse();
  const activeClipLabel = activeClip ? clipDisplayName(activeClip, view.videos) : 'Sem video selecionado';
  const activeNodeId = videoState?.activeNodeId || activeClip?.nodeId || null;
  const activeConnectionId = videoState?.activeConnectionId || null;
  const selectedClip =
    [activeClip, ...upcomingClips].find((clip) => clip?.nodeId && clip.nodeId === selectedClipId) ||
    activeClip ||
    null;
  const selectedConnection =
    view.connections.find((connection) => connection.id === selectedConnectionId) ||
    view.connections.find((connection) => connection.id === activeConnectionId) ||
    view.connections.find((connection) => connection.fromNodeId === selectedClip?.nodeId) ||
    null;
  const clipDuration =
    activeClip?.endSec && activeClip.endSec > activeClip.startSec
      ? activeClip.endSec - activeClip.startSec
      : 6.04;

  const advanceVideo = async () => {
    await advanceReactiveFlow(videoState ?? null);
    onRefresh();
  };

  const previewConnection = async () => {
    if (!selectedConnection) {
      setPreviewMessage('Selecione uma conexao para testar.');
      return;
    }
    previewTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    previewTimersRef.current = [];
    const fromNode = view.flowNodes.find((node) => node.nodeId === selectedConnection.fromNodeId);
    const toNode = view.flowNodes.find((node) => node.nodeId === selectedConnection.toNodeId);
    if (fromNode && toNode) {
      const settings = selectedConnection.connectionSettings || {};
      const tailSec = Math.max(0.5, Number(settings.previewTailSec || 2));
      const headSec = Math.max(0.5, Number(settings.previewHeadSec || 2));
      const fromClip = workflowClipFromNode(fromNode);
      const toClip = workflowClipFromNode(toNode);
      const fromEnd = fromClip.endSec ?? fromClip.startSec + tailSec;
      const safeFromClip = {
        ...fromClip,
        startSec: Math.max(0, fromEnd - tailSec),
        endSec: fromEnd,
        transitionMs: settings.transitionMs ?? fromClip.transitionMs,
      };
      const safeToClip = {
        ...toClip,
        endSec: toClip.startSec + headSec,
        transitionMs: settings.transitionMs ?? toClip.transitionMs,
      };
      setConnectionPreviewClip(safeFromClip);
      previewTimersRef.current = [
        window.setTimeout(() => setConnectionPreviewClip(safeToClip), tailSec * 1000),
        window.setTimeout(() => setConnectionPreviewClip(null), (tailSec + headSec) * 1000),
      ];
    }
    setPreviewMessage('Previa local tocando no palco; OBS/live/chat/TTS continuam intocados.');
    await fetch(apiUrl('/api/video/workflow/preview-connection'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectionId: selectedConnection.id }),
    }).catch(() => undefined);
  };

  useEffect(
    () => () => {
      previewTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    },
    [],
  );

  if (isFullscreen) {
    return (
      <div ref={stageRef} className="flex h-screen w-screen items-center justify-center overflow-hidden bg-black">
        <div className="relative aspect-[9/16] h-full max-h-screen max-w-full bg-black">
          <ContinuityPlayer
            clip={activeClip}
            nextClip={videoState?.nextClip ? applyVideoEdit(videoState.nextClip) : null}
            videos={view.videos}
            onEnded={advanceVideo}
            fit="contain"
            showLabel={false}
            className="h-full w-full"
          />
        </div>
      </div>
    );
  }

  return (
    <div ref={stageRef} className="odsa-stage2 flex h-full min-h-0 flex-col gap-4 overflow-y-auto bg-[#07080a] p-4 lg:p-5">
      {/* Status + controles de OBS */}
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge
          status={deriveStageStatus({ state: videoState?.state, isTransitioning: triggering, queueLen: videoState?.queue_len, autopilotEnabled: runtime.autopilotEnabled })}
          pulse={runtime.autopilotEnabled}
        />
        <span className="truncate text-xs text-slate-400">{videoState?.queue_len ?? 0} na fila</span>
        <div className="ml-auto flex items-center gap-2">
          <button className="odsa-btn odsa-btn-secondary odsa-btn-md" disabled={!!obsBusy} onClick={() => void runRoutedCommand('Preparar mesa OBS', () => routeSetupLiveScene(obsSettingsFromApp as never))}>
            <Upload style={{ width: 14, height: 14 }} /> Preparar OBS
          </button>
          <button className="odsa-btn odsa-btn-primary odsa-btn-md" disabled={!!obsBusy} onClick={() => void runRoutedCommand('Iniciar transmissao', () => routeStartTransmission(obsSettingsFromApp as never))}>
            <RadioTower style={{ width: 14, height: 14 }} /> Transmitir
          </button>
          <button className="odsa-btn odsa-btn-secondary odsa-btn-md odsa-btn-icon" onClick={() => void toggleFullscreen()} title="Tela cheia">
            <Maximize2 style={{ width: 15, height: 15 }} />
          </button>
        </div>
      </div>

      {/* Topo: preview + No ar agora + fila */}
      <div className="grid gap-4 lg:grid-cols-[minmax(260px,320px)_1fr]" style={{ alignItems: 'start' }}>
        <div className="relative overflow-hidden rounded-2xl border border-white/12 bg-black" style={{ aspectRatio: '9 / 16', maxHeight: 460 }}>
          <ContinuityPlayer clip={displayClip} nextClip={videoState?.nextClip ? applyVideoEdit(videoState.nextClip) : null} videos={view.videos} onEnded={advanceVideo} fit="contain" className="h-full w-full" />
          <div className="pointer-events-none absolute right-2 top-2 rounded-full border border-white/15 bg-black/60 px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest text-[var(--sky)]">No ar</div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="odessa-panel-surface p-4">
            <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">No ar agora</div>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-white">{activeClipLabel}</div>
                <div className="truncate text-xs text-slate-500">{(activeClip?.segments?.length || 0) > 0 ? `${activeClip?.segments?.length} cortes` : 'sem corte'} · áudio {activeClip?.audio?.mode || 'mudo'}</div>
              </div>
              <div className="flex items-center gap-2">
                <button className="odsa-btn odsa-btn-secondary odsa-btn-md odsa-btn-icon" title="Repetir" onClick={() => { if (activeClip?.videoId) void forceVideo(activeClip.videoId); }}><Rewind style={{ width: 15, height: 15 }} /></button>
                <button className="odsa-btn odsa-btn-secondary odsa-btn-md odsa-btn-icon" title="Próximo" onClick={() => void advanceVideo()}><FastForward style={{ width: 15, height: 15 }} /></button>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <VolumeX style={{ width: 15, height: 15 }} className="shrink-0 text-slate-500" />
              <input type="range" min={0} max={100} value={Math.round((activeClip?.audio?.volume ?? 1) * 100)}
                onChange={(e) => { if (!activeClip?.videoId) return; const cur = getVideoEdit(activeClip.videoId) ?? defaultVideoEdit(activeClip.videoId); saveVideoEdit({ ...cur, volume: Number(e.target.value) / 100 }); onRefresh(); }}
                className="flex-1 accent-[var(--violet)]" />
              <span className="w-9 shrink-0 text-right font-mono text-[11px] text-slate-400">{Math.round((activeClip?.audio?.volume ?? 1) * 100)}%</span>
            </div>
          </div>

          <div className="odessa-panel-surface p-4">
            <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">A seguir na fila</div>
            {upcomingClips.length === 0 ? (
              <div className="text-xs text-slate-500">Nada enfileirado. A Diretora enfileira reações automaticamente.</div>
            ) : (
              <div className="space-y-2">
                {upcomingClips.slice(0, 5).map((clip, i) => (
                  <div key={`${clip.videoId}-${i}`} className="flex items-center gap-3 text-xs">
                    <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#171a1f] text-slate-400">▶</span>
                    <span className="truncate text-slate-300">{clipDisplayName(clip, view.videos)}</span>
                    <span className="ml-auto text-slate-600">fila</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Editor de cortes — embutido na página (sem modal) */}
      {activeClip?.videoId ? (
        <Suspense fallback={<div className="odessa-panel-surface p-4 text-xs text-slate-500">Carregando editor…</div>}>
          <VideoEditor embedded key={activeClip.videoId} videoId={activeClip.videoId} label={activeClipLabel} />
        </Suspense>
      ) : (
        <div className="odessa-panel-surface p-4 text-xs text-slate-500">Coloque um vídeo no ar para editar os cortes aqui.</div>
      )}
    </div>
  );

}

function VideoLibraryPanel({
  config,
  onChanged,
}: {
  config: PersonaConfig | null;
  onChanged: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadBatch, setUploadBatch] = useState<
    Array<{ name: string; status: 'pending' | 'uploading' | 'done' | 'error'; error?: string }>
  >([]);
  const [editingVideoId, setEditingVideoId] = useState<string | null>(null);
  const videos = config?.videos || [];
  const editingVideo = videos.find((v) => v.id === editingVideoId) || null;

  const uploadSummary = useMemo(
    () =>
      uploadBatch.reduce(
        (acc, item) => {
          if (item.status === 'done') acc.sent++;
          else if (item.status === 'error') acc.failed++;
          else if (item.status === 'pending' || item.status === 'uploading') acc.pending++;
          return acc;
        },
        { sent: 0, failed: 0, pending: 0 },
      ),
    [uploadBatch],
  );

  const uploadOne = (file: File, index: number, total: number) =>
    new Promise<void>((resolve, reject) => {
      const body = new FormData();
      body.append('file', file);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', apiUrl('/video/upload'));
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        const fileProgress = event.loaded / event.total;
        setUploadProgress(Math.round(((index + fileProgress) / total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
          return;
        }
        reject(new Error(`HTTP ${xhr.status}`));
      };
      xhr.onerror = () => reject(new Error('Falha de rede'));
      xhr.send(body);
    });

  const upload = async (fileList?: FileList | null) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setUploading(true);
    setUploadProgress(0);
    setUploadBatch(files.map((file) => ({ name: file.name, status: 'pending' })));
    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        setUploadBatch((current) =>
          current.map((item) =>
            item.name === file.name ? { ...item, status: 'uploading' } : item,
          ),
        );
        try {
          await uploadOne(file, index, files.length);
          setUploadBatch((current) =>
            current.map((item) => (item.name === file.name ? { ...item, status: 'done' } : item)),
          );
        } catch (err) {
          setUploadBatch((current) =>
            current.map((item) =>
              item.name === file.name
                ? {
                    ...item,
                    status: 'error',
                    error: err instanceof Error ? err.message : 'Falha no upload',
                  }
                : item,
            ),
          );
        }
      }
      setUploadProgress(100);
      onChanged();
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const forceVideo = async (videoId: string) => {
    await fetch(apiUrl('/video/force'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId }),
    }).catch(() => undefined);
  };

  const archiveVideo = async (videoId: string) => {
    await fetch(apiUrl(`/video/${encodeURIComponent(videoId)}/archive`), { method: 'POST' }).catch(() => undefined);
    onChanged();
  };

  const setIdle = async (videoId: string) => {
    if (!config) return;
    const nextConfig = {
      ...config,
      idleVideoId: videoId,
      videos: config.videos.map((video) => ({
        ...video,
        loop: video.id === videoId ? true : video.loop,
      })),
      action_map: { ...(config.action_map || {}), idle: [videoId] },
    };
    await fetch(apiUrl('/video/config'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nextConfig),
    });
    onChanged();
  };

  return (
    <div className="h-full overflow-y-auto p-5 lg:p-8">
      <div className="mb-6 flex flex-col gap-4 rounded-[34px] border border-white/10 bg-[#101114] p-5 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.3em] text-sky-200/70">
            Biblioteca
          </div>
          <h1 className="mt-2 text-4xl font-semibold tracking-[-0.04em] text-white">
            Videos da mesa de direcao
          </h1>
          <p className="mt-1 text-sm text-[var(--t3)]">
            Clipes usados pelo Idle, reacoes, loops e gatilhos OCR.
          </p>
        </div>
        <div>
          <input
            ref={fileRef}
            type="file"
            accept="video/mp4,video/webm"
            multiple
            className="hidden"
            onChange={(event) => upload(event.target.files)}
          />
          <Button variant="primary" loading={uploading} onClick={() => fileRef.current?.click()}>
            <Upload className="h-4 w-4" />
            Adicionar videos
          </Button>
        </div>
      </div>

      {uploading || uploadBatch.length > 0 ? (
        <div className="mb-5 rounded-[28px] border border-sky-200/20 bg-sky-300/10 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-white">
                {uploading ? 'Enviando videos' : 'Upload concluido'}
              </div>
              <div className="text-xs text-slate-400">
                {uploadSummary.sent} enviados, {uploadSummary.failed} falharam,{' '}
                {uploadSummary.pending} pendentes
              </div>
            </div>
            <Badge variant={uploadSummary.failed > 0 ? 'warning' : 'gold'}>{uploadProgress}%</Badge>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-black/45">
            <div
              className="h-full rounded-full bg-gradient-to-r from-sky-300 to-lime-300 transition-all"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {uploadBatch.map((item) => (
              <div
                key={item.name}
                className="rounded-2xl border border-white/10 bg-black/25 px-3 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-semibold text-white">{item.name}</span>
                  <span
                    className={cn(
                      'text-[10px] font-semibold uppercase tracking-widest',
                      item.status === 'done' && 'text-lime-300',
                      item.status === 'uploading' && 'text-sky-300',
                      item.status === 'error' && 'text-rose-300',
                      item.status === 'pending' && 'text-slate-500',
                    )}
                  >
                    {item.status}
                  </span>
                </div>
                {item.error && (
                  <div className="mt-1 truncate text-[10px] text-rose-300">{item.error}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {videos.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Film className="mb-4 h-12 w-12 text-[var(--t3)]" />
          <p className="text-sm font-semibold text-[var(--t1)]">Nenhum video na biblioteca</p>
          <p className="mt-1 text-xs text-[var(--t3)]">Clique em "Adicionar videos" para fazer upload</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {videos.map((video) => (
          <Card key={video.id} className="overflow-hidden bg-[#101114]">
            <div className="aspect-video bg-black">
              <video
                muted
                playsInline
                preload="metadata"
                className="h-full w-full object-contain"
                src={apiUrl(`/api/video/play/${video.id}`)}
              />
            </div>
            <div className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{videoLabel(video)}</div>
                  <div className="truncate text-xs text-[var(--t3)]">{video.group || video.id}</div>
                </div>
                {video.loop && <Badge variant="gold">Idle</Badge>}
              </div>
              <div className="mt-3 line-clamp-2 text-xs text-[var(--t3)]">
                {video.description || 'Video registrado na Odessa.'}
              </div>
              <div className="mt-4 flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => forceVideo(video.id)}>
                  <Play className="h-3.5 w-3.5" />
                  Preview
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setEditingVideoId(video.id)}>
                  <Scissors className="h-3.5 w-3.5" />
                  Editar
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setIdle(video.id)}>
                  Idle
                </Button>
                <Button size="sm" variant="danger" onClick={() => archiveVideo(video.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
      {editingVideo && (
        <Suspense fallback={null}>
          <VideoEditor
            videoId={editingVideo.id}
            label={videoLabel(editingVideo)}
            onClose={() => setEditingVideoId(null)}
          />
        </Suspense>
      )}
    </div>
  );
}

function SectionTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 text-sm font-semibold text-[var(--t1)]">
      <span className="flex h-4 w-4 items-center justify-center text-[var(--sky)] [&_svg]:h-4 [&_svg]:w-4 [&_svg]:stroke-[1.75]">
        {icon}
      </span>
      {title}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0 rounded-[22px] border border-[var(--border2)] bg-black/20 p-4 shadow-[var(--shadow-1)]">
      <div className="heading-serif truncate text-[34px] leading-none text-[var(--t1)]">{value}</div>
      <div className="mt-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--t3)]">
        {label}
      </div>
    </div>
  );
}
