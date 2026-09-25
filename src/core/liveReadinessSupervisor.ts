/**
 * liveReadinessSupervisor — prontidão da live e ações de recuperação (#162).
 *
 * Avalia os quatro subsistemas que a Odessa usa ao vivo — captura do chat pela
 * bridge do Tango, envio no chat, OBS e vídeo — em `healthy`, `warning`,
 * `blocked` ou `recovering`, com diagnóstico, ação sugerida e ações de
 * recuperação automáticas (pausar chat autônomo, voltar ao idle, reconectar
 * OBS, reduzir autonomia). Função pura: quem chama decide quando executar.
 *
 * Histórico: a primeira versão avaliava OCR e um "alvo visual" calibrado.
 * Os dois foram removidos em set/2026 (o chat passou a vir da bridge) e o
 * supervisor ficou marcando tudo como bloqueado — reduzindo a autonomia sem
 * parar. Agora ele olha para a bridge.
 */
import type { AiAutonomyLevel } from './aiConfig';

export type LiveSubsystem = 'capture' | 'chat' | 'obs' | 'video';
export type LiveReadinessState = 'healthy' | 'warning' | 'blocked' | 'recovering';
export type RecoveryAction =
  | 'pause_auto_chat'
  | 'return_to_idle'
  | 'reconnect_obs'
  | 'reduce_autonomy';

export interface SubsystemReadiness {
  id: LiveSubsystem;
  label: string;
  state: LiveReadinessState;
  /** Envio em modo teste: pronto, mas nada sai no chat. */
  simulated?: boolean;
  detail: string;
  suggestedAction?: string;
  recoveryActions: RecoveryAction[];
  metrics: Record<string, unknown>;
}

export interface LiveSupervisorSnapshot {
  state: LiveReadinessState;
  readyToStart: boolean;
  summary: string;
  checklist: SubsystemReadiness[];
  recoveryActions: RecoveryAction[];
  diagnostics: string[];
}

export type ChatStreamState = 'stopped' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

export interface LiveSupervisorInput {
  now: number;
  capture: {
    /** Bridge do Tango conectada à página da live. */
    bridgeConnected: boolean;
    /** Stream de mensagens (SSE) da bridge para o app. */
    stream: ChatStreamState;
    /** Quando chegou a última mensagem do chat (ms). */
    lastMessageAt?: number | null;
  };
  obs: {
    connected: boolean;
    currentScene?: string | null;
    scenes: string[];
    error?: string | null;
    hasStageSource?: boolean;
    streaming?: boolean;
  };
  video: {
    currentVideoId?: string | null;
    idleVideoId?: string | null;
    queueSize?: number;
    updatedAt?: string | null;
    error?: string | null;
  };
  chat: {
    sendMode: 'dry_run' | 'real';
    bridgeConnected: boolean;
    /** Observer injetado na página: a bridge sabe onde está o campo de digitação. */
    inputReady: boolean;
    lastSendStatus?: 'sent' | 'simulated' | 'failed' | null;
    lastSendError?: string | null;
  };
  autonomyLevel: AiAutonomyLevel;
  autoChatEnabled: boolean;
}

function worstState(states: LiveReadinessState[]): LiveReadinessState {
  if (states.includes('blocked')) return 'blocked';
  if (states.includes('recovering')) return 'recovering';
  if (states.includes('warning')) return 'warning';
  return 'healthy';
}

function minutesSince(now: number, iso?: string | null) {
  if (!iso) return Infinity;
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return Infinity;
  return Math.max(0, (now - parsed) / 60_000);
}

function captureReadiness(input: LiveSupervisorInput): SubsystemReadiness {
  const { bridgeConnected, stream, lastMessageAt } = input.capture;
  const lastAgeSec = lastMessageAt ? Math.max(0, Math.round((input.now - lastMessageAt) / 1000)) : null;
  const metrics = { bridgeConnected, stream, lastAgeSec };
  if (!bridgeConnected) {
    return {
      id: 'capture',
      label: 'Captura do chat',
      state: 'blocked',
      detail: 'Bridge do Tango desconectada: a Odessa não está lendo o chat.',
      suggestedAction: 'Inicie a bridge na Central da Live (Configuração Automática).',
      recoveryActions: ['pause_auto_chat'],
      metrics,
    };
  }
  if (stream === 'failed') {
    return {
      id: 'capture',
      label: 'Captura do chat',
      state: 'blocked',
      detail: 'O stream de mensagens caiu depois de várias tentativas.',
      suggestedAction: 'Reconecte a bridge.',
      recoveryActions: ['pause_auto_chat'],
      metrics,
    };
  }
  if (stream !== 'connected') {
    return {
      id: 'capture',
      label: 'Captura do chat',
      state: 'warning',
      detail: 'Reconectando ao chat…',
      suggestedAction: 'Aguarde alguns segundos; se não voltar, reconecte a bridge.',
      recoveryActions: [],
      metrics,
    };
  }
  return {
    id: 'capture',
    label: 'Captura do chat',
    state: 'healthy',
    detail: lastAgeSec === null ? 'Conectado, aguardando mensagens.' : `Última mensagem há ${lastAgeSec}s.`,
    recoveryActions: [],
    metrics,
  };
}

function chatReadiness(input: LiveSupervisorInput): SubsystemReadiness {
  const chat = input.chat;
  const metrics = chat as unknown as Record<string, unknown>;
  if (chat.sendMode === 'dry_run') {
    return {
      id: 'chat',
      label: 'Envio no chat',
      state: 'healthy',
      simulated: true,
      detail: 'Modo teste: as respostas aparecem aqui, nada é enviado no chat.',
      suggestedAction: 'Ligue o Envio real quando quiser que a Odessa escreva no chat.',
      recoveryActions: [],
      metrics,
    };
  }
  if (!chat.bridgeConnected) {
    return {
      id: 'chat',
      label: 'Envio no chat',
      state: 'blocked',
      detail: 'Envio real ligado, mas a bridge está desconectada.',
      suggestedAction: 'Conecte a bridge ou volte para o modo teste.',
      recoveryActions: ['pause_auto_chat'],
      metrics,
    };
  }
  if (chat.lastSendStatus === 'failed' || chat.lastSendError) {
    return {
      id: 'chat',
      label: 'Envio no chat',
      state: 'warning',
      detail: chat.lastSendError || 'O último envio falhou.',
      suggestedAction: 'Rode o teste de digitação na Configuração Automática antes de voltar ao Autônomo.',
      recoveryActions: ['pause_auto_chat'],
      metrics,
    };
  }
  if (!chat.inputReady) {
    return {
      id: 'chat',
      label: 'Envio no chat',
      state: 'warning',
      detail: 'Campo de digitação do chat ainda não confirmado.',
      suggestedAction: 'Rode o teste de digitação na Configuração Automática.',
      recoveryActions: [],
      metrics,
    };
  }
  return {
    id: 'chat',
    label: 'Envio no chat',
    state: 'healthy',
    detail: 'Campo do chat validado: pronto para enviar de verdade.',
    recoveryActions: [],
    metrics,
  };
}

function obsReadiness(input: LiveSupervisorInput): SubsystemReadiness {
  const obs = input.obs;
  if (obs.error || !obs.connected) {
    return {
      id: 'obs',
      label: 'OBS',
      state: 'blocked',
      detail: obs.error || 'OBS desconectado.',
      suggestedAction: 'Reconectar OBS antes de iniciar a live.',
      recoveryActions: ['reconnect_obs', 'reduce_autonomy'],
      metrics: obs as unknown as Record<string, unknown>,
    };
  }
  if (obs.hasStageSource === false || !obs.currentScene) {
    return {
      id: 'obs',
      label: 'OBS',
      state: 'warning',
      detail: 'Cena ativa ou source do palco ainda não confirmados.',
      suggestedAction: 'Confirme a cena ativa e o source do palco no OBS.',
      recoveryActions: ['reconnect_obs'],
      metrics: obs as unknown as Record<string, unknown>,
    };
  }
  return {
    id: 'obs',
    label: 'OBS',
    state: 'healthy',
    detail: `Conectado em ${obs.currentScene}.`,
    recoveryActions: [],
    metrics: obs as unknown as Record<string, unknown>,
  };
}

function videoReadiness(input: LiveSupervisorInput): SubsystemReadiness {
  const video = input.video;
  const staleMinutes = minutesSince(input.now, video.updatedAt);
  if (video.error) {
    return {
      id: 'video',
      label: 'Video',
      state: 'blocked',
      detail: video.error,
      suggestedAction: 'Voltar ao idle e conferir a fila.',
      recoveryActions: ['return_to_idle'],
      metrics: video as unknown as Record<string, unknown>,
    };
  }
  if (video.currentVideoId && staleMinutes > 3 && video.currentVideoId !== video.idleVideoId) {
    return {
      id: 'video',
      label: 'Video',
      state: 'recovering',
      detail: 'Video sem avancar ha mais de 3 minutos.',
      suggestedAction: 'Forcar retorno ao idle.',
      recoveryActions: ['return_to_idle'],
      metrics: { ...video, staleMinutes },
    };
  }
  if ((video.queueSize || 0) > 8) {
    return {
      id: 'video',
      label: 'Video',
      state: 'warning',
      detail: 'Fila de video alta; risco de atraso nas reacoes.',
      suggestedAction: 'Acompanhe a fila antes de aumentar autonomia.',
      recoveryActions: [],
      metrics: video as unknown as Record<string, unknown>,
    };
  }
  return {
    id: 'video',
    label: 'Video',
    state: 'healthy',
    detail: video.currentVideoId ? `Atual: ${video.currentVideoId}.` : 'Aguardando estado de video.',
    recoveryActions: [],
    metrics: video as unknown as Record<string, unknown>,
  };
}

export function buildLiveSupervisorSnapshot(input: LiveSupervisorInput): LiveSupervisorSnapshot {
  const checklist = [
    captureReadiness(input),
    chatReadiness(input),
    obsReadiness(input),
    videoReadiness(input),
  ];
  const state = worstState(checklist.map((item) => item.state));
  const recoveryActions = Array.from(new Set(checklist.flatMap((item) => item.recoveryActions)));
  const diagnostics = checklist
    .filter((item) => item.state !== 'healthy')
    .map((item) => `${item.label}: ${item.detail}`);
  const riskyAutonomy =
    input.autonomyLevel === 'auto' && (state === 'blocked' || recoveryActions.includes('pause_auto_chat'));

  return {
    state,
    readyToStart: state === 'healthy',
    summary:
      state === 'healthy'
        ? 'Pronto para iniciar a live.'
        : riskyAutonomy
          ? 'Autonomia alta com subsistema instavel; reducao recomendada.'
          : 'Revise os itens pendentes antes de iniciar.',
    checklist,
    recoveryActions,
    diagnostics,
  };
}
