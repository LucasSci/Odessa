/**
 * TangoChatPanel — Cockpit Completo de Respostas da IA no Tango Chat.
 *
 * Inclui:
 * 1. Feed ao vivo do chat com identificação de mensagens, presentes e eventos.
 * 2. Geração automática e sob demanda de respostas da Diretora IA (Gemini/OpenAI).
 * 3. Chave de Autonomia: Desativado, Assistido (Aprovação com 1 clique) e Autônomo.
 * 4. Fila de Rascunhos / Inbox de Respostas com aprovação humana e estados visuais.
 * 5. Atalhos de Respostas Rápidas (Canned Responses).
 * 6. Configurações de Personalidade da Odessa, Modelo e Regras do Governor.
 * 7. Bridge Standalone/CDP, Monitor de Visão e Diagnóstico com logs em tempo real.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  Bot,
  Check,
  CheckCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Edit3,
  ExternalLink,
  Eye,
  Gift,
  HelpCircle,
  History,
  Key,
  Layers,
  ListFilter,
  Loader2,
  Lock,
  MessageSquare,
  Pause,
  Play,
  Radio,
  RefreshCw,
  RotateCcw,
  Send,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  User,
  Tv,
  Wifi,
  WifiOff,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import { Badge, Button, Input } from './ui';
import { cn } from '../lib/utils';
import {
  generateTangoChatReply,
  generateTangoProactiveMessage,
  type TangoChatMessage,
} from '../core/tangoAiChatService';
import { getChatInsights } from '../core/chatLearning';
import { getAiConfig, saveAiConfig } from '../core/aiConfig';
import { routeChatToTriggers } from '../core/chatToTriggerBridge';
import {
  shouldReplyToMessage,
  recordChatReplySent,
  recordIncomingMessage,
} from '../core/chatConversationGovernor';
import { LiveVisionMonitor } from './LiveVisionMonitor';
import { SessionHistoryPanel } from './SessionHistoryPanel';
import { recordSessionEvent } from '../core/sessionHistory';
import { TangoChatFeed } from './TangoChatFeed';
import { UnifiedLivePanel, type VideoStateLite } from './UnifiedLivePanel';
import { AiConfigPanel } from './AiConfigPanel';
import { BridgeConnectionGuide } from './BridgeConnectionGuide';
import type { AutopilotRuntimeState } from '../core/useAutopilotRuntime';
import type { CapturedMessage } from '../types';

// ─── Config & Endpoints ──────────────────────────────────────────────
const BRIDGE_URL = '/tango-bridge';
const BRIDGE_API = '/api/v1/chat-automation/bridge';

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


type ChromeTab = {
  id: string;
  title: string;
  url: string;
  isTango: boolean;
  isBroadcast: boolean;
};

type ChromeStatus = {
  runningWithDebug: boolean;
  port: number;
  tabs: ChromeTab[];
  tangoTabFound: boolean;
};

type SubTab = 'wizard' | 'unified' | 'cockpit' | 'ai_config' | 'bridge_config' | 'vision' | 'diagnostics' | 'insights' | 'history';

const DEFAULT_CANNED_RESPONSES = [
  'Obrigada pelo carinho, amores! 💕',
  'Sejam todos bem-vindos à live! ✨',
  'Manda uma rosinha pra fortalecer a transmissão! 🌹',
  'Que bom ter vocês aqui comigo hoje! 🥰',
  'Live todo dia! Já segue o canal pra não perder! 🌟',
];

// ─── Helpers ─────────────────────────────────────────────────────────

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
      username: ".Hhi6n",
      textoMsg: ".KR99L",
      inputTexto: '[data-testid="textarea"]',
      botaoEnviar: '',
    },
  };
}

// ─── Main Component ──────────────────────────────────────────────────

export type TangoChatPanelProps = {
  /** Eventos capturados pelo runtime do Odessa (OCR, manual, etc.) — alimentam o Painel Unificado quando a bridge está offline. */
  capturedText?: CapturedMessage[];
  /** Runtime do autopilot do Odessa — controles de iniciar/pausar, decisão da IA, saúde. */
  runtime?: AutopilotRuntimeState;
  /** Estado atual do vídeo (vindo do backend) — exibido no palco do Painel Unificado. */
  videoState?: VideoStateLite | null;
  /** Callback para iniciar a live (configura OBS + automação + captura). */
  onStartLive?: () => void | Promise<void>;
};

export function TangoChatPanel({
  capturedText: odessaCapturedText,
  runtime: odessaRuntime,
  videoState: odessaVideoState,
  onStartLive: odessaStartLive,
}: TangoChatPanelProps = {}) {
  // ── Navegação & Modos ─────────────────────────────
  const [subTab, setSubTab] = useState<SubTab>('unified');
  const [autonomyMode, setAutonomyMode] = useState<AutonomyMode>('assistido');
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('real');

  // ── Bridge Status & Processo ──────────────────────
  const [processStatus, setProcessStatus] = useState<BridgeProcessStatus | null>(null);
  const [bridgeConfig, setBridgeConfig] = useState<BridgeConfig>(defaultConfig());
  const [configDirty, setConfigDirty] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [showAdvancedSelectors, setShowAdvancedSelectors] = useState(false);

  // ── Chat & Mensagens ──────────────────────────────
  const [messages, setMessages] = useState<TangoChatMessage[]>([]);
  const [replyQueue, setReplyQueue] = useState<TangoReplyItem[]>([]);
  const [draftText, setDraftText] = useState('');
  const [sending, setSending] = useState(false);
  const [generatingProactive, setGeneratingProactive] = useState(false);
  const [generatingForId, setGeneratingForId] = useState<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');

  // ── IA & Configurações da Odessa ──────────────────
  const [aiPrompt, setAiPrompt] = useState(() => getAiConfig().systemPrompt || '');
  const [cooldownSec, setCooldownSec] = useState(() => Math.round((getAiConfig().chatReplyCooldownMs || 15000) / 1000));
  const [maxPerMinute, setMaxPerMinute] = useState(() => getAiConfig().chatReplyMaxPerMinute || 4);
  const [lastSentAt, setLastSentAt] = useState<number>(0);
  const [cannedResponses, setCannedResponses] = useState<string[]>(DEFAULT_CANNED_RESPONSES);
  const [newCannedText, setNewCannedText] = useState('');

  // ── Logs e Diagnósticos ───────────────────────────
  const [logs, setLogs] = useState<string[]>([]);
  const [insights, setInsights] = useState(() => getChatInsights());
  // ── Chrome Live Helpers State ─────────────────────
  const [chromeStatus, setChromeStatus] = useState<ChromeStatus | null>(null);
  const [launchingChrome, setLaunchingChrome] = useState(false);
  const [creatingShortcut, setCreatingShortcut] = useState(false);
  const [shortcutFeedback, setShortcutFeedback] = useState<string | null>(null);
  // ── Wizard State ──────────────────────────────────
  const [wizardStep, setWizardStep] = useState<number>(1);
  const [wizardTargetKind, setWizardTargetKind] = useState<'anotepad' | 'tango'>('anotepad');
  const [wizardTestSending, setWizardTestSending] = useState(false);
  const [wizardTestResult, setWizardTestResult] = useState<string | null>(null);
  const [wizardAiSimulating, setWizardAiSimulating] = useState(false);



  const messagesEndRef = useRef<HTMLDivElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const sseRef = useRef<EventSource | null>(null);

  // ── Derived State ─────────────────────────────────
  const backendOnline = processStatus !== null;
  const processRunning = processStatus?.processRunning ?? false;
  const bridgeReachable = processStatus?.bridgeReachable ?? false;
  const bridgeConnected = processStatus?.bridgeStatus?.status === 'connected';
  const bridgeError = processStatus?.bridgeStatus?.error;

  // ── Mensagens unificadas: bridge + capturedText do Odessa ──
  // Quando a bridge está offline, messages (bridge) está vazia. Convertemos
  // capturedText (eventos do runtime: OCR, manual, etc.) para o formato
  // TangoChatMessage para que a IA tenha contexto ao gerar respostas.
  const unifiedMessages = useMemo<TangoChatMessage[]>(() => {
    if (messages.length > 0 || bridgeConnected) return messages;
    return (odessaCapturedText || [])
      .filter((m) => m.kind === 'chat' || m.kind === 'gift')
      .map((m) => ({
        username: (m.metadata?.username as string) || m.zoneName || 'Espectador',
        text: m.text,
        timestamp: m.createdAt,
      }));
  }, [messages, bridgeConnected, odessaCapturedText]);

  const combinedStatus = bridgeConnected
    ? 'connected'
    : connecting
      ? 'connecting'
      : bridgeReachable
        ? 'reachable'
        : processRunning
          ? 'starting'
          : 'stopped';

  // ── Polling de Status ─────────────────────────────
  const refreshStatus = useCallback(async () => {
    const data = await fetchJson<BridgeProcessStatus>(`${BRIDGE_API}/status`);
    setProcessStatus(data);
  }, []);

  useEffect(() => {
    void refreshStatus();
    const timer = window.setInterval(() => void refreshStatus(), 3500);
    return () => window.clearInterval(timer);
  }, [refreshStatus]);

  // ── Carregar Configurações ────────────────────────
  useEffect(() => {
    (async () => {
      const data = await fetchJson<BridgeConfig>(`${BRIDGE_API}/config`);
      if (data) setBridgeConfig({ ...defaultConfig(), ...data });
    })();
  }, []);

  // ── Histórico ao Conectar ─────────────────────────
  useEffect(() => {
    if (!bridgeConnected) return;
    (async () => {
      const data = await fetchJson<{ messages: TangoChatMessage[] }>(`${BRIDGE_URL}/history?limit=150`);
      if (data?.messages) setMessages(data.messages);
    })();
  }, [bridgeConnected]);

  // ── SSE Stream de Mensagens ───────────────────────
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
        const msg: TangoChatMessage = JSON.parse(ev.data);
        setMessages((prev) => [...prev.slice(-399), msg]);

        // Roteia a mensagem para o trigger engine do backend (palavra-chave/
        // presente -> vídeo do fluxo publicado), com dedupe e cooldown.
        void routeChatToTriggers(msg);

        // Se modo for Autônomo, dispara geração e envio automático
        if (autonomyMode === 'auto') {
          void handleAutoTriggerAi(msg);
        }
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
  }, [bridgeConnected, autonomyMode]);

  // ── Logs & Insights Polling ───────────────────────
  useEffect(() => {
    if (subTab === 'diagnostics' && processRunning) {
      const pollLogs = async () => {
        const data = await fetchJson<{ lines: string[] }>(`${BRIDGE_API}/logs?limit=150`);
        if (data?.lines) setLogs(data.lines);
      };
      void pollLogs();
      const timer = window.setInterval(() => void pollLogs(), 3000);
      return () => window.clearInterval(timer);
    }
    if (subTab === 'insights') {
      setInsights(getChatInsights());
    }
  }, [subTab, processRunning]);

  // ── Auto-scrolls ──────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  
  // ── Polling de Abas do Chrome ─────────────────────
  const refreshChromeStatus = useCallback(async () => {
    const data = await fetchJson<ChromeStatus>(`${BRIDGE_API}/chrome-tabs?port=9222`);
    setChromeStatus(data);
  }, []);

  useEffect(() => {
    void refreshChromeStatus();
    const timer = window.setInterval(() => void refreshChromeStatus(), 4000);
    return () => window.clearInterval(timer);
  }, [refreshChromeStatus]);

  const handleLaunchChrome = async () => {
    setLaunchingChrome(true);
    try {
      await fetchJson(`${BRIDGE_API}/launch-chrome`, {
        method: 'POST',
        body: JSON.stringify({ url: bridgeConfig.roomUrl || 'https://tango.me/stream/broadcast', port: 9222 }),
      });
      await new Promise((r) => setTimeout(r, 2000));
      await refreshChromeStatus();
    } finally {
      setLaunchingChrome(false);
    }
  };

  const handleCreateShortcut = async () => {
    setCreatingShortcut(true);
    setShortcutFeedback(null);
    try {
      const res = await fetchJson<{ ok: boolean; message?: string; error?: string }>(`${BRIDGE_API}/create-shortcut`, {
        method: 'POST',
        body: JSON.stringify({ url: bridgeConfig.roomUrl || 'https://tango.me/stream/broadcast', port: 9222 }),
      });
      if (res?.ok) {
        setShortcutFeedback('Atalho criado na sua Área de Trabalho com sucesso! ✨');
      } else {
        setShortcutFeedback(res?.error || 'Não foi possível criar o atalho.');
      }
    } finally {
      setCreatingShortcut(false);
      setTimeout(() => setShortcutFeedback(null), 5000);
    }
  };

  
  const handleSelectWizardPreset = async (kind: 'anotepad' | 'tango') => {
    setWizardTargetKind(kind);
    let newConf: BridgeConfig;
    if (kind === 'anotepad') {
      newConf = {
        ...bridgeConfig,
        roomUrl: 'https://pt.anotepad.com/',
        selectors: {
          containerChat: '#edit_textarea',
          mensagem: '#edit_textarea',
          username: '',
          textoMsg: '',
          inputTexto: '#edit_textarea',
          botaoEnviar: '#btnSaveNote',
        },
      };
    } else {
      newConf = {
        ...bridgeConfig,
        roomUrl: 'https://tango.me/stream/broadcast',
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
    setBridgeConfig(newConf);
    // Salva imediatamente no backend para que a bridge use as configurações certas
    await fetchJson(`${BRIDGE_API}/config`, {
      method: 'POST',
      body: JSON.stringify(newConf),
    });
    setConfigDirty(false);
  };

  const [autoConfiguring, setAutoConfiguring] = useState(false);
  const [autoConfigStepName, setAutoConfigStepName] = useState<string>('');

  const handleRunFullAutoSetup = async () => {
    setAutoConfiguring(true);
    setWizardTestResult(null);
    try {
      // 1. Salva Config
      setAutoConfigStepName('1/4: Salvando configuração do alvo...');
      await handleSelectWizardPreset(wizardTargetKind);
      await new Promise((r) => setTimeout(r, 600));

      // 2. Abre Chrome se necessário
      setAutoConfigStepName('2/4: Verificando / Abrindo navegador...');
      if (!chromeStatus?.runningWithDebug) {
        await handleLaunchChrome();
        await new Promise((r) => setTimeout(r, 2000));
        await refreshChromeStatus();
      }

      // 3. Inicia Bridge e Conecta
      setAutoConfigStepName('3/4: Iniciando Bridge e acoplando à aba...');
      if (!processRunning) {
        await handleStartProcess();
        await new Promise((r) => setTimeout(r, 1800));
      }
      await handleConnectBridge();
      await new Promise((r) => setTimeout(r, 1500));
      await refreshStatus();

      // ── Verificação HONESTA: a bridge realmente conectou? ──
      // Antes este passo reportava "100% validado" mesmo com a bridge offline,
      // porque a IA gera respostas sem precisar da bridge. Agora só prossegue
      // se a conexão foi confirmada de verdade.
      const actuallyConnected =
        processStatus?.bridgeStatus?.status === 'connected' && processStatus?.bridgeStatus?.observerInjected;

      if (!actuallyConnected) {
        const bridgeErr = processStatus?.bridgeStatus?.error || 'conexão não estabelecida';
        setWizardStep(3); // volta para o passo 3 para o usuário tentar de novo
        setWizardTestResult(
          '⚠️ A bridge NÃO conectou à aba do navegador.\n' +
          `Erro: ${bridgeErr}\n\n` +
          'Verifique se:\n' +
          '• O Chrome foi aberto com a porta de depuração 9222\n' +
          '• A aba da transmissão está aberta e visível\n' +
          '• Nenhuma outra instância do Chrome está usando a porta\n\n' +
          'Dica: use o atalho no Desktop para abrir o Chrome corretamente.',
        );
        return; // NÃO reporta falso positivo — para aqui
      }

      // 4. Teste de Validação — só roda se a bridge conectou de verdade
      setAutoConfigStepName('4/4: Executando teste de resposta da IA...');
      const sampleMsg: TangoChatMessage = {
        username: 'Odessa_Tester',
        text: 'Olá! Sistema de monitoramento do chat configurado com sucesso.',
        timestamp: new Date().toISOString(),
      };
      const aiRes = await generateTangoChatReply(sampleMsg, unifiedMessages, aiPrompt);

      if (aiRes.ok && aiRes.reply) {
        // Tenta enviar a resposta pela bridge (só funciona se conectado de verdade)
        const sent = await executeSendMessage(aiRes.reply);
        if (sent) {
          setWizardTestResult(
            `🎉 Configuração 100% Concluída e Validada!\n` +
            `A bridge se conectou à página e o robô digitou:\n"${aiRes.reply}"`,
          );
        } else {
          // Bridge conectou mas o envio falhou — reporta honestamente
          setWizardTestResult(
            '✅ Bridge conectada à aba!\n' +
            '⚠️ O envio da mensagem de teste falhou, mas a conexão está ativa.\n' +
            `A IA gerou: "${aiRes.reply}"\n\n` +
            'Você pode testar o envio manualmente no passo 4.',
          );
        }
      } else {
        // Bridge conectou mas a IA não gerou resposta — ainda é sucesso parcial
        setWizardTestResult(
          '✅ Bridge conectada com sucesso à página!\n' +
          '⚠️ A IA não gerou uma resposta de teste (verifique a chave da API na aba "Personalidade da IA").\n\n' +
          'A conexão está ativa — você já pode usar o Painel Unificado.',
        );
      }

      setWizardStep(4);

      // ── Navega para o Painel Unificado ao concluir ──
      // O usuário pediu: ao final da configuração automática, cair direto
      // no painel interativo (live + chat lado a lado).
      setSubTab('unified');
    } catch (err) {
      setWizardTestResult('❌ Erro durante configuração automática: ' + String(err));
    } finally {
      setAutoConfiguring(false);
      setAutoConfigStepName('');
    }
  };

  const handleRunWizardTestSend = async (sampleText: string) => {
    setWizardTestSending(true);
    setWizardTestResult(null);
    try {
      const ok = await executeSendMessage(sampleText);
      if (ok) {
        setWizardTestResult(`✅ Mensagem digitada com sucesso no navegador: "${sampleText}"`);
      } else {
        setWizardTestResult('❌ Não foi possível enviar. Verifique se o Chrome está aberto e conectado.');
      }
    } finally {
      setWizardTestSending(false);
    }
  };

  const handleRunWizardAiSimulation = async () => {
    setWizardAiSimulating(true);
    setWizardTestResult(null);
    try {
      const sampleMsg: TangoChatMessage = {
        username: 'Lucas_Tester',
        text: 'Oi Odessa, a live está incrível! Você consegue ler minha mensagem?',
        timestamp: new Date().toISOString(),
      };
      const result = await generateTangoChatReply(sampleMsg, unifiedMessages, aiPrompt);
      if (result.ok && result.reply) {
        const sent = await executeSendMessage(result.reply);
        if (sent) {
          setWizardTestResult(`🎉 Sucesso! A IA gerou a resposta e o robô digitou no alvo:\n"${result.reply}"`);
        } else {
          setWizardTestResult(
            `⚠️ IA gerou a resposta: "${result.reply}", mas o envio falhou.\n` +
            'Verifique se a bridge está conectada à aba.',
          );
        }
      } else {
        setWizardTestResult('❌ Erro na geração da IA: ' + (result.blockedReason || result.reason));
      }
    } finally {
      setWizardAiSimulating(false);
    }
  };

  // ── Ações do Processo e Conexão ───────────────────
  const handleStartProcess = async () => {
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
  };

  const handleStopProcess = async () => {
    await fetchJson(`${BRIDGE_API}/stop`, { method: 'POST' });
    setMessages([]);
    setReplyQueue([]);
    await refreshStatus();
  };

  const handleConnectBridge = async () => {
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
  };

  const handleDisconnectBridge = async () => {
    await fetchJson(`${BRIDGE_URL}/disconnect`, { method: 'POST' });
    setMessages([]);
    await refreshStatus();
  };

  // ── Envio no Tango ────────────────────────────────
  const executeSendMessage = async (text: string): Promise<boolean> => {
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
  };

  // ── Geração de Resposta por IA ─────────────────────
  const handleGenerateReplyForMessage = async (msg: TangoChatMessage) => {
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
  };

  const handleAutoTriggerAi = async (msg: TangoChatMessage) => {
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
          : item
      )
    );
  };

  const handleApproveReply = async (item: TangoReplyItem) => {
    setReplyQueue((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, status: 'sending' } : i))
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
          : i
      )
    );
  };

  const handleDiscardReply = (id: string) => {
    setReplyQueue((prev) => prev.filter((i) => i.id !== id));
  };

  const handleRegenerateReply = async (item: TangoReplyItem) => {
    setReplyQueue((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, status: 'draft', text: 'Regenerando com IA...' } : i))
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
          : i
      )
    );
  };

  const handleGenerateProactive = async () => {
    setGeneratingProactive(true);
    try {
      const result = await generateTangoProactiveMessage(undefined, unifiedMessages);
      setDraftText(result.reply);
    } finally {
      setGeneratingProactive(false);
    }
  };

  const handleSendManual = async () => {
    const text = draftText.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const ok = await executeSendMessage(text);
      if (ok) {
        setDraftText('');
        recordSessionEvent('message.sent', { text, source: 'manual' });
      }
    } finally {
      setSending(false);
    }
  };

  const handleSaveAiConfig = () => {
    saveAiConfig({
      systemPrompt: aiPrompt,
      chatReplyCooldownMs: Math.max(3, cooldownSec) * 1000,
      chatReplyMaxPerMinute: maxPerMinute,
    });
  };

  const handleSaveBridgeConfig = async () => {
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
  };

  const handleAddCannedResponse = () => {
    const text = newCannedText.trim();
    if (!text) return;
    setCannedResponses((prev) => [...prev, text]);
    setNewCannedText('');
  };

  const handleRemoveCanned = (index: number) => {
    setCannedResponses((prev) => prev.filter((_, i) => i !== index));
  };

  // Cooldown timer calculation
  const cooldownRemaining = Math.max(
    0,
    Math.ceil(cooldownSec - (Date.now() - lastSentAt) / 1000)
  );

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* ── 1. Barra de Controle Superior (Cockpit Bar) ─────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#090a0d] p-4 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/20 via-fuchsia-500/20 to-sky-500/20 text-violet-300 border border-violet-500/20">
            <Radio className="h-5 w-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-white tracking-wide">Tango Chat Live Cockpit</h2>
              <span
                className={cn(
                  'flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full border',
                  bridgeConnected
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                    : processRunning
                      ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                      : 'border-white/10 bg-black/40 text-slate-500'
                )}
              >
                <span className={cn('h-1.5 w-1.5 rounded-full', bridgeConnected ? 'bg-emerald-400 animate-ping' : 'bg-slate-500')} />
                {bridgeConnected ? 'Conectado · Ao Vivo' : processRunning ? 'Bridge Pronta' : 'Desconectado'}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {bridgeConnected
                ? `${processStatus?.bridgeStatus?.messageCount ?? 0} msgs capturadas · Modo ${processStatus?.bridgeStatus?.mode || 'Standalone'}`
                : 'Inicie a bridge para monitorar o chat e responder com IA'}
            </p>
          </div>
        </div>

        {/* Controles de Autonomia e Envio */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Seletor de Autonomia da IA */}
          <div className="flex items-center rounded-xl border border-white/10 bg-black/40 p-1">
            {[
              { id: 'off' as AutonomyMode, label: 'IA Off', icon: <X className="h-3 w-3" /> },
              { id: 'assistido' as AutonomyMode, label: 'Assistido', icon: <Sparkles className="h-3 w-3 text-violet-400" /> },
              { id: 'auto' as AutonomyMode, label: 'Autônomo', icon: <Bot className="h-3 w-3 text-emerald-400" /> },
            ].map((m) => (
              <button
                key={m.id}
                className={cn(
                  'flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition',
                  autonomyMode === m.id
                    ? 'bg-white/15 text-white shadow'
                    : 'text-slate-500 hover:text-slate-300'
                )}
                onClick={() => setAutonomyMode(m.id)}
              >
                {m.icon}
                {m.label}
              </button>
            ))}
          </div>

          {/* Toggle Dry-Run vs Real */}
          <button
            className={cn(
              'flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition',
              executionMode === 'real'
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
            )}
            onClick={() => setExecutionMode((prev) => (prev === 'real' ? 'dry_run' : 'real'))}
            title={executionMode === 'real' ? 'Envio real ativo no Tango' : 'Modo simulação (não digita no Tango)'}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            {executionMode === 'real' ? 'Envio Real' : 'Dry-Run (Teste)'}
          </button>

          {/* Botões de Ação do Processo */}
          {!processRunning ? (
            <Button size="sm" variant="primary" disabled={!backendOnline || starting} onClick={() => void handleStartProcess()}>
              {starting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              Iniciar Bridge
            </Button>
          ) : (
            <>
              {!bridgeConnected ? (
                <Button size="sm" variant="primary" disabled={!bridgeReachable || connecting} onClick={() => void handleConnectBridge()}>
                  {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wifi className="h-3.5 w-3.5" />}
                  Conectar
                </Button>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => void handleDisconnectBridge()}>
                  <WifiOff className="h-3.5 w-3.5" />
                  Desconectar
                </Button>
              )}
              <Button size="sm" variant="danger" onClick={() => void handleStopProcess()}>
                <Square className="h-3.5 w-3.5" />
                Parar
              </Button>
            </>
          )}

          <Button size="sm" variant="secondary" onClick={() => void refreshStatus()} title="Atualizar status">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* ── Sub-navegação em Abas ───────────────────────────────────── */}
      <div className="flex gap-1 overflow-x-auto rounded-xl border border-white/8 bg-black/40 p-1">
        {[
          { id: 'wizard' as SubTab, label: '🧙‍♂️ Assistente Passo a Passo', icon: <Sparkles className="h-3.5 w-3.5 text-amber-400" /> },
          { id: 'unified' as SubTab, label: 'Painel Unificado', icon: <Tv className="h-3.5 w-3.5 text-emerald-400" /> },
          { id: 'cockpit' as SubTab, label: 'Live Chat & Respostas IA', icon: <MessageSquare className="h-3.5 w-3.5" /> },
          { id: 'ai_config' as SubTab, label: 'Personalidade da IA', icon: <Bot className="h-3.5 w-3.5" /> },
          { id: 'bridge_config' as SubTab, label: 'Configuração Bridge', icon: <Settings className="h-3.5 w-3.5" /> },
          { id: 'vision' as SubTab, label: 'Monitor de Visão', icon: <Eye className="h-3.5 w-3.5" /> },
          { id: 'insights' as SubTab, label: 'Aprendizado do Chat', icon: <Sparkles className="h-3.5 w-3.5" /> },
          { id: 'history' as SubTab, label: 'Histórico da Live', icon: <History className="h-3.5 w-3.5" /> },
          { id: 'diagnostics' as SubTab, label: 'Diagnóstico & Logs', icon: <Terminal className="h-3.5 w-3.5" /> },
        ].map((t) => (
          <button
            key={t.id}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition',
              subTab === t.id ? 'bg-white/15 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'
            )}
            onClick={() => setSubTab(t.id)}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>
      {/* ── ABA WIZARD: ASSISTENTE PASSO A PASSO ────────────────────── */}
      {subTab === 'wizard' && (
        <div className="space-y-4 rounded-2xl border border-white/10 bg-[#0c0e12] p-5 shadow-xl">
          {/* Header do Assistente */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 pb-4">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-amber-400" />
                Assistente de Configuração Guiada
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Configure e valide o monitoramento do chat e as respostas automáticas da IA etapa por etapa de forma 100% visual.
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              {[1, 2, 3, 4].map((step) => (
                <button
                  key={step}
                  className={cn(
                    'h-7 px-3 rounded-lg text-xs font-bold transition flex items-center gap-1.5',
                    wizardStep === step
                      ? 'bg-violet-600 text-white shadow-md'
                      : wizardStep > step
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        : 'bg-white/5 text-slate-500 hover:text-slate-300'
                  )}
                  onClick={() => setWizardStep(step)}
                >
                  {wizardStep > step ? <Check className="h-3 w-3" /> : step}
                  <span>
                    {step === 1 && '1. Ambiente'}
                    {step === 2 && '2. Navegador'}
                    {step === 3 && '3. Acoplamento'}
                    {step === 4 && '4. Teste da IA'}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* ── CARD DE AUTO-CONFIGURAÇÃO EM 1 CLIQUE ── */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-violet-950/40 via-purple-900/20 to-black p-4 rounded-xl border border-violet-500/30">
            <div>
              <h4 className="text-sm font-bold text-white flex items-center gap-2">
                <Zap className="h-4 w-4 text-amber-400" />
                Configuração Automática em 1 Clique
              </h4>
              <p className="text-xs text-slate-300 mt-0.5">
                Deseja que a Odessa abra o navegador, inicie a bridge e valide a IA automaticamente agora?
              </p>
            </div>
            <Button
              size="sm"
              variant="primary"
              className="bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white font-bold shadow-lg"
              disabled={autoConfiguring}
              onClick={() => void handleRunFullAutoSetup()}
            >
              {autoConfiguring ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                  {autoConfigStepName || 'Configurando...'}
                </>
              ) : (
                <>
                  <Zap className="h-4 w-4 mr-1.5 text-amber-300" />
                  Executar Configuração Automática Completa
                </>
              )}
            </Button>
          </div>

          {/* ── ETAPA 1: ESCOLHA DO AMBIENTE ── */}
          {wizardStep === 1 && (
            <div className="space-y-4 py-2">
              <div>
                <h4 className="text-sm font-bold text-white mb-1">Passo 1: Onde você deseja monitorar o chat?</h4>
                <p className="text-xs text-slate-400">
                  Você pode usar o Bloco de Notas Online para testar imediatamente com zero risco, ou conectar direto na sua transmissão do Tango.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {/* Opção A: Anotepad */}
                <div
                  className={cn(
                    'cursor-pointer rounded-2xl border p-4 transition',
                    wizardTargetKind === 'anotepad'
                      ? 'border-violet-500/60 bg-violet-500/10 ring-1 ring-violet-500/30'
                      : 'border-white/8 bg-black/30 hover:border-white/20'
                  )}
                  onClick={() => void handleSelectWizardPreset('anotepad')}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      📝 Modo Bloco de Notas (Teste Rápido)
                    </span>
                    <Badge variant={wizardTargetKind === 'anotepad' ? 'lavender' : 'default'} className="text-[10px]">
                      Recomendado para Teste
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Abre o <strong>pt.anotepad.com</strong>. Permite ver o robô digitando e testar as respostas da IA imediatamente, sem precisar abrir live ou fazer login.
                  </p>
                  <div className="mt-3 text-[11px] font-mono text-slate-500 truncate">
                    URL: https://pt.anotepad.com/
                  </div>
                </div>

                {/* Opção B: Tango Live Real */}
                <div
                  className={cn(
                    'cursor-pointer rounded-2xl border p-4 transition',
                    wizardTargetKind === 'tango'
                      ? 'border-violet-500/60 bg-violet-500/10 ring-1 ring-violet-500/30'
                      : 'border-white/8 bg-black/30 hover:border-white/20'
                  )}
                  onClick={() => void handleSelectWizardPreset('tango')}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      🎙️ Modo Tango Live Real
                    </span>
                    <Badge variant={wizardTargetKind === 'tango' ? 'success' : 'default'} className="text-[10px]">
                      Produção
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Conecta à sua aba de transmissão ao vivo no <strong>Tango.me</strong>. A IA lê os comentários de espectadores reais e responde no chat da stream.
                  </p>
                  <div className="mt-3 text-[11px] font-mono text-slate-500 truncate">
                    URL: https://tango.me/stream/broadcast
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-3 border-t border-white/8">
                <Button size="sm" variant="primary" onClick={() => setWizardStep(2)}>
                  Próximo: Abrir Navegador ➔
                </Button>
              </div>
            </div>
          )}

          {/* ── ETAPA 2: ABERTURA DO NAVEGADOR ── */}
          {wizardStep === 2 && (
            <div className="space-y-4 py-2">
              <div>
                <h4 className="text-sm font-bold text-white mb-1">Passo 2: Abrir a página no Navegador com Depuração</h4>
                <p className="text-xs text-slate-400">
                  Clique no botão abaixo para abrir o Chrome na página escolhida (<strong>{bridgeConfig.roomUrl}</strong>).
                </p>
              </div>

              {/* Status do Chrome */}
              <div className="rounded-xl border border-white/10 bg-black/40 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-300">Status do Google Chrome:</span>
                  {chromeStatus?.runningWithDebug ? (
                    <Badge variant="success" className="text-xs">
                      <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Chrome Aberto com Debug Ativo!
                    </Badge>
                  ) : (
                    <Badge variant="warning" className="text-xs">
                      <AlertCircle className="mr-1 h-3.5 w-3.5" /> Chrome Não Detectado na Porta 9222
                    </Badge>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="primary"
                    className="bg-violet-600 hover:bg-violet-500 text-white font-semibold"
                    disabled={launchingChrome}
                    onClick={() => void handleLaunchChrome()}
                  >
                    {launchingChrome ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <ExternalLink className="h-4 w-4 mr-1.5" />}
                    🚀 1. Abrir Página no Chrome
                  </Button>

                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={creatingShortcut}
                    onClick={() => void handleCreateShortcut()}
                  >
                    {creatingShortcut ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Copy className="h-4 w-4 mr-1.5" />}
                    Criar Atalho no Desktop
                  </Button>

                  <Button size="sm" variant="secondary" onClick={() => void refreshChromeStatus()}>
                    <RefreshCw className="h-3.5 w-3.5 mr-1" /> Verificar Novamente
                  </Button>
                </div>

                {shortcutFeedback && (
                  <p className="text-xs text-emerald-300 bg-emerald-500/10 p-2 rounded border border-emerald-500/20">
                    {shortcutFeedback}
                  </p>
                )}

                {/* Abas Detectadas */}
                {chromeStatus?.tabs && chromeStatus.tabs.length > 0 && (
                  <div className="pt-2">
                    <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">
                      Abas Abertas Encontradas ({chromeStatus.tabs.length}):
                    </p>
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {chromeStatus.tabs.map((tab) => (
                        <div key={tab.id} className="flex justify-between items-center bg-white/[0.03] p-1.5 px-2.5 rounded text-xs">
                          <span className="truncate font-medium text-slate-200">{tab.title}</span>
                          <span className="text-[10px] text-slate-500 truncate max-w-xs">{tab.url}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-between pt-3 border-t border-white/8">
                <Button size="sm" variant="secondary" onClick={() => setWizardStep(1)}>
                  ⬅ Voltar
                </Button>
                <Button size="sm" variant="primary" onClick={() => setWizardStep(3)}>
                  Próximo: Conectar Bridge ➔
                </Button>
              </div>
            </div>
          )}

          {/* ── ETAPA 3: ACOPLAMENTO DA BRIDGE ── */}
          {wizardStep === 3 && (
            <div className="space-y-4 py-2">
              <div>
                <h4 className="text-sm font-bold text-white mb-1">Passo 3: Conectar a Bridge de Monitoramento</h4>
                <p className="text-xs text-slate-400">
                  Inicie o serviço da bridge para injetar o leitor e transmissor na aba do navegador aberta.
                </p>
              </div>

              {/* Checklist de Serviços */}
              <div className="rounded-xl border border-white/10 bg-black/40 p-4 space-y-2.5">
                <div className="flex items-center justify-between text-xs p-2 rounded bg-white/[0.02]">
                  <span>1. Servidor Backend Odessa (Porta 8000)</span>
                  <span className="font-bold text-emerald-400 flex items-center gap-1">
                    <CheckCircle className="h-3.5 w-3.5" /> Online
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs p-2 rounded bg-white/[0.02]">
                  <span>2. Processo da Bridge Python</span>
                  <span className={cn('font-bold flex items-center gap-1', processRunning ? 'text-emerald-400' : 'text-slate-500')}>
                    {processRunning ? <CheckCircle className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                    {processRunning ? `Ativo (PID ${processStatus?.pid})` : 'Parado'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs p-2 rounded bg-white/[0.02]">
                  <span>3. Acoplamento à Aba do Navegador</span>
                  <span className={cn('font-bold flex items-center gap-1', bridgeConnected ? 'text-emerald-400' : 'text-amber-400')}>
                    {bridgeConnected ? <CheckCircle className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
                    {bridgeConnected ? 'Conectado (Leitor Ativo)' : 'Pendente'}
                  </span>
                </div>
              </div>

              {/* Botões de Ação */}
              <div className="flex gap-2">
                {!processRunning ? (
                  <Button
                    size="sm"
                    variant="primary"
                    className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
                    disabled={starting}
                    onClick={() => void handleStartProcess()}
                  >
                    {starting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Play className="h-3.5 w-3.5 mr-1" />}
                    Iniciar Bridge Agora
                  </Button>
                ) : !bridgeConnected ? (
                  <Button
                    size="sm"
                    variant="primary"
                    className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
                    disabled={connecting}
                    onClick={() => void handleConnectBridge()}
                  >
                    {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1" />}
                    Acoplar à Aba Aberta
                  </Button>
                ) : (
                  <div className="text-xs text-emerald-400 font-bold flex items-center gap-1.5 bg-emerald-500/10 p-2.5 rounded-xl border border-emerald-500/30 flex-1">
                    <CheckCircle2 className="h-4 w-4" /> Bridge Conectada com Sucesso à Página!
                  </div>
                )}
              </div>

              {/* Guia de diagnóstico quando a bridge não conecta */}
              {!bridgeConnected && (
                <BridgeConnectionGuide
                  chromeRunning={!!chromeStatus?.runningWithDebug}
                  processRunning={processRunning}
                  bridgeConnected={bridgeConnected}
                  bridgeReachable={bridgeReachable}
                  onGoUnified={() => setSubTab('unified')}
                  onStartBridge={() => void (processRunning ? handleConnectBridge() : handleStartProcess())}
                  onLaunchChrome={() => void handleLaunchChrome()}
                  starting={starting}
                  launching={launchingChrome}
                />
              )}

              <div className="flex justify-between pt-3 border-t border-white/8">
                <Button size="sm" variant="secondary" onClick={() => setWizardStep(2)}>
                  ⬅ Voltar
                </Button>
                <Button size="sm" variant="primary" onClick={() => setWizardStep(4)}>
                  Próximo: Testar Envio & IA ➔
                </Button>
              </div>
            </div>
          )}

          {/* ── ETAPA 4: TESTE DE RESPOSTA DA IA ── */}
          {wizardStep === 4 && (
            <div className="space-y-4 py-2">
              <div>
                <h4 className="text-sm font-bold text-white mb-1">Passo 4: Teste ao Vivo de Digitação e Resposta da IA</h4>
                <p className="text-xs text-slate-400">
                  Execute os testes abaixo para ver a Odessa digitando na página do navegador em tempo real!
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {/* Teste 1: Digitação Direta */}
                <div className="rounded-xl border border-white/10 bg-black/40 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Send className="h-4 w-4 text-sky-400" />
                    <span className="text-xs font-bold text-white">Teste 1: Digitação do Robô</span>
                  </div>
                  <p className="text-xs text-slate-400">
                    Envia uma frase teste fixa para confirmar que o robô consegue digitar no campo da página.
                  </p>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="w-full"
                    disabled={wizardTestSending}
                    onClick={() => void handleRunWizardTestSend('Teste de automação Odessa funcionando perfeitamente! ✨')}
                  >
                    {wizardTestSending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Send className="h-3.5 w-3.5 mr-1" />}
                    Testar Digitação no Alvo
                  </Button>
                </div>

                {/* Teste 2: Resposta Automática da IA */}
                <div className="rounded-xl border border-white/10 bg-black/40 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Bot className="h-4 w-4 text-violet-400" />
                    <span className="text-xs font-bold text-white">Teste 2: Geração & Envio da IA</span>
                  </div>
                  <p className="text-xs text-slate-400">
                    Simula um espectador perguntando algo e faz a IA gerar e digitar a resposta automaticamente.
                  </p>
                  <Button
                    size="sm"
                    variant="primary"
                    className="w-full bg-violet-600 hover:bg-violet-500 text-white font-semibold"
                    disabled={wizardAiSimulating}
                    onClick={() => void handleRunWizardAiSimulation()}
                  >
                    {wizardAiSimulating ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
                    Simular e Responder com IA
                  </Button>
                </div>
              </div>

              {/* Resultado do Teste */}
              {wizardTestResult && (
                <div className="rounded-xl border border-violet-500/30 bg-violet-500/10 p-3 text-xs text-slate-200 whitespace-pre-line leading-relaxed">
                  {wizardTestResult}
                </div>
              )}

              <div className="flex justify-between pt-3 border-t border-white/8">
                <Button size="sm" variant="secondary" onClick={() => setWizardStep(3)}>
                  ⬅ Voltar
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold"
                  onClick={() => setSubTab('unified')}
                >
                  🎉 Concluir e Ir para o Painel Unificado
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── ABA: PAINEL UNIFICADO (Live + Chat lado a lado) ─────────── */}
      {subTab === 'unified' && (
        <div className="space-y-4">
          {bridgeConnected ? (
            <>
              {/* Modo bridge conectada: CDP screencast interativo + chat */}
              <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-2">
                <Tv className="h-4 w-4 shrink-0 text-emerald-400" />
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  <strong className="text-emerald-300">Painel Unificado:</strong> a transmissão ao vivo (esquerda) e o chat (direita) compartilham a
                  <strong> mesma aba/sessão da live</strong>. Clique e digite direto na tela; as mensagens capturadas aparecem no chat em tempo real.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
                <div className="xl:col-span-3">
                  <LiveVisionMonitor connected={bridgeConnected} />
                </div>
                <div className="xl:col-span-2">
                  <TangoChatFeed
                    messages={messages}
                    bridgeConnected={bridgeConnected}
                    cooldownRemaining={cooldownRemaining}
                    generatingForId={generatingForId}
                    onGenerateReply={(msg) => void handleGenerateReplyForMessage(msg)}
                    cannedResponses={cannedResponses}
                    onPickCanned={setDraftText}
                    generatingProactive={generatingProactive}
                    onGenerateProactive={() => void handleGenerateProactive()}
                    draftText={draftText}
                    onDraftChange={setDraftText}
                    onSend={() => void handleSendManual()}
                    sending={sending}
                    messagesEndRef={messagesEndRef}
                    replyQueueCount={replyQueue.length}
                    onViewReplies={() => setSubTab('cockpit')}
                    heightClass="h-full min-h-[520px]"
                  />
                </div>
              </div>

              {/* ── Configuração da IA ── */}
              <AiConfigPanel />
            </>
          ) : (
            <>
              {/* Modo offline (sem bridge): painel interativo via runtime do Odessa */}
              {odessaRuntime ? (
                <UnifiedLivePanel
                  capturedText={odessaCapturedText || []}
                  runtime={odessaRuntime}
                  videoState={odessaVideoState || null}
                  onStartLive={odessaStartLive}
                  bridgeConnected={bridgeConnected}
                  messages={messages}
                  replyQueue={replyQueue}
                  autonomyMode={autonomyMode}
                  executionMode={executionMode}
                  onSetAutonomy={setAutonomyMode}
                  onSetExecution={setExecutionMode}
                  generatingForId={generatingForId}
                  cooldownRemaining={cooldownRemaining}
                  cannedResponses={cannedResponses}
                  generatingProactive={generatingProactive}
                  draftText={draftText}
                  sending={sending}
                  onGenerateReply={(msg) => void handleGenerateReplyForMessage(msg)}
                  onPickCanned={setDraftText}
                  onGenerateProactive={() => void handleGenerateProactive()}
                  onDraftChange={setDraftText}
                  onSend={() => void handleSendManual()}
                  onApproveReply={(item) => void handleApproveReply(item)}
                  onDiscardReply={handleDiscardReply}
                  onViewReplies={() => setSubTab('cockpit')}
                  messagesEndRef={messagesEndRef}
                />
              ) : (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-white/10 bg-[#0c0e12] p-12 text-center">
                  <Tv className="h-12 w-12 text-slate-700 mb-4" />
                  <p className="text-sm font-semibold text-slate-400">Painel Unificado indisponível</p>
                  <p className="text-xs text-slate-600 mt-1 max-w-md">
                    O runtime do Odessa não está conectado a este painel. Navegue pela aba "Início" no menu lateral
                    para usar o painel principal, ou conecte a bridge na aba "Cockpit".
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── ABA 1: COCKPIT DE CHAT & IA ─────────────────────────────── */}
      {subTab === 'cockpit' && (
        <div className="space-y-4">
          {/* ── Card Inteligente de Conexão com a Transmissão do Tango ── */}
          <div className="rounded-2xl border border-violet-500/20 bg-gradient-to-r from-violet-950/20 via-[#0d0f14] to-fuchsia-950/20 p-4 shadow-lg">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-300 border border-violet-500/30">
                  <Radio className="h-5 w-5 text-violet-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-bold uppercase tracking-widest text-white">
                      Conexão Direta com a Aba de Transmissão
                    </h3>
                    {bridgeConnected ? (
                      <Badge variant="success" className="text-[10px]">
                        <CheckCircle2 className="mr-1 h-3 w-3" /> Acoplado à Live
                      </Badge>
                    ) : chromeStatus?.runningWithDebug ? (
                      <Badge variant="lavender" className="text-[10px]">
                        <Check className="mr-1 h-3 w-3" /> Chrome com Debug Detectado
                      </Badge>
                    ) : (
                      <Badge variant="warning" className="text-[10px]">
                        <AlertCircle className="mr-1 h-3 w-3" /> Chrome Normal (Sem Debug)
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-slate-300 mt-1 max-w-2xl leading-relaxed">
                    Como a live já utiliza a câmera e o login no Tango, a Odessa se acopla <strong>diretamente à sua mesma aba de transmissão</strong> aberta, sem abrir janelas extras nem derrubar a live.
                  </p>
                </div>
              </div>

              {/* Botões de Ação Rápida */}
              <div className="flex flex-wrap items-center gap-2">
                {!bridgeConnected && (
                  <>
                    <Button
                      size="sm"
                      variant="primary"
                      className="bg-violet-600 hover:bg-violet-500 text-white font-semibold shadow-md"
                      disabled={launchingChrome}
                      onClick={() => void handleLaunchChrome()}
                      title="Abre o Chrome oficial da transmissão com depuração ativa"
                    >
                      {launchingChrome ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <ExternalLink className="h-3.5 w-3.5 mr-1" />}
                      1. Abrir Chrome da Live
                    </Button>

                    <Button
                      size="sm"
                      variant="secondary"
                      className="border-white/15 bg-white/5 hover:bg-white/10 text-slate-200"
                      disabled={creatingShortcut}
                      onClick={() => void handleCreateShortcut()}
                      title="Cria um atalho no seu Desktop para abrir o Chrome da Live sempre que quiser"
                    >
                      {creatingShortcut ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
                      Criar Atalho no Desktop
                    </Button>

                    {!processRunning ? (
                      <Button
                        size="sm"
                        variant="primary"
                        className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
                        disabled={starting}
                        onClick={() => void handleStartProcess()}
                      >
                        {starting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Play className="h-3.5 w-3.5 mr-1" />}
                        2. Iniciar Bridge
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="primary"
                        className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
                        disabled={connecting}
                        onClick={() => void handleConnectBridge()}
                      >
                        {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1" />}
                        2. Acoplar à Transmissão
                      </Button>
                    )}
                  </>
                )}

                {bridgeConnected && (
                  <Button size="sm" variant="danger" onClick={() => void handleDisconnectBridge()}>
                    <WifiOff className="h-3.5 w-3.5 mr-1" />
                    Desconectar da Aba
                  </Button>
                )}
              </div>
            </div>

            {/* Feedback de Atalho criado */}
            {shortcutFeedback && (
              <div className="mt-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-300 flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4" />
                {shortcutFeedback}
              </div>
            )}

            {/* Abas detectadas do Chrome */}
            {chromeStatus?.runningWithDebug && chromeStatus.tabs.length > 0 && !bridgeConnected && (
              <div className="mt-3 pt-3 border-t border-white/10">
                <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400 block mb-2">
                  Abas Abertas Detectadas no Chrome ({chromeStatus.tabs.length}):
                </span>
                <div className="grid gap-2 sm:grid-cols-2">
                  {chromeStatus.tabs.map((tab) => (
                    <div
                      key={tab.id}
                      className={cn(
                        'flex items-center justify-between gap-2 p-2 rounded-xl border text-xs transition',
                        tab.isTango
                          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                          : 'border-white/5 bg-black/30 text-slate-400'
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold truncate">{tab.title || '(Sem título)'}</p>
                        <p className="text-[10px] text-slate-500 truncate">{tab.url}</p>
                      </div>
                      {tab.isTango && (
                        <span className="shrink-0 text-[10px] font-bold uppercase tracking-widest text-emerald-400 bg-emerald-500/20 px-2 py-0.5 rounded">
                          Live Tango
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Guia de diagnóstico e resolução da bridge ── */}
          {!bridgeConnected && (
            <BridgeConnectionGuide
              chromeRunning={!!chromeStatus?.runningWithDebug}
              processRunning={processRunning}
              bridgeConnected={bridgeConnected}
              bridgeReachable={bridgeReachable}
              onGoUnified={() => setSubTab('unified')}
              onStartBridge={() => void (processRunning ? handleConnectBridge() : handleStartProcess())}
              onLaunchChrome={() => void handleLaunchChrome()}
              starting={starting}
              launching={launchingChrome}
            />
          )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Coluna Esquerda/Centro: Feed do Chat e Envio (2/3 da largura) */}
          <div className="space-y-3 lg:col-span-2">
            <TangoChatFeed
              messages={messages}
              bridgeConnected={bridgeConnected}
              cooldownRemaining={cooldownRemaining}
              generatingForId={generatingForId}
              onGenerateReply={(msg) => void handleGenerateReplyForMessage(msg)}
              cannedResponses={cannedResponses}
              onPickCanned={setDraftText}
              generatingProactive={generatingProactive}
              onGenerateProactive={() => void handleGenerateProactive()}
              draftText={draftText}
              onDraftChange={setDraftText}
              onSend={() => void handleSendManual()}
              sending={sending}
              messagesEndRef={messagesEndRef}
              replyQueueCount={replyQueue.length}
              onViewReplies={() => setSubTab('cockpit')}
            />
          </div>

          {/* Coluna Direita: Fila de Rascunhos / Respostas da IA (1/3 da largura) */}
          <div className="space-y-3">
            <div className="rounded-2xl border border-white/10 bg-[#0c0e12] overflow-hidden shadow-lg flex flex-col h-[520px]">
              <div className="flex items-center justify-between border-b border-white/8 px-4 py-3 bg-black/30">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-violet-400" />
                  <span className="text-xs font-bold uppercase tracking-widest text-slate-300">Inbox de Respostas IA</span>
                </div>
                <Badge variant={replyQueue.length > 0 ? 'lavender' : 'default'} className="text-[10px]">
                  {replyQueue.length} na fila
                </Badge>
              </div>

              {/* Lista de Rascunhos */}
              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {replyQueue.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center text-center p-4 text-slate-500">
                    <Bot className="h-8 w-8 mb-2 opacity-50 text-violet-400" />
                    <p className="text-xs font-semibold text-slate-400">Nenhuma resposta pendente</p>
                    <p className="text-[11px] text-slate-600 mt-1 max-w-xs">
                      {autonomyMode === 'assistido'
                        ? 'Clique em "Responder IA" em qualquer mensagem para gerar um rascunho de aprovação.'
                        : autonomyMode === 'auto'
                          ? 'Modo Autônomo ativo: a IA responde diretamente no chat.'
                          : 'Ligue o modo Assistido para receber sugestões da IA.'}
                    </p>
                  </div>
                ) : (
                  replyQueue.map((item) => (
                    <div
                      key={item.id}
                      className={cn(
                        'rounded-xl border p-3 space-y-2 transition',
                        item.status === 'sent' && 'border-emerald-500/30 bg-emerald-500/5',
                        item.status === 'sending' && 'border-sky-500/30 bg-sky-500/5 animate-pulse',
                        item.status === 'blocked' && 'border-red-500/30 bg-red-500/5',
                        item.status === 'draft' && 'border-violet-500/30 bg-violet-500/5'
                      )}
                    >
                      {/* Contexto da Pergunta */}
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-bold text-violet-300">
                          Para: @{item.sourceMessage.username}
                        </span>
                        <span className="text-[10px] text-slate-500">
                          {Math.round(item.confidence * 100)}% confiança
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 italic line-clamp-1 border-l-2 border-white/20 pl-2">
                        "{item.sourceMessage.text}"
                      </p>

                      {/* Texto da Resposta ou Edição */}
                      {editingItemId === item.id ? (
                        <div className="space-y-1.5 pt-1">
                          <textarea
                            className="w-full h-16 rounded-lg border border-white/20 bg-black/40 p-2 text-xs text-white outline-none focus:border-violet-500"
                            value={editingText}
                            onChange={(e) => setEditingText(e.target.value)}
                          />
                          <div className="flex justify-end gap-1.5">
                            <Button size="sm" variant="secondary" onClick={() => setEditingItemId(null)}>
                              Cancelar
                            </Button>
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={() => {
                                setReplyQueue((prev) =>
                                  prev.map((i) => (i.id === item.id ? { ...i, text: editingText } : i))
                                );
                                setEditingItemId(null);
                              }}
                            >
                              Salvar
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs font-medium text-slate-100 bg-black/30 p-2 rounded-lg border border-white/5">
                          {item.text}
                        </p>
                      )}

                      {/* Motivo de bloqueio se houver */}
                      {item.blockedReason && (
                        <p className="text-[10px] text-red-400 flex items-center gap-1">
                          <ShieldAlert className="h-3 w-3 shrink-0" /> {item.blockedReason}
                        </p>
                      )}

                      {/* Ações de Aprovação */}
                      {item.status === 'draft' && editingItemId !== item.id && (
                        <div className="flex items-center gap-1.5 pt-1">
                          <Button
                            size="sm"
                            variant="primary"
                            className="flex-1 h-7 text-xs bg-emerald-600 hover:bg-emerald-500 text-white"
                            onClick={() => void handleApproveReply(item)}
                          >
                            <Check className="h-3.5 w-3.5 mr-1" /> Aprovar & Enviar
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-7 px-2"
                            title="Editar texto"
                            onClick={() => {
                              setEditingItemId(item.id);
                              setEditingText(item.text);
                            }}
                          >
                            <Edit3 className="h-3 w-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-7 px-2"
                            title="Regerar com IA"
                            onClick={() => void handleRegenerateReply(item)}
                          >
                            <RotateCcw className="h-3 w-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            className="h-7 px-2"
                            title="Descartar"
                            onClick={() => handleDiscardReply(item.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      )}

                      {item.status === 'sent' && (
                        <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400">
                          <CheckCircle2 className="h-3 w-3" /> Enviada com sucesso
                        </span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
        </div>
      )}

      {/* ── ABA 2: PERSONALIDADE DA IA & REGRAS ──────────────────────── */}
      {subTab === 'ai_config' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Personalidade da Odessa */}
          <div className="rounded-2xl border border-white/10 bg-[#0c0e12] p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-violet-400" />
              <h3 className="text-sm font-bold text-white">Personalidade no Chat (System Prompt)</h3>
            </div>
            <p className="text-xs text-slate-400">
              Instruções que moldam como a Odessa responde no chat da stream.
            </p>
            <textarea
              className="h-64 w-full rounded-xl border border-white/10 bg-black/40 p-3 font-mono text-xs text-slate-200 outline-none focus:border-violet-500 leading-relaxed"
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder="Digite o prompt de personalidade..."
            />
            <div className="flex justify-end">
              <Button size="sm" variant="primary" onClick={handleSaveAiConfig}>
                <Check className="h-3.5 w-3.5 mr-1" /> Salvar Personalidade
              </Button>
            </div>
          </div>

          {/* Regras do Governor & Rate Limit */}
          <div className="rounded-2xl border border-white/10 bg-[#0c0e12] p-5 space-y-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-400" />
              <h3 className="text-sm font-bold text-white">Segurança & Rate Limit (Governor)</h3>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Cooldown Mínimo entre Mensagens (segundos)
                </label>
                <input
                  type="number"
                  className="h-9 w-full rounded-lg border border-white/10 bg-black/40 px-3 text-xs text-white"
                  value={cooldownSec}
                  onChange={(e) => setCooldownSec(Number(e.target.value) || 15)}
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Evita que a IA envie mensagens muito seguidas (recomendado: 10 a 20s).
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Máximo de Mensagens por Minuto
                </label>
                <input
                  type="number"
                  className="h-9 w-full rounded-lg border border-white/10 bg-black/40 px-3 text-xs text-white"
                  value={maxPerMinute}
                  onChange={(e) => setMaxPerMinute(Number(e.target.value) || 4)}
                />
              </div>

              {/* Gerenciador de Respostas Rápidas */}
              <div className="pt-2 border-t border-white/8">
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Respostas Rápidas Pré-definidas
                </label>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    className="h-8 flex-1 rounded-lg border border-white/10 bg-black/40 px-3 text-xs text-white"
                    placeholder="Adicionar nova resposta rápida..."
                    value={newCannedText}
                    onChange={(e) => setNewCannedText(e.target.value)}
                  />
                  <Button size="sm" variant="secondary" onClick={handleAddCannedResponse}>
                    Adicionar
                  </Button>
                </div>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {cannedResponses.map((c, i) => (
                    <div key={i} className="flex items-center justify-between rounded bg-white/[0.02] px-2.5 py-1 text-xs text-slate-300">
                      <span className="truncate">{c}</span>
                      <button className="text-slate-500 hover:text-red-400 ml-2" onClick={() => handleRemoveCanned(i)}>
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── ABA 3: CONFIGURAÇÃO DA BRIDGE ───────────────────────────── */}
      {subTab === 'bridge_config' && (
        <div className="space-y-4 rounded-2xl border border-white/10 bg-[#0c0e12] p-5">
          <div>
            <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-slate-400">
              Modo de Conexão com o Tango
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { value: '', label: 'Automático', desc: 'Tenta CDP primeiro; fallback para Standalone.' },
                { value: 'standalone', label: 'Standalone (Recomendado)', desc: 'Abre um Chromium próprio do Playwright com perfil salvo permanente.' },
                { value: 'cdp', label: 'CDP (Chrome Aberto)', desc: 'Conecta ao seu Chrome com flag --remote-debugging-port=9222.' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  className={cn(
                    'rounded-xl border p-3.5 text-left transition',
                    bridgeConfig.mode === opt.value
                      ? 'border-violet-500/60 bg-violet-500/10'
                      : 'border-white/8 bg-black/20 hover:border-white/20'
                  )}
                  onClick={() => {
                    setBridgeConfig((prev) => ({ ...prev, mode: opt.value }));
                    setConfigDirty(true);
                  }}
                >
                  <span className="text-xs font-bold text-white">{opt.label}</span>
                  <p className="mt-1 text-[11px] text-slate-400">{opt.desc}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-300">
                URL da Live Tango
              </label>
              <input
                type="text"
                className="h-9 w-full rounded-lg border border-white/10 bg-black/40 px-3 text-xs text-white placeholder-slate-600 outline-none focus:border-violet-500"
                value={bridgeConfig.roomUrl}
                onChange={(e) => {
                  setBridgeConfig((prev) => ({ ...prev, roomUrl: e.target.value }));
                  setConfigDirty(true);
                }}
                placeholder="https://tango.me/stream/broadcast"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-300">
                Porta HTTP da Bridge
              </label>
              <input
                type="number"
                className="h-9 w-full rounded-lg border border-white/10 bg-black/40 px-3 text-xs text-white outline-none focus:border-violet-500"
                value={bridgeConfig.port}
                onChange={(e) => {
                  setBridgeConfig((prev) => ({ ...prev, port: Number(e.target.value) || 7555 }));
                  setConfigDirty(true);
                }}
              />
            </div>
          </div>

          {/* Seletores Avançados */}
          <div>
            <button
              className="flex items-center gap-1 text-xs font-bold uppercase tracking-widest text-slate-500 hover:text-slate-300"
              onClick={() => setShowAdvancedSelectors(!showAdvancedSelectors)}
            >
              {showAdvancedSelectors ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Seletores CSS do Tango (Avançado)
            </button>
            {showAdvancedSelectors && (
              <div className="mt-2 grid gap-2 sm:grid-cols-2 rounded-xl border border-white/8 bg-black/30 p-3">
                {Object.entries(bridgeConfig.selectors).map(([key, val]) => (
                  <div key={key}>
                    <label className="block text-[10px] text-slate-500 mb-0.5">{key}</label>
                    <input
                      type="text"
                      className="h-7 w-full rounded border border-white/10 bg-black/40 px-2 font-mono text-[11px] text-white"
                      value={val}
                      onChange={(e) => {
                        setBridgeConfig((prev) => ({
                          ...prev,
                          selectors: { ...prev.selectors, [key]: e.target.value },
                        }));
                        setConfigDirty(true);
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 pt-2 border-t border-white/8">
            <Button
              size="sm"
              variant="primary"
              disabled={!configDirty || configSaving}
              onClick={() => void handleSaveBridgeConfig()}
            >
              {configSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5 mr-1" />}
              Salvar Configurações
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setBridgeConfig(defaultConfig());
                setConfigDirty(true);
              }}
            >
              Restaurar Padrões
            </Button>
          </div>
        </div>
      )}

      {/* ── ABA 4: MONITOR DE VISÃO (AO VIVO + INTERAÇÃO) ─────────────── */}
      {subTab === 'vision' && (
        <LiveVisionMonitor connected={bridgeConnected} />
      )}

      {/* ── ABA 5: APRENDIZADO DO CHAT ──────────────────────────────── */}
      {subTab === 'insights' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-[#0c0e12] p-4 space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400">Tópicos Mais Falados</h4>
            <div className="space-y-1.5">
              {insights.topTopics.length === 0 ? (
                <p className="text-xs text-slate-600">Nenhum tópico registrado ainda.</p>
              ) : (
                insights.topTopics.map(([topic, counter], i) => (
                  <div key={i} className="flex justify-between items-center bg-white/[0.02] p-2 rounded-lg text-xs">
                    <span className="font-semibold text-violet-300">#{topic}</span>
                    <Badge variant="default" className="text-[10px]">{counter.count}x</Badge>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#0c0e12] p-4 space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400">Pedidos Frequentes</h4>
            <div className="space-y-1.5">
              {insights.topRequests.length === 0 ? (
                <p className="text-xs text-slate-600">Nenhum pedido frequente identificado.</p>
              ) : (
                insights.topRequests.map(([req, counter], i) => (
                  <div key={i} className="flex justify-between items-center bg-white/[0.02] p-2 rounded-lg text-xs">
                    <span className="truncate text-slate-300">{req}</span>
                    <Badge variant="lavender" className="text-[10px]">{counter.count}x</Badge>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#0c0e12] p-4 space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400">Elogios & Curtidas</h4>
            <div className="space-y-1.5">
              {insights.topLikes.length === 0 ? (
                <p className="text-xs text-slate-600">Nenhum elogio registrado ainda.</p>
              ) : (
                insights.topLikes.map(([like, counter], i) => (
                  <div key={i} className="flex justify-between items-center bg-white/[0.02] p-2 rounded-lg text-xs">
                    <span className="text-emerald-300">✨ {like}</span>
                    <Badge variant="success" className="text-[10px]">{counter.count}x</Badge>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── ABA 6: DIAGNÓSTICO & LOGS ────────────────────────────────── */}
      {subTab === 'history' && <SessionHistoryPanel active={subTab === 'history'} />}

      {subTab === 'diagnostics' && (
        <div className="space-y-4">
          {/* Checks de Conectividade */}
          <div className="rounded-2xl border border-white/10 bg-[#0c0e12] p-5">
            <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Saúde do Ecossistema</h4>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-black/30 border border-white/5">
                <span className="text-xs text-slate-300">Backend API (FastAPI)</span>
                <span className={cn('text-xs font-bold', backendOnline ? 'text-emerald-400' : 'text-red-400')}>
                  {backendOnline ? 'Online (8000)' : 'Offline'}
                </span>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-black/30 border border-white/5">
                <span className="text-xs text-slate-300">Processo Python (tango_chat.py)</span>
                <span className={cn('text-xs font-bold', processRunning ? 'text-emerald-400' : 'text-slate-500')}>
                  {processRunning ? `Ativo (PID ${processStatus?.pid})` : 'Parado'}
                </span>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-black/30 border border-white/5">
                <span className="text-xs text-slate-300">Servidor HTTP Bridge</span>
                <span className={cn('text-xs font-bold', bridgeReachable ? 'text-emerald-400' : 'text-slate-500')}>
                  {bridgeReachable ? `Respondendo (${bridgeConfig.port})` : 'Inativo'}
                </span>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-black/30 border border-white/5">
                <span className="text-xs text-slate-300">Conexão DOM Tango Live</span>
                <span className={cn('text-xs font-bold', bridgeConnected ? 'text-emerald-400' : 'text-slate-500')}>
                  {bridgeConnected ? 'MutationObserver Ativo' : 'Desconectado'}
                </span>
              </div>
            </div>
          </div>

          {/* Terminal de Logs ao Vivo */}
          <div className="rounded-2xl border border-white/10 bg-[#0c0e12] overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/8 px-4 py-2.5 bg-black/40">
              <div className="flex items-center gap-2">
                <Terminal className="h-3.5 w-3.5 text-emerald-400" />
                <span className="text-xs font-bold uppercase tracking-widest text-slate-300">Terminal da Bridge</span>
              </div>
              <span className="text-[10px] text-slate-500">{logs.length} linhas</span>
            </div>
            <div className="h-64 overflow-y-auto bg-black/60 p-3 font-mono text-[11px] space-y-0.5">
              {logs.length === 0 ? (
                <p className="text-slate-600">Inicie a bridge para visualizar os logs em tempo real...</p>
              ) : (
                logs.map((line, i) => (
                  <div
                    key={i}
                    className={cn(
                      'whitespace-pre-wrap break-all leading-tight',
                      line.includes('ERROR')
                        ? 'text-red-400'
                        : line.includes('WARNING')
                          ? 'text-amber-400'
                          : line.includes('MSG |')
                            ? 'text-sky-300'
                            : line.includes('SEND |')
                              ? 'text-emerald-400'
                              : 'text-slate-400'
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
