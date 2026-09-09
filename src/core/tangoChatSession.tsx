/**
 * tangoChatSession — sessão do Tango Chat de nível superior.
 *
 * Problema estrutural que este módulo resolve: a conexão SSE da bridge, o
 * recebimento de mensagens, a fila de respostas e o disparo automático de IA
 * viviam dentro do componente TangoChatPanel — ou seja, só existiam enquanto
 * a aba "chat" estava aberta. Ao trocar de aba o painel desmontava e a
 * automação morria silenciosamente.
 *
 * O TangoChatSessionProvider é montado uma única vez no App (acima de qualquer
 * troca de aba/painel) e mantém viva toda a lógica de sessão:
 *  - status do processo/bridge + polling
 *  - conexão SSE de mensagens (com backoff exponencial e tentativas limitadas)
 *  - mensagens unificadas (bridge + eventos capturados do runtime)
 *  - fila de respostas (gerar/aprovar/descartar/regenerar) e envio no Tango
 *  - modos de operação (autonomia, dry-run/real) e prompt da IA
 *
 * O TangoChatPanel (e qualquer outra UI futura) apenas consome via
 * useTangoChatSession().
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import {
  generateTangoChatReply,
  type TangoChatMessage,
} from './tangoAiChatService';
import { getAiConfig } from './aiConfig';
import { routeChatToTriggers } from './chatToTriggerBridge';
import {
  shouldReplyToMessage,
  recordChatReplySent,
  recordIncomingMessage,
} from './chatConversationGovernor';
import { recordSessionEvent } from './sessionHistory';
import type { CapturedMessage } from '../types';

// ─── Config & Endpoints ──────────────────────────────────────────────
export const BRIDGE_URL = '/tango-bridge';
export const BRIDGE_API = '/api/v1/chat-automation/bridge';

// ─── Types ───────────────────────────────────────────────────────────

export type AutonomyMode = 'off' | 'assistido' | 'auto';
export type ExecutionMode = 'dry_run' | 'real';

export type ReplyQueueStatus = 'draft' | 'sending' | 'sent' | 'blocked' | 'discarded';

export type TangoReplyItem = {
  id: string;
  sourceMessage: TangoChatMessage;
  text: string;
  originalText: string;
  status: ReplyQueueStatus;
  confidence: number;
  reason?: string;
  blockedReason?: string;
  createdAt: string;
  sentAt?: string;
};

export type BridgeProcessStatus = {
  processRunning: boolean;
  pid: number | null;
  startedAt: string | null;
  bridgeUrl: string;
  bridgeReachable: boolean;
  bridgeStatus: BridgeConnectionStatus | null;
};

export type BridgeConnectionStatus = {
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

export type BridgeConfig = {
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

/** Estado do stream SSE de mensagens da bridge. */
export type SseConnectionState = 'stopped' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

export const SSE_MAX_ATTEMPTS = 6;
const SSE_BACKOFF_BASE_MS = 1_000;
const SSE_BACKOFF_MAX_MS = 30_000;

// ─── Helpers ─────────────────────────────────────────────────────────

export async function fetchJson<T = unknown>(url: string, opts?: RequestInit): Promise<T | null> {
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

export function defaultConfig(): BridgeConfig {
  return {
    mode: '',
    cdpUrl: 'http://127.0.0.1:9222',
    roomUrl: 'https://tango.me/stream/broadcast',
    port: 7555,
    autoconnect: true,
    selectors: {
      containerChat: '[data-testid="virtuoso-item-list"]',
      mensagem: '[data-testid^="chat-event-"]',
      username: ".Hhi6n",
      textoMsg: ".KR99L",
      inputTexto: '[data-testid="textarea"]',
      botaoEnviar: '',
    },
  };
}

// ─── Context ─────────────────────────────────────────────────────────

export type TangoChatSessionValue = {
  // Status do processo/bridge
  processStatus: BridgeProcessStatus | null;
  refreshStatus: () => Promise<void>;
  starting: boolean;
  connecting: boolean;
  // Config da bridge
  bridgeConfig: BridgeConfig;
  setBridgeConfig: Dispatch<SetStateAction<BridgeConfig>>;
  configDirty: boolean;
  setConfigDirty: Dispatch<SetStateAction<boolean>>;
  configSaving: boolean;
  handleSaveBridgeConfig: () => Promise<void>;
  // Ações de processo/conexão
  handleStartProcess: () => Promise<void>;
  handleStopProcess: () => Promise<void>;
  handleConnectBridge: () => Promise<void>;
  handleDisconnectBridge: () => Promise<void>;
  // Mensagens
  messages: TangoChatMessage[];
  unifiedMessages: TangoChatMessage[];
  handleLoadHistory: () => Promise<void>;
  handleClearChat: () => void;
  // Fila de respostas
  replyQueue: TangoReplyItem[];
  setReplyQueue: Dispatch<SetStateAction<TangoReplyItem[]>>;
  generatingForId: string | null;
  handleGenerateReplyForMessage: (msg: TangoChatMessage) => Promise<void>;
  handleApproveReply: (item: TangoReplyItem) => Promise<void>;
  handleDiscardReply: (id: string) => void;
  handleRegenerateReply: (item: TangoReplyItem) => Promise<void>;
  executeSendMessage: (text: string) => Promise<boolean>;
  // Modos de operação
  autonomyMode: AutonomyMode;
  setAutonomyMode: Dispatch<SetStateAction<AutonomyMode>>;
  executionMode: ExecutionMode;
  setExecutionMode: Dispatch<SetStateAction<ExecutionMode>>;
  // IA
  aiPrompt: string;
  setAiPrompt: Dispatch<SetStateAction<string>>;
  lastSentAt: number;
  // SSE
  sseState: SseConnectionState;
  sseAttempts: number;
};

const TangoChatSessionContext = createContext<TangoChatSessionValue | null>(null);

export function useTangoChatSession(): TangoChatSessionValue {
  const ctx = useContext(TangoChatSessionContext);
  if (!ctx) {
    throw new Error('useTangoChatSession exige um <TangoChatSessionProvider> acima na árvore');
  }
  return ctx;
}

export function TangoChatSessionProvider({
  capturedText,
  children,
}: {
  /** Eventos capturados pelo runtime do Odessa (OCR, manual, etc.). */
  capturedText?: CapturedMessage[];
  children: ReactNode;
}) {
  // ── Bridge Status & Processo ──────────────────────
  const [processStatus, setProcessStatus] = useState<BridgeProcessStatus | null>(null);
  const [bridgeConfig, setBridgeConfig] = useState<BridgeConfig>(defaultConfig());
  const [configDirty, setConfigDirty] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [connecting, setConnecting] = useState(false);

  // ── Chat & Mensagens ──────────────────────────────
  const [messages, setMessages] = useState<TangoChatMessage[]>([]);
  const [replyQueue, setReplyQueue] = useState<TangoReplyItem[]>([]);
  const [generatingForId, setGeneratingForId] = useState<string | null>(null);

  // ── IA & Modos ────────────────────────────────────
  const [autonomyMode, setAutonomyMode] = useState<AutonomyMode>('assistido');
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('real');
  const [aiPrompt, setAiPrompt] = useState(() => getAiConfig().systemPrompt || '');
  const [lastSentAt, setLastSentAt] = useState<number>(0);

  // ── SSE ───────────────────────────────────────────
  const [sseState, setSseState] = useState<SseConnectionState>('stopped');
  const [sseAttempts, setSseAttempts] = useState(0);
  const sseRef = useRef<EventSource | null>(null);

  const bridgeConnected = processStatus?.bridgeStatus?.status === 'connected';

  // ── Mensagens unificadas: bridge + capturedText do Odessa ──
  // Quando a bridge está offline, messages (bridge) está vazia. Convertemos
  // capturedText (eventos do runtime: OCR, manual, etc.) para o formato
  // TangoChatMessage para que a IA tenha contexto ao gerar respostas.
  const unifiedMessages = useMemo<TangoChatMessage[]>(() => {
    if (messages.length > 0 || bridgeConnected) return messages;
    return (capturedText || [])
      .filter((m) => m.kind === 'chat' || m.kind === 'gift')
      .map((m) => ({
        username: (m.metadata?.username as string) || m.zoneName || 'Espectador',
        text: m.text,
        timestamp: m.createdAt,
      }));
  }, [messages, bridgeConnected, capturedText]);

  // ── Polling de Status com backoff exponencial e pausa quando inativo ──
  const inFlightStatusRef = useRef(false);
  const statusBackoffMsRef = useRef(3500);

  const refreshStatus = useCallback(async () => {
    if (inFlightStatusRef.current || (typeof document !== 'undefined' && document.hidden)) {
      return;
    }
    inFlightStatusRef.current = true;
    try {
      const data = await fetchJson<BridgeProcessStatus>(`${BRIDGE_API}/status`);
      setProcessStatus(data);
      if (data) {
        statusBackoffMsRef.current = 3500; // Reset backoff no sucesso
      } else {
        statusBackoffMsRef.current = Math.min(statusBackoffMsRef.current * 1.5, 30000);
      }
    } catch {
      statusBackoffMsRef.current = Math.min(statusBackoffMsRef.current * 1.5, 30000);
    } finally {
      inFlightStatusRef.current = false;
    }
  }, []);

  useEffect(() => {
    let timeoutId: number | undefined;
    let cancelled = false;

    const schedulePoll = () => {
      if (cancelled) return;
      timeoutId = window.setTimeout(async () => {
        await refreshStatus();
        schedulePoll();
      }, statusBackoffMsRef.current);
    };

    // Dispara imediatamente e agenda ciclo recursivo
    void refreshStatus();
    schedulePoll();

    // Quando o usuário volta à aba do navegador, acorda imediatamente
    const handleVisibility = () => {
      if (typeof document !== 'undefined' && !document.hidden && !cancelled) {
        statusBackoffMsRef.current = 3500;
        window.clearTimeout(timeoutId);
        void refreshStatus();
        schedulePoll();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [refreshStatus]);

  // ── Carregar Configurações ────────────────────────
  useEffect(() => {
    (async () => {
      const data = await fetchJson<BridgeConfig>(`${BRIDGE_API}/config`);
      if (data) setBridgeConfig({ ...defaultConfig(), ...data });
    })();
  }, []);

  // ── Histórico ao Conectar ─────────────────────────
  // Não carrega mais o histórico antigo da bridge ao conectar: a bridge mantém
  // mensagens de sessões anteriores em memória, o que poluía o feed com um
  // "histórico aleatório". O feed começa limpo e só mostra mensagens ao vivo
  // da sessão atual (via SSE). O usuário pode carregar o histórico manualmente
  // com o botão "Carregar histórico".
  const handleLoadHistory = useCallback(async () => {
    const data = await fetchJson<{ messages: TangoChatMessage[] }>(`${BRIDGE_URL}/history?limit=150`);
    if (data?.messages) setMessages(data.messages);
  }, []);

  const handleClearChat = useCallback(() => {
    setMessages([]);
  }, []);

  // ── Envio no Tango ────────────────────────────────
  const executeSendMessage = useCallback(
    async (text: string): Promise<boolean> => {
      const clean = text.trim();
      if (!clean) return false;

      if (executionMode === 'dry_run') {
        console.log('[DRY-RUN] Simulação de envio no Tango:', clean);
        setLastSentAt(Date.now());
        return true;
      }

      try {
        const res = await fetchJson<{ ok: boolean; error?: string }>(`${BRIDGE_URL}/send`, {
          method: 'POST',
          body: JSON.stringify({ text: clean }),
        });
        if (res?.ok) {
          setLastSentAt(Date.now());
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [executionMode],
  );

  // ── Geração de Resposta por IA ─────────────────────
  const handleGenerateReplyForMessage = useCallback(
    async (msg: TangoChatMessage) => {
      setGeneratingForId(msg.timestamp || msg.text);
      try {
        const result = await generateTangoChatReply(msg, unifiedMessages, aiPrompt);
        recordSessionEvent('ai.reply', {
          username: msg.username,
          sourceText: msg.text,
          reply: result.reply,
          confidence: result.confidence,
          blocked: result.blocked,
          reason: result.reason,
        });
        const newItem: TangoReplyItem = {
          id: `reply-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          sourceMessage: msg,
          text: result.reply,
          originalText: result.reply,
          status: result.blocked ? 'blocked' : 'draft',
          confidence: result.confidence,
          reason: result.reason,
          blockedReason: result.blockedReason,
          createdAt: new Date().toISOString(),
        };

        setReplyQueue((prev) => [newItem, ...prev].slice(0, 30));
      } finally {
        setGeneratingForId(null);
      }
    },
    [unifiedMessages, aiPrompt],
  );

  const handleAutoTriggerAi = useCallback(
    async (msg: TangoChatMessage) => {
      // Registra a mensagem recebida para detecção de repetição
      recordIncomingMessage(msg.text);

      // Governança: cooldown global + limite por minuto + cooldown por usuário + anti-flood
      const config = getAiConfig();
      const decision = shouldReplyToMessage(msg, {
        cooldownMs: config.chatReplyCooldownMs || 15_000,
        maxPerMinute: config.chatReplyMaxPerMinute || 4,
      });
      if (!decision.allowed) return;

      const result = await generateTangoChatReply(msg, unifiedMessages, aiPrompt);
      if (!result.ok || result.blocked || !result.reply) return;

      recordSessionEvent('ai.reply', {
        username: msg.username,
        sourceText: msg.text,
        reply: result.reply,
        confidence: result.confidence,
        autonomous: true,
      });

      const newItem: TangoReplyItem = {
        id: `reply-auto-${Date.now()}`,
        sourceMessage: msg,
        text: result.reply,
        originalText: result.reply,
        status: 'sending',
        confidence: result.confidence,
        reason: 'Resposta autônoma enviada pela IA',
        createdAt: new Date().toISOString(),
      };

      setReplyQueue((prev) => [newItem, ...prev].slice(0, 30));

      const sent = await executeSendMessage(result.reply);
      if (sent) {
        recordChatReplySent(msg.username);
        recordSessionEvent('ai.reply.sent', {
          username: msg.username,
          sourceText: msg.text,
          reply: result.reply,
        });
      }
      setReplyQueue((prev) =>
        prev.map((item) =>
          item.id === newItem.id
            ? { ...item, status: sent ? 'sent' : 'blocked', sentAt: new Date().toISOString() }
            : item,
        ),
      );
    },
    [unifiedMessages, aiPrompt, executeSendMessage],
  );

  const handleApproveReply = useCallback(
    async (item: TangoReplyItem) => {
      setReplyQueue((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, status: 'sending' } : i)),
      );

      const ok = await executeSendMessage(item.text);
      if (ok) {
        recordSessionEvent('message.sent', {
          text: item.text,
          source: 'approved_reply',
          username: item.sourceMessage.username,
        });
      }

      setReplyQueue((prev) =>
        prev.map((i) =>
          i.id === item.id
            ? { ...i, status: ok ? 'sent' : 'blocked', sentAt: new Date().toISOString() }
            : i,
        ),
      );
    },
    [executeSendMessage],
  );

  const handleDiscardReply = useCallback((id: string) => {
    setReplyQueue((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const handleRegenerateReply = useCallback(
    async (item: TangoReplyItem) => {
      setReplyQueue((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, status: 'draft', text: 'Regenerando com IA...' } : i)),
      );
      const result = await generateTangoChatReply(item.sourceMessage, unifiedMessages, aiPrompt);
      setReplyQueue((prev) =>
        prev.map((i) =>
          i.id === item.id
            ? {
                ...i,
                text: result.reply,
                originalText: result.reply,
                status: result.blocked ? 'blocked' : 'draft',
                confidence: result.confidence,
                blockedReason: result.blockedReason,
              }
            : i,
        ),
      );
    },
    [unifiedMessages, aiPrompt],
  );

  // ── Ações do Processo e Conexão ───────────────────
  const handleStartProcess = useCallback(async () => {
    setStarting(true);
    try {
      await fetchJson(`${BRIDGE_API}/start`, {
        method: 'POST',
        body: JSON.stringify({
          mode: bridgeConfig.mode,
          autoconnect: bridgeConfig.autoconnect,
          config: bridgeConfig,
        }),
      });
      await new Promise((r) => setTimeout(r, 1500));
      await refreshStatus();
    } finally {
      setStarting(false);
    }
  }, [bridgeConfig, refreshStatus]);

  const handleStopProcess = useCallback(async () => {
    await fetchJson(`${BRIDGE_API}/stop`, { method: 'POST' });
    setMessages([]);
    setReplyQueue([]);
    await refreshStatus();
  }, [refreshStatus]);

  const handleConnectBridge = useCallback(async () => {
    setConnecting(true);
    try {
      await fetchJson(`${BRIDGE_URL}/connect`, {
        method: 'POST',
        body: JSON.stringify({ mode: bridgeConfig.mode }),
      });
      await new Promise((r) => setTimeout(r, 2000));
      await refreshStatus();
    } finally {
      setConnecting(false);
    }
  }, [bridgeConfig, refreshStatus]);

  const handleDisconnectBridge = useCallback(async () => {
    await fetchJson(`${BRIDGE_URL}/disconnect`, { method: 'POST' });
    setMessages([]);
    await refreshStatus();
  }, [refreshStatus]);

  const handleSaveBridgeConfig = useCallback(async () => {
    setConfigSaving(true);
    try {
      const res = await fetchJson<BridgeConfig>(`${BRIDGE_API}/config`, {
        method: 'POST',
        body: JSON.stringify(bridgeConfig),
      });
      if (res) setBridgeConfig(res);
      setConfigDirty(false);
    } finally {
      setConfigSaving(false);
    }
  }, [bridgeConfig]);

  // ── SSE Stream de Mensagens ───────────────────────
  // Referências "latest": o stream não deve ser recriado quando o modo de
  // autonomia ou o histórico mudam (antes isso dependia do closure do efeito);
  // os callbacks sempre leem o valor atual via ref.
  const autonomyModeRef = useRef(autonomyMode);
  useEffect(() => {
    autonomyModeRef.current = autonomyMode;
  }, [autonomyMode]);

  const autoTriggerRef = useRef(handleAutoTriggerAi);
  useEffect(() => {
    autoTriggerRef.current = handleAutoTriggerAi;
  }, [handleAutoTriggerAi]);

  useEffect(() => {
    if (!bridgeConnected) {
      // Nota: o cleanup do effect anterior ja fecha o ES; o estado 'stopped'
      // e resetado no cleanup (abaixo) para evitar setState sincrono no corpo.
      sseRef.current?.close();
      sseRef.current = null;
      return;
    }

    let disposed = false;
    let attempt = 0;
    let retryTimer: number | undefined;

    const connect = () => {
      if (disposed) return;
      const es = new EventSource(`${BRIDGE_URL}/messages`);
      sseRef.current = es;

      es.onopen = () => {
        if (disposed) return;
        attempt = 0;
        setSseAttempts(0);
        setSseState('connected');
      };

      es.onmessage = (ev) => {
        try {
          const msg: TangoChatMessage = JSON.parse(ev.data);
          setMessages((prev) => [...prev.slice(-399), msg]);

          // Roteia a mensagem para o trigger engine do backend (palavra-chave/
          // presente -> vídeo do fluxo publicado), com dedupe e cooldown.
          void routeChatToTriggers(msg);

          // Se modo for Autônomo, dispara geração e envio automático
          if (autonomyModeRef.current === 'auto') {
            void autoTriggerRef.current(msg);
          }
        } catch { /* payload invalido: ignora */ }
      };

      // Backoff exponencial com tentativas limitadas — antes o onerror apenas
      // fechava o stream silenciosamente e o chat parava de receber mensagens
      // até a bridge mudar de estado.
      es.onerror = () => {
        es.close();
        if (sseRef.current === es) sseRef.current = null;
        if (disposed) return;
        attempt += 1;
        setSseAttempts(attempt);
        if (attempt > SSE_MAX_ATTEMPTS) {
          setSseState('failed');
          return;
        }
        setSseState('reconnecting');
        const delay = Math.min(SSE_BACKOFF_MAX_MS, SSE_BACKOFF_BASE_MS * 2 ** (attempt - 1));
        retryTimer = window.setTimeout(connect, delay);
      };
    };

    setSseState('connecting');
    connect();

    return () => {
      disposed = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      sseRef.current?.close();
      sseRef.current = null;
      setSseState('stopped');
      setSseAttempts(0);
    };
  }, [bridgeConnected]);

  const value: TangoChatSessionValue = {
    processStatus,
    refreshStatus,
    starting,
    connecting,
    bridgeConfig,
    setBridgeConfig,
    configDirty,
    setConfigDirty,
    configSaving,
    handleSaveBridgeConfig,
    handleStartProcess,
    handleStopProcess,
    handleConnectBridge,
    handleDisconnectBridge,
    messages,
    unifiedMessages,
    handleLoadHistory,
    handleClearChat,
    replyQueue,
    setReplyQueue,
    generatingForId,
    handleGenerateReplyForMessage,
    handleApproveReply,
    handleDiscardReply,
    handleRegenerateReply,
    executeSendMessage,
    autonomyMode,
    setAutonomyMode,
    executionMode,
    setExecutionMode,
    aiPrompt,
    setAiPrompt,
    lastSentAt,
    sseState,
    sseAttempts,
  };

  return <TangoChatSessionContext.Provider value={value}>{children}</TangoChatSessionContext.Provider>;
}
