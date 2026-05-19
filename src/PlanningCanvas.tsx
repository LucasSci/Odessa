/**
 * PlanningCanvas — Miro-like canvas for pre-live planning.
 *
 * Supports sticky notes, text blocks, images, and connections between elements.
 * Built on @xyflow/react (same library as ReactiveFlowBoard).
 * Data is persisted to the cloud API under the persona config.
 */

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
  Panel,
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
  Download,
  FileText,
  Image,
  Link2,
  MessageSquare,
  MoreHorizontal,
  MousePointer2,
  Move,
  Plus,
  Save,
  StickyNote,
  Trash2,
  Type,
  Palette,
  Upload,
  Zap,
  GripVertical,
  X,
  Check,
  RefreshCw,
} from 'lucide-react';
import { Badge, Button } from './components/ui';
import { apiUrl } from './lib/api';
import { cn } from './lib/utils';

// ─── Types ────────────────────────────────────────────────────────

type NoteColor = 'yellow' | 'blue' | 'green' | 'pink' | 'purple' | 'orange';

type CanvasItemType = 'sticky' | 'text' | 'section';

type CanvasItemData = {
  type: CanvasItemType;
  content: string;
  color: NoteColor;
  width?: number;
  height?: number;
  fontSize?: number;
  /** Link to a trigger ID from the reactive flow */
  linkedTriggerId?: string;
  /** Link to a video ID from the content library */
  linkedVideoId?: string;
  /** Custom tags for organization */
  tags?: string[];
};

type CanvasItem = {
  id: string;
  position: { x: number; y: number };
  data: CanvasItemData;
};

type CanvasConnection = {
  id: string;
  source: string;
  target: string;
  label?: string;
};

type CanvasState = {
  items: CanvasItem[];
  connections: CanvasConnection[];
  viewport?: { x: number; y: number; zoom: number };
};

type TriggerEntry = {
  id: string;
  name: string;
  enabled: boolean;
  eventType: string;
  conditions?: { giftKey?: string; keyword?: string };
};

type VideoEntry = {
  id: string;
  label?: string;
  group?: string;
};

// ─── Color Palette ────────────────────────────────────────────────

const NOTE_COLORS: Record<NoteColor, { bg: string; border: string; text: string; dark: string }> = {
  yellow: { bg: '#fef9c3', border: '#facc15', text: '#713f12', dark: 'rgba(254,249,195,0.15)' },
  blue:   { bg: '#dbeafe', border: '#60a5fa', text: '#1e3a5f', dark: 'rgba(219,234,254,0.15)' },
  green:  { bg: '#dcfce7', border: '#4ade80', text: '#14532d', dark: 'rgba(220,252,231,0.15)' },
  pink:   { bg: '#fce7f3', border: '#f472b6', text: '#831843', dark: 'rgba(252,231,243,0.15)' },
  purple: { bg: '#ede9fe', border: '#a78bfa', text: '#3b0764', dark: 'rgba(237,233,254,0.15)' },
  orange: { bg: '#ffedd5', border: '#fb923c', text: '#7c2d12', dark: 'rgba(255,237,213,0.15)' },
};

const COLOR_ORDER: NoteColor[] = ['yellow', 'blue', 'green', 'pink', 'purple', 'orange'];

// ─── Sticky Note Node ─────────────────────────────────────────────

function StickyNoteNode({ id, data, selected }: NodeProps<Node<CanvasItemData>>) {
  const { setNodes } = useReactFlow();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(data.content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const colors = NOTE_COLORS[data.color] || NOTE_COLORS.yellow;

  useEffect(() => { setText(data.content); }, [data.content]);

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.selectionStart = textareaRef.current.value.length;
    }
  }, [editing]);

  const commitEdit = useCallback(() => {
    setEditing(false);
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, content: text } } : n,
      ),
    );
  }, [id, text, setNodes]);

  const cycleColor = useCallback(() => {
    const idx = COLOR_ORDER.indexOf(data.color);
    const next = COLOR_ORDER[(idx + 1) % COLOR_ORDER.length];
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, color: next } } : n,
      ),
    );
  }, [id, data.color, setNodes]);

  const minW = data.width || 200;
  const minH = data.height || 140;

  return (
    <div
      className="group relative"
      style={{ minWidth: minW, minHeight: minH }}
    >
      {/* Connection handles */}
      <Handle type="target" position={Position.Top} className="!w-2 !h-2 !bg-white/60 !border-white/30" />
      <Handle type="source" position={Position.Bottom} className="!w-2 !h-2 !bg-white/60 !border-white/30" />
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-white/60 !border-white/30" id="left" />
      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-white/60 !border-white/30" id="right" />

      <div
        className={cn(
          'rounded-lg shadow-md transition-shadow',
          selected && 'ring-2 ring-white/50 shadow-lg',
        )}
        style={{
          background: colors.bg,
          borderLeft: `4px solid ${colors.border}`,
          minWidth: minW,
          minHeight: minH,
          padding: '12px 14px',
        }}
      >
        {/* Top bar */}
        <div className="flex items-center justify-between mb-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <GripVertical size={14} style={{ color: colors.text, opacity: 0.4 }} className="cursor-grab" />
          <div className="flex gap-1">
            {data.linkedTriggerId && (
              <Zap size={12} style={{ color: colors.text }} title="Conectado ao Fluxo Reativo" />
            )}
            <button onClick={cycleColor} title="Mudar cor">
              <Palette size={13} style={{ color: colors.text, opacity: 0.6 }} />
            </button>
          </div>
        </div>

        {/* Content */}
        {editing ? (
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { setText(data.content); setEditing(false); }
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commitEdit();
            }}
            className="w-full bg-transparent border-none outline-none resize-none"
            style={{
              color: colors.text,
              fontSize: data.fontSize || 14,
              minHeight: minH - 48,
              fontFamily: 'inherit',
            }}
          />
        ) : (
          <div
            onDoubleClick={() => setEditing(true)}
            className="whitespace-pre-wrap cursor-text select-text"
            style={{
              color: colors.text,
              fontSize: data.fontSize || 14,
              minHeight: minH - 48,
              lineHeight: 1.5,
            }}
          >
            {data.content || 'Duplo clique para editar...'}
          </div>
        )}

        {/* Tags */}
        {data.tags && data.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {data.tags.map((tag) => (
              <span
                key={tag}
                className="text-[10px] px-1.5 py-0.5 rounded-full"
                style={{ background: colors.border + '33', color: colors.text }}
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Text Block Node ──────────────────────────────────────────────

function TextBlockNode({ id, data, selected }: NodeProps<Node<CanvasItemData>>) {
  const { setNodes } = useReactFlow();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(data.content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setText(data.content); }, [data.content]);

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [editing]);

  const commitEdit = useCallback(() => {
    setEditing(false);
    setNodes((nds) =>
      nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, content: text } } : n)),
    );
  }, [id, text, setNodes]);

  return (
    <div
      className={cn(
        'group relative rounded-lg border transition-all',
        selected ? 'border-white/30 bg-white/[0.06]' : 'border-transparent bg-white/[0.03]',
      )}
      style={{ minWidth: data.width || 280, padding: '16px 18px' }}
    >
      <Handle type="target" position={Position.Top} className="!w-2 !h-2 !bg-white/40 !border-white/20" />
      <Handle type="source" position={Position.Bottom} className="!w-2 !h-2 !bg-white/40 !border-white/20" />

      {editing ? (
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { setText(data.content); setEditing(false); }
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commitEdit();
          }}
          className="w-full bg-transparent border-none outline-none resize-none text-[var(--t1)]"
          style={{ fontSize: data.fontSize || 15, minHeight: 60 }}
        />
      ) : (
        <div
          onDoubleClick={() => setEditing(true)}
          className="whitespace-pre-wrap cursor-text select-text text-[var(--t1)]"
          style={{ fontSize: data.fontSize || 15, lineHeight: 1.6 }}
        >
          {data.content || 'Duplo clique para editar...'}
        </div>
      )}
    </div>
  );
}

// ─── Section Header Node ──────────────────────────────────────────

function SectionNode({ id, data, selected }: NodeProps<Node<CanvasItemData>>) {
  const { setNodes } = useReactFlow();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(data.content);
  const colors = NOTE_COLORS[data.color] || NOTE_COLORS.blue;

  const commitEdit = useCallback(() => {
    setEditing(false);
    setNodes((nds) =>
      nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, content: text } } : n)),
    );
  }, [id, text, setNodes]);

  return (
    <div
      className={cn(
        'group relative rounded-xl border-2 border-dashed transition-all',
        selected && 'ring-1 ring-white/20',
      )}
      style={{
        borderColor: colors.border + '60',
        background: colors.dark,
        minWidth: data.width || 400,
        minHeight: data.height || 300,
        padding: '14px 18px',
      }}
    >
      <Handle type="target" position={Position.Top} className="!w-2 !h-2 !bg-white/40 !border-white/20" />
      <Handle type="source" position={Position.Bottom} className="!w-2 !h-2 !bg-white/40 !border-white/20" />

      {editing ? (
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') { setText(data.content); setEditing(false); } }}
          className="bg-transparent border-none outline-none text-lg font-semibold w-full"
          style={{ color: colors.border }}
        />
      ) : (
        <div
          onDoubleClick={() => setEditing(true)}
          className="text-lg font-semibold cursor-text"
          style={{ color: colors.border }}
        >
          {data.content || 'Duplo clique para nomear...'}
        </div>
      )}
    </div>
  );
}

// ─── Node type registry ───────────────────────────────────────────

const nodeTypes = {
  sticky: StickyNoteNode,
  text: TextBlockNode,
  section: SectionNode,
};

// ─── Toolbar ──────────────────────────────────────────────────────

function CanvasToolbar({
  onAdd,
  onSave,
  onExport,
  onImport,
  saving,
  dirty,
}: {
  onAdd: (type: CanvasItemType, color?: NoteColor) => void;
  onSave: () => void;
  onExport: () => void;
  onImport: () => void;
  saving: boolean;
  dirty: boolean;
}) {
  const [colorPicker, setColorPicker] = useState(false);

  return (
    <div className="flex items-center gap-1.5 bg-[var(--surface)] border border-[var(--border)] rounded-xl px-3 py-2 shadow-lg">
      <div className="relative">
        <button
          onClick={() => setColorPicker(!colorPicker)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-white/10 text-[var(--t2)] text-xs font-medium transition-colors"
          title="Adicionar nota"
        >
          <StickyNote size={15} /> Nota
        </button>
        {colorPicker && (
          <div className="absolute top-full left-0 mt-1 flex gap-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg p-2 shadow-xl z-50">
            {COLOR_ORDER.map((c) => (
              <button
                key={c}
                onClick={() => { onAdd('sticky', c); setColorPicker(false); }}
                className="w-6 h-6 rounded-md border border-white/10 hover:scale-110 transition-transform"
                style={{ background: NOTE_COLORS[c].bg }}
                title={c}
              />
            ))}
          </div>
        )}
      </div>

      <button
        onClick={() => onAdd('text')}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-white/10 text-[var(--t2)] text-xs font-medium transition-colors"
        title="Adicionar bloco de texto"
      >
        <Type size={15} /> Texto
      </button>

      <button
        onClick={() => onAdd('section')}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-white/10 text-[var(--t2)] text-xs font-medium transition-colors"
        title="Adicionar secao"
      >
        <FileText size={15} /> Secao
      </button>

      <div className="w-px h-5 bg-[var(--border)] mx-1" />

      <button
        onClick={onSave}
        disabled={saving || !dirty}
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors',
          dirty ? 'bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]' : 'text-[var(--t3)] hover:bg-white/10',
        )}
        title={dirty ? 'Salvar mural' : 'Nada para salvar'}
      >
        {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
        {dirty ? 'Salvar' : 'Salvo'}
      </button>

      <div className="w-px h-5 bg-[var(--border)] mx-1" />

      <button
        onClick={onImport}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-white/10 text-[var(--t2)] text-xs font-medium transition-colors"
        title="Importar mural de JSON"
      >
        <Upload size={14} /> Importar
      </button>

      <button
        onClick={onExport}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-white/10 text-[var(--t2)] text-xs font-medium transition-colors"
        title="Exportar mural como JSON"
      >
        <Download size={14} /> Exportar
      </button>
    </div>
  );
}

// ─── Link Panel (connects items to triggers/videos) ──────────────

function LinkPanel({
  nodeId,
  nodeData,
  triggers,
  videos,
  onLink,
  onClose,
}: {
  nodeId: string;
  nodeData: CanvasItemData;
  triggers: TriggerEntry[];
  videos: VideoEntry[];
  onLink: (nodeId: string, patch: Partial<CanvasItemData>) => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute right-4 top-4 w-72 bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-2xl z-50 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
        <span className="text-sm font-medium text-[var(--t1)]">Conectar elemento</span>
        <button onClick={onClose} className="text-[var(--t3)] hover:text-[var(--t1)]"><X size={16} /></button>
      </div>

      <div className="p-4 space-y-3 max-h-80 overflow-y-auto">
        {/* Triggers */}
        <div>
          <label className="text-xs text-[var(--t3)] font-medium uppercase tracking-wider">Trigger do Fluxo</label>
          <div className="mt-1 space-y-1">
            {triggers.length === 0 && <p className="text-xs text-[var(--t3)]">Nenhum trigger configurado</p>}
            {triggers.map((t) => (
              <button
                key={t.id}
                onClick={() => onLink(nodeId, { linkedTriggerId: nodeData.linkedTriggerId === t.id ? undefined : t.id })}
                className={cn(
                  'w-full text-left px-3 py-2 rounded-lg text-xs transition-colors',
                  nodeData.linkedTriggerId === t.id
                    ? 'bg-[var(--accent)]/20 text-[var(--accent)]'
                    : 'hover:bg-white/5 text-[var(--t2)]',
                )}
              >
                <Zap size={12} className="inline mr-1.5" />
                {t.name || t.conditions?.keyword || t.conditions?.giftKey || t.eventType}
                {nodeData.linkedTriggerId === t.id && <Check size={12} className="inline ml-auto float-right" />}
              </button>
            ))}
          </div>
        </div>

        {/* Videos */}
        <div>
          <label className="text-xs text-[var(--t3)] font-medium uppercase tracking-wider">Video</label>
          <div className="mt-1 space-y-1">
            {videos.length === 0 && <p className="text-xs text-[var(--t3)]">Nenhum video disponivel</p>}
            {videos.slice(0, 20).map((v) => (
              <button
                key={v.id}
                onClick={() => onLink(nodeId, { linkedVideoId: nodeData.linkedVideoId === v.id ? undefined : v.id })}
                className={cn(
                  'w-full text-left px-3 py-2 rounded-lg text-xs transition-colors',
                  nodeData.linkedVideoId === v.id
                    ? 'bg-blue-500/20 text-blue-400'
                    : 'hover:bg-white/5 text-[var(--t2)]',
                )}
              >
                {v.label || v.id.slice(0, 30)}
                {nodeData.linkedVideoId === v.id && <Check size={12} className="inline ml-auto float-right" />}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Canvas Component ────────────────────────────────────────

let idCounter = 0;
function nextId() {
  return `canvas-${Date.now()}-${++idCounter}`;
}

function PlanningCanvasInner() {
  const { screenToFlowPosition, getViewport } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<CanvasItemData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [linkPanelNode, setLinkPanelNode] = useState<string | null>(null);
  const [triggers, setTriggers] = useState<TriggerEntry[]>([]);
  const [videos, setVideos] = useState<VideoEntry[]>([]);
  const loadedRef = useRef(false);

  // ── Load canvas from API ──
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    (async () => {
      try {
        const res = await fetch(apiUrl('/workflow/draft'));
        if (!res.ok) { setLoading(false); return; }
        const data = await res.json();
        const config = data.draft || data.config || data;

        // Load triggers & videos for linking
        setTriggers(Array.isArray(config.triggers) ? config.triggers : []);
        setVideos(Array.isArray(config.videos) ? config.videos : []);

        // Load canvas state
        const canvas: CanvasState = config.planningCanvas || { items: [], connections: [] };
        const loadedNodes: Node<CanvasItemData>[] = canvas.items.map((item) => ({
          id: item.id,
          type: item.data.type,
          position: item.position,
          data: item.data,
        }));
        const loadedEdges: Edge[] = canvas.connections.map((conn) => ({
          id: conn.id,
          source: conn.source,
          target: conn.target,
          label: conn.label,
          type: 'default',
          animated: false,
          style: { stroke: 'rgba(255,255,255,0.2)', strokeWidth: 2 },
          labelStyle: { fill: 'var(--t2)', fontSize: 11 },
        }));
        setNodes(loadedNodes);
        setEdges(loadedEdges);
      } catch (err) {
        console.warn('[PlanningCanvas] Failed to load:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [setNodes, setEdges]);

  // ── Mark dirty on changes ──
  const handleNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      onNodesChange(changes);
      // Only mark dirty for meaningful changes (not selection/drag preview)
      const meaningful = changes.some(
        (c) => c.type === 'remove' || c.type === 'position' || c.type === 'dimensions',
      );
      if (meaningful) setDirty(true);
    },
    [onNodesChange],
  );

  const handleEdgesChange = useCallback(
    (changes: Parameters<typeof onEdgesChange>[0]) => {
      onEdgesChange(changes);
      setDirty(true);
    },
    [onEdgesChange],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            type: 'default',
            animated: false,
            style: { stroke: 'rgba(255,255,255,0.2)', strokeWidth: 2 },
          },
          eds,
        ),
      );
      setDirty(true);
    },
    [setEdges],
  );

  // ── Add new item ──
  const addItem = useCallback(
    (type: CanvasItemType, color: NoteColor = 'yellow') => {
      const viewport = getViewport();
      const centerX = (-viewport.x + 600) / viewport.zoom;
      const centerY = (-viewport.y + 400) / viewport.zoom;
      // Offset randomly so items don't stack perfectly
      const offset = { x: (Math.random() - 0.5) * 100, y: (Math.random() - 0.5) * 100 };

      const newNode: Node<CanvasItemData> = {
        id: nextId(),
        type,
        position: { x: centerX + offset.x, y: centerY + offset.y },
        data: {
          type,
          content: '',
          color: type === 'section' ? 'blue' : color,
          width: type === 'section' ? 400 : type === 'text' ? 280 : 200,
          height: type === 'section' ? 300 : undefined,
          fontSize: type === 'section' ? 18 : 14,
        },
      };
      setNodes((nds) => [...nds, newNode]);
      setDirty(true);
    },
    [setNodes, getViewport],
  );

  // ── Delete selected ──
  const deleteSelected = useCallback(() => {
    setNodes((nds) => nds.filter((n) => !n.selected));
    setEdges((eds) => {
      const selectedNodeIds = new Set(nodes.filter((n) => n.selected).map((n) => n.id));
      return eds.filter((e) => !selectedNodeIds.has(e.source) && !selectedNodeIds.has(e.target));
    });
    setDirty(true);
    setSelectedNode(null);
    setLinkPanelNode(null);
  }, [nodes, setNodes, setEdges]);

  // ── Update node data (for linking) ──
  const onLinkUpdate = useCallback(
    (nodeId: string, patch: Partial<CanvasItemData>) => {
      setNodes((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n)),
      );
      setDirty(true);
    },
    [setNodes],
  );

  // ── Save to API ──
  const saveCanvas = useCallback(async () => {
    setSaving(true);
    try {
      // Build canvas state from current nodes/edges
      const items: CanvasItem[] = nodes.map((n) => ({
        id: n.id,
        position: n.position,
        data: n.data as CanvasItemData,
      }));
      const connections: CanvasConnection[] = edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: typeof e.label === 'string' ? e.label : undefined,
      }));
      const viewport = getViewport();
      const canvas: CanvasState = { items, connections, viewport };

      // PATCH the workflow config to include planningCanvas
      const res = await fetch(apiUrl('/workflow/draft'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planningCanvas: canvas }),
      });
      if (res.ok) setDirty(false);
    } catch (err) {
      console.warn('[PlanningCanvas] Save failed:', err);
    } finally {
      setSaving(false);
    }
  }, [nodes, edges, getViewport]);

  // ── Export as JSON ──
  const importInputRef = useRef<HTMLInputElement>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const exportCanvas = useCallback(() => {
    const items: CanvasItem[] = nodes.map((n) => ({
      id: n.id,
      position: n.position,
      data: n.data as CanvasItemData,
    }));
    const connections: CanvasConnection[] = edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: typeof e.label === 'string' ? e.label : undefined,
    }));
    const viewport = getViewport();
    const payload = {
      schemaVersion: 'odessa.mural.v1',
      exportedAt: new Date().toISOString(),
      items,
      connections,
      viewport,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `odessa-mural-${new Date().toISOString().slice(0, 19).replaceAll(':', '-')}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }, [nodes, edges, getViewport]);

  // ── Import from JSON ──
  const importCanvas = useCallback(
    async (file?: File | null) => {
      if (!file) return;
      try {
        const raw = JSON.parse(await file.text()) as CanvasState & { schemaVersion?: string };
        const items = Array.isArray(raw.items) ? raw.items : [];
        const connections = Array.isArray(raw.connections) ? raw.connections : [];
        if (items.length === 0 && connections.length === 0) {
          setToastMsg('JSON vazio ou formato invalido.');
          return;
        }
        const loadedNodes: Node<CanvasItemData>[] = items.map((item) => ({
          id: item.id || nextId(),
          type: item.data?.type || 'sticky',
          position: item.position || { x: 0, y: 0 },
          data: {
            type: item.data?.type || 'sticky',
            content: item.data?.content || '',
            color: item.data?.color || 'yellow',
            width: item.data?.width,
            height: item.data?.height,
            fontSize: item.data?.fontSize,
            linkedTriggerId: item.data?.linkedTriggerId,
            linkedVideoId: item.data?.linkedVideoId,
            tags: item.data?.tags,
          },
        }));
        const loadedEdges: Edge[] = connections.map((conn) => ({
          id: conn.id || nextId(),
          source: conn.source,
          target: conn.target,
          label: conn.label,
          type: 'default',
          animated: false,
          style: { stroke: 'rgba(255,255,255,0.2)', strokeWidth: 2 },
          labelStyle: { fill: 'var(--t2)', fontSize: 11 },
        }));
        setNodes(loadedNodes);
        setEdges(loadedEdges);
        setDirty(true);
        setToastMsg(`Importado: ${items.length} elementos, ${connections.length} conexoes.`);
      } catch {
        setToastMsg('Falha ao ler JSON. Verifique o formato do arquivo.');
      } finally {
        if (importInputRef.current) importInputRef.current.value = '';
      }
    },
    [setNodes, setEdges],
  );

  // Auto-dismiss toast
  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 4000);
    return () => clearTimeout(t);
  }, [toastMsg]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Don't delete when editing text
        const active = document.activeElement;
        if (active?.tagName === 'TEXTAREA' || active?.tagName === 'INPUT') return;
        deleteSelected();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveCanvas();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [deleteSelected, saveCanvas]);

  // ── Track selected node ──
  const onSelectionChange = useCallback(({ nodes: sel }: { nodes: Node[] }) => {
    setSelectedNode(sel.length === 1 ? sel[0].id : null);
  }, []);

  // ── Context menu for linking ──
  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      event.preventDefault();
      setLinkPanelNode(linkPanelNode === node.id ? null : node.id);
    },
    [linkPanelNode],
  );

  // ── Content change marks dirty ──
  const onNodeDoubleClick = useCallback(() => {
    // After editing completes, the node data changes → mark dirty
    // This is handled by the individual node components calling setNodes
  }, []);

  const selectedNodeData = useMemo(() => {
    if (!linkPanelNode) return null;
    const node = nodes.find((n) => n.id === linkPanelNode);
    return node ? (node.data as CanvasItemData) : null;
  }, [linkPanelNode, nodes]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--t3)]">
        <RefreshCw size={20} className="animate-spin mr-2" /> Carregando canvas...
      </div>
    );
  }

  return (
    <div className="relative w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={onConnect}
        onSelectionChange={onSelectionChange}
        onNodeContextMenu={onNodeContextMenu}
        fitView={nodes.length > 0}
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.1}
        maxZoom={3}
        snapToGrid
        snapGrid={[20, 20]}
        deleteKeyCode={null} // We handle delete ourselves
        multiSelectionKeyCode="Shift"
        panOnScroll
        selectionOnDrag
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{
          type: 'default',
          animated: false,
          style: { stroke: 'rgba(255,255,255,0.2)', strokeWidth: 2 },
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="rgba(255,255,255,0.05)" />
        <Controls
          showInteractive={false}
          className="!bg-[var(--surface)] !border-[var(--border)] !rounded-lg !shadow-lg [&>button]:!bg-transparent [&>button]:!border-[var(--border)] [&>button]:!text-[var(--t2)] [&>button:hover]:!bg-white/10"
        />
        <MiniMap
          nodeColor={(node) => {
            const data = node.data as CanvasItemData;
            return NOTE_COLORS[data?.color]?.border || '#666';
          }}
          maskColor="rgba(0,0,0,0.7)"
          className="!bg-[var(--surface)] !border-[var(--border)] !rounded-lg"
        />

        {/* Floating toolbar */}
        <Panel position="top-center">
          <CanvasToolbar
            onAdd={addItem}
            onSave={saveCanvas}
            onExport={exportCanvas}
            onImport={() => importInputRef.current?.click()}
            saving={saving}
            dirty={dirty}
          />
        </Panel>

        {/* Empty state */}
        {nodes.length === 0 && (
          <Panel position="top-center" className="mt-20">
            <div className="text-center text-[var(--t3)] space-y-3">
              <StickyNote size={48} className="mx-auto opacity-30" />
              <p className="text-sm">Mural vazio. Adicione notas, textos e secoes<br />para planejar sua live.</p>
              <div className="flex gap-2 justify-center">
                <Button variant="secondary" size="sm" onClick={() => addItem('sticky', 'yellow')}>
                  <StickyNote size={14} className="mr-1" /> Nota
                </Button>
                <Button variant="secondary" size="sm" onClick={() => addItem('section', 'blue')}>
                  <FileText size={14} className="mr-1" /> Secao
                </Button>
              </div>
            </div>
          </Panel>
        )}
      </ReactFlow>

      {/* Link panel */}
      {linkPanelNode && selectedNodeData && (
        <LinkPanel
          nodeId={linkPanelNode}
          nodeData={selectedNodeData}
          triggers={triggers}
          videos={videos}
          onLink={onLinkUpdate}
          onClose={() => setLinkPanelNode(null)}
        />
      )}

      {/* Selection actions */}
      {selectedNode && (
        <div className="absolute bottom-4 right-4 flex gap-2">
          <button
            onClick={() => setLinkPanelNode(selectedNode)}
            className="p-2 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--t2)] hover:bg-white/10 shadow-lg"
            title="Conectar a trigger/video"
          >
            <Link2 size={16} />
          </button>
          <button
            onClick={deleteSelected}
            className="p-2 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-red-400 hover:bg-red-500/10 shadow-lg"
            title="Remover"
          >
            <Trash2 size={16} />
          </button>
        </div>
      )}

      {/* Hidden file input for import */}
      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => void importCanvas(e.target.files?.[0])}
      />

      {/* Toast */}
      {toastMsg && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-xs text-[var(--t1)] shadow-xl">
          {toastMsg}
        </div>
      )}
    </div>
  );
}

export default function PlanningCanvas() {
  return (
    <ReactFlowProvider>
      <PlanningCanvasInner />
    </ReactFlowProvider>
  );
}
