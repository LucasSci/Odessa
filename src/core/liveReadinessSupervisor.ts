import type { AiAutonomyLevel } from './aiConfig';
import type { LiveEvent } from '../types';

export type LiveSubsystem = 'ocr' | 'obs' | 'video' | 'chat';
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

export interface LiveSupervisorInput {
  now: number;
  capturedEvents: LiveEvent[];
  healthError?: string | null;
  obs: {
    connected: boolean;
    currentScene?: string | null;
    scenes: string[];
    error?: string | null;
    hasOcrSource?: boolean;
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
    visualTargetReady: boolean;
    allowlistReady: boolean;
    localAgentReady: boolean;
    lastSendStatus?: string | null;
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

function confidenceValues(events: LiveEvent[]) {
  return events
    .map((event) => Number(event.metadata?.confidence))
    .filter((value) => Number.isFinite(value));
}

function ocrReadiness(input: LiveSupervisorInput): SubsystemReadiness {
  const ocrEvents = input.capturedEvents.filter((event) => event.source === 'ocr');
  const latest = ocrEvents
    .map((event) => Date.parse(event.createdAt))
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];
  const lastAgeSec = latest ? Math.round((input.now - latest) / 1000) : Infinity;
  const lastMinute = ocrEvents.filter((event) => input.now - Date.parse(event.createdAt) <= 60_000);
  const values = confidenceValues(ocrEvents.slice(-20));
  const avgConfidence = values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;

  if (!ocrEvents.length || lastAgeSec > 45) {
    return {
      id: 'ocr',
      label: 'OCR',
      state: 'blocked',
      detail: 'Sem leitura recente do OCR.',
      suggestedAction: 'Verifique captura/zonas antes de liberar chat real.',
      recoveryActions: ['pause_auto_chat', 'reduce_autonomy'],
      metrics: { lastAgeSec, frequencyPerMinute: lastMinute.length, avgConfidence },
    };
  }
  if (avgConfidence < 0.65 || lastMinute.length < 2) {
    return {
      id: 'ocr',
      label: 'OCR',
      state: 'warning',
      detail: 'OCR instavel ou com confianca baixa.',
      suggestedAction: 'Mantenha respostas publicas em preview ate estabilizar.',
      recoveryActions: ['pause_auto_chat'],
      metrics: { lastAgeSec, frequencyPerMinute: lastMinute.length, avgConfidence },
    };
  }
  return {
    id: 'ocr',
    label: 'OCR',
    state: 'healthy',
    detail: 'Leitura recente e confianca adequada.',
    recoveryActions: [],
    metrics: { lastAgeSec, frequencyPerMinute: lastMinute.length, avgConfidence },
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
  if (obs.hasOcrSource === false || obs.hasStageSource === false || !obs.currentScene) {
    return {
      id: 'obs',
      label: 'OBS',
      state: 'warning',
      detail: 'Cena/source essencial ainda nao confirmado.',
      suggestedAction: 'Confirme source de OCR, palco e cena ativa.',
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

function chatReadiness(input: LiveSupervisorInput): SubsystemReadiness {
  const chat = input.chat;
  if (!chat.visualTargetReady || !chat.allowlistReady) {
    return {
      id: 'chat',
      label: 'Chat automation',
      state: 'blocked',
      detail: 'Alvo visual ou allowlist ausente.',
      suggestedAction: 'Calibre e valide o alvo visual antes de enviar chat real.',
      recoveryActions: ['pause_auto_chat', 'reduce_autonomy'],
      metrics: chat as unknown as Record<string, unknown>,
    };
  }
  if (!chat.localAgentReady) {
    return {
      id: 'chat',
      label: 'Chat automation',
      state: 'blocked',
      detail: 'Agente local offline.',
      suggestedAction: 'Inicie o agente local na maquina da live.',
      recoveryActions: ['pause_auto_chat', 'reduce_autonomy'],
      metrics: chat as unknown as Record<string, unknown>,
    };
  }
  if (chat.lastSendError || chat.lastSendStatus === 'failed' || chat.lastSendStatus === 'blocked') {
    return {
      id: 'chat',
      label: 'Chat automation',
      state: 'warning',
      detail: chat.lastSendError || `Ultimo envio: ${chat.lastSendStatus}.`,
      suggestedAction: 'Revise o ultimo erro antes de voltar ao modo real.',
      recoveryActions: ['pause_auto_chat'],
      metrics: chat as unknown as Record<string, unknown>,
    };
  }
  return {
    id: 'chat',
    label: 'Chat automation',
    state: 'healthy',
    detail: 'Alvo, allowlist e agente local prontos.',
    recoveryActions: [],
    metrics: chat as unknown as Record<string, unknown>,
  };
}

export function buildLiveSupervisorSnapshot(input: LiveSupervisorInput): LiveSupervisorSnapshot {
  const checklist = [
    ocrReadiness(input),
    obsReadiness(input),
    videoReadiness(input),
    chatReadiness(input),
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
