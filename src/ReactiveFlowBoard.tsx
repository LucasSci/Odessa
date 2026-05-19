import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Connection,
  Controls,
  Edge,
  Handle,
  MiniMap,
  Node,
  NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  BellRing,
  CircleDot,
  Download,
  Eye,
  MousePointer2,
  Play,
  Plus,
  RadioTower,
  RefreshCw,
  Save,
  Scissors,
  Trash2,
  Upload,
  Video,
} from 'lucide-react';
import { Badge, Button, Input, Skeleton, StatusDot } from './components/ui';
import { loadRulesFromFlowTriggers } from './core/giftEventBus';
import { apiUrl } from './lib/api';
import { cn } from './lib/utils';

type VideoEntry = {
  id: string;
  label?: string;
  group?: string;
  description?: string;
  loop?: boolean;
  tags?: string[];
  missingFile?: boolean;
};

type PlaybackSettings = {
  startSec: number;
  endSec: number | null;
  transitionMs: number;
};

type ClipAudioSettings = {
  mode: 'muted' | 'original' | 'track';
  volume: number;
  trackId?: string;
  trackUrl?: string;
};

type FlowPosition = { x: number; y: number };

type FlowNode = {
  nodeId: string;
  videoId: string;
  label?: string;
  position: FlowPosition;
  playback: PlaybackSettings;
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
    nodeId?: string;
    videoId?: string;
    playback?: PlaybackSettings;
    audio?: ClipAudioSettings;
    returnToIdle?: boolean;
    payload?: { videoId?: string; sceneName?: string; scene?: string; requestedScene?: string };
  }>;
  cooldown_ms?: number;
  priority?: number;
};

type FlowConnection = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  fromVideoId?: string;
  toVideoId?: string;
  triggerId: string;
  returnToIdle?: boolean;
};

type PersonaConfig = {
  videos: VideoEntry[];
  triggers: TriggerEntry[];
  idleVideoId?: string;
  flowNodes?: FlowNode[];
  flowConnections?: FlowConnection[];
  flowCanvasVideoIds?: string[];
  flowLayout?: Record<string, FlowPosition>;
  action_map?: Record<string, string[]>;
  transitions?: Record<string, { safe_next: string[] }>;
  workflowMeta?: {
    workflowId?: string;
    version?: number;
    status?: 'draft' | 'published';
    updatedAt?: string;
    publishedAt?: string;
    lastValidation?: Record<string, unknown>;
  };
  [key: string]: unknown;
};

type VideoNodeData = {
  flowNode: FlowNode;
  video: VideoEntry;
  isIdle: boolean;
  isActive?: boolean;
  isNext?: boolean;
};

type VideoFlowNodeType = Node<VideoNodeData, 'videoNode'>;

type FlowRuntimeState = {
  activeNodeId?: string | null;
  activeConnectionId?: string | null;
  nextConnectionIds?: string[];
  blockedConnectionIds?: string[];
  executionMode?: 'live' | 'test';
  lastTransitionAt?: number | null;
};

const DEFAULT_PLAYBACK: PlaybackSettings = { startSec: 0, endSec: null, transitionMs: 220 };

function shortVideo(video?: VideoEntry) {
  if (!video) return 'Video';
  return (
    video.label ||
    video.id
      .replace(/^grok-/, '')
      .split('-')
      .slice(0, 4)
      .join(' ')
  );
}

function playbackFrom(value?: Partial<PlaybackSettings>): PlaybackSettings {
  const startSec = Math.max(0, Number(value?.startSec || 0));
  const rawEnd = value?.endSec;
  const endSec = rawEnd === null || rawEnd === undefined || Number(rawEnd) <= startSec
    ? null
    : Math.max(0, Number(rawEnd));
  const transitionMs = Math.max(0, Math.min(2000, Number(value?.transitionMs ?? 220)));
  return { startSec, endSec, transitionMs };
}

function audioFrom(value?: Partial<ClipAudioSettings>): ClipAudioSettings {
  const mode = value?.mode === 'original' || value?.mode === 'track' ? value.mode : 'muted';
  const volume = Math.max(0, Math.min(1, Number(value?.volume ?? 1)));
  return {
    mode,
    volume,
    trackId: value?.trackId || '',
    trackUrl: value?.trackUrl || '',
  };
}

function newNodeId(videoId: string) {
  return `node-${videoId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function nodeTitle(node?: FlowNode, video?: VideoEntry) {
  return node?.label || shortVideo(video);
}

function actionVideoId(trigger: TriggerEntry) {
  const action = trigger.actions?.find((item) => item.type === 'play_video');
  return action?.videoId || action?.payload?.videoId || '';
}

function actionNodeId(trigger: TriggerEntry) {
  const action = trigger.actions?.find((item) => item.type === 'play_video');
  return action?.nodeId || '';
}

function eventKey(trigger?: TriggerEntry) {
  if (!trigger) return 'sem.regra';
  if (trigger.eventType === 'gift') return trigger.conditions?.giftKey || 'gift.*';
  if (trigger.eventType === 'comment') return trigger.conditions?.keyword || 'chat.keyword';
  if (trigger.eventType === 'natural') return 'Ao finalizar';
  return trigger.eventType;
}

function defaultTriggerName(trigger?: TriggerEntry) {
  return trigger?.name || eventKey(trigger).replace('.', ' ');
}

function uniqueList(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function findVideo(videos: VideoEntry[], videoId?: string) {
  return videos.find((video) => video.id === videoId);
}

/** Placeholder for imported nodes whose video isn't in the library yet */
function placeholderVideo(videoId: string): VideoEntry {
  return { id: videoId, label: `[${videoId}]`, description: 'Video nao encontrado na biblioteca', missingFile: true };
}

function makeFlowNode(video: VideoEntry, index: number, position?: FlowPosition): FlowNode {
  return {
    nodeId: newNodeId(video.id),
    videoId: video.id,
    label: shortVideo(video),
    position: position || {
      x: 80 + (index % 4) * 270,
      y: 80 + Math.floor(index / 4) * 210,
    },
    playback: DEFAULT_PLAYBACK,
    audio: audioFrom(),
  };
}

function makeNode(
  flowNode: FlowNode,
  video: VideoEntry,
  idleVideoId: string,
  flowState?: FlowRuntimeState | null,
): VideoFlowNodeType {
  return {
    id: flowNode.nodeId,
    type: 'videoNode',
    position: flowNode.position,
        data: {
      flowNode: { ...flowNode, playback: playbackFrom(flowNode.playback), audio: audioFrom(flowNode.audio) },
      video,
      isIdle: video.id === idleVideoId,
      isActive: flowState?.activeNodeId === flowNode.nodeId,
      isNext: Boolean(flowState?.nextConnectionIds?.some((id) => id && id.includes(flowNode.nodeId))),
    },
  };
}

function makeEdge(
  connection: FlowConnection,
  trigger?: TriggerEntry,
  flowState?: FlowRuntimeState | null,
  animateFlow = true,
): Edge {
  const isNatural = trigger?.eventType === 'natural';
  const isActive = flowState?.activeConnectionId === connection.id;
  const isNext = Boolean(flowState?.nextConnectionIds?.includes(connection.id));
  const isBlocked = Boolean(flowState?.blockedConnectionIds?.includes(connection.id));
  return {
    id: connection.id,
    source: connection.fromNodeId,
    target: connection.toNodeId,
    type: 'smoothstep',
    animated: animateFlow && (isActive || isNext),
    label: eventKey(trigger),
    data: { triggerId: connection.triggerId },
    style: {
      stroke: isBlocked
        ? '#f87171'
        : isActive
          ? '#bef264'
          : isNext
            ? '#fbbf24'
            : trigger?.enabled
              ? (isNatural ? '#fbbf24' : 'var(--accent)')
              : 'rgba(255,255,255,0.24)',
      strokeWidth: isActive ? 4 : isNatural || isNext ? 3 : 2,
      filter: isActive ? 'drop-shadow(0 0 10px rgba(190,242,100,0.45))' : undefined,
    },
    labelStyle: { fill: isNatural ? '#fbbf24' : '#dff7ff', fontSize: 11, fontWeight: 700 },
    labelBgStyle: { fill: '#0b0d10', fillOpacity: 0.92 },
  };
}

function triggerToConnection(
  trigger: TriggerEntry,
  nodes: FlowNode[],
  idleNodeId: string,
): FlowConnection | null {
  const targetNodeId = actionNodeId(trigger) || nodes.find((node) => node.videoId === actionVideoId(trigger))?.nodeId;
  const targetNode = nodes.find((node) => node.nodeId === targetNodeId);
  const idleNode = nodes.find((node) => node.nodeId === idleNodeId);
  if (!targetNode || !idleNode) return null;
  return {
    id: `flow-${trigger.id}`,
    fromNodeId: idleNode.nodeId,
    toNodeId: targetNode.nodeId,
    fromVideoId: idleNode.videoId,
    toVideoId: targetNode.videoId,
    triggerId: trigger.id,
    returnToIdle: true,
  };
}

function normalizeTriggerForConnection(
  trigger: TriggerEntry,
  connection: FlowConnection,
  nodeById: Map<string, FlowNode>,
): TriggerEntry {
  const target = nodeById.get(connection.toNodeId);
  const extraActions = (trigger.actions || []).filter((action) => action.type !== 'play_video');
  return {
    ...trigger,
    actions: [
      {
        type: 'play_video',
        nodeId: target?.nodeId,
        videoId: target?.videoId || connection.toVideoId,
        playback: playbackFrom(target?.playback),
        audio: audioFrom(target?.audio),
        returnToIdle: connection.returnToIdle !== false,
      },
      ...extraActions,
    ],
  };
}

function buildTransitions(
  connections: FlowConnection[],
  triggers: TriggerEntry[],
  idleVideoId: string,
  nodeById: Map<string, FlowNode>,
) {
  const transitions: Record<string, { safe_next: string[] }> = {};
  const triggerById = new Map(triggers.map((trigger) => [trigger.id, trigger]));

  connections.forEach((connection) => {
    const trigger = triggerById.get(connection.triggerId);
    const fromVideoId = nodeById.get(connection.fromNodeId)?.videoId || connection.fromVideoId;
    const toVideoId = nodeById.get(connection.toNodeId)?.videoId || connection.toVideoId;
    if (!trigger || !fromVideoId || !toVideoId) return;

    if (trigger.eventType === 'natural') {
      transitions[fromVideoId] ||= { safe_next: [] };
      transitions[fromVideoId].safe_next = uniqueList([...transitions[fromVideoId].safe_next, toVideoId]);
      return;
    }

    if (connection.returnToIdle !== false && idleVideoId) {
      transitions[toVideoId] ||= { safe_next: [] };
      transitions[toVideoId].safe_next = uniqueList([...transitions[toVideoId].safe_next, idleVideoId]);
    }
  });

  return transitions;
}

function buildActionMap(current: Record<string, string[]> | undefined, triggers: TriggerEntry[], idleVideoId: string) {
  const nextMap: Record<string, string[]> = { ...(current || {}) };
  nextMap.idle = idleVideoId ? [idleVideoId] : [];
  nextMap.gift = [];
  nextMap.message = [];

  triggers.forEach((trigger) => {
    if (!trigger.enabled) return;
    const videoId = actionVideoId(trigger);
    if (!videoId) return;
    if (trigger.eventType === 'gift') nextMap.gift.push(videoId);
    if (trigger.eventType === 'comment') nextMap.message.push(videoId);
  });

  nextMap.gift = uniqueList(nextMap.gift);
  nextMap.message = uniqueList(nextMap.message);
  return nextMap;
}

function secondsLabel(value: number | null | undefined) {
  if (value === null || value === undefined) return 'fim';
  return `${Number(value).toFixed(1)}s`;
}

function StaticThumbnail({ videoId, className }: { videoId: string; className?: string }) {
  return (
    <div className={cn('overflow-hidden bg-black', className)}>
      <video
        src={apiUrl(`/video/play/${videoId}`)}
        className="h-full w-full object-cover opacity-75"
        muted
        playsInline
        preload="metadata"
      />
    </div>
  );
}

function VideoFlowNode({ data, selected }: NodeProps<VideoFlowNodeType>) {
  const playback = playbackFrom(data.flowNode.playback);
  return (
    <div
      className={cn(
        'w-56 overflow-hidden rounded-[24px] border bg-[#0b0d10] shadow-2xl transition',
        data.isActive && 'odessa-flow-node-active border-lime-200/80',
        selected ? 'border-sky-200/70 shadow-[0_0_40px_rgba(125,211,252,0.2)]' : 'border-[var(--border)]',
      )}
    >
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-sky-100 !bg-sky-300" />
      <div className="relative aspect-video bg-black">
        <StaticThumbnail videoId={data.video.id} className="h-full w-full" />
        <div className="absolute left-2 top-2 flex gap-1.5">
          {data.isIdle && <Badge variant="gold">Idle</Badge>}
          {data.isActive && <Badge variant="success">Agora</Badge>}
          {data.video.missingFile && <Badge variant="warning">Sem arquivo</Badge>}
          <Badge variant="lavender">{secondsLabel(playback.startSec)} {'->'} {secondsLabel(playback.endSec)}</Badge>
        </div>
      </div>
      <div className="p-3">
        <div className="truncate text-sm font-semibold text-white">{nodeTitle(data.flowNode, data.video)}</div>
        <div className="mt-1 truncate text-[11px] text-[var(--t3)]">{data.video.group || data.video.id}</div>
      </div>
      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !border-sky-100 !bg-sky-300" />
    </div>
  );
}

const nodeTypes = { videoNode: VideoFlowNode };

export default function ReactiveFlowBoard({ onSaved }: { onSaved?: () => void }) {
  return (
    <ReactFlowProvider>
      <ReactiveFlowCanvas onSaved={onSaved} />
    </ReactFlowProvider>
  );
}

function ReactiveFlowCanvas({ onSaved }: { onSaved?: () => void }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const { screenToFlowPosition } = useReactFlow();
  const [config, setConfig] = useState<PersonaConfig | null>(null);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const [flowState, setFlowState] = useState<FlowRuntimeState | null>(null);
  const [animateFlow, setAnimateFlow] = useState(() => localStorage.getItem('odessa:flow-animate') !== 'false');
  const [workflowPreview, setWorkflowPreview] = useState<Record<string, unknown> | null>(null);
  const [pendingWorkflow, setPendingWorkflow] = useState<Record<string, unknown> | null>(null);
  const [publishPreview, setPublishPreview] = useState<Record<string, unknown> | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<VideoFlowNodeType>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const loadConfig = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch(apiUrl('/workflow/draft'));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as PersonaConfig;
      console.log('[Odessa] loadConfig:', {
        videos: data.videos?.length ?? 0,
        flowNodes: data.flowNodes?.length ?? 0,
        triggers: data.triggers?.length ?? 0,
        flowConnections: data.flowConnections?.length ?? 0,
        idleVideoId: data.idleVideoId,
      });
      const idleVideoId =
        data.idleVideoId ||
        data.action_map?.idle?.[0] ||
        data.videos.find((video) => video.loop)?.id ||
        data.videos[0]?.id ||
        '';
      const nextFlowNodes = (data.flowNodes || []).map((node) => ({
        ...node,
        playback: playbackFrom(node.playback),
        audio: audioFrom(node.audio),
      }));
      const idleNodeId =
        nextFlowNodes.find((node) => node.videoId === idleVideoId)?.nodeId ||
        nextFlowNodes[0]?.nodeId ||
        '';
      const flowConnections =
        Array.isArray(data.flowConnections) && data.flowConnections.length > 0
          ? data.flowConnections
          : ((data.triggers || [])
              .map((trigger) => triggerToConnection(trigger, nextFlowNodes, idleNodeId))
              .filter(Boolean) as FlowConnection[]);
      const nodeById = new Map(nextFlowNodes.map((node) => [node.nodeId, node]));
      const nextConnections = flowConnections
        .map((connection) => ({
          ...connection,
          fromNodeId: connection.fromNodeId,
          toNodeId: connection.toNodeId,
          fromVideoId: nodeById.get(connection.fromNodeId)?.videoId || connection.fromVideoId,
          toVideoId: nodeById.get(connection.toNodeId)?.videoId || connection.toVideoId,
          returnToIdle: connection.returnToIdle !== false,
        }))
        .filter((connection) => nodeById.has(connection.fromNodeId) && nodeById.has(connection.toNodeId));
      const nextTriggers = (data.triggers || []).map((trigger) => {
        const connection = nextConnections.find((item) => item.triggerId === trigger.id);
        return connection ? normalizeTriggerForConnection(trigger, connection, nodeById) : trigger;
      });
      const nextVideos = data.videos.map((video) => ({
        ...video,
        loop: video.id === idleVideoId ? true : Boolean(video.loop && video.id === idleVideoId),
      }));
      const nextConfig = {
        ...data,
        videos: nextVideos,
        idleVideoId,
        flowNodes: nextFlowNodes,
        flowConnections: nextConnections,
        triggers: nextTriggers,
        action_map: { ...(data.action_map || {}), idle: idleVideoId ? [idleVideoId] : [] },
      };
      setConfig(nextConfig);
      setNodes(
        nextFlowNodes
          .map((flowNode) => {
            const video = findVideo(nextVideos, flowNode.videoId) || placeholderVideo(flowNode.videoId);
            return makeNode(flowNode, video, idleVideoId, null);
          }),
      );
      setEdges(
        nextConnections.map((connection) =>
          makeEdge(connection, nextTriggers.find((trigger) => trigger.id === connection.triggerId), null, animateFlow),
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar fluxo');
    }
  }, [animateFlow, setEdges, setNodes]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadConfig();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadConfig]);

  const videos = useMemo(() => config?.videos || [], [config?.videos]);
  const triggers = useMemo(() => config?.triggers || [], [config?.triggers]);
  const connections = useMemo(() => config?.flowConnections || [], [config?.flowConnections]);
  const flowNodes = useMemo(() => config?.flowNodes || [], [config?.flowNodes]);
  const idleVideoId = config?.idleVideoId || '';
  const nodeById = useMemo(() => new Map(flowNodes.map((node) => [node.nodeId, node])), [flowNodes]);
  const selectedFlowNode = nodeById.get(selectedNodeId);
  const selectedVideo = findVideo(videos, selectedFlowNode?.videoId);
  const selectedConnection = connections.find((connection) => connection.id === selectedEdgeId);
  const selectedTrigger = triggers.find((trigger) => trigger.id === selectedConnection?.triggerId);
  const selectedTargetNode = nodeById.get(selectedConnection?.toNodeId || '');
  const selectedTargetVideo = findVideo(videos, selectedTargetNode?.videoId);
  const selectedNodeConnections = connections.filter((connection) => connection.toNodeId === selectedNodeId);
  const selectedNodeTriggers = selectedNodeConnections
    .map((connection) => ({
      connection,
      trigger: triggers.find((trigger) => trigger.id === connection.triggerId),
    }))
    .filter((entry): entry is { connection: FlowConnection; trigger: TriggerEntry } => Boolean(entry.trigger));

  const refreshFlowState = useCallback(async () => {
    try {
      const response = await fetch(apiUrl('/video/state'));
      if (!response.ok) return;
      const data = await response.json();
      setFlowState({
        activeNodeId: data.activeNodeId || data.currentClip?.nodeId || null,
        activeConnectionId: data.activeConnectionId || null,
        nextConnectionIds: Array.isArray(data.nextConnectionIds) ? data.nextConnectionIds : [],
        blockedConnectionIds: Array.isArray(data.blockedConnectionIds) ? data.blockedConnectionIds : [],
        executionMode: data.executionMode || 'live',
        lastTransitionAt: data.lastTransitionAt || data.start_ts || null,
      });
    } catch {
      // Flow animation is best-effort; editing must keep working offline.
    }
  }, []);

  useEffect(() => {
    void refreshFlowState();
    const interval = window.setInterval(refreshFlowState, 1500);
    return () => window.clearInterval(interval);
  }, [refreshFlowState]);

  useEffect(() => {
    if (!config) return;
    setNodes((current) =>
      current.map((node) => ({
        ...node,
        data: {
          ...node.data,
          isActive: flowState?.activeNodeId === node.id,
        },
      })),
    );
    setEdges(
      connections.map((connection) =>
        makeEdge(
          connection,
          triggers.find((trigger) => trigger.id === connection.triggerId),
          flowState,
          animateFlow,
        ),
      ),
    );
  }, [animateFlow, config, connections, flowState, setEdges, setNodes, triggers]);

  const filteredVideos = useMemo(() => {
    const clean = query.trim().toLowerCase();
    return videos.filter((video) =>
      [video.id, video.label, video.group, video.description, ...(video.tags || [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(clean),
    );
  }, [query, videos]);

  const syncEdges = useCallback(
    (nextConnections: FlowConnection[], nextTriggers: TriggerEntry[]) => {
      setEdges(
        nextConnections.map((connection) =>
          makeEdge(
            connection,
            nextTriggers.find((trigger) => trigger.id === connection.triggerId),
            flowState,
            animateFlow,
          ),
        ),
      );
    },
    [animateFlow, flowState, setEdges],
  );

  const updateConfig = useCallback((recipe: (current: PersonaConfig) => PersonaConfig) => {
    setConfig((current) => {
      if (!current) return current;
      const next = recipe(current);
      const nextNodeById = new Map((next.flowNodes || []).map((node) => [node.nodeId, node]));
      setNodes((currentNodes) =>
        currentNodes.map((node) => {
          const flowNode = nextNodeById.get(node.id);
          const video = next.videos.find((item) => item.id === flowNode?.videoId);
          return flowNode && video
            ? { ...node, data: { flowNode: { ...flowNode, audio: audioFrom(flowNode.audio) }, video, isIdle: video.id === next.idleVideoId } }
            : node;
        }),
      );
      syncEdges(next.flowConnections || [], next.triggers || []);
      return next;
    });
  }, [setNodes, syncEdges]);

  const updateFlowNode = (nodeId: string, patch: Partial<FlowNode>) => {
    updateConfig((current) => ({
      ...current,
      flowNodes: (current.flowNodes || []).map((node) =>
        node.nodeId === nodeId
          ? { ...node, ...patch, playback: playbackFrom(patch.playback || node.playback) }
          : node,
      ),
    }));
  };

  const updatePlayback = (nodeId: string, patch: Partial<PlaybackSettings>) => {
    const node = nodeById.get(nodeId);
    if (!node) return;
    updateFlowNode(nodeId, { playback: playbackFrom({ ...node.playback, ...patch }) });
  };

  const updateAudio = (nodeId: string, patch: Partial<ClipAudioSettings>) => {
    const node = nodeById.get(nodeId);
    if (!node) return;
    updateFlowNode(nodeId, { audio: audioFrom({ ...audioFrom(node.audio), ...patch }) });
  };

  const createConnection = useCallback(
    (connection: Connection) => {
      if (!config || !connection.source || !connection.target || connection.source === connection.target) return;
      const fromNode = nodeById.get(connection.source);
      const toNode = nodeById.get(connection.target);
      if (!fromNode || !toNode) return;
      const triggerId = `trigger-${Date.now()}`;
      const edgeId = `flow-${triggerId}`;
      const trigger: TriggerEntry = {
        id: triggerId,
        name: `Quando ${nodeTitle(toNode, findVideo(videos, toNode.videoId))}`,
        enabled: true,
        eventType: 'gift',
        conditions: { giftKey: 'gift.rosa' },
        actions: [
          {
            type: 'play_video',
            nodeId: toNode.nodeId,
            videoId: toNode.videoId,
            playback: playbackFrom(toNode.playback),
            audio: audioFrom(toNode.audio),
            returnToIdle: true,
          },
        ],
        priority: 1,
        cooldown_ms: 2500,
      };
      const flowConnection: FlowConnection = {
        id: edgeId,
        fromNodeId: fromNode.nodeId,
        toNodeId: toNode.nodeId,
        fromVideoId: fromNode.videoId,
        toVideoId: toNode.videoId,
        triggerId,
        returnToIdle: true,
      };
      const nextConnections = [...(config.flowConnections || []), flowConnection];
      const nextTriggers = [...(config.triggers || []), trigger];
      setConfig({ ...config, triggers: nextTriggers, flowConnections: nextConnections });
      setEdges((eds) => addEdge(makeEdge(flowConnection, trigger), eds));
      setSelectedEdgeId(edgeId);
      setSelectedNodeId('');
    },
    [config, nodeById, setEdges, videos],
  );

  const addNodeToCanvas = useCallback((video: VideoEntry, position?: FlowPosition) => {
    const flowNode = makeFlowNode(video, nodes.length, position);
    setNodes((current) => [...current, makeNode(flowNode, video, idleVideoId)]);
    updateConfig((current) => ({
      ...current,
      flowNodes: [...(current.flowNodes || []), flowNode],
      flowCanvasVideoIds: uniqueList([...(current.flowCanvasVideoIds || []), video.id]),
    }));
    setSelectedNodeId(flowNode.nodeId);
    setSelectedEdgeId('');
  }, [idleVideoId, nodes.length, setNodes, updateConfig]);

  const setIdleFromNode = (nodeId: string) => {
    const idleNode = nodeById.get(nodeId);
    if (!idleNode) return;
    updateConfig((current) => ({
      ...current,
      idleVideoId: idleNode.videoId,
      videos: current.videos.map((video) => ({ ...video, loop: video.id === idleNode.videoId })),
      flowConnections: (current.flowConnections || []).map((connection) => {
        const trigger = current.triggers.find((item) => item.id === connection.triggerId);
        return trigger && trigger.eventType !== 'natural'
          ? {
              ...connection,
              fromNodeId: idleNode.nodeId,
              fromVideoId: idleNode.videoId,
            }
          : connection;
      }),
      action_map: { ...(current.action_map || {}), idle: [idleNode.videoId] },
    }));
    setSelectedNodeId(nodeId);
  };

  const updateTrigger = (triggerId: string, patch: Partial<TriggerEntry>) => {
    updateConfig((current) => {
      const connection = (current.flowConnections || []).find((item) => item.triggerId === triggerId);
      const currentNodeById = new Map((current.flowNodes || []).map((node) => [node.nodeId, node]));
      return {
        ...current,
        triggers: current.triggers.map((trigger) =>
          trigger.id === triggerId
            ? normalizeTriggerForConnection({ ...trigger, ...patch }, connection || {
                id: `flow-${triggerId}`,
                fromNodeId: '',
                toNodeId: actionNodeId(trigger),
                triggerId,
                returnToIdle: true,
              }, currentNodeById)
            : trigger,
        ),
      };
    });
  };

  const updateConnection = (connectionId: string, patch: Partial<FlowConnection>) => {
    updateConfig((current) => {
      const nextConnections = (current.flowConnections || []).map((connection) =>
        connection.id === connectionId ? { ...connection, ...patch } : connection,
      );
      const currentNodeById = new Map((current.flowNodes || []).map((node) => [node.nodeId, node]));
      const nextTriggers = current.triggers.map((trigger) => {
        const connection = nextConnections.find((item) => item.triggerId === trigger.id);
        return connection ? normalizeTriggerForConnection(trigger, connection, currentNodeById) : trigger;
      });
      return { ...current, flowConnections: nextConnections, triggers: nextTriggers };
    });
  };

  const updateSelectedTrigger = (patch: Partial<TriggerEntry>) => {
    if (!selectedConnection) return;
    updateTrigger(selectedConnection.triggerId, patch);
  };

  const updateSelectedConnection = (patch: Partial<FlowConnection>) => {
    if (!selectedConnection) return;
    updateConnection(selectedConnection.id, patch);
  };

  const toggleVideoLoop = (videoId: string, loop: boolean) => {
    updateConfig((current) => ({
      ...current,
      videos: current.videos.map((video) =>
        video.id === videoId ? { ...video, loop: video.id === current.idleVideoId ? true : loop } : video,
      ),
    }));
  };

  const toggleTargetLoop = (loop: boolean) => {
    if (!selectedTargetVideo) return;
    toggleVideoLoop(selectedTargetVideo.id, loop);
  };

  const createNodeTrigger = (nodeId: string) => {
    const targetNode = nodeById.get(nodeId);
    if (!config || !targetNode) return;
    const idleNode = flowNodes.find((node) => node.videoId === idleVideoId) || flowNodes[0];
    if (!idleNode) return;
    const triggerId = `trigger-${Date.now()}`;
    const connectionId = `flow-${triggerId}`;
    const trigger: TriggerEntry = {
      id: triggerId,
      name: `Quando ${nodeTitle(targetNode, findVideo(videos, targetNode.videoId))}`,
      enabled: true,
      eventType: 'gift',
      conditions: { giftKey: 'gift.rosa' },
      actions: [
        {
          type: 'play_video',
          nodeId: targetNode.nodeId,
          videoId: targetNode.videoId,
          playback: playbackFrom(targetNode.playback),
          returnToIdle: true,
        },
      ],
      priority: 1,
      cooldown_ms: 2500,
    };
    const connection: FlowConnection = {
      id: connectionId,
      fromNodeId: idleNode.nodeId,
      toNodeId: targetNode.nodeId,
      fromVideoId: idleNode.videoId,
      toVideoId: targetNode.videoId,
      triggerId,
      returnToIdle: true,
    };
    updateConfig((current) => ({
      ...current,
      triggers: [...(current.triggers || []), trigger],
      flowConnections: [...(current.flowConnections || []), connection],
    }));
    setSelectedEdgeId(connectionId);
    setSelectedNodeId('');
  };

  const removeTrigger = (triggerId: string) => {
    updateConfig((current) => ({
      ...current,
      flowConnections: (current.flowConnections || []).filter((connection) => connection.triggerId !== triggerId),
      triggers: current.triggers.filter((trigger) => trigger.id !== triggerId),
    }));
    if (selectedConnection?.triggerId === triggerId) setSelectedEdgeId('');
  };

  const removeSelectedConnection = () => {
    if (!selectedConnection) return;
    removeTrigger(selectedConnection.triggerId);
  };

  const removeSelectedNode = () => {
    if (!selectedFlowNode) return;
    const affectedConnectionIds = new Set(
      connections
        .filter((connection) => connection.fromNodeId === selectedFlowNode.nodeId || connection.toNodeId === selectedFlowNode.nodeId)
        .map((connection) => connection.id),
    );
    const affectedTriggerIds = new Set(
      connections
        .filter((connection) => affectedConnectionIds.has(connection.id))
        .map((connection) => connection.triggerId),
    );
    updateConfig((current) => ({
      ...current,
      flowNodes: (current.flowNodes || []).filter((node) => node.nodeId !== selectedFlowNode.nodeId),
      flowConnections: (current.flowConnections || []).filter((connection) => !affectedConnectionIds.has(connection.id)),
      triggers: current.triggers.filter((trigger) => !affectedTriggerIds.has(trigger.id)),
    }));
    setNodes((current) => current.filter((node) => node.id !== selectedFlowNode.nodeId));
    setEdges((current) => current.filter((edge) => !affectedConnectionIds.has(edge.id)));
    setSelectedNodeId('');
  };

  const clearMultiSelection = () => {
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);
    setSelectedNodeId('');
    setSelectedEdgeId('');
    setNodes((current) => current.map((node) => ({ ...node, selected: false })));
    setEdges((current) => current.map((edge) => ({ ...edge, selected: false })));
  };

  const deleteSelectedItems = () => {
    const nodeIds = new Set(selectedNodeIds);
    const edgeIds = new Set(selectedEdgeIds);
    if (!nodeIds.size && !edgeIds.size) return;
    const affectedConnectionIds = new Set(
      connections
        .filter(
          (connection) =>
            edgeIds.has(connection.id) || nodeIds.has(connection.fromNodeId) || nodeIds.has(connection.toNodeId),
        )
        .map((connection) => connection.id),
    );
    const affectedTriggerIds = new Set(
      connections
        .filter((connection) => affectedConnectionIds.has(connection.id))
        .map((connection) => connection.triggerId),
    );
    updateConfig((current) => ({
      ...current,
      flowNodes: (current.flowNodes || []).filter((node) => !nodeIds.has(node.nodeId)),
      flowConnections: (current.flowConnections || []).filter((connection) => !affectedConnectionIds.has(connection.id)),
      triggers: current.triggers.filter((trigger) => !affectedTriggerIds.has(trigger.id)),
    }));
    setNodes((current) => current.filter((node) => !nodeIds.has(node.id)));
    setEdges((current) => current.filter((edge) => !affectedConnectionIds.has(edge.id)));
    clearMultiSelection();
    setStatusMessage('Itens removidos do rascunho. Publique para alterar a live.');
  };

  const duplicateSelectedNodes = () => {
    if (!selectedNodeIds.length) return;
    const selected = flowNodes.filter((node) => selectedNodeIds.includes(node.nodeId));
    const clones = selected.map((node, index) => ({
      ...node,
      nodeId: newNodeId(node.videoId),
      label: `${node.label || shortVideo(findVideo(videos, node.videoId))} copia`,
      position: {
        x: node.position.x + 48 + index * 16,
        y: node.position.y + 48 + index * 16,
      },
    }));
    updateConfig((current) => ({
      ...current,
      flowNodes: [...(current.flowNodes || []), ...clones],
      flowCanvasVideoIds: uniqueList([...(current.flowCanvasVideoIds || []), ...clones.map((node) => node.videoId)]),
    }));
    setNodes((current) => [
      ...current,
      ...clones
        .map((node) => {
          const video = findVideo(videos, node.videoId);
          return video ? makeNode(node, video, idleVideoId) : null;
        })
        .filter(Boolean) as VideoFlowNodeType[],
    ]);
    setStatusMessage('Instancias duplicadas no rascunho.');
  };

  const alignSelectedNodes = () => {
    if (selectedNodeIds.length < 2) return;
    const selected = flowNodes.filter((node) => selectedNodeIds.includes(node.nodeId));
    const targetY = Math.round(Math.min(...selected.map((node) => node.position.y)));
    updateConfig((current) => ({
      ...current,
      flowNodes: (current.flowNodes || []).map((node) =>
        selectedNodeIds.includes(node.nodeId) ? { ...node, position: { ...node.position, y: targetY } } : node,
      ),
    }));
    setNodes((current) =>
      current.map((node) =>
        selectedNodeIds.includes(node.id) ? { ...node, position: { ...node.position, y: targetY } } : node,
      ),
    );
    setStatusMessage('Selecao alinhada no rascunho.');
  };

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const videoId = event.dataTransfer.getData('application/odessa-video') || event.dataTransfer.getData('text/plain');
      const video = videos.find((item) => item.id === videoId);
      if (!video || !wrapperRef.current) return;
      addNodeToCanvas(video, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
    },
    [addNodeToCanvas, screenToFlowPosition, videos],
  );

  const saveConfig = async () => {
    if (!config) return;
    setSaving(true);
    setError(null);
    const nextFlowNodes = nodes.map((node) => ({
      ...node.data.flowNode,
      position: {
        x: Math.round(node.position.x),
        y: Math.round(node.position.y),
      },
      playback: playbackFrom(node.data.flowNode.playback),
      audio: audioFrom(node.data.flowNode.audio),
    }));
    const nextNodeById = new Map(nextFlowNodes.map((node) => [node.nodeId, node]));
    const normalizedConnections = edges
      .map((edge) => {
        const existing = (config.flowConnections || []).find((connection) => connection.id === edge.id);
        const source = nextNodeById.get(edge.source);
        const target = nextNodeById.get(edge.target);
        if (!existing || !source || !target) return null;
        return {
          ...existing,
          fromNodeId: source.nodeId,
          toNodeId: target.nodeId,
          fromVideoId: source.videoId,
          toVideoId: target.videoId,
        };
      })
      .filter(Boolean) as FlowConnection[];
    const idleId = config.idleVideoId || config.action_map?.idle?.[0] || '';
    const nextTriggers = (config.triggers || []).map((trigger) => {
      const connection = normalizedConnections.find((item) => item.triggerId === trigger.id);
      return connection ? normalizeTriggerForConnection(trigger, connection, nextNodeById) : trigger;
    });
    const nextConfig: PersonaConfig = {
      ...config,
      idleVideoId: idleId,
      videos: config.videos.map((video) => ({ ...video, loop: video.id === idleId })),
      triggers: nextTriggers,
      flowNodes: nextFlowNodes,
      flowConnections: normalizedConnections,
      flowCanvasVideoIds: uniqueList(nextFlowNodes.map((node) => node.videoId)),
      flowLayout: nextFlowNodes.reduce<Record<string, FlowPosition>>((acc, node) => {
        acc[node.nodeId] = node.position;
        return acc;
      }, {}),
      action_map: buildActionMap(config.action_map, nextTriggers, idleId),
      transitions: buildTransitions(normalizedConnections, nextTriggers, idleId, nextNodeById),
    };

    try {
      const response = await fetch(apiUrl('/workflow/draft'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflow: nextConfig }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json().catch(() => ({}))) as { validation?: Record<string, unknown> };
      setConfig(nextConfig);
      setStatusMessage('Rascunho salvo. A live continua usando o fluxo publicado.');
      setPublishPreview(data.validation || null);
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar fluxo');
    } finally {
      setSaving(false);
    }
  };

  const validateDraft = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveConfig();
      const response = await fetch(apiUrl('/workflow/draft/validate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflow: config || {} }),
      });
      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) throw new Error(String(data.detail || `HTTP ${response.status}`));
      setPublishPreview(data);
      setStatusMessage('Rascunho validado sem publicar.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao validar rascunho');
    } finally {
      setSaving(false);
    }
  };

  const publishDraft = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveConfig();
      const response = await fetch(apiUrl('/workflow/publish'), { method: 'POST' });
      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) throw new Error(String(data.detail || `HTTP ${response.status}`));
      loadRulesFromFlowTriggers(config?.triggers || []);
      setPublishPreview(data);
      setStatusMessage('Fluxo publicado. A live usara esta versao nos proximos eventos.');
      await loadConfig();
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao publicar fluxo');
    } finally {
      setSaving(false);
    }
  };

  const resetDraft = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(apiUrl('/workflow/draft/reset-from-published'), { method: 'POST' });
      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) throw new Error(String(data.detail || `HTTP ${response.status}`));
      setStatusMessage('Rascunho revertido para a versao publicada.');
      setPublishPreview(data);
      await loadConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao reverter rascunho');
    } finally {
      setSaving(false);
    }
  };

  const testDraft = async () => {
    setTesting('draft');
    setError(null);
    try {
      await saveConfig();
      const response = await fetch(apiUrl('/workflow/draft/test'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Lucas enviou Rosa', kind: 'gift', source: 'draft' }),
      });
      const data = (await response.json().catch(() => ({}))) as { plan?: Array<Record<string, unknown>> };
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const active = data.plan?.find((item) => item.activeNodeId);
      setFlowState({
        activeNodeId: (active || {}).activeNodeId as string | null,
        activeConnectionId: (active || {}).activeConnectionId as string | null,
        nextConnectionIds: ((active || {}).nextConnectionIds as string[]) || [],
        blockedConnectionIds: (data.plan || [])
          .filter((item) => item.blockedReason && item.activeConnectionId)
          .map((item) => String(item.activeConnectionId)),
        executionMode: 'test',
        lastTransitionAt: null,
      });
      setStatusMessage('Teste do rascunho executado em dry-run.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao testar rascunho');
    } finally {
      setTesting('');
    }
  };

  const exportWorkflow = async () => {
    setError(null);
    try {
      if (!config) throw new Error('Rascunho indisponivel');
      const workflow = {
        schemaVersion: 'odessa.workflow.v1',
        workflowName: config.workflowName || 'Odessa Draft Workflow',
        exportedAt: new Date().toISOString(),
        idleVideoId: config.idleVideoId || '',
        flowNodes: config.flowNodes || [],
        flowConnections: config.flowConnections || [],
        triggers: config.triggers || [],
        stageSettings: config.stageSettings || {},
        mediaTracks: config.mediaTracks || [],
        transitions: config.transitions || {},
        videos: config.videos || [],
        workflowMeta: config.workflowMeta,
      };
      const blob = new Blob([JSON.stringify(workflow, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `odessa-workflow-${new Date().toISOString().slice(0, 19).replaceAll(':', '-')}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao exportar workflow');
    }
  };

  const validateWorkflowFile = async (file?: File | null) => {
    if (!file) return;
    setError(null);
    setStatusMessage(null);
    try {
      const raw = await file.text();
      console.log('[Odessa] Validando arquivo:', { name: file.name, size: raw.length });
      let workflow: Record<string, unknown>;
      try {
        workflow = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        throw new Error(`Arquivo "${file.name}" nao e um JSON valido.`);
      }
      if (!workflow || typeof workflow !== 'object') {
        throw new Error('JSON invalido: esperado um objeto com videos, flowNodes, triggers, etc.');
      }
      const hasFlowData = Array.isArray(workflow.flowNodes) || Array.isArray(workflow.triggers) || Array.isArray(workflow.videos);
      if (!hasFlowData) {
        throw new Error('JSON nao parece ser um workflow Odessa. Campos esperados: flowNodes, triggers, videos.');
      }
      const response = await fetch(apiUrl('/video/workflow/validate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(workflow),
      });
      const preview = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      console.log('[Odessa] Validacao:', { status: response.status, ok: preview.ok, warnings: preview.warnings });
      if (!response.ok) throw new Error(String(preview.detail || `HTTP ${response.status}`));
      setPendingWorkflow(workflow);
      setWorkflowPreview(preview);
    } catch (err) {
      console.error('[Odessa] Falha na validacao:', err);
      setError(err instanceof Error ? err.message : 'JSON de workflow invalido');
    } finally {
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  const applyWorkflowImport = async () => {
    if (!pendingWorkflow) return;
    setSaving(true);
    setError(null);
    try {
      const payload = { workflow: pendingWorkflow };
      const bodyStr = JSON.stringify(payload);
      console.log('[Odessa] Importando workflow:', {
        bodySize: bodyStr.length,
        flowNodes: Array.isArray(pendingWorkflow.flowNodes) ? (pendingWorkflow.flowNodes as unknown[]).length : 0,
        triggers: Array.isArray(pendingWorkflow.triggers) ? (pendingWorkflow.triggers as unknown[]).length : 0,
        videos: Array.isArray(pendingWorkflow.videos) ? (pendingWorkflow.videos as unknown[]).length : 0,
      });
      const response = await fetch(apiUrl('/workflow/draft'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodyStr,
      });
      const data = (await response.json().catch(() => ({}))) as { detail?: string; ok?: boolean; updatedAt?: string };
      console.log('[Odessa] Resposta import:', { status: response.status, ok: data.ok, updatedAt: data.updatedAt });
      if (!response.ok) throw new Error(data.detail || `HTTP ${response.status}`);
      if (!data.ok) throw new Error(data.detail || 'Servidor retornou ok=false');
      setPendingWorkflow(null);
      setWorkflowPreview(null);
      await loadConfig();
      setStatusMessage('Workflow importado como rascunho. Publique para usar na live.');
      onSaved?.();
    } catch (err) {
      console.error('[Odessa] Falha ao importar:', err);
      setError(err instanceof Error ? err.message : 'Falha ao importar workflow');
    } finally {
      setSaving(false);
    }
  };

  const toggleAnimateFlow = () => {
    setAnimateFlow((value) => {
      const next = !value;
      localStorage.setItem('odessa:flow-animate', String(next));
      return next;
    });
  };

  const simulate = async (trigger: TriggerEntry) => {
    const giftKey = trigger.conditions?.giftKey || 'gift.rosa';
    const giftName = giftKey.replace(/^gift\./, '');
    const text =
      trigger.eventType === 'gift'
        ? `Lucas enviou ${giftName.charAt(0).toUpperCase() + giftName.slice(1)}`
        : `@Viewer: ${trigger.conditions?.keyword || 'oi'}`;
    setTesting(trigger.id);
    try {
      const response = await fetch(apiUrl('/automation/dry-run'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          source: 'test',
          zoneName: 'Fluxo reativo',
          kind: trigger.eventType,
          execute: false,
          maxActions: 6,
          metadata: {
            triggerId: trigger.id,
            triggerTest: true,
          },
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (data.flowState) setFlowState(data.flowState);
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao testar gatilho');
    } finally {
      setTesting('');
    }
  };

  if (!config) {
    if (error) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
          <div className="rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
          <Button variant="secondary" onClick={loadConfig}>
            <RefreshCw className="h-4 w-4" />
            Tentar novamente
          </Button>
        </div>
      );
    }
    return (
      <div className="grid h-full gap-4 p-5 lg:grid-cols-[1fr_320px]">
        <Skeleton className="h-full rounded-[32px]" />
        <Skeleton className="h-full rounded-[32px]" />
      </div>
    );
  }

  return (
    <div className="grid h-[calc(100dvh-64px)] grid-rows-[1fr] gap-4 overflow-hidden p-4 xl:grid-cols-[280px_minmax(640px,1fr)_360px]">
      <aside className="odessa-panel flex min-h-0 flex-col overflow-hidden p-4">
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
          <Video className="h-4 w-4 text-sky-200" />
          Biblioteca
        </div>
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar videos..." />
        <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
          {filteredVideos.map((video) => {
            const copies = flowNodes.filter((node) => node.videoId === video.id).length;
            return (
              <button
                key={video.id}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'copy';
                  event.dataTransfer.setData('application/odessa-video', video.id);
                  event.dataTransfer.setData('text/plain', video.id);
                }}
                onClick={() => addNodeToCanvas(video)}
                className="w-full rounded-2xl border border-[var(--border)] bg-[rgba(255,255,255,0.035)] p-2 text-left transition hover:border-sky-200/35"
              >
                <div className="flex gap-3">
                  <StaticThumbnail videoId={video.id} className="h-14 w-20 shrink-0 rounded-xl" />
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-white">{shortVideo(video)}</div>
                    <div className="mt-1 truncate text-[10px] text-[var(--t3)]">{video.group || video.id}</div>
                    <div className="mt-1 flex gap-1">
                      {video.id === idleVideoId && <Badge variant="gold">Idle</Badge>}
                      {copies > 0 && <Badge variant="lavender">{copies} no canvas</Badge>}
                      {video.missingFile && <Badge variant="warning">placeholder</Badge>}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
          {filteredVideos.length === 0 && (
            <p className="px-2 py-4 text-center text-xs text-[var(--t3)]">
              {videos.length === 0
                ? 'Nenhum video. Adicione na Biblioteca.'
                : 'Nenhum video corresponde a busca.'}
            </p>
          )}
        </div>
      </aside>

      <section className="signal-lane-surface relative flex min-h-0 flex-col overflow-hidden rounded-[34px] border border-[var(--border)] bg-[var(--bg)]">
        <div className="absolute inset-x-5 top-5 z-20 flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-sky-200/70">
              <RadioTower className="h-4 w-4" />
              Fluxo Reativo
            </div>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-white">
              Use instancias independentes para montar rotas alternativas.
            </h1>
            <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-200">
              Editando rascunho - live usando versao publicada
              {config.workflowMeta?.version !== undefined && (
                <span className="text-emerald-100/60">v{config.workflowMeta.version}</span>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => void validateWorkflowFile(event.target.files?.[0])}
            />
            <Button onClick={() => importInputRef.current?.click()} variant="secondary">
              <Upload className="h-4 w-4" />
              Importar
            </Button>
            <Button onClick={exportWorkflow} variant="secondary">
              <Download className="h-4 w-4" />
              Exportar
            </Button>
            <Button onClick={toggleAnimateFlow} variant={animateFlow ? 'success' : 'secondary'}>
              <Eye className="h-4 w-4" />
              Fluxo
            </Button>
            <Button onClick={loadConfig} variant="secondary">
              <RefreshCw className="h-4 w-4" />
              Recarregar
            </Button>
            <Button onClick={() => void resetDraft()} loading={saving} variant="secondary">
              Reverter
            </Button>
            <Button onClick={() => void testDraft()} loading={testing === 'draft'} variant="secondary">
              <Play className="h-4 w-4" />
              Testar rascunho
            </Button>
            <Button onClick={() => void validateDraft()} loading={saving} variant="secondary">
              Validar
            </Button>
            <Button onClick={saveConfig} loading={saving} variant="primary">
              <Save className="h-4 w-4" />
              Salvar rascunho
            </Button>
            <Button onClick={() => void publishDraft()} loading={saving} variant="success">
              <RadioTower className="h-4 w-4" />
              Publicar fluxo
            </Button>
          </div>
        </div>

        {(error || statusMessage) && (
          <div
            className={cn(
              'absolute left-5 right-5 top-32 z-30 rounded-2xl border px-4 py-3 text-sm',
              error
                ? 'border-red-400/30 bg-red-500/10 text-red-100'
                : 'border-emerald-400/25 bg-emerald-500/10 text-emerald-100',
            )}
          >
            {error || statusMessage}
          </div>
        )}

        {(selectedNodeIds.length > 1 || selectedEdgeIds.length > 0) && (
          <div className="absolute left-5 right-5 top-48 z-30 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sky-200/25 bg-[#0b0d10]/95 px-4 py-3 shadow-2xl backdrop-blur">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <MousePointer2 className="h-4 w-4 text-sky-200" />
              {selectedNodeIds.length} no(s), {selectedEdgeIds.length} conexao(oes) selecionados
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={duplicateSelectedNodes} disabled={!selectedNodeIds.length}>
                <Plus className="h-4 w-4" />
                Duplicar
              </Button>
              <Button size="sm" variant="secondary" onClick={alignSelectedNodes} disabled={selectedNodeIds.length < 2}>
                Alinhar
              </Button>
              <Button size="sm" variant="danger" onClick={deleteSelectedItems}>
                <Trash2 className="h-4 w-4" />
                Deletar
              </Button>
              <Button size="sm" variant="secondary" onClick={clearMultiSelection}>
                Limpar
              </Button>
            </div>
          </div>
        )}

        {publishPreview && (
          <div className="absolute bottom-5 left-5 z-30 max-w-xl rounded-2xl border border-[var(--border)] bg-[rgba(0,0,0,0.70)] px-4 py-3 text-xs text-[var(--t2)] backdrop-blur">
            <div className="mb-1 font-semibold text-white">Resumo do rascunho/publicacao</div>
            {JSON.stringify(
              (publishPreview.comparison as Record<string, unknown>) ||
                (publishPreview.validation as Record<string, unknown>) ||
                publishPreview,
            )}
          </div>
        )}

        {workflowPreview && (() => {
          const s = (workflowPreview.summary || {}) as Record<string, unknown>;
          const warnings = Array.isArray(workflowPreview.warnings) ? workflowPreview.warnings as string[] : [];
          return (
            <div className="absolute left-5 right-5 top-24 z-40 rounded-3xl border border-sky-200/25 bg-[#0b0d10]/95 p-4 shadow-2xl backdrop-blur">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="text-sm font-semibold text-white">Importar workflow</div>
                  <div className="flex gap-2 text-xs text-[var(--t3)]">
                    <span>{String(s.videos ?? 0)} videos</span>
                    <span>·</span>
                    <span>{String(s.flowNodes ?? 0)} nodes</span>
                    <span>·</span>
                    <span>{String(s.triggers ?? 0)} triggers</span>
                    <span>·</span>
                    <span>{String(s.flowConnections ?? 0)} conexoes</span>
                  </div>
                  {warnings.length > 0 && (
                    <span className="text-xs text-amber-200" title={warnings.join('\n')}>
                      {warnings.length} aviso{warnings.length > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="secondary" onClick={() => { setWorkflowPreview(null); setPendingWorkflow(null); }}>
                    Cancelar
                  </Button>
                  <Button variant="primary" loading={saving} onClick={applyWorkflowImport}>
                    Aplicar
                  </Button>
                </div>
              </div>
            </div>
          );
        })()}

        {nodes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 top-40 z-10 flex flex-col items-center justify-center gap-3 text-center">
            <Video className="h-10 w-10 text-[var(--t3)]" />
            <p className="text-sm font-semibold text-[var(--t2)]">Canvas vazio</p>
            <p className="text-xs text-[var(--t3)]">
              {videos.length > 0
                ? 'Arraste um video da lista lateral para comecar.'
                : 'Adicione videos na Biblioteca primeiro.'}
            </p>
          </div>
        )}

        <div
          ref={wrapperRef}
          className="flex-1 pt-24"
          onDrop={onDrop}
          onDragOver={(event) => event.preventDefault()}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={createConnection}
            onNodeClick={(_, node) => {
              setSelectedNodeId(node.id);
              setSelectedEdgeId('');
            }}
            onEdgeClick={(_, edge) => {
              setSelectedEdgeId(edge.id);
              setSelectedNodeId('');
            }}
            onSelectionChange={({ nodes: selectedNodes, edges: selectedEdges }) => {
              setSelectedNodeIds(selectedNodes.map((node) => node.id));
              setSelectedEdgeIds(selectedEdges.map((edge) => edge.id));
            }}
            multiSelectionKeyCode={['Shift', 'Control', 'Meta']}
            selectionOnDrag
            panOnDrag={[1, 2]}
            fitView
            minZoom={0.25}
            maxZoom={1.5}
            proOptions={{ hideAttribution: true }}
            className="odessa-react-flow"
          >
            <Background color="rgba(125,211,252,0.16)" gap={28} variant={BackgroundVariant.Dots} />
            <MiniMap
              pannable
              zoomable
              nodeColor={(node) =>
                nodeById.get(node.id)?.videoId === idleVideoId ? '#7dd3fc' : '#fb7185'
              }
            />
            <Controls />
          </ReactFlow>
        </div>
      </section>

      <aside className="odessa-panel flex min-h-0 flex-col overflow-hidden p-4">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <BellRing className="h-4 w-4 text-rose-200" />
            {selectedFlowNode ? 'Instancia do video' : 'Regra da conexao'}
          </div>
          <Badge>{connections.length} rotas</Badge>
        </div>

        {selectedFlowNode && selectedVideo ? (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            <div className="rounded-[24px] border border-sky-200/20 bg-sky-300/10 p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <Badge variant={selectedVideo.id === idleVideoId ? 'gold' : 'lavender'}>
                  {selectedVideo.id === idleVideoId ? 'Idle oficial' : 'Instancia'}
                </Badge>
                <StatusDot status={selectedVideo.id === idleVideoId ? 'idle' : 'online'} />
              </div>
              <div className="text-lg font-semibold text-white">{nodeTitle(selectedFlowNode, selectedVideo)}</div>
              <div className="mt-1 truncate text-xs text-[var(--t3)]">{selectedVideo.group || selectedVideo.id}</div>
            </div>

            <Input
              label="Nome da instancia"
              value={selectedFlowNode.label || ''}
              onChange={(event) => updateFlowNode(selectedFlowNode.nodeId, { label: event.target.value })}
            />

            <div className="rounded-[24px] border border-[var(--border)] bg-[rgba(255,255,255,0.035)] p-3">
              <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-[var(--t2)]">
                <Scissors className="h-4 w-4 text-sky-200" />
                Corte e transicao
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Input
                  label="Inicio s"
                  type="number"
                  min="0"
                  step="0.1"
                  value={selectedFlowNode.playback.startSec}
                  onChange={(event) => updatePlayback(selectedFlowNode.nodeId, { startSec: Number(event.target.value) || 0 })}
                />
                <Input
                  label="Fim s"
                  type="number"
                  min="0"
                  step="0.1"
                  value={selectedFlowNode.playback.endSec ?? ''}
                  onChange={(event) =>
                    updatePlayback(selectedFlowNode.nodeId, {
                      endSec: event.target.value === '' ? null : Number(event.target.value) || null,
                    })
                  }
                />
                <Input
                  label="Fade ms"
                  type="number"
                  min="0"
                  step="20"
                  value={selectedFlowNode.playback.transitionMs}
                  onChange={(event) => updatePlayback(selectedFlowNode.nodeId, { transitionMs: Number(event.target.value) || 0 })}
                />
              </div>
            </div>

            <div className="rounded-[24px] border border-[var(--border)] bg-[rgba(255,255,255,0.035)] p-3">
              <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-[var(--t2)]">Audio do clipe</div>
              <div className="grid gap-2">
                <label className="block">
                  <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-[var(--t3)]">Modo</span>
                  <select
                    value={audioFrom(selectedFlowNode.audio).mode}
                    onChange={(event) => updateAudio(selectedFlowNode.nodeId, { mode: event.target.value as ClipAudioSettings['mode'] })}
                    className="h-10 w-full rounded-2xl border border-[var(--border2)] bg-[var(--bg3)] px-3 text-sm text-white outline-none"
                  >
                    <option value="muted">Sem audio</option>
                    <option value="original">Audio original</option>
                    <option value="track">Trilha externa</option>
                  </select>
                </label>
                <Input
                  label="Volume"
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={audioFrom(selectedFlowNode.audio).volume}
                  onChange={(event) => updateAudio(selectedFlowNode.nodeId, { volume: Number(event.target.value) || 0 })}
                />
                {audioFrom(selectedFlowNode.audio).mode === 'track' && (
                  <Input
                    label="URL da trilha"
                    value={audioFrom(selectedFlowNode.audio).trackUrl || ''}
                    onChange={(event) => updateAudio(selectedFlowNode.nodeId, { trackUrl: event.target.value })}
                  />
                )}
              </div>
            </div>

            <Button
              className="w-full"
              variant={selectedVideo.id === idleVideoId ? 'primary' : 'secondary'}
              onClick={() => setIdleFromNode(selectedFlowNode.nodeId)}
            >
              <CircleDot className="h-4 w-4" />
              {selectedVideo.id === idleVideoId ? 'Idle configurado' : 'Definir como Idle'}
            </Button>

            <label className="flex items-center justify-between rounded-2xl border border-[var(--border)] bg-[rgba(255,255,255,0.035)] px-3 py-3 text-sm text-[var(--t1)]">
              <span>Arquivo em loop</span>
              <input
                type="checkbox"
                checked={selectedVideo.id === idleVideoId || !!selectedVideo.loop}
                disabled={selectedVideo.id === idleVideoId}
                onChange={(event) => toggleVideoLoop(selectedVideo.id, event.target.checked)}
              />
            </label>

            <div className="rounded-[24px] border border-[var(--border)] bg-[rgba(255,255,255,0.035)] p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="text-xs font-semibold uppercase tracking-widest text-[var(--t2)]">Gatilhos OCR</div>
                <Button variant="secondary" onClick={() => createNodeTrigger(selectedFlowNode.nodeId)}>
                  <Plus className="h-4 w-4" />
                  Novo
                </Button>
              </div>

              {selectedNodeTriggers.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-[var(--border2)] p-3 text-xs text-[var(--t3)]">
                  Nenhum gatilho aciona esta instancia.
                </p>
              ) : (
                <div className="space-y-3">
                  {selectedNodeTriggers.map(({ connection, trigger }) => (
                    <TriggerCard
                      key={trigger.id}
                      trigger={trigger}
                      connection={connection}
                      testing={testing}
                      onTriggerChange={(patch) => updateTrigger(trigger.id, patch)}
                      onConnectionChange={(patch) => updateConnection(connection.id, patch)}
                      onRemove={() => removeTrigger(trigger.id)}
                      onSimulate={() => simulate(trigger)}
                    />
                  ))}
                </div>
              )}
            </div>

            <Button className="w-full" variant="danger" onClick={removeSelectedNode}>
              <Trash2 className="h-4 w-4" />
              Remover instancia
            </Button>
          </div>
        ) : !selectedConnection || !selectedTrigger ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-[26px] border border-dashed border-[var(--border2)] bg-[rgba(255,255,255,0.035)] p-6 text-center">
            <MousePointer2 className="h-8 w-8 text-[var(--t4)]" />
            <div className="mt-3 text-sm font-semibold text-white">Selecione uma instancia ou conecte uma linha</div>
            <p className="mt-2 text-xs text-[var(--t3)]">
              Cada arraste cria uma nova instancia do video. Conecte os pontos laterais para criar rotas.
            </p>
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            <div className="rounded-[24px] border border-sky-200/20 bg-sky-300/10 p-4">
              <div className="mb-2 flex items-center justify-between">
                <Badge variant={selectedTrigger.enabled ? 'success' : 'warning'}>
                  {selectedTrigger.enabled ? 'Ativa' : 'Pausada'}
                </Badge>
                <StatusDot status={selectedTrigger.enabled ? 'online' : 'warn'} />
              </div>
              <div className="text-lg font-semibold text-white">{nodeTitle(selectedTargetNode, selectedTargetVideo)}</div>
              <div className="mt-1 text-xs text-[var(--t3)]">{eventKey(selectedTrigger)} aciona esta instancia</div>
            </div>

            <TriggerCard
              trigger={selectedTrigger}
              connection={selectedConnection}
              testing={testing}
              onTriggerChange={updateSelectedTrigger}
              onConnectionChange={updateSelectedConnection}
              onRemove={removeSelectedConnection}
              onSimulate={() => simulate(selectedTrigger)}
            />

            <label className="flex items-center justify-between rounded-2xl border border-[var(--border)] bg-[rgba(255,255,255,0.035)] px-3 py-3 text-sm text-[var(--t1)]">
              <span>Arquivo em loop</span>
              <input type="checkbox" checked={!!selectedTargetVideo?.loop} onChange={(event) => toggleTargetLoop(event.target.checked)} />
            </label>

            {selectedTargetNode && (
              <Button className="w-full" variant="secondary" onClick={() => setIdleFromNode(selectedTargetNode.nodeId)}>
                <CircleDot className="h-4 w-4" />
                Definir como Idle
              </Button>
            )}
          </div>
        )}

        <div className="mt-4 rounded-[22px] border border-[var(--border)] bg-[rgba(255,255,255,0.035)] p-3 text-xs text-[var(--t3)]">
          <div className="mb-2 flex items-center gap-2 font-semibold text-[var(--t2)]">
            <Plus className="h-3.5 w-3.5 text-sky-200" />
            Como usar
          </div>
          Arraste ou clique em videos para criar instancias independentes. Cada instancia pode ter cortes e retorno proprios.
        </div>
      </aside>
    </div>
  );
}

function TriggerCard({
  trigger,
  connection,
  testing,
  onTriggerChange,
  onConnectionChange,
  onRemove,
  onSimulate,
}: {
  trigger: TriggerEntry;
  connection: FlowConnection;
  testing: string;
  onTriggerChange: (patch: Partial<TriggerEntry>) => void;
  onConnectionChange: (patch: Partial<FlowConnection>) => void;
  onRemove: () => void;
  onSimulate: () => void;
}) {
  type TriggerAction = NonNullable<TriggerEntry['actions']>[number];
  const isSceneAction = (action: TriggerAction) =>
    action.type === 'obs.switch_scene' ||
    action.type === 'switch_scene' ||
    action.capability === 'obs.switch_scene';
  const sceneAction = trigger.actions?.find(isSceneAction);
  const sceneValue = String(
    sceneAction?.payload?.sceneName ||
      sceneAction?.payload?.scene ||
      sceneAction?.payload?.requestedScene ||
      '',
  );
  const updateSceneAction = (value: string) => {
    const trimmed = value.trim();
    const preserved = (trigger.actions || []).filter((action) => !isSceneAction(action));
    onTriggerChange({
      actions: trimmed
        ? [
            ...preserved,
            {
              type: 'obs.switch_scene',
              capability: 'obs.switch_scene',
              payload: { sceneName: trimmed },
            },
          ]
        : preserved,
    });
  };

  return (
    <div className="space-y-3 rounded-[22px] border border-[var(--border)] bg-[rgba(0,0,0,0.20)] p-3">
      <div className="flex items-center justify-between gap-2">
        <Badge variant={trigger.enabled ? 'success' : 'warning'}>{trigger.enabled ? 'Ativo' : 'Pausado'}</Badge>
        <Button variant="danger" onClick={onRemove}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <Input label="Nome da regra" value={defaultTriggerName(trigger)} onChange={(event) => onTriggerChange({ name: event.target.value })} />

      <label className="block">
        <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-[var(--t3)]">Tipo de evento</span>
        <select
          value={trigger.eventType}
          onChange={(event) =>
            onTriggerChange({
              eventType: event.target.value,
              conditions:
                event.target.value === 'gift'
                  ? { giftKey: trigger.conditions?.giftKey || 'gift.rosa' }
                  : event.target.value === 'natural'
                    ? {}
                    : { keyword: trigger.conditions?.keyword || 'oi' },
            })
          }
          className="h-10 w-full rounded-2xl border border-[var(--border2)] bg-[var(--bg3)] px-3 text-sm text-white outline-none"
        >
          <option value="gift">Presente / gift</option>
          <option value="comment">Mensagem / keyword</option>
          <option value="manual">Manual</option>
          <option value="natural">Sequencia automatica</option>
        </select>
      </label>

      {trigger.eventType !== 'natural' && (
        <Input
          label={trigger.eventType === 'gift' ? 'Evento normalizado' : 'Palavra-chave'}
          value={trigger.eventType === 'gift' ? trigger.conditions?.giftKey || '' : trigger.conditions?.keyword || ''}
          onChange={(event) =>
            onTriggerChange({
              conditions: trigger.eventType === 'gift' ? { giftKey: event.target.value } : { keyword: event.target.value },
            })
          }
        />
      )}

      {trigger.eventType !== 'natural' && (
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Prioridade"
            type="number"
            value={trigger.priority ?? 1}
            onChange={(event) => onTriggerChange({ priority: Number(event.target.value) || 1 })}
          />
          <Input
            label="Cooldown ms"
            type="number"
            value={trigger.cooldown_ms ?? 2500}
            onChange={(event) => onTriggerChange({ cooldown_ms: Number(event.target.value) || 0 })}
          />
        </div>
      )}

      <label className="flex items-center justify-between rounded-2xl border border-[var(--border)] bg-[rgba(255,255,255,0.035)] px-3 py-3 text-sm text-[var(--t1)]">
        <span>Regra ativa</span>
        <input type="checkbox" checked={trigger.enabled} onChange={(event) => onTriggerChange({ enabled: event.target.checked })} />
      </label>

      {trigger.eventType !== 'natural' && (
        <label className="flex items-center justify-between rounded-2xl border border-[var(--border)] bg-[rgba(255,255,255,0.035)] px-3 py-3 text-sm text-[var(--t1)]">
          <span>Voltar ao Idle depois</span>
          <input
            type="checkbox"
            checked={connection.returnToIdle !== false}
            onChange={(event) => onConnectionChange({ returnToIdle: event.target.checked })}
          />
        </label>
      )}

      {trigger.eventType !== 'natural' && (
        <Input
          label="Cena OBS opcional"
          value={sceneValue}
          placeholder="Odessa LIVE, Odessa START ou cena permitida"
          onChange={(event) => updateSceneAction(event.target.value)}
        />
      )}

      <Button className="w-full" variant="secondary" loading={testing === trigger.id} onClick={onSimulate}>
        <Play className="h-4 w-4" />
        Testar regra
      </Button>
    </div>
  );
}
