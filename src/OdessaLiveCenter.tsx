import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import {
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
import { Badge, Button, Card, Input, StatusDot } from './components/ui';

const CaptureStudio = lazy(() => import('./CaptureStudio'));
const ReactiveFlowBoard = lazy(() => import('./ReactiveFlowBoard'));
const PlanningCanvas = lazy(() => import('./PlanningCanvas'));

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

type TabKey = 'home' | 'stage' | 'flow' | 'canvas' | 'library' | 'sources' | 'logs' | 'settings';

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
  playback?: PlaybackSettings;
  audio?: ClipAudioSettings;
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
      setVideoState((await response.json()) as VideoState);
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

    const shouldPollVideoState =
      activeTab === 'home' || activeTab === 'stage' || runtime.autopilotEnabled;
    const videoIntervalMs = activeTab === 'stage' ? 1200 : runtime.autopilotEnabled ? 1500 : 3000;
    const videoTimer = shouldPollVideoState
      ? window.setInterval(() => {
          void refreshVideoState();
        }, videoIntervalMs)
      : null;
    const logsTimer =
      activeTab === 'logs'
        ? window.setInterval(() => {
            void refreshAutomationLogs();
          }, 5000)
        : null;

    return () => {
      window.clearTimeout(initialLoadTimer);
      if (videoTimer !== null) window.clearInterval(videoTimer);
      if (logsTimer !== null) window.clearInterval(logsTimer);
    };
  }, [activeTab, loadConfig, refreshAutomationLogs, refreshVideoState, runtime.autopilotEnabled]);

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

  // Watch new captured chat/OCR events and send them through the backend flow.
  useEffect(() => {
    for (const event of capturedText) {
      if (processedGiftIdsRef.current.has(event.id)) continue;
      if (!event.text?.trim()) continue;
      if (event.metadata?.backendIngested) {
        processedGiftIdsRef.current.add(event.id);
        continue;
      }
      processedGiftIdsRef.current.add(event.id);
      queueMicrotask(() => {
        void runReactiveFlow(event.text, event.source);
      });
    }
  }, [capturedText, runReactiveFlow]);

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
    const lastOcr = [...capturedText].reverse().find((event) => event.source === 'ocr');
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

  return (
    <main className="odessa-shell flex h-screen w-screen min-h-0 flex-col overflow-hidden text-[var(--t1)]">
      <header className="relative z-30 flex h-16 shrink-0 items-center justify-between border-b border-[var(--border2)] bg-[#06070a]/96 px-[22px] backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="odessa-brand-mark">
            <img src="/favicon.png" alt="Odessa" />
          </div>
          <div>
            <div className="heading-serif text-[24px] leading-none">Odessa</div>
            <div className="mt-1 text-[9px] font-semibold uppercase tracking-[0.32em] text-[var(--t3)]">
              Live Direction Desk
            </div>
          </div>
        </div>

        <nav className="hidden items-center gap-0.5 lg:flex">
          <NavButton
            icon={<Home />}
            label="Início"
            active={activeTab === 'home'}
            onClick={() => setActiveTab('home')}
          />
          <NavButton
            icon={<Video />}
            label="Palco"
            active={activeTab === 'stage'}
            onClick={() => setActiveTab('stage')}
          />
          <NavButton
            icon={<Link2 />}
            label="Fluxo Reativo"
            active={activeTab === 'flow'}
            onClick={() => setActiveTab('flow')}
          />
          <NavButton
            icon={<StickyNote />}
            label="Mural"
            active={activeTab === 'canvas'}
            onClick={() => setActiveTab('canvas')}
          />
          <NavButton
            icon={<Film />}
            label="Biblioteca"
            active={activeTab === 'library'}
            onClick={() => setActiveTab('library')}
          />
          <NavButton
            icon={<Camera />}
            label="Fontes / OCR"
            active={activeTab === 'sources'}
            onClick={() => setActiveTab('sources')}
          />
          <NavButton
            icon={<ListVideo />}
            label="Logs"
            active={activeTab === 'logs'}
            onClick={() => setActiveTab('logs')}
          />
          <NavButton
            icon={<Settings />}
            label="Config"
            active={activeTab === 'settings'}
            onClick={() => setActiveTab('settings')}
          />
        </nav>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => void onRefreshAgentStatus?.()}
            className="hidden h-[36px] items-center gap-2 rounded-full border border-[var(--border2)] bg-[var(--bg2)] px-3 text-left text-[11.5px] font-semibold text-[var(--t2)] transition hover:bg-[var(--bg3)] sm:flex"
            title={agentStatus?.message || 'Status do Odessa Agent'}
          >
            <StatusDot status={agentStatus?.agentConnected ? 'online' : 'error'} pulse={!!agentStatus?.agentConnected} />
            <span>
              Agent {agentStatus?.agentConnected ? 'online' : 'offline'}
            </span>
            {typeof agentStatus?.queueSize === 'number' && (
              <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-bold text-slate-300">
                {agentStatus.queueSize}
              </span>
            )}
          </button>
          <div className="hidden h-[36px] items-center gap-2 rounded-full border border-[var(--border2)] bg-[var(--bg2)] px-3 text-[11.5px] font-bold uppercase tracking-[0.14em] text-[var(--sky)] sm:flex">
            <StatusDot status={runtime.autopilotEnabled ? 'online' : 'idle'} pulse />
            <span>
              {runtime.autopilotEnabled ? 'AO VIVO' : 'PRONTA'}
            </span>
          </div>
          <Button
            size="icon"
            variant="secondary"
            onClick={() => {
              onLiveConfigOpenChange?.(false);
              setActiveTab('settings');
            }}
            title="Configurar Iniciar live"
          >
            <Settings className="h-4 w-4" />
          </Button>
          <Button
            variant={runtime.autopilotEnabled ? 'secondary' : 'primary'}
            onClick={() => {
              if (runtime.autopilotEnabled) {
                runtime.pause();
                return;
              }
              if (onStartLive) {
                void onStartLive();
                return;
              }
              runtime.start();
            }}
          >
            <Play className="h-4 w-4" />
            {runtime.autopilotEnabled ? 'Pausar live' : 'Iniciar live'}
          </Button>
        </div>

        {liveStartError && (
          <div className="absolute right-5 top-[58px] z-40 max-w-md rounded-[18px] border border-rose-400/30 bg-rose-950/90 px-4 py-3 text-xs font-semibold leading-5 text-rose-100 shadow-[var(--shadow-alert)]">
            {liveStartError}
          </div>
        )}
      </header>

      <div className="flex gap-2 overflow-x-auto border-b border-[var(--border)] px-3 py-2 lg:hidden">
        {(['home', 'stage', 'flow', 'canvas', 'library', 'sources', 'logs', 'settings'] as TabKey[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold',
              activeTab === tab
                ? 'bg-[var(--gold)] text-[#0a0a0c]'
                : 'bg-[var(--bg2)] text-[var(--t2)]',
            )}
          >
            {tab}
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
          />
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
        {activeTab === 'sources' && (
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
        )}
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

  const loadObsProfiles = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/obs/profiles'));
      const data = (await res.json().catch(() => ({}))) as { profiles?: typeof obsProfiles };
      if (Array.isArray(data.profiles)) setObsProfiles(data.profiles);
    } catch { /* ignore */ }
  }, []);

  const saveObsProfile = async (name: string) => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(apiUrl('/obs/profiles'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, settings: obsSettings }),
      });
      const data = (await res.json().catch(() => ({}))) as { profiles?: typeof obsProfiles };
      if (Array.isArray(data.profiles)) setObsProfiles(data.profiles);
      const saved = data.profiles?.find((p) => p.name === name);
      if (saved) setActiveObsProfileId(saved.id);
      setObsProfileName('');
      setMessage(`Perfil "${name}" salvo.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Falha ao salvar perfil');
    } finally {
      setSaving(false);
    }
  };

  const applyObsProfile = async (id: string) => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(apiUrl('/obs/profiles-apply'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; settings?: Partial<ObsSettings>; appliedProfile?: string };
      if (!res.ok || !data.ok) throw new Error('Falha ao aplicar perfil');
      if (data.settings) {
        const normalized = normalizeObsSettings(data.settings);
        setObsSettings(normalized);
        setObsConnection(parseObsConnection(normalized));
      }
      setActiveObsProfileId(id);
      setMessage(`Perfil "${data.appliedProfile}" aplicado.`);
      if (onObsSettingsChanged && data.settings) onObsSettingsChanged(data.settings as Record<string, unknown>);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Falha ao aplicar perfil');
    } finally {
      setSaving(false);
    }
  };

  const deleteObsProfile = async (id: string) => {
    try {
      const res = await fetch(apiUrl('/obs/profiles'), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const data = (await res.json().catch(() => ({}))) as { profiles?: typeof obsProfiles };
      if (Array.isArray(data.profiles)) setObsProfiles(data.profiles);
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

              <div className="mb-4 flex items-start gap-3 rounded-2xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
                <span className="mt-0.5 shrink-0 text-amber-400">⚠</span>
                <span>
                  O OBS WebSocket conecta via <strong>Odessa Agent</strong> — um processo local que deve estar rodando
                  no mesmo computador que o OBS. Sem o Agent ativo, o teste de conexao sempre falha.
                  {!obsReady && !obsHealth && (
                    <span className="mt-1 block text-amber-300">
                      Status atual: Agent/OBS nao detectado. Inicie o Odessa Agent e clique em "Testar conexao" abaixo.
                    </span>
                  )}
                </span>
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
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[12.5px] font-medium transition',
        active
          ? 'bg-[var(--bg3)] text-[var(--t1)] shadow-[inset_0_0_0_1px_var(--border2)]'
          : 'text-[var(--t2)] hover:bg-[var(--bg3)] hover:text-[var(--t1)]',
      )}
    >
      <span className="flex h-4 w-4 items-center justify-center [&_svg]:h-4 [&_svg]:w-4 [&_svg]:stroke-[1.75]">
        {icon}
      </span>
      {label}
    </button>
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

  return (
    <div className="h-full overflow-y-auto p-[18px]">
      <div className="grid min-h-[calc(100vh-100px)] gap-4 xl:grid-cols-[minmax(680px,1fr)_minmax(420px,0.72fr)]">
        <section className="grid min-h-0 grid-rows-[1fr_auto] gap-4">
          <div className="odessa-stage-mesh odessa-panel-surface relative min-h-[320px] overflow-hidden bg-[#07080a]">
            <div className="pointer-events-none absolute right-4 top-4 z-10 flex items-center gap-2">
              <Badge variant={videoState?.state === 'ACTION' ? 'lavender' : 'gold'}>
                {videoState?.state === 'ACTION' ? 'reacao no ar' : 'em ensaio'}
              </Badge>
              <span className="rounded-full border border-white/10 bg-black/55 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-300">
                1080 x 1920
              </span>
            </div>
            <div className="flex h-full items-center justify-center p-4">
              {videoState?.current_video_id ? (
                <video
                  key={videoState.current_video_id}
                  autoPlay
                  muted
                  loop={
                    videoState.state !== 'ACTION' &&
                    (videoState.current_video_id === view.idleVideoId || !!view.currentVideo?.loop)
                  }
                  onEnded={async () => {
                    if (videoState.state !== 'ACTION') return;
                    await fetch(apiUrl('/api/video/idle'), { method: 'POST' }).catch(() => undefined);
                    onRefresh();
                  }}
                  playsInline
                  className="h-full w-full rounded-[28px] object-contain"
                  src={apiUrl(`/api/video/play/${videoState.current_video_id}`)}
                />
              ) : (
                <div className="relative grid h-44 w-44 place-items-center rounded-full border border-sky-200/25 bg-[radial-gradient(circle_at_32%_28%,rgba(125,211,252,0.72),rgba(251,113,133,0.55)_58%,rgba(7,8,10,0.92)_100%)] shadow-[0_0_96px_rgba(125,211,252,0.22)]">
                  <div className="absolute inset-[-34px] rounded-full border border-dashed border-sky-200/16" />
                  <div className="absolute inset-[-18px] rounded-full border border-sky-200/18" />
                  <span className="sr-only">Player aguardando estado do backend</span>
                </div>
              )}
            </div>
            <div className="pointer-events-none absolute bottom-5 left-6 font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
              {videoState?.current_video_id || currentLabel}
            </div>
          </div>

          <div className="odessa-panel-surface min-h-[300px] p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.32em] text-[var(--t3)]">
                <Link2 className="h-4 w-4 text-[var(--sky)]" />
                Gatilhos · fluxo reativo
              </div>
              <Button size="sm" variant="ghost" onClick={() => go('flow')}>
                Editar fluxo
              </Button>
            </div>
            <div className="space-y-2">
              {activeConnections.map(({ connection, trigger, video }, index) => (
                <button
                  key={connection.id}
                  onClick={() => go('flow')}
                  className="group grid w-full grid-cols-[1fr_auto] items-center gap-3 rounded-[18px] border border-white/10 bg-black/20 p-3 text-left transition hover:border-sky-200/35 hover:bg-white/[0.045]"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-white">
                        {trigger ? eventLabel(trigger) : `Sinal ${String(index + 1).padStart(2, '0')}`}
                      </span>
                      <StatusDot status={trigger?.enabled ? 'online' : 'warn'} />
                    </div>
                    <div className="mt-1 truncate font-mono text-[11px] text-[var(--t3)]">
                      {connection.triggerId} · {videoLabel(video)}
                    </div>
                  </div>
                  <div className="rounded-full border border-white/10 bg-white/10 px-2.5 py-1 font-mono text-[10px] text-slate-300">
                    play
                  </div>
                </button>
              ))}
              {activeConnections.length === 0 && (
                <p className="rounded-[22px] border border-dashed border-white/15 p-4 text-sm text-slate-500">
                  Configure os gatilhos no Fluxo Reativo e deixe a Odessa conduzir a transmissao.
                </p>
              )}
            </div>
          </div>
        </section>

        <aside className="grid min-h-0 gap-4">
          <div className="odessa-panel-surface p-5">
            <div className="mb-4 text-[10px] font-semibold uppercase tracking-[0.32em] text-[var(--t3)]">
              Sessão de hoje
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Metric label="Clipes na fila" value={videoState?.queue_len ?? 0} />
              <Metric label="Gatilhos ativos" value={view.activeTriggers.length} />
              <Metric label="Eventos parseados" value={capturedText.length} />
              <Metric label="Cenas autorizadas" value={view.readyScore} />
            </div>
          </div>

          <div className="odessa-panel-surface p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-[var(--t3)]">
                Ações rápidas
              </div>
              <span className="font-mono text-[10px] text-slate-500">obs.live_health · ok</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => go('stage')}>
                <RadioTower className="h-4 w-4" />
                Abrir palco
              </Button>
              <Button variant="secondary" onClick={onSimulateGift}>
                <Play className="h-4 w-4" />
                Testar gatilho
              </Button>
              <Button variant="ghost" onClick={() => go('library')}>
                <Film className="h-4 w-4" />
                Biblioteca
              </Button>
            </div>
            {configError && (
              <div className="mt-4 rounded-[18px] border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-100">
                Backend/config: {configError}
              </div>
            )}
          </div>

          <div className="odessa-panel-surface min-h-[300px] overflow-hidden p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.32em] text-[var(--t3)]">
                <ListVideo className="h-4 w-4 text-[var(--sky)]" />
                Eventos · ao vivo
              </div>
              <Badge variant="gold">Captura</Badge>
            </div>
            <div className="max-h-[300px] space-y-2 overflow-y-auto pr-1">
              {latestEvents.map((event) => (
                <div key={event.id} className="rounded-[18px] border border-white/10 bg-black/25 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[10px] text-slate-500">{event.time}</span>
                    <Badge variant={event.kind === 'gift' ? 'lavender' : 'default'}>{event.kind}</Badge>
                  </div>
                  <div className="mt-2 text-sm font-semibold text-white">{event.source}</div>
                  <div className="mt-1 line-clamp-2 text-sm text-slate-300">{event.text}</div>
                </div>
              ))}
              {latestEvents.length === 0 && (
                <p className="text-sm text-slate-500">Aguardando captura ou simulacao.</p>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );

  return (
    <div className="h-full overflow-y-auto p-4 lg:p-5">
      <div className="grid min-h-[calc(100vh-108px)] gap-4 xl:grid-cols-[minmax(620px,1fr)_380px]">
        <section className="odessa-stage-mesh relative overflow-hidden rounded-[34px] border border-white/10 bg-[#07080a]">
          <div className="relative z-10 flex h-full min-h-[640px] flex-col p-5 lg:p-6">
            <div className="flex flex-col gap-4 border-b border-white/10 pb-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-3xl">
                <div className="text-xs font-semibold uppercase tracking-[0.34em] text-sky-200/70">
                  Mesa de direcao
                </div>
                <h1 className="mt-3 text-4xl font-semibold leading-tight tracking-[-0.04em] text-white lg:text-5xl">
                  Controle a live pelo caminho do sinal, nao por telas soltas.
                </h1>
              </div>
              <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/35 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-slate-200">
                <StatusDot status={runtime.autopilotEnabled ? 'online' : 'idle'} pulse />
                {runtime.autopilotEnabled ? 'em execucao' : 'standby'}
              </div>
            </div>

            <div className="mt-5 grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(460px,1fr)_290px]">
              <div className="flex min-h-0 flex-col gap-4">
                <div className="relative overflow-hidden rounded-[30px] border border-sky-200/18 bg-black/75 p-3 shadow-[0_0_86px_rgba(125,211,252,0.14)]">
                  <div className="pointer-events-none absolute inset-x-5 top-5 z-10 flex items-center justify-between">
                    <Badge variant={videoState?.state === 'ACTION' ? 'lavender' : 'gold'}>
                      {videoState?.state === 'ACTION' ? 'reacao no ar' : 'idle em loop'}
                    </Badge>
                    <div className="rounded-full border border-white/10 bg-black/55 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-slate-300">
                      {videoState?.queue_len ?? 0} na fila
                    </div>
                  </div>
                  {videoState?.current_video_id ? (
                    <video
                      key={videoState.current_video_id}
                      autoPlay
                      muted
                      loop={
                        videoState.state !== 'ACTION' &&
                        (videoState.current_video_id === view.idleVideoId || !!view.currentVideo?.loop)
                      }
                      onEnded={async () => {
                        if (videoState.state !== 'ACTION') return;
                        await fetch(apiUrl('/api/video/idle'), { method: 'POST' }).catch(() => undefined);
                        onRefresh();
                      }}
                      playsInline
                      className="aspect-video w-full rounded-[24px] object-contain"
                      src={apiUrl(`/api/video/play/${videoState.current_video_id}`)}
                    />
                  ) : (
                    <div className="flex aspect-video w-full items-center justify-center rounded-[24px] bg-black text-sm text-slate-500">
                      Player aguardando estado do backend
                    </div>
                  )}
                </div>

                <div className="rounded-[30px] border border-white/10 bg-[#101114] p-4">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-200/70">
                        Pipeline ao vivo
                      </div>
                      <div className="mt-1 text-sm text-slate-400">
                        OCR para agente, regra, video e retorno ao Idle.
                      </div>
                    </div>
                    <Button variant="secondary" onClick={() => go('flow')}>
                      Editar fluxo
                    </Button>
                  </div>
                  <div className="grid gap-3 md:grid-cols-5">
                    {pipeline.map((step, index) => (
                      <div
                        key={step.label}
                        className="relative rounded-[22px] border border-white/10 bg-white/[0.045] p-3"
                      >
                        {index < pipeline.length - 1 && (
                          <div className="absolute -right-2 top-1/2 hidden h-px w-4 bg-sky-200/35 md:block" />
                        )}
                        <div
                          className={cn(
                            'mb-3 h-1.5 w-10 rounded-full',
                            step.tone === 'sky' && 'bg-sky-300',
                            step.tone === 'lime' && 'bg-lime-300',
                            step.tone === 'rose' && 'bg-rose-300',
                            step.tone === 'slate' && 'bg-slate-500',
                          )}
                        />
                        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                          {step.label}
                        </div>
                        <div className="mt-2 line-clamp-2 min-h-10 text-sm font-semibold text-white">
                          {step.value}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex min-h-0 flex-col gap-4">
                <div className="rounded-[30px] border border-white/10 bg-[#101114] p-4">
                  <div className="mb-4 flex items-center justify-between">
                    <div className="text-sm font-semibold text-white">Trilhas prontas</div>
                    <Badge>{activeConnections.length}</Badge>
                  </div>
                  <div className="space-y-2">
                    {activeConnections.map(({ connection, trigger, video }, index) => (
                      <button
                        key={connection.id}
                        onClick={() => go('flow')}
                        className="w-full rounded-[22px] border border-white/10 bg-white/[0.045] p-3 text-left transition hover:border-sky-200/35"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-semibold uppercase tracking-widest text-sky-200">
                            sinal {String(index + 1).padStart(2, '0')}
                          </span>
                          <StatusDot
                            status={trigger?.enabled ? 'online' : 'warn'}
                          />
                        </div>
                        <div className="mt-2 truncate text-sm font-semibold text-white">
                          {trigger ? eventLabel(trigger) : 'sinal'}
                        </div>
                        <div className="mt-1 truncate text-xs text-slate-400">
                          {videoLabel(video)}
                        </div>
                      </button>
                    ))}
                    {activeConnections.length === 0 && (
                      <p className="rounded-[22px] border border-dashed border-white/15 p-4 text-sm text-slate-500">
                        Nenhuma trilha conectada. Abra o fluxo reativo para criar a primeira rota.
                      </p>
                    )}
                  </div>
                </div>

                <div className="rounded-[30px] border border-white/10 bg-[#101114] p-4">
                  <div className="text-sm font-semibold text-white">Comandos rapidos</div>
                  <div className="mt-4 grid gap-3">
                    <Button variant="primary" onClick={() => go('stage')}>
                      Abrir palco
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        // ✔ Passa pelo pipeline completo: texto → parser → gift → vídeo
                        onSimulateGift();
                      }}
                    >
                      Simular presente Rosa
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <aside className="flex min-h-[640px] flex-col gap-4">
          {configError && (
            <div className="rounded-[28px] border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-100">
              Backend/config: {configError}
            </div>
          )}

          <div className="rounded-[32px] border border-white/10 bg-[#101114] p-5">
            <div className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-200/70">
              Estado da operacao
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Metric label="Videos" value={view.videos.length} />
              <Metric label="Sinais" value={view.activeTriggers.length} />
              <Metric label="Trilhas" value={view.connections.length} />
              <Metric label="Eventos" value={capturedText.length} />
            </div>
          </div>

          <div className="min-h-0 flex-1 rounded-[32px] border border-white/10 bg-[#101114] p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="text-sm font-semibold text-white">Telemetria do OCR</div>
              <Badge>{latestEvents.length} linhas</Badge>
            </div>
            <div className="space-y-3">
              {latestEvents.map((event) => (
                <div
                  key={event.id}
                  className="rounded-[22px] border border-white/10 bg-white/[0.045] p-3"
                >
                  <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-slate-500">
                    <span>
                      {event.kind}/{event.source}
                    </span>
                    <span>{event.time}</span>
                  </div>
                  <div className="mt-2 line-clamp-2 text-sm text-slate-200">{event.text}</div>
                </div>
              ))}
              {latestEvents.length === 0 && (
                <p className="text-sm text-slate-500">Aguardando captura ou simulacao.</p>
              )}
            </div>
          </div>
        </aside>
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
  return {
    nodeId: null,
    videoId,
    label: videoLabel(video),
    startSec: 0,
    endSec: null,
    transitionMs: 220,
    returnToIdle: false,
    playback: { startSec: 0, endSec: null, transitionMs: 220 },
  };
}

function clipKey(clip?: VideoClip | null) {
  if (!clip) return 'none';
  return `${clip.nodeId || 'video'}:${clip.videoId}:${clip.startSec}:${clip.endSec ?? 'end'}:${clip.transitionMs}`;
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
  videos,
  onEnded,
  className,
  fit = 'cover',
  showLabel = true,
}: {
  clip: VideoClip | null;
  videos: VideoEntry[];
  onEnded: () => Promise<void>;
  className?: string;
  fit?: 'cover' | 'contain';
  showLabel?: boolean;
}) {
  const firstVideoRef = useRef<HTMLVideoElement>(null);
  const secondVideoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [activeSlot, setActiveSlot] = useState<0 | 1>(0);
  const [slotClips, setSlotClips] = useState<[VideoClip | null, VideoClip | null]>([null, null]);
  const activeSlotRef = useRef<0 | 1>(0);
  const slotClipsRef = useRef<[VideoClip | null, VideoClip | null]>([null, null]);
  const endedRef = useRef('');
  const watchdogRef = useRef({ key: '', time: -1, stuck: 0 });
  const currentKey = clipKey(clip);
  const refs = useMemo(() => [firstVideoRef, secondVideoRef] as const, []);

  useEffect(() => {
    activeSlotRef.current = activeSlot;
  }, [activeSlot]);

  useEffect(() => {
    slotClipsRef.current = slotClips;
  }, [slotClips]);

  const playSlot = useCallback(
    (slot: 0 | 1, slotClip: VideoClip, seekToStart: boolean) => {
      const element = refs[slot].current;
      if (!element) return;

      const start = Math.max(0, slotClip.startSec || 0);
      const play = () => {
        element.muted = (slotClip.audio?.mode || 'muted') !== 'original';
        element.volume = Math.max(0, Math.min(1, slotClip.audio?.volume ?? 1));
        if (seekToStart) {
          try {
            element.currentTime = start;
          } catch {
            // The media element may only allow seeking after metadata is available.
          }
        }
        void element.play().catch(() => undefined);
        const audioElement = audioRef.current;
        if (audioElement) {
          if (slotClip.audio?.mode === 'track' && slotClip.audio.trackUrl) {
            audioElement.src = slotClip.audio.trackUrl;
            audioElement.volume = Math.max(0, Math.min(1, slotClip.audio.volume ?? 1));
            audioElement.currentTime = 0;
            void audioElement.play().catch(() => undefined);
          } else {
            audioElement.pause();
            audioElement.removeAttribute('src');
          }
        }
        setActiveSlot(slot);
      };

      if (element.readyState >= 1) {
        play();
        return;
      }

      element.addEventListener('loadedmetadata', play, { once: true });
      element.load();
    },
    [refs],
  );

  useEffect(() => {
    if (!clip) {
      setSlotClips([null, null]);
      return;
    }

    endedRef.current = '';
    const currentSlot = activeSlotRef.current;
    const currentSlotClip = slotClipsRef.current[currentSlot];
    if (clipKey(currentSlotClip) === currentKey) {
      playSlot(currentSlot, clip, false);
      return;
    }

    const nextSlot: 0 | 1 = currentSlot === 0 ? 1 : 0;
    let playTimer = 0;
    const swapTimer = window.setTimeout(() => {
      setSlotClips((current) => {
        const next: [VideoClip | null, VideoClip | null] = [...current] as [VideoClip | null, VideoClip | null];
        next[nextSlot] = clip;
        return next;
      });
      playTimer = window.setTimeout(() => playSlot(nextSlot, clip, true), 30);
    }, 30);

    return () => {
      window.clearTimeout(swapTimer);
      window.clearTimeout(playTimer);
    };
  }, [clip, currentKey, playSlot]);

  useEffect(() => {
    refs.forEach((ref, index) => {
      const element = ref.current;
      if (!element || index === activeSlot) return;
      element.pause();
    });
  }, [activeSlot, refs]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const slot = activeSlotRef.current;
      const element = refs[slot].current;
      const slotClip = slotClipsRef.current[slot];
      if (!element || !slotClip) return;

      const key = clipKey(slotClip);
      if (watchdogRef.current.key !== key) {
        watchdogRef.current = { key, time: element.currentTime, stuck: 0 };
      }

      if (element.paused && !element.ended) {
        void element.play().catch(() => undefined);
        return;
      }

      const lastTime = watchdogRef.current.time;
      if (!element.ended && Math.abs(element.currentTime - lastTime) < 0.01) {
        watchdogRef.current.stuck += 1;
        if (watchdogRef.current.stuck >= 2) {
          void element.play().catch(() => undefined);
        }
      } else {
        watchdogRef.current.stuck = 0;
      }
      watchdogRef.current.time = element.currentTime;
    }, 1000);

    return () => window.clearInterval(interval);
  }, [refs]);

  const handleProgress = (slotClip: VideoClip | null, element: HTMLVideoElement) => {
    if (!slotClip?.endSec) return;
    const key = clipKey(slotClip);
    if (element.currentTime >= slotClip.endSec && endedRef.current !== key) {
      endedRef.current = key;
      void onEnded();
    }
  };

  if (!clip) {
    return (
      <div
        className={cn(
          'flex h-full min-h-[320px] w-full flex-col items-center justify-center bg-slate-950 text-slate-500',
          className,
        )}
      >
        <Play className="mb-3 h-12 w-12 opacity-20" />
        <p className="text-sm font-medium uppercase tracking-widest">Sem sinal de video</p>
        <p className="mt-1 text-xs opacity-50">Aguardando configuracao ou backend</p>
      </div>
    );
  }

  return (
    <div className={cn('relative h-full w-full overflow-hidden bg-black', className)}>
      {slotClips.map((slotClip, index) => (
        <video
          key={`${index}-${clipKey(slotClip)}`}
          ref={refs[index]}
          autoPlay
          muted={(slotClip?.audio?.mode || 'muted') !== 'original'}
          playsInline
          loop={Boolean(
            slotClip &&
              slotClip.returnToIdle === false &&
              !slotClip.endSec &&
              videos.find((item) => item.id === slotClip.videoId)?.loop,
          )}
          preload={activeSlot === index ? 'auto' : 'metadata'}
          src={slotClip ? apiUrl(`/api/video/play/${slotClip.videoId}`) : undefined}
          onTimeUpdate={(event) => handleProgress(slotClip, event.currentTarget)}
          onEnded={() => {
            if (slotClip && endedRef.current !== clipKey(slotClip)) {
              endedRef.current = clipKey(slotClip);
              void onEnded();
            }
          }}
          className={cn(
            'absolute inset-0 h-full w-full transition-opacity',
            fit === 'contain' ? 'object-contain' : 'object-cover',
            activeSlot === index ? 'opacity-100' : 'opacity-0',
          )}
          style={{ transitionDuration: `${slotClip?.transitionMs ?? 220}ms` }}
        />
      ))}
      <audio ref={audioRef} />
      {showLabel && (
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
  onRunReactiveFlow,
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
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [manualVideoId, setManualVideoId] = useState('');
  const [triggering, setTriggering] = useState(false);
  const [obsBusy, setObsBusy] = useState('');
  const [obsMessage, setObsMessage] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [timelineMode, setTimelineMode] = useState<'sequence' | 'workflow'>('sequence');
  const [timelineZoom, setTimelineZoom] = useState(140);
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

  const simulateGift = () => {
    if (onRunReactiveFlow) {
      void onRunReactiveFlow('Lucas enviou Rosa', 'test');
      return;
    }
    runtime.injectEvent('gift', 'Lucas enviou Rosa', 'test');
  };
  const activeClip =
    videoState?.currentClip ||
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
    await fetch(apiUrl('/api/video/advance'), { method: 'POST' }).catch(() => undefined);
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
    <div ref={stageRef} className="flex h-full min-h-0 flex-col overflow-hidden bg-[#0d0f12]">
      <section className="relative min-h-0 flex-1 overflow-hidden border-b border-white/10 bg-[#101114]">
        <div className="absolute left-5 top-5 z-20 flex items-center gap-3">
          <Badge variant={videoState?.state === 'ACTION' ? 'lavender' : 'gold'}>
            {videoState?.state || 'IDLE'}
          </Badge>
          <span className="max-w-[42vw] truncate text-xs font-semibold text-slate-400">
            {activeClipLabel}
          </span>
        </div>
        <div className="absolute right-5 top-5 z-20 flex items-center gap-3 rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-xs text-slate-300">
          <StatusDot status={runtime.autopilotEnabled ? 'online' : 'idle'} pulse />
          <span>{runtime.autopilotEnabled ? 'live assistida ativa' : 'standby'}</span>
          <span className="text-slate-600">|</span>
          <span>{videoState?.queue_len ?? 0} na fila</span>
          <span className="text-slate-600">|</span>
          <span>{videoState?.executionMode || (runtime.autopilotEnabled ? 'live' : 'edicao')}</span>
        </div>

        <div className="flex h-full min-h-[420px] items-center justify-center px-4 py-6">
          <div className="relative aspect-[9/16] h-[min(68vh,620px)] max-h-[calc(100vh-280px)] min-h-[360px] bg-black shadow-[0_0_80px_rgba(0,0,0,0.45)]">
            <ContinuityPlayer
              clip={displayClip}
              videos={view.videos}
              onEnded={advanceVideo}
              className="h-full w-full"
            />
            <div className="pointer-events-none absolute inset-0 border-2 border-[var(--gold)]" />
            <SelectionHandle className="-left-1.5 -top-1.5" />
            <SelectionHandle className="-right-1.5 -top-1.5" />
            <SelectionHandle className="-bottom-1.5 -left-1.5" />
            <SelectionHandle className="-bottom-1.5 -right-1.5" />
            <span className="pointer-events-none absolute left-1/2 top-[-28px] h-7 w-px bg-[var(--gold)]" />
            <span className="pointer-events-none absolute left-1/2 top-[-31px] h-2 w-2 -translate-x-[3.5px] rounded-full border-2 border-[var(--gold)] bg-[#101114]" />
            <div className="pointer-events-none absolute bottom-2 left-2 max-w-[calc(100%-16px)] rounded bg-black/65 px-2 py-1 text-[10px] font-mono text-white/45">
              {connectionPreviewClip ? 'PREVIEW CONEXAO' : 'ID'}: {displayClip?.videoId || view.idleVideoId || 'None'} |{' '}
              {formatClipTime(displayClip?.startSec)} {'->'} {formatClipTime(displayClip?.endSec)}
            </div>
          </div>
        </div>

        <div className="absolute bottom-4 left-4 hidden w-72 rounded-lg border border-white/10 bg-black/45 p-3 xl:block">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
              Ultimos sinais
            </span>
            <Badge>{capturedText.length}</Badge>
          </div>
          <div className="space-y-1">
            {latestSignals.map((event) => (
              <div key={event.id} className="truncate text-xs text-slate-300">
                {event.kind}/{event.source}: {event.text}
              </div>
            ))}
            {!latestSignals.length && (
              <div className="text-xs text-slate-500">Aguardando OCR ou teste manual.</div>
            )}
          </div>
        </div>
      </section>

      <section className="shrink-0 border-b border-white/10 bg-[#101114] px-4 py-3">
        <div className="grid items-center gap-3 md:grid-cols-[1fr_auto_1fr]">
          <div className="flex items-center gap-1">
            <EditorIconButton title="Cortar">
              <Scissors className="h-4 w-4" />
            </EditorIconButton>
            <EditorIconButton
              title="Copiar ID do video"
              onClick={() => {
                const id = videoState?.current_video_id || activeClip?.videoId || '';
                if (id) void navigator.clipboard?.writeText(id);
              }}
              disabled={!activeClip}
            >
              <Copy className="h-4 w-4" />
            </EditorIconButton>
            <EditorIconButton title="Remover selecao" disabled>
              <Trash2 className="h-4 w-4" />
            </EditorIconButton>
            <span className="mx-1 h-6 w-px bg-white/10" />
            <EditorIconButton title="Preview sem audio">
              <VolumeX className="h-4 w-4" />
            </EditorIconButton>
          </div>

          <div className="flex items-center justify-center gap-3 text-xs font-mono text-slate-400">
            <span>{formatEditorTimestamp(activeClip?.startSec)}</span>
            <EditorIconButton title="Atualizar estado" onClick={onRefresh}>
              <Rewind className="h-4 w-4" />
            </EditorIconButton>
            <button
              type="button"
              onClick={() => {
                if (runtime.autopilotEnabled) {
                  runtime.pause();
                  return;
                }
                if (onStartLive) {
                  void onStartLive();
                  return;
                }
                runtime.start();
              }}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full text-white transition hover:bg-white/[0.06]"
              aria-label={runtime.autopilotEnabled ? 'Pausar live' : 'Iniciar live'}
              title={runtime.autopilotEnabled ? 'Pausar live' : 'Iniciar live'}
            >
              {runtime.autopilotEnabled ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
            </button>
            <EditorIconButton title="Proximo clipe" onClick={() => void advanceVideo()}>
              <FastForward className="h-4 w-4" />
            </EditorIconButton>
            <span>{formatEditorTimestamp(clipDuration)}</span>
          </div>

          <div className="flex items-center justify-end gap-2">
            <EditorIconButton title="Reduzir zoom">
              <ZoomOut className="h-4 w-4" />
            </EditorIconButton>
            <input
              type="range"
              min="40"
              max="180"
              defaultValue="100"
              aria-label="Zoom do palco"
              className="h-1 w-28 accent-[var(--gold)]"
            />
            <EditorIconButton title="Aumentar zoom">
              <ZoomIn className="h-4 w-4" />
            </EditorIconButton>
            <EditorIconButton title="Tela cheia" onClick={toggleFullscreen}>
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </EditorIconButton>
          </div>
        </div>
      </section>

      <ClipTimeline
        current={activeClip}
        upcoming={upcomingClips}
        view={view}
        mode={timelineMode}
        zoom={timelineZoom}
        selectedClipId={selectedClipId || activeNodeId || ''}
        selectedConnectionId={selectedConnectionId || activeConnectionId || ''}
        activeNodeId={activeNodeId}
        activeConnectionId={activeConnectionId}
        nextConnectionIds={videoState?.nextConnectionIds}
        blockedConnectionIds={videoState?.blockedConnectionIds}
        onModeChange={setTimelineMode}
        onZoomChange={setTimelineZoom}
        onSelectClip={setSelectedClipId}
        onSelectConnection={setSelectedConnectionId}
        onPatchClip={onPatchFlowNodePlayback}
        onPatchConnection={onPatchFlowConnectionSettings}
        onPreviewConnection={previewConnection}
      />

      <div className="flex shrink-0 flex-col gap-3 border-t border-white/10 bg-[#0d0f12] px-4 py-3 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={simulateGift}
            className="inline-flex items-center gap-2 text-xs font-semibold text-slate-400 transition hover:text-white"
          >
            <RadioTower className="h-4 w-4" />
            Simular Rosa pelo ingest
          </button>
          <span className="hidden h-5 w-px bg-white/10 md:inline" />
          <span className="flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: obsDirectStatus?.state === 'connected' ? '#34d399' : obsDirectStatus?.state === 'connecting' ? '#fbbf24' : '#64748b' }}>
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: obsDirectStatus?.state === 'connected' ? '#34d399' : obsDirectStatus?.state === 'connecting' ? '#fbbf24' : '#64748b' }} />
            {obsDirectStatus?.state === 'connected' ? 'OBS Direto' : obsDirectStatus?.state === 'connecting' ? 'Conectando...' : 'OBS Offline'}
          </span>
          <Button
            size="sm"
            variant="secondary"
            loading={obsBusy === 'Preparar OBS'}
            onClick={() => void runRoutedCommand('Preparar OBS', () => routeSetupLiveScene(obsSettingsFromApp))}
          >
            Preparar OBS
          </Button>
          <Button
            size="sm"
            variant="secondary"
            loading={obsBusy === 'Tela inicial'}
            onClick={() => void runRoutedCommand('Tela inicial', () => routeShowStart(obsSettingsFromApp))}
          >
            Tela inicial
          </Button>
          <Button
            size="sm"
            variant="secondary"
            loading={obsBusy === 'Palco ao vivo'}
            onClick={() => void runRoutedCommand('Palco ao vivo', () => routeShowStage(obsSettingsFromApp))}
          >
            Palco ao vivo
          </Button>
          <Button
            size="sm"
            variant="primary"
            loading={obsBusy === 'Iniciar transmissao'}
            onClick={() => void runRoutedCommand('Iniciar transmissao', () => routeStartTransmission(obsSettingsFromApp))}
          >
            Iniciar transmissao
          </Button>
          <Button
            size="sm"
            variant="secondary"
            loading={obsBusy === 'Parar transmissao'}
            onClick={() => void runRoutedCommand('Parar transmissao', () => routeStopTransmission(obsSettingsFromApp))}
          >
            Parar transmissao
          </Button>
          {obsMessage && <span className="truncate text-xs text-slate-500">{obsMessage}</span>}
          {previewMessage && <span className="truncate text-xs text-emerald-300">{previewMessage}</span>}
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <select
            value={manualVideoId}
            onChange={(event) => setManualVideoId(event.target.value)}
            className="h-9 min-w-0 flex-1 rounded-lg border border-white/10 bg-[#15161a] px-3 text-sm text-slate-200 outline-none focus:border-[var(--gold)] md:w-72"
          >
            <option value="">Escolher video...</option>
            {view.videos.map((video) => (
              <option key={video.id} value={video.id}>
                {videoLabel(video)}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            loading={triggering}
            variant="secondary"
            onClick={() => forceVideo(manualVideoId)}
          >
            Tocar
          </Button>
        </div>
      </div>
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
  const videos = config?.videos || [];

  const uploadSummary = useMemo(
    () => ({
      sent: uploadBatch.filter((item) => item.status === 'done').length,
      failed: uploadBatch.filter((item) => item.status === 'error').length,
      pending: uploadBatch.filter(
        (item) => item.status === 'pending' || item.status === 'uploading',
      ).length,
    }),
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
