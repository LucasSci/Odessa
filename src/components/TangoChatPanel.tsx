/**
 * TangoChatPanel — Painel completo de configuração, diagnóstico e uso
 * do Tango Chat Bridge, 100% pelo frontend.
 *
 * O usuário não precisa abrir terminal nem saber comandos.
 * Tudo é feito por botões e formulários neste painel.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
  MessageCircle,
  Play,
  Radio,
  RefreshCw,
  Send,
  Settings,
  Square,
  Terminal,
  Wifi,
  WifiOff,
  XCircle,
} from 'lucide-react';
import { Badge, Button, Input } from './ui';
import { cn } from '../lib/utils';

// ─── Config ─────────────────────────────────────────────────────────
const BRIDGE_URL = '/tango-bridge';
const BRIDGE_API = '/api/v1/chat-automation/bridge';

// ─── Types ──────────────────────────────────────────────────────────

type BridgeProcessStatus = {
  processRunning: boolean;
  pid: number | null;
  startedAt: string | null;
  bridgeUrl: string;
  bridgeReachable: boolean;
  bridgeStatus: BridgeConnectionStatus | null;
};

type BridgeConnectionStatus = {
  status: 'disconnected' | 'connecting' | 'connected' | 'error' | 'not_initialized';
  mode?: string;
  pageUrl?: string;
  startedAt?: string | null;
  messageCount?: number;
  historySize?: number;
  observerInjected?: boolean;
  error?: string | null;
  cdpUrl?: string;
  profileDir?: string;
};

type BridgeConfig = {
  mode: string;
  cdpUrl: string;
  roomUrl: string;
  port: number;
  autoconnect: boolean;
  selectors: {
    containerChat: string;
    mensagem: string;
    username: string;
    textoMsg: string;
    inputTexto: string;
    botaoEnviar: string;
  };
};

type ChatMsg = {
  username: string;
  text: string;
  timestamp: string;
};

type Tab = 'chat' | 'config' | 'diagnostico';

// ─── Helpers ────────────────────────────────────────────────────────

async function fetchJson<T = unknown>(url: string, opts?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...opts?.headers },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function defaultConfig(): BridgeConfig {
  return {
    mode: '',
    cdpUrl: 'http://127.0.0.1:9222',
    roomUrl: 'https://tango.me/stream/broadcast',
    port: 7555,
    autoconnect: true,
    selectors: {
      containerChat: '[data-testid="virtuoso-item-list"]',
      mensagem: '[data-testid^="chat-event-"]',
      username: '.Hhi6n',
      textoMsg: '.KR99L',
      inputTexto: '[data-testid="textarea"]',
      botaoEnviar: '',
    },
  };
}

// ─── Component ──────────────────────────────────────────────────────

export function TangoChatPanel() {
  // ── State ──────────────────────────────────────────
  const [tab, setTab] = useState<Tab>('chat');
  const [processStatus, setProcessStatus] = useState<BridgeProcessStatus | null>(null);
  const [config, setConfig] = useState<BridgeConfig>(defaultConfig());
  const [configDirty, setConfigDirty] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [draftText, setDraftText] = useState('');
  const [sending, setSending] = useState(false);
  const [starting, setStarting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const sseRef = useRef<EventSource | null>(null);

  // ── Derived state ─────────────────────────────────
  const backendOnline = processStatus !== null;
  const processRunning = processStatus?.processRunning ?? false;
  const bridgeReachable = processStatus?.bridgeReachable ?? false;
  const bridgeConnected = processStatus?.bridgeStatus?.status === 'connected';
  const bridgeError = processStatus?.bridgeStatus?.error;

  const combinedStatus = bridgeConnected
    ? 'connected'
    : connecting
      ? 'connecting'
      : bridgeReachable
        ? 'reachable'
        : processRunning
          ? 'starting'
          : 'stopped';

  const statusColor: Record<string, string> = {
    connected: 'text-emerald-400',
    connecting: 'text-amber-400',
    reachable: 'text-amber-400',
    starting: 'text-amber-400',
    stopped: 'text-slate-500',
  };

  const statusLabel: Record<string, string> = {
    connected: 'Conectado',
    connecting: 'Conectando…',
    reachable: 'Bridge pronta',
    starting: 'Iniciando…',
    stopped: 'Parado',
  };

  // ── Poll backend status every 4s ──────────────────
  const refreshStatus = useCallback(async () => {
    const data = await fetchJson<BridgeProcessStatus>(`${BRIDGE_API}/status`);
    setProcessStatus(data);
  }, []);

  useEffect(() => {
    void refreshStatus();
    const timer = window.setInterval(() => void refreshStatus(), 4000);
    return () => window.clearInterval(timer);
  }, [refreshStatus]);

  // ── Load config on mount ──────────────────────────
  useEffect(() => {
    (async () => {
      const data = await fetchJson<BridgeConfig>(`${BRIDGE_API}/config`);
      if (data) {
        setConfig({ ...defaultConfig(), ...data });
      }
    })();
  }, []);

  // ── Load history when bridge connects ────────────
  useEffect(() => {
    if (!bridgeConnected) return;
    (async () => {
      const data = await fetchJson<{ messages: ChatMsg[] }>(`${BRIDGE_URL}/history?limit=200`);
      if (data?.messages) setMessages(data.messages);
    })();
  }, [bridgeConnected]);

  // ── SSE stream for realtime messages ─────────────
  useEffect(() => {
    if (!bridgeConnected) {
      sseRef.current?.close();
      sseRef.current = null;
      return;
    }
    if (sseRef.current) return;

    const es = new EventSource(`${BRIDGE_URL}/messages`);
    sseRef.current = es;

    es.onmessage = (ev) => {
      try {
        const msg: ChatMsg = JSON.parse(ev.data);
        setMessages((prev) => [...prev.slice(-499), msg]);
      } catch { /* ignore */ }
    };

    es.onerror = () => {
      es.close();
      sseRef.current = null;
    };

    return () => {
      es.close();
      sseRef.current = null;
    };
  }, [bridgeConnected]);

  // ── Poll logs when on diagnostico tab ─────────────
  useEffect(() => {
    if (tab !== 'diagnostico' || !processRunning) return;
    const poll = async () => {
      const data = await fetchJson<{ lines: string[] }>(`${BRIDGE_API}/logs?limit=150`);
      if (data?.lines) setLogs(data.lines);
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 3000);
    return () => window.clearInterval(timer);
  }, [tab, processRunning]);

  // ── Auto-scroll ──────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // ── Actions ──────────────────────────────────────
  const handleStart = async () => {
    setStarting(true);
    try {
      await fetchJson(`${BRIDGE_API}/start`, {
        method: 'POST',
        body: JSON.stringify({
          mode: config.mode,
          autoconnect: config.autoconnect,
          config,
        }),
      });
      await new Promise((r) => setTimeout(r, 1500));
      await refreshStatus();
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    await fetchJson(`${BRIDGE_API}/stop`, { method: 'POST' });
    setMessages([]);
    await refreshStatus();
  };

  const handleConnect = async () => {
    setConnecting(true);
    try {
      await fetchJson(`${BRIDGE_URL}/connect`, {
        method: 'POST',
        body: JSON.stringify({ mode: config.mode }),
      });
      await new Promise((r) => setTimeout(r, 2000));
      await refreshStatus();
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    await fetchJson(`${BRIDGE_URL}/disconnect`, { method: 'POST' });
    setMessages([]);
    await refreshStatus();
  };

  const handleSend = async () => {
    const text = draftText.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await fetchJson(`${BRIDGE_URL}/send`, {
        method: 'POST',
        body: JSON.stringify({ text }),
      });
      setDraftText('');
    } finally {
      setSending(false);
    }
  };

  const handleSaveConfig = async () => {
    setConfigSaving(true);
    try {
      const result = await fetchJson<BridgeConfig>(`${BRIDGE_API}/config`, {
        method: 'POST',
        body: JSON.stringify(config),
      });
      if (result) setConfig(result);
      setConfigDirty(false);
    } finally {
      setConfigSaving(false);
    }
  };

  const handleResetConfig = () => {
    setConfig(defaultConfig());
    setConfigDirty(true);
  };

  const updateConfig = <K extends keyof BridgeConfig>(key: K, value: BridgeConfig[K]) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
    setConfigDirty(true);
  };

  const updateSelector = (key: string, value: string) => {
    setConfig((prev) => ({
      ...prev,
      selectors: { ...prev.selectors, [key]: value },
    }));
    setConfigDirty(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  // ── Render ─────────────────────────────────────────
  return (
    <div className="space-y-3">
      {/* ── Header ──────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/8 bg-[#0a0b0d] p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 text-violet-300">
            <MessageCircle className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-white">Tango Chat Bridge</h3>
              <span className={cn('flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest', statusColor[combinedStatus] || 'text-slate-500')}>
                {bridgeConnected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                {statusLabel[combinedStatus] || 'Desconhecido'}
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              {bridgeConnected
                ? `${processStatus?.bridgeStatus?.messageCount ?? 0} msgs · Observer ${processStatus?.bridgeStatus?.observerInjected ? 'ativo' : 'pendente'} · Modo ${processStatus?.bridgeStatus?.mode || '?'}`
                : !backendOnline
                  ? 'Backend não acessível. Inicie com npm run dev:api'
                  : processRunning
                    ? bridgeReachable ? 'Bridge pronta. Clique em Conectar.' : 'Aguardando bridge iniciar…'
                    : 'Clique em Iniciar para subir a bridge.'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!processRunning ? (
            <Button size="sm" variant="primary" disabled={!backendOnline || starting} onClick={() => void handleStart()}>
              {starting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              Iniciar
            </Button>
          ) : (
            <>
              {!bridgeConnected ? (
                <Button size="sm" variant="primary" disabled={!bridgeReachable || connecting} onClick={() => void handleConnect()}>
                  {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wifi className="h-3.5 w-3.5" />}
                  Conectar
                </Button>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => void handleDisconnect()}>
                  <WifiOff className="h-3.5 w-3.5" />
                  Desconectar
                </Button>
              )}
              <Button size="sm" variant="danger" onClick={() => void handleStop()}>
                <Square className="h-3 w-3" />
                Parar
              </Button>
            </>
          )}
          <Button size="sm" variant="secondary" onClick={() => void refreshStatus()}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* ── Error ─────────────────────────────── */}
      {bridgeError && (
        <div className="flex items-start gap-2 rounded-xl border border-red-400/30 bg-red-500/10 p-3">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-red-300">Erro na bridge</p>
            <p className="mt-1 text-xs text-red-200/80">{bridgeError}</p>
          </div>
        </div>
      )}

      {/* ── Tabs ──────────────────────────────── */}
      <div className="flex gap-1 rounded-lg border border-white/8 bg-black/30 p-1">
        {[
          { id: 'chat' as Tab, label: 'Chat', icon: <MessageCircle className="h-3.5 w-3.5" /> },
          { id: 'config' as Tab, label: 'Configuração', icon: <Settings className="h-3.5 w-3.5" /> },
          { id: 'diagnostico' as Tab, label: 'Diagnóstico', icon: <Terminal className="h-3.5 w-3.5" /> },
        ].map((t) => (
          <button
            key={t.id}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition',
              tab === t.id
                ? 'bg-white/10 text-white'
                : 'text-slate-500 hover:text-slate-300',
            )}
            onClick={() => setTab(t.id)}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab: Chat ─────────────────────────── */}
      {tab === 'chat' && (
        <div className="space-y-3">
          {/* Stats */}
          {bridgeConnected && (
            <>
              <div className="grid gap-2 md:grid-cols-4">
                <StatCard label="Mensagens" value={String(processStatus?.bridgeStatus?.messageCount ?? 0)} icon={<MessageCircle className="h-3.5 w-3.5 text-sky-400" />} />
                <StatCard label="Histórico" value={String(processStatus?.bridgeStatus?.historySize ?? 0)} icon={<Activity className="h-3.5 w-3.5 text-violet-400" />} />
                <StatCard label="Observer" value={processStatus?.bridgeStatus?.observerInjected ? 'Ativo' : 'Pendente'} icon={<Radio className="h-3.5 w-3.5 text-emerald-400" />} />
                <StatCard label="Desde" value={processStatus?.bridgeStatus?.startedAt ? new Date(processStatus.bridgeStatus.startedAt).toLocaleTimeString('pt-BR') : '-'} icon={<CheckCircle className="h-3.5 w-3.5 text-amber-400" />} />
              </div>

              {/* Page URL */}
              {processStatus?.bridgeStatus?.pageUrl && (
                <div className="flex items-center gap-2 rounded-lg border border-white/8 bg-black/20 px-3 py-2">
                  <ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                  <span className="truncate text-[11px] text-slate-400">{processStatus.bridgeStatus.pageUrl}</span>
                </div>
              )}

              {/* Monitor de Visão */}
              <div className="rounded-xl border border-white/8 bg-black/30 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Activity className="h-4 w-4 text-emerald-400" />
                    <span className="text-[11px] font-bold uppercase tracking-widest text-slate-300">Monitor de Visão</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      id="goto-url"
                      placeholder="URL da Live..."
                      className="h-7 w-64 rounded border border-white/10 bg-white/[0.04] px-2 text-xs text-white"
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={async () => {
                        const url = (document.getElementById('goto-url') as HTMLInputElement).value;
                        if (url) await fetchJson(`${BRIDGE_URL}/goto`, { method: 'POST', body: JSON.stringify({ url }) });
                      }}
                    >Navegar</Button>
                  </div>
                </div>
                <div className="relative aspect-video w-full overflow-hidden rounded border border-white/10 bg-black/50">
                  <img
                    src={`${BRIDGE_URL}/screenshot?t=${Date.now()}`}
                    alt="Visão do Robô"
                    className="h-full w-full object-contain"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    onLoad={(e) => { (e.target as HTMLImageElement).style.display = 'block'; }}
                  />
                  <div className="absolute bottom-2 right-2">
                    <Button size="sm" variant="secondary" className="opacity-80 hover:opacity-100" onClick={(e) => {
                      const img = (e.currentTarget as HTMLElement).parentElement?.previousElementSibling as HTMLImageElement;
                      if (img) img.src = `${BRIDGE_URL}/screenshot?t=${Date.now()}`;
                    }}>
                      <RefreshCw className="mr-1 h-3 w-3" />
                      Atualizar
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Chat feed */}
          <div className="rounded-xl border border-white/8 bg-black/30">
            <div className="flex items-center gap-2 border-b border-white/8 px-4 py-2.5">
              <Radio className="h-3.5 w-3.5 text-violet-400" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Chat ao vivo</span>
              {bridgeConnected && (
                <span className="ml-auto flex items-center gap-1 text-[10px] text-emerald-400">
                  <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                  streaming
                </span>
              )}
            </div>
            <div className="h-72 overflow-y-auto p-3">
              {messages.length === 0 ? (
                <div className="flex h-full items-center justify-center">
                  <p className="text-xs text-slate-600">
                    {bridgeConnected ? 'Aguardando mensagens do chat…' : 'Inicie e conecte a bridge para ver mensagens.'}
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {messages.map((msg, idx) => (
                    <ChatBubble key={`${msg.timestamp}-${idx}`} msg={msg} />
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 border-t border-white/8 px-3 py-2.5">
              <input
                type="text"
                className="h-9 flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm text-white placeholder-slate-500 outline-none focus:border-violet-500/50"
                placeholder={bridgeConnected ? 'Digite uma mensagem…' : 'Conecte a bridge primeiro'}
                disabled={!bridgeConnected}
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
                onKeyDown={handleKeyDown}
              />
              <Button size="sm" variant="primary" disabled={!bridgeConnected || !draftText.trim() || sending} onClick={() => void handleSend()}>
                {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Enviar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Configuração ─────────────────── */}
      {tab === 'config' && (
        <div className="space-y-4 rounded-xl border border-white/8 bg-[#0a0b0d] p-4">
          {/* Modo */}
          <div>
            <label className="mb-2 block text-[11px] font-bold uppercase tracking-widest text-slate-400">
              Modo de conexão
            </label>
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                { value: '', label: 'Automático', desc: 'Tenta CDP primeiro, depois Standalone.' },
                { value: 'cdp', label: 'CDP', desc: 'Conecta ao Chrome já aberto (flag --remote-debugging-port=9222).' },
                { value: 'standalone', label: 'Standalone', desc: 'Abre Chromium próprio do Playwright. Recomendado para primeiro uso.' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  className={cn(
                    'rounded-lg border p-3 text-left transition',
                    config.mode === opt.value
                      ? 'border-violet-500/50 bg-violet-500/10'
                      : 'border-white/8 bg-black/20 hover:border-white/15',
                  )}
                  onClick={() => updateConfig('mode', opt.value)}
                >
                  <span className="text-xs font-bold text-white">{opt.label}</span>
                  <p className="mt-0.5 text-[10px] text-slate-400">{opt.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* URL */}
          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-widest text-slate-400">
              URL da Live Tango
            </label>
            <input
              type="text"
              className="h-9 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm text-white placeholder-slate-500 outline-none focus:border-violet-500/50"
              value={config.roomUrl}
              onChange={(e) => updateConfig('roomUrl', e.target.value)}
              placeholder="https://tango.me/stream/broadcast"
            />
          </div>

          {/* Port + CDP URL */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-widest text-slate-400">
                Porta da Bridge
              </label>
              <input
                type="number"
                className="h-9 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm text-white placeholder-slate-500 outline-none focus:border-violet-500/50"
                value={config.port}
                onChange={(e) => updateConfig('port', Number(e.target.value) || 7555)}
              />
            </div>
            {config.mode !== 'standalone' && (
              <div>
                <label className="mb-1 block text-[11px] font-bold uppercase tracking-widest text-slate-400">
                  URL do Chrome CDP
                </label>
                <input
                  type="text"
                  className="h-9 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm text-white placeholder-slate-500 outline-none focus:border-violet-500/50"
                  value={config.cdpUrl}
                  onChange={(e) => updateConfig('cdpUrl', e.target.value)}
                />
              </div>
            )}
          </div>

          {/* Autoconnect */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-white/20 bg-white/5 accent-violet-500"
              checked={config.autoconnect}
              onChange={(e) => updateConfig('autoconnect', e.target.checked)}
            />
            <span className="text-xs text-slate-300">Conectar automaticamente ao iniciar</span>
          </label>

          {/* Seletores avançados */}
          <div>
            <button
              className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-slate-500 hover:text-slate-300 transition"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              {showAdvanced ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Seletores CSS (avançado)
            </button>
            {showAdvanced && (
              <div className="mt-2 space-y-2 rounded-lg border border-white/8 bg-black/20 p-3">
                {Object.entries(config.selectors).map(([key, value]) => (
                  <div key={key}>
                    <label className="mb-0.5 block text-[10px] font-medium text-slate-500">{key}</label>
                    <input
                      type="text"
                      className="h-8 w-full rounded border border-white/10 bg-white/[0.04] px-2 font-mono text-[11px] text-white placeholder-slate-600 outline-none focus:border-violet-500/50"
                      value={value}
                      onChange={(e) => updateSelector(key, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Buttons */}
          <div className="flex items-center gap-2 border-t border-white/8 pt-3">
            <Button
              size="sm"
              variant="primary"
              disabled={!configDirty || configSaving}
              onClick={() => void handleSaveConfig()}
            >
              {configSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
              Salvar
            </Button>
            <Button size="sm" variant="secondary" onClick={handleResetConfig}>
              <RefreshCw className="h-3.5 w-3.5" />
              Restaurar padrões
            </Button>
            {configDirty && (
              <Badge variant="warning">
                <AlertCircle className="mr-1 h-3 w-3" />
                Não salvo
              </Badge>
            )}
          </div>
        </div>
      )}

      {/* ── Tab: Diagnóstico ──────────────────── */}
      {tab === 'diagnostico' && (
        <div className="space-y-3">
          {/* Connectivity checks */}
          <div className="rounded-xl border border-white/8 bg-[#0a0b0d] p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Conectividade</span>
              <Button size="sm" variant="secondary" onClick={() => void refreshStatus()}>
                <RefreshCw className="h-3 w-3 mr-1" />
                Testar tudo
              </Button>
            </div>
            <div className="space-y-2">
              <CheckItem ok={backendOnline} label="Backend Odessa (API)" detail={backendOnline ? 'Respondendo' : 'Não acessível'} />
              <CheckItem ok={processRunning} label="Processo da Bridge" detail={processRunning ? `PID ${processStatus?.pid}` : 'Não iniciado'} />
              <CheckItem ok={bridgeReachable} label={`Bridge HTTP (porta ${config.port})`} detail={bridgeReachable ? 'Respondendo' : 'Não acessível'} />
              <CheckItem ok={bridgeConnected} label="Conexão com Tango" detail={bridgeConnected ? `Modo ${processStatus?.bridgeStatus?.mode || '?'}` : 'Não conectado'} />
            </div>
          </div>

          {/* Process controls */}
          <div className="rounded-xl border border-white/8 bg-[#0a0b0d] p-4">
            <span className="mb-3 block text-[11px] font-bold uppercase tracking-widest text-slate-400">Controle do processo</span>
            <div className="flex items-center gap-2">
              {!processRunning ? (
                <Button size="sm" variant="primary" disabled={starting} onClick={() => void handleStart()}>
                  {starting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                  Iniciar Bridge
                </Button>
              ) : (
                <Button size="sm" variant="danger" onClick={() => void handleStop()}>
                  <Square className="h-3 w-3" />
                  Parar Bridge
                </Button>
              )}
              <span className="text-[11px] text-slate-500">
                {processRunning
                  ? `Rodando desde ${processStatus?.startedAt ? new Date(processStatus.startedAt).toLocaleTimeString('pt-BR') : '?'}`
                  : 'Processo parado'}
              </span>
            </div>
          </div>

          {/* Logs */}
          <div className="rounded-xl border border-white/8 bg-[#0a0b0d]">
            <div className="flex items-center gap-2 border-b border-white/8 px-4 py-2.5">
              <Terminal className="h-3.5 w-3.5 text-emerald-400" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Log da Bridge</span>
              <span className="ml-auto text-[10px] text-slate-600">{logs.length} linhas</span>
            </div>
            <div className="h-64 overflow-y-auto bg-black/40 p-3 font-mono text-[11px]">
              {logs.length === 0 ? (
                <p className="text-slate-600">
                  {processRunning ? 'Carregando logs…' : 'Inicie a bridge para ver logs aqui.'}
                </p>
              ) : (
                logs.map((line, i) => (
                  <div
                    key={i}
                    className={cn(
                      'py-0.5 whitespace-pre-wrap break-all',
                      line.includes('ERROR') ? 'text-red-400' :
                      line.includes('WARNING') ? 'text-amber-400' :
                      line.includes('INFO') ? 'text-emerald-400/80' :
                      'text-slate-400',
                    )}
                  >
                    {line}
                  </div>
                ))
              )}
              <div ref={logsEndRef} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────

function StatCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/8 bg-black/20 p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-white">{value}</div>
    </div>
  );
}

function ChatBubble({ msg }: { msg: ChatMsg }) {
  const time = new Date(msg.timestamp).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return (
    <div className="group flex items-start gap-2 rounded-lg px-2 py-1 transition hover:bg-white/[0.03]">
      <span className="shrink-0 font-mono text-[10px] text-slate-600">{time}</span>
      <span className="shrink-0 text-xs font-bold text-violet-300">{msg.username}</span>
      <span className="min-w-0 break-words text-xs text-slate-200">{msg.text}</span>
    </div>
  );
}

function CheckItem({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/5 bg-black/20 px-3 py-2">
      {ok ? (
        <CheckCircle className="h-4 w-4 shrink-0 text-emerald-400" />
      ) : (
        <XCircle className="h-4 w-4 shrink-0 text-red-400/60" />
      )}
      <span className="text-xs text-white">{label}</span>
      <span className={cn('ml-auto text-[10px]', ok ? 'text-emerald-400/80' : 'text-slate-500')}>{detail}</span>
    </div>
  );
}
