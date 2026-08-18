/**
 * TangoChatPanel — Painel visual de integração com o chat do Tango.
 *
 * Consome o servidor HTTP local do Python (porta 7555) que se conecta
 * ao Chrome do usuário via CDP (Chrome DevTools Protocol).
 *
 * O Chrome do usuário precisa ter sido aberto com:
 *   chrome.exe --remote-debugging-port=9222
 *
 * O Python NÃO abre um browser separado — ele se "acopla" ao Chrome
 * já aberto e injeta o MutationObserver na aba do Tango.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle,
  ExternalLink,
  Loader2,
  MessageCircle,
  Pause,
  Play,
  Radio,
  RefreshCw,
  Send,
  Terminal,
  Wifi,
  WifiOff,
  XCircle,
} from 'lucide-react';
import { Badge, Button, Input } from './ui';
import { cn } from '../lib/utils';

// ─── Config ─────────────────────────────────────────────────────────
const TANGO_BRIDGE_URL = 'http://localhost:7555';

// ─── Types ──────────────────────────────────────────────────────────

type BridgeStatus = {
  status: 'disconnected' | 'connecting' | 'connected' | 'error' | 'not_initialized';
  pageUrl?: string;
  startedAt?: string | null;
  messageCount?: number;
  historySize?: number;
  observerInjected?: boolean;
  error?: string | null;
  cdpUrl?: string;
};

type ChatMsg = {
  username: string;
  text: string;
  timestamp: string;
};

// ─── Helpers ────────────────────────────────────────────────────────

async function fetchBridge<T = unknown>(path: string, opts?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(`${TANGO_BRIDGE_URL}${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...opts?.headers },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ─── Component ──────────────────────────────────────────────────────

export function TangoChatPanel() {
  const [status, setStatus] = useState<BridgeStatus>({ status: 'not_initialized' });
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [draftText, setDraftText] = useState('');
  const [sending, setSending] = useState(false);
  const [serverOnline, setServerOnline] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sseRef = useRef<EventSource | null>(null);

  // ── Poll status every 3s ─────────────────────────────
  const refreshStatus = useCallback(async () => {
    const data = await fetchBridge<BridgeStatus>('/status');
    if (data) {
      setStatus(data);
      setServerOnline(true);
    } else {
      setServerOnline(false);
      setStatus({ status: 'not_initialized' });
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
    const timer = window.setInterval(() => void refreshStatus(), 3000);
    return () => window.clearInterval(timer);
  }, [refreshStatus]);

  // ── Load history when bridge connects ────────────────
  useEffect(() => {
    if (status.status !== 'connected') return;
    (async () => {
      const data = await fetchBridge<{ messages: ChatMsg[] }>('/history?limit=200');
      if (data?.messages) setMessages(data.messages);
    })();
  }, [status.status]);

  // ── SSE stream for realtime messages ─────────────────
  useEffect(() => {
    if (status.status !== 'connected') {
      sseRef.current?.close();
      sseRef.current = null;
      return;
    }
    if (sseRef.current) return;

    const es = new EventSource(`${TANGO_BRIDGE_URL}/messages`);
    sseRef.current = es;

    es.onmessage = (ev) => {
      try {
        const msg: ChatMsg = JSON.parse(ev.data);
        setMessages((prev) => [...prev.slice(-499), msg]);
      } catch { /* ignore bad data */ }
    };

    es.onerror = () => {
      es.close();
      sseRef.current = null;
    };

    return () => {
      es.close();
      sseRef.current = null;
    };
  }, [status.status]);

  // ── Auto-scroll ─────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Actions ─────────────────────────────────────────
  const handleConnect = async () => {
    await fetchBridge('/connect', { method: 'POST', body: '{}' });
    await refreshStatus();
  };

  const handleDisconnect = async () => {
    await fetchBridge('/disconnect', { method: 'POST' });
    setMessages([]);
    await refreshStatus();
  };

  const handleSend = async () => {
    const text = draftText.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await fetchBridge('/send', {
        method: 'POST',
        body: JSON.stringify({ text }),
      });
      setDraftText('');
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  // ── Derived ────────────────────────────────────────
  const isConnected = status.status === 'connected';
  const isConnecting = status.status === 'connecting';
  const hasError = status.status === 'error';

  const statusColor = isConnected
    ? 'text-emerald-400'
    : isConnecting
      ? 'text-amber-400'
      : hasError
        ? 'text-red-400'
        : 'text-slate-500';

  const statusLabel = isConnected
    ? 'Conectado via CDP'
    : isConnecting
      ? 'Conectando…'
      : hasError
        ? 'Erro'
        : serverOnline
          ? 'Desconectado'
          : 'Servidor offline';

  // ── Render ─────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* ── Header + Status ───────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/8 bg-[#0a0b0d] p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 text-violet-300">
            <MessageCircle className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-white">Tango Chat Bridge</h3>
              <span className={cn('flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest', statusColor)}>
                {isConnected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                {statusLabel}
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              {isConnected
                ? `${status.messageCount ?? 0} msgs capturadas · Observer ${status.observerInjected ? 'ativo' : 'pendente'}`
                : serverOnline
                  ? 'Servidor Python pronto. Clique em Conectar (Chrome precisa estar com CDP ativo).'
                  : 'Inicie o servidor Python: python tango_chat/tango_chat.py'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!serverOnline && (
            <Badge variant="warning">
              <AlertCircle className="mr-1 h-3 w-3" />
              Servidor offline
            </Badge>
          )}
          <Button size="sm" variant="secondary" onClick={() => void refreshStatus()}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          {isConnected ? (
            <Button size="sm" variant="danger" onClick={() => void handleDisconnect()}>
              <Pause className="h-3.5 w-3.5" />
              Desconectar
            </Button>
          ) : (
            <Button
              size="sm"
              variant="primary"
              disabled={!serverOnline || isConnecting}
              onClick={() => void handleConnect()}
            >
              {isConnecting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              Conectar
            </Button>
          )}
        </div>
      </div>

      {/* ── Error ────────────────────────────────────── */}
      {hasError && status.error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-400/30 bg-red-500/10 p-3">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-red-300">Erro na bridge</p>
            <p className="mt-1 text-xs text-red-200/80">{status.error}</p>
          </div>
        </div>
      )}

      {/* ── Connected info ───────────────────────────── */}
      {isConnected && (
        <>
          {/* Stats */}
          <div className="grid gap-2 md:grid-cols-4">
            <StatCard
              label="Mensagens"
              value={String(status.messageCount ?? 0)}
              icon={<MessageCircle className="h-3.5 w-3.5 text-sky-400" />}
            />
            <StatCard
              label="Histórico"
              value={String(status.historySize ?? 0)}
              icon={<Activity className="h-3.5 w-3.5 text-violet-400" />}
            />
            <StatCard
              label="Observer"
              value={status.observerInjected ? 'Ativo' : 'Pendente'}
              icon={<Radio className="h-3.5 w-3.5 text-emerald-400" />}
            />
            <StatCard
              label="Desde"
              value={status.startedAt ? new Date(status.startedAt).toLocaleTimeString('pt-BR') : '-'}
              icon={<CheckCircle className="h-3.5 w-3.5 text-amber-400" />}
            />
          </div>

          {/* Page URL */}
          {status.pageUrl && (
            <div className="flex items-center gap-2 rounded-lg border border-white/8 bg-black/20 px-3 py-2">
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-500" />
              <span className="truncate text-[11px] text-slate-400">{status.pageUrl}</span>
            </div>
          )}

          {/* ── Monitor de Visão ───────────────────────────── */}
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
                    placeholder="Cole a URL da Live aqui..." 
                    className="h-7 w-64 rounded border border-white/10 bg-white/[0.04] px-2 text-xs text-white"
                 />
                 <Button 
                    size="sm" 
                    variant="secondary" 
                    onClick={async () => {
                      const url = (document.getElementById('goto-url') as HTMLInputElement).value;
                      if(url) await fetchBridge('/goto', { method: 'POST', body: JSON.stringify({url}) });
                    }}
                 >Navegar</Button>
              </div>
            </div>
            <div className="relative aspect-video w-full overflow-hidden rounded border border-white/10 bg-black/50">
              <img 
                src={`http://localhost:7555/screenshot?t=${Date.now()}`} 
                alt="Visão do Robô"
                className="h-full w-full object-contain"
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
                onError={(e: any) => { e.target.style.display = 'none'; }}
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
                onLoad={(e: any) => { e.target.style.display = 'block'; }}
              />
              <div className="absolute bottom-2 right-2 flex gap-2">
                <Button size="sm" variant="secondary" className="opacity-80 hover:opacity-100" onClick={(e) => {
                  const img = e.currentTarget.parentElement?.previousElementSibling as HTMLImageElement;
                  if (img) img.src = `http://localhost:7555/screenshot?t=${Date.now()}`;
                }}>
                  <RefreshCw className="mr-1 h-3 w-3" />
                  Atualizar Foto
                </Button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Chat feed ────────────────────────────────── */}
      <div className="rounded-xl border border-white/8 bg-black/30">
        <div className="flex items-center gap-2 border-b border-white/8 px-4 py-2.5">
          <Radio className="h-3.5 w-3.5 text-violet-400" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
            Chat ao vivo
          </span>
          {isConnected && (
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
                {isConnected
                  ? 'Aguardando mensagens do chat…'
                  : 'Conecte a bridge para ver mensagens aqui.'}
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

        {/* ── Send bar ───────────────────────────────── */}
        <div className="flex items-center gap-2 border-t border-white/8 px-3 py-2.5">
          <input
            type="text"
            className="h-9 flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm text-white placeholder-slate-500 outline-none focus:border-violet-500/50"
            placeholder={isConnected ? 'Digite uma mensagem…' : 'Conecte a bridge primeiro'}
            disabled={!isConnected}
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <Button
            size="sm"
            variant="primary"
            disabled={!isConnected || !draftText.trim() || sending}
            onClick={() => void handleSend()}
          >
            {sending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            Enviar
          </Button>
        </div>
      </div>

      {/* ── Setup instructions ───────────────────────── */}
      {!isConnected && (
        <div className="rounded-xl border border-sky-500/20 bg-sky-500/8 p-4">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-sky-300" />
            <p className="text-[11px] font-bold uppercase tracking-widest text-sky-300">Como usar</p>
          </div>
          <ol className="mt-3 space-y-2 text-xs text-sky-100/80">
            <li className="flex gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-500/20 text-[10px] font-bold text-sky-200">1</span>
              <span>
                <strong>Feche o Chrome</strong> e reabra com a flag CDP:
                <code className="mt-1 block rounded bg-black/30 px-2 py-1 text-[11px] text-sky-100">
                  chrome.exe --remote-debugging-port=9222
                </code>
                <span className="mt-1 block text-[10px] text-sky-200/60">
                  Dica: crie um atalho no desktop com essa flag para não digitar toda vez.
                </span>
              </span>
            </li>
            <li className="flex gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-500/20 text-[10px] font-bold text-sky-200">2</span>
              <span>Abra o <strong>Tango</strong> no Chrome e inicie sua stream normalmente.</span>
            </li>
            <li className="flex gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-500/20 text-[10px] font-bold text-sky-200">3</span>
              <span>
                Em outro terminal, inicie o servidor Python:
                <code className="mt-1 block rounded bg-black/30 px-2 py-1 text-[11px] text-sky-100">
                  python tango_chat/tango_chat.py
                </code>
              </span>
            </li>
            <li className="flex gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-500/20 text-[10px] font-bold text-sky-200">4</span>
              <span>Clique em <strong>Conectar</strong> aqui no painel. O Python vai encontrar a aba do Tango e injetar o observer.</span>
            </li>
          </ol>

          <div className="mt-3 rounded-lg border border-amber-400/20 bg-amber-500/8 px-3 py-2">
            <p className="text-[10px] font-semibold text-amber-200">
              ⚠️ O Chrome deve estar com --remote-debugging-port=9222 para que o Python consiga se conectar.
              Essa flag não abre nenhuma janela extra — o Python só "escuta" a aba que já está aberta.
            </p>
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
