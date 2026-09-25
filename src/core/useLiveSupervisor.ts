import { useEffect, useRef, useState } from 'react';
import { buildLiveSupervisorSnapshot, type LiveSupervisorSnapshot } from './liveReadinessSupervisor';
import { useTangoChatSession } from './tangoChatSession';
import type { AutopilotRuntimeState } from './useAutopilotRuntime';

const CLOCK_MS = 5_000;

/**
 * Prontidão da live (#162, #168): junta o estado da Diretora (OBS, vídeo,
 * autonomia) com o da bridge do Tango (captura e envio no chat).
 */
export function useLiveReadiness(runtime: AutopilotRuntimeState): LiveSupervisorSnapshot {
  const { processStatus, sseState, messages, executionMode, replyQueue } = useTangoChatSession();
  // Relógio próprio: "última mensagem há Xs" envelhece sem precisar de evento.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => window.clearInterval(id);
  }, []);

  const bridgeConnected = processStatus?.bridgeStatus?.status === 'connected';
  const inputReady = Boolean(processStatus?.bridgeStatus?.observerInjected);
  const lastMessage = messages[messages.length - 1];
  const lastMessageAt = lastMessage?.timestamp ? Date.parse(lastMessage.timestamp) || null : null;
  const lastSend = replyQueue.find((item) => item.status === 'sent' || item.status === 'simulated' || item.status === 'failed');

  // Cálculo barato e puro: sem memo manual (o React Compiler cuida disso).
  return buildLiveSupervisorSnapshot({
    now,
    capture: { bridgeConnected, stream: sseState, lastMessageAt },
    chat: {
      sendMode: executionMode,
      bridgeConnected,
      inputReady,
      lastSendStatus: (lastSend?.status as 'sent' | 'simulated' | 'failed' | undefined) ?? null,
      lastSendError: lastSend?.status === 'failed' ? lastSend.blockedReason || null : null,
    },
    obs: {
      connected: !runtime.obsError && runtime.obsScenes.length > 0,
      currentScene: runtime.currentObsScene,
      scenes: runtime.obsScenes,
      error: runtime.obsError,
    },
    video: runtime.videoMonitor,
    autonomyLevel: runtime.autonomyLevel,
    autoChatEnabled: false,
  });
}

/**
 * Supervisor ativo: com a live no ar, executa as ações de recuperação quando
 * algum subsistema falha (pausa o chat autônomo, volta ao idle, reconecta o
 * OBS, reduz a autonomia). Fora da live só informa — o operador pode estar
 * preparando e não deve ter a autonomia rebaixada sozinha.
 */
export function useLiveSupervisor(
  runtime: AutopilotRuntimeState,
  /** Avisa o operador quando o supervisor pausa o chat autônomo. */
  onAutoChatPaused?: (reason: string) => void,
): LiveSupervisorSnapshot {
  const readiness = useLiveReadiness(runtime);
  const { autonomyMode, setAutonomyMode } = useTangoChatSession();
  const live = runtime.autopilotEnabled;
  const { runRecoveryAction } = runtime;
  const actionsKey = readiness.recoveryActions.join(',');
  const lastRunKey = useRef('');

  useEffect(() => {
    if (!live || readiness.state === 'healthy' || !actionsKey) {
      lastRunKey.current = '';
      return;
    }
    // Uma vez por combinação de falhas (o runtime ainda limita por ação).
    const runKey = `${readiness.state}|${actionsKey}`;
    if (lastRunKey.current === runKey) return;
    lastRunKey.current = runKey;
    for (const action of actionsKey.split(',')) {
      if (action === 'pause_auto_chat' && autonomyMode === 'auto') {
        setAutonomyMode('assistido');
        onAutoChatPaused?.(readiness.diagnostics[0] ?? 'subsistema instável');
      }
      void runRecoveryAction(action as Parameters<typeof runRecoveryAction>[0]);
    }
  }, [live, readiness.state, actionsKey, readiness.diagnostics, autonomyMode, setAutonomyMode, runRecoveryAction, onAutoChatPaused]);

  return readiness;
}
