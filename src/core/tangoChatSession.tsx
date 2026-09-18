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
import { getActivePersona, type PersonaMeta } from './personaManager';
import {
  reflectOnConversation,
  applySelfConfig,
  requestSelfGeneratedPhoto,
  summarizeSelfConfigChanges,
  type PendingSelfConfigChange,
} from './personaSelfConfig';
import type { CapturedMessage } from '../types';

// ─── Config & Endpoints ──────────────────────────────────────────────
export const BRIDGE_URL = '/tango-bridge';
export const BRIDGE_API = '/api/v1/chat-automation/bridge';

// Persiste o modo de autonomia/execução escolhido pelo usuário — sem isso o
// modo "Autônomo" resetava para "assistido" a cada F5, tornando a conversa
// autônoma pedida pelo usuário impossível de manter ligada de verdade.
const AUTONOMY_STORAGE_KEY = 'odessa:tango:autonomy:v1';

// A cada quantas respostas autônomas realmente enviadas a persona para e
// reflete sobre a conversa recente para (talvez) evoluir um traço duradouro.
// Baixo o suficiente para aprender rápido numa live, alto o suficiente para
// não gerar uma chamada de IA extra a cada única mensagem.
const AUTO_LEARN_EVERY_N_REPLIES = 6;

function loadStoredAutonomy(): { autonomyMode: AutonomyMode; executionMode: ExecutionMode } {
  const fallback = { autonomyMode: 'assistido' as AutonomyMode, executionMode: 'real' as ExecutionMode };
  if (typeof window === 'undefined' || !window.localStorage) return fallback;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(AUTONOMY_STORAGE_KEY) || '{}');
    return {
      autonomyMode: ['off', 'assistido', 'auto'].includes(parsed.autonomyMode) ? parsed.autonomyMode : fallback.autonomyMode,
      executionMode: ['dry_run', 'real'].includes(parsed.executionMode) ? parsed.executionMode : fallback.executionMode,
    };
  } catch {
    return fallback;
  }
}

function saveStoredAutonomy(autonomyMode: AutonomyMode, executionMode: ExecutionMode) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(AUTONOMY_STORAGE_KEY, JSON.stringify({ autonomyMode, executionMode }));
  } catch {
    // Ignora falhas de storage — o modo só deixa de persistir entre sessões.
  }
}

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
  refreshStatus: () => Promise<BridgeProcessStatus | null>;
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
  /** Timestamp (Date.now()) de quando a geração atual começou, ou null se ociosa. */
  aiGenerationStartedAt: number | null;
  handleGenerateReplyForMessage: (msg: TangoChatMessage) => Promise<void>;
  handleApproveReply: (item: TangoReplyItem) => Promise<void>;
  handleDiscardReply: (id: string) => void;
  handleRegenerateReply: (item: TangoReplyItem) => Promise<void>;
  executeSendMessage: (text: string) => Promise<boolean>;
  // Autoconfigurações pendentes de aprovação (Área 4)
  pendingSelfConfig: PendingSelfConfigChange[];
  approveSelfConfig: (id: string) => Promise<void>;
  rejectSelfConfig: (id: string) => void;
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
  children,
}: {
  /**
   * Eventos capturados pelo runtime do Odessa (OCR, manual, etc.) — aceito
   * por compatibilidade com quem chama este provider, mas não consumido
   * aqui: esta sessão trata só das mensagens do Tango Chat em si (bridge/SSE),
   * não do runtime de captura do Odessa.
   */
  capturedText?: CapturedMessage[];
  children: ReactNode;
}) {
  // ── Bridge Status & Processo ──────────────────────
  const [processStatus, setProcessStatus] = useState<BridgeProcessStatus | null>(null);
  // Espelha processStatus para refreshStatus() poder devolver o valor recém-buscado
  // de forma síncrona ao chamador — ler o state diretamente logo após o await
  // pegaria a closure antiga (o setState ainda não re-renderizou).
  const processStatusRef = useRef<BridgeProcessStatus | null>(null);
  const [bridgeConfig, setBridgeConfig] = useState<BridgeConfig>(defaultConfig());
  const [configDirty, setConfigDirty] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [connecting, setConnecting] = useState(false);

  // ── Chat & Mensagens ──────────────────────────────
  const [messages, setMessages] = useState<TangoChatMessage[]>([]);
  const [replyQueue, setReplyQueue] = useState<TangoReplyItem[]>([]);
  // Fila de autoconfigurações propostas pela persona (Área 4: aprovação
  // obrigatória). NUNCA bloqueia o chat — o envio de resposta já terminou
  // quando algo chega aqui (ver o bloco de reflexão de evolução abaixo);
  // só fica pendente até o operador aceitar/rejeitar pela UI.
  const [pendingSelfConfig, setPendingSelfConfig] = useState<PendingSelfConfigChange[]>([]);
  // O observer de DOM da bridge (tango_chat.py) não distingue "mensagem de um
  // espectador" de "mensagem que a própria Barbara acabou de enviar" — ele
  // simplesmente captura qualquer texto novo que aparece no chat. Sem isso, a
  // fala da própria persona ecoava de volta pelo SSE como se fosse uma
  // mensagem de outra pessoa: duplicava no histórico (já adicionado por
  // executeSendMessage) e, em modo Autônomo, disparava a IA respondendo a si
  // mesma — o que explica repetição e respostas sem contexto/continuidade.
  const recentlySentRef = useRef<{ text: string; at: number }[]>([]);
  const SELF_ECHO_WINDOW_MS = 8_000;
  const normalizeForEchoCheck = (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' ');
  const isOwnEcho = useCallback((incomingText: string) => {
    const now = Date.now();
    const normalized = normalizeForEchoCheck(incomingText);
    recentlySentRef.current = recentlySentRef.current.filter((entry) => now - entry.at < SELF_ECHO_WINDOW_MS);
    return recentlySentRef.current.some((entry) => entry.text === normalized);
  }, []);
  const [generatingForId, setGeneratingForId] = useState<string | null>(null);
  // Timestamp de quando a IA começou a gerar a resposta ATUAL (manual ou
  // autônoma) — null quando ociosa. Não dá pra saber uma % real de progresso
  // (o Ollama não expõe isso na chamada não-streaming que usamos), mas o
  // tempo decorrido já responde "ela está escrevendo ou travou?" na prática.
  const [aiGenerationStartedAt, setAiGenerationStartedAt] = useState<number | null>(null);

  // ── IA & Modos ────────────────────────────────────
  // autonomyMode + executionMode vivem num único state (em vez de dois
  // separados) para que cada setter possa persistir os DOIS valores em
  // localStorage sem precisar ler o "outro" valor de uma ref — refs lidas
  // dentro de um useCallback memoizado entram em conflito com a checagem de
  // imutabilidade do React Compiler quando outro efeito escreve nelas.
  const [autonomy, setAutonomyState] = useState(loadStoredAutonomy);
  const autonomyMode = autonomy.autonomyMode;
  const executionMode = autonomy.executionMode;
  const setAutonomyMode: Dispatch<SetStateAction<AutonomyMode>> = useCallback((value) => {
    setAutonomyState((prev) => {
      const nextMode = typeof value === 'function' ? (value as (p: AutonomyMode) => AutonomyMode)(prev.autonomyMode) : value;
      const next = { ...prev, autonomyMode: nextMode };
      saveStoredAutonomy(next.autonomyMode, next.executionMode);
      return next;
    });
  }, []);
  const setExecutionMode: Dispatch<SetStateAction<ExecutionMode>> = useCallback((value) => {
    setAutonomyState((prev) => {
      const nextMode = typeof value === 'function' ? (value as (p: ExecutionMode) => ExecutionMode)(prev.executionMode) : value;
      const next = { ...prev, executionMode: nextMode };
      saveStoredAutonomy(next.autonomyMode, next.executionMode);
      return next;
    });
  }, []);

  const [aiPrompt, setAiPrompt] = useState(() => getAiConfig().systemPrompt || '');
  const [activePersona, setActivePersona] = useState<PersonaMeta | null>(null);
  const [lastSentAt, setLastSentAt] = useState<number>(0);
  const autonomousReplyCountRef = useRef(0);

  // ── Persona ativa: usada para (1) semear o prompt com a identidade real da
  // persona (Barbara, etc.) em vez de um "Odessa" genérico, e (2) permitir a
  // reflexão de auto-evolução aprender com as respostas reais do chat.
  useEffect(() => {
    (async () => {
      try {
        const { persona } = await getActivePersona();
        setActivePersona(persona);
        // Só semeia o prompt se o usuário não tiver customizado nada ainda
        // (nem em AiConfigPanel, nem editando o campo aqui na sessão).
        const hasCustomPrompt = Boolean(getAiConfig().systemPrompt?.trim());
        if (!hasCustomPrompt && persona.personality?.trim()) {
          setAiPrompt((prev) => (prev.trim() ? prev : persona.personality!.trim()));
        }
      } catch {
        // Sem persona ativa disponível — segue com o prompt padrão da Odessa.
      }
    })();
  }, []);

  // ── SSE ───────────────────────────────────────────
  const [sseState, setSseState] = useState<SseConnectionState>('stopped');
  const [sseAttempts, setSseAttempts] = useState(0);
  const sseRef = useRef<EventSource | null>(null);

  const bridgeConnected = processStatus?.bridgeStatus?.status === 'connected';

  // ── Mensagens da sessão atual da bridge ──
  // Eventos OCR/manual não são chat do Tango e não devem aparecer no feed
  // quando a bridge está offline. Isso evita apresentar histórico local como
  // se fosse uma live atual.
  const unifiedMessages = useMemo<TangoChatMessage[]>(() => {
    return messages;
  }, [messages]);

  // ── Polling de Status com backoff exponencial e pausa quando inativo ──
  const inFlightStatusRef = useRef(false);
  const statusBackoffMsRef = useRef(3500);

  const refreshStatus = useCallback(async (): Promise<BridgeProcessStatus | null> => {
    if (inFlightStatusRef.current || (typeof document !== 'undefined' && document.hidden)) {
      return processStatusRef.current;
    }
    inFlightStatusRef.current = true;
    try {
      const data = await fetchJson<BridgeProcessStatus>(`${BRIDGE_API}/status`);
      setProcessStatus(data);
      processStatusRef.current = data;
      if (data) {
        statusBackoffMsRef.current = 3500; // Reset backoff no sucesso
      } else {
        statusBackoffMsRef.current = Math.min(statusBackoffMsRef.current * 1.5, 30000);
      }
      return data;
    } catch {
      statusBackoffMsRef.current = Math.min(statusBackoffMsRef.current * 1.5, 30000);
      return processStatusRef.current;
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
    void fetchJson(`${BRIDGE_URL}/clear-history`, { method: 'POST' });
  }, []);

  // ── Envio no Tango ────────────────────────────────
  const executeSendMessage = useCallback(
    async (text: string): Promise<boolean> => {
      const clean = text.trim();
      if (!clean) return false;

      // Registra a própria fala no histórico local — sem isso a IA nunca via
      // o que ela mesma tinha dito, só as mensagens do público. Isso é o que
      // fazia ela "esquecer" a conversa e cair sempre no mesmo movimento
      // genérico (convite pra jogar/dançar) em vez de manter um diálogo real
      // de pergunta-resposta-pergunta.
      const recordOwnReply = () => {
        setMessages((prev) => [
          ...prev.slice(-399),
          { username: activePersona?.name || 'Você', text: clean, timestamp: new Date().toISOString() },
        ]);
        // Marca esse texto como "acabei de enviar" para o filtro de eco do
        // SSE (isOwnEcho) descartar a versão que o observer da bridge captura
        // de volta do próprio DOM do chat.
        recentlySentRef.current.push({ text: normalizeForEchoCheck(clean), at: Date.now() });
      };

      if (executionMode === 'dry_run') {
        console.log('[DRY-RUN] Simulação de envio no Tango:', clean);
        setLastSentAt(Date.now());
        recordOwnReply();
        return true;
      }

      try {
        const res = await fetchJson<{ ok: boolean; error?: string }>(`${BRIDGE_URL}/send`, {
          method: 'POST',
          body: JSON.stringify({ text: clean }),
        });
        if (res?.ok) {
          setLastSentAt(Date.now());
          recordOwnReply();
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [executionMode, activePersona],
  );

  // ── Geração de Resposta por IA ─────────────────────
  const handleGenerateReplyForMessage = useCallback(
    async (msg: TangoChatMessage) => {
      setGeneratingForId(msg.timestamp || msg.text);
      setAiGenerationStartedAt(Date.now());
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
        setAiGenerationStartedAt(null);
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
      if (!decision.allowed) {
        // Visibilidade: sem isto, uma mensagem real ficava sem resposta em
        // silêncio (cooldown/limite/repetida) sem nenhum rastro de por quê —
        // só registra os motivos "de verdade" (não os triviais de validação
        // de entrada, que são ruído: mensagem vazia ou curta demais).
        if (decision.reason && decision.reason !== 'empty_message' && decision.reason !== 'too_short') {
          recordSessionEvent('ai.reply.skipped', {
            username: msg.username,
            text: msg.text,
            reason: decision.reason,
          });
        }
        return;
      }

      setGeneratingForId(msg.timestamp || msg.text);
      setAiGenerationStartedAt(Date.now());
      let result: Awaited<ReturnType<typeof generateTangoChatReply>>;
      try {
        result = await generateTangoChatReply(msg, unifiedMessages, aiPrompt);
      } finally {
        setGeneratingForId(null);
        setAiGenerationStartedAt(null);
      }
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

        // Aprendizado automático: a cada N respostas autônomas enviadas de
        // verdade, a persona reflete sobre a conversa recente e pode propor
        // um traço duradouro (mesmo protocolo do PersonaChatLab). Área 4:
        // isto só ENFILEIRA — não aplica nada sozinho. O envio da resposta
        // acima (executeSendMessage) já terminou, então enfileirar aqui não
        // atrasa a live em nada; o operador aprova/rejeita quando puder.
        autonomousReplyCountRef.current += 1;
        if (activePersona && autonomousReplyCountRef.current % AUTO_LEARN_EVERY_N_REPLIES === 0) {
          void (async () => {
            try {
              const changes = await reflectOnConversation(activePersona, [...unifiedMessages, msg].slice(-20));
              if (!changes) return;

              const proposal: PendingSelfConfigChange = {
                id: `selfconfig-${Date.now()}`,
                personaId: activePersona.id,
                changes,
                source: 'conversation',
                proposedAt: new Date().toISOString(),
                summary: summarizeSelfConfigChanges(changes),
              };
              setPendingSelfConfig((current) => [...current, proposal].slice(-20));
              recordSessionEvent('persona.selfconfig.proposed', {
                personaId: activePersona.id,
                summary: proposal.summary,
                source: 'conversation',
              });
            } catch {
              // Melhor esforço — a conversa continua normalmente sem a proposta desta rodada.
            }
          })();
        }
      }
      setReplyQueue((prev) =>
        prev.map((item) =>
          item.id === newItem.id
            ? { ...item, status: sent ? 'sent' : 'blocked', sentAt: new Date().toISOString() }
            : item,
        ),
      );
    },
    [unifiedMessages, aiPrompt, executeSendMessage, activePersona],
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

  // Área 4: aprovar/rejeitar uma autoconfiguração proposta pela persona.
  // Só aqui (após aceite explícito) applySelfConfig/requestSelfGeneratedPhoto
  // são chamados de verdade — nunca no momento em que a mudança é proposta.
  const approveSelfConfig = useCallback(
    async (id: string) => {
      const item = pendingSelfConfig.find((p) => p.id === id);
      if (!item) return;
      setPendingSelfConfig((current) => current.filter((p) => p.id !== id));
      try {
        const applyResult = await applySelfConfig(item.personaId, item.changes, item.source);
        if (applyResult.ok && applyResult.applied.length) {
          recordSessionEvent('persona.selfconfig.applied', {
            personaId: item.personaId,
            applied: applyResult.applied,
            source: item.source,
          });
          // Recarrega a persona (e o prompt em uso) com a personalidade já
          // aprovada, pra que a PRÓXIMA resposta já reflita a mudança.
          if (activePersona && activePersona.id === item.personaId) {
            const { persona: refreshed } = await getActivePersona();
            setActivePersona(refreshed);
            if (!getAiConfig().systemPrompt?.trim() && refreshed.personality?.trim()) {
              setAiPrompt(refreshed.personality.trim());
            }
          }
        }
        // Pedido de foto nova: disparo assíncrono (não trava a UI) — a foto
        // some no Content Studio/histórico quando terminar.
        if (item.changes.photo_prompt) {
          void requestSelfGeneratedPhoto(item.personaId, item.changes.photo_prompt, item.source);
          recordSessionEvent('persona.selfconfig.photoRequested', {
            prompt: item.changes.photo_prompt,
            personaId: item.personaId,
          });
        }
      } catch {
        // Melhor esforço — o operador pode notar pelo histórico que não pegou.
      }
    },
    [pendingSelfConfig, activePersona],
  );

  const rejectSelfConfig = useCallback(
    (id: string) => {
      const item = pendingSelfConfig.find((p) => p.id === id);
      setPendingSelfConfig((current) => current.filter((p) => p.id !== id));
      if (item) {
        recordSessionEvent('persona.selfconfig.rejected', {
          personaId: item.personaId,
          summary: item.summary,
          source: item.source,
        });
      }
    },
    [pendingSelfConfig],
  );

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
      setMessages([]);
      setReplyQueue([]);
      await fetchJson(`${BRIDGE_URL}/clear-history`, { method: 'POST' });
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
    await fetchJson(`${BRIDGE_URL}/clear-history`, { method: 'POST' });
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
    await fetchJson(`${BRIDGE_URL}/clear-history`, { method: 'POST' });
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

  const bridgePortRef = useRef(bridgeConfig.port);
  useEffect(() => {
    bridgePortRef.current = bridgeConfig.port;
  }, [bridgeConfig.port]);

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
      // Em dev, o proxy do Vite (server.proxy, /tango-bridge → 127.0.0.1:7555)
      // nunca entrega os headers/bytes de uma resposta SSE (text/event-stream,
      // chunked, sem fim) — a conexão fica presa em CONNECTING para sempre,
      // então NENHUMA mensagem nova chega ao app e o modo autônomo nunca
      // dispara, mesmo com a bridge e o Ollama funcionando perfeitamente.
      // Como a bridge já libera CORS (Access-Control-Allow-Origin: *), em dev
      // conectamos direto nela, sem passar pelo proxy quebrado.
      const sseUrl = import.meta.env.DEV
        ? `http://${window.location.hostname}:${bridgePortRef.current}/messages`
        : `${BRIDGE_URL}/messages`;
      const es = new EventSource(sseUrl);
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

          // O observer da bridge captura QUALQUER texto novo no DOM do chat,
          // inclusive a mensagem que a própria Barbara acabou de enviar. Sem
          // esse filtro, a fala dela ecoava de volta como se fosse de outra
          // pessoa: duplicava no histórico e, em modo Autônomo, disparava a
          // IA gerando resposta pra si mesma — causando repetição e perda de
          // contexto/continuidade na conversa.
          if (isOwnEcho(msg.text)) return;

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
  }, [bridgeConnected, isOwnEcho]);

  // O botão principal da live dispara a bridge sem exigir que o usuário abra
  // primeiro a aba de configurações do chat.
  useEffect(() => {
    const handleStartLive = async () => {
      if (processStatus?.bridgeStatus?.status === 'connected') return;
      await handleStartProcess();
      await handleConnectBridge();
    };

    window.addEventListener('odessa:start-chat-bridge', handleStartLive);
    return () => window.removeEventListener('odessa:start-chat-bridge', handleStartLive);
  }, [handleConnectBridge, handleStartProcess, processStatus?.bridgeStatus?.status]);

  useEffect(() => {
    const handleEndLive = async () => {
      await handleStopProcess();
      setSseState('stopped');
      setSseAttempts(0);
    };

    window.addEventListener('odessa:end-live', handleEndLive);
    return () => window.removeEventListener('odessa:end-live', handleEndLive);
  }, [handleStopProcess]);

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
    aiGenerationStartedAt,
    handleGenerateReplyForMessage,
    handleApproveReply,
    handleDiscardReply,
    handleRegenerateReply,
    executeSendMessage,
    pendingSelfConfig,
    approveSelfConfig,
    rejectSelfConfig,
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
