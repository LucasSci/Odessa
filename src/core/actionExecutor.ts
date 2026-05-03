import { apiUrl } from '../lib/api';
import { loadTtsSettings } from '../lib/ttsSettings';
import type { AutopilotAction, PersonaDecision, PersonaTool } from '../types';
import { capabilityForAction, findTool } from './toolRegistry';

export interface ActionExecutionOptions {
  tools: PersonaTool[];
  voiceEnabled: boolean;
}

let ttsPlaybackLock: Promise<void> = Promise.resolve();

interface N8NDispatchResult {
  ok?: boolean;
  target?: string;
  status_code?: number;
  detail?: string;
  executed?: boolean;
  simulated?: boolean;
  capability?: string;
  scene?: string;
  currentScene?: string;
  message?: string;
  response?: unknown;
}

export function actionSummary(action: AutopilotAction) {
  const payload = action.payload || {};
  const detail =
    typeof payload.text === 'string'
      ? payload.text
      : typeof payload.message === 'string'
        ? payload.message
        : typeof payload.scene === 'string'
          ? payload.scene
          : typeof payload.track === 'string'
            ? payload.track
            : typeof payload.topic === 'string'
              ? payload.topic
              : '';
  return detail ? `${action.label}: ${detail}` : action.label;
}

function simulatedActionResult(action: AutopilotAction, capability: string) {
  const payload = action.payload || {};
  if (capability === 'chat.reply') {
    const message =
      typeof payload.message === 'string'
        ? payload.message
        : typeof payload.text === 'string'
          ? payload.text
          : actionSummary(action);
    return `Mensagem que seria enviada ao chat: ${message}`;
  }
  if (capability === 'moderation.message') {
    return `Moderacao simulada: ${actionSummary(action)}`;
  }
  if (capability === 'obs.switch_scene') {
    return `OBS simulado: trocar cena para ${String(payload.scene || actionSummary(action))}`;
  }
  if (capability === 'media.play_music') {
    return `Midia simulada: adicionar musica ${String(payload.track || actionSummary(action))}`;
  }
  if (capability === 'obs.show_overlay') {
    return `Overlay simulado: ${actionSummary(action)}`;
  }
  return `Simulado local: ${actionSummary(action)}`;
}

async function playTts(text: string, voiceEnabled: boolean) {
  if (!voiceEnabled) return 'Voz desativada: fala registrada sem audio.';

  let releaseLock!: () => void;
  const previousLock = ttsPlaybackLock;
  ttsPlaybackLock = previousLock.then(
    () =>
      new Promise<void>((resolve) => {
        releaseLock = resolve;
      }),
  );
  await previousLock;

  let audioUrl = '';
  try {
    const ttsSettings = loadTtsSettings();
    const response = await fetch(apiUrl('/tts'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, ...ttsSettings }),
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new Error(detail.detail || 'Falha no TTS');
    }

    const blob = await response.blob();
    audioUrl = URL.createObjectURL(blob);
    const audio = new Audio(audioUrl);
    await new Promise<void>((resolve, reject) => {
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error('Falha ao reproduzir audio TTS'));
      audio.play().catch(reject);
    });
    return 'Audio reproduzido no player local.';
  } finally {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    releaseLock();
  }
}

async function dispatchExternalActionToN8N(
  action: AutopilotAction,
  decision: PersonaDecision,
  tool: PersonaTool,
): Promise<N8NDispatchResult | null> {
  const response = await fetch(apiUrl('/n8n/dispatch'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      target: 'action',
      payload: {
        product: 'Odessa',
        kind: 'autopilot_action',
        createdAt: new Date().toISOString(),
        tool: {
          id: tool.id,
          label: tool.label,
          capability: tool.capability,
          simulated: tool.simulated,
        },
        action,
        decision: {
          intent: decision.intent,
          confidence: decision.confidence,
          priority: decision.priority,
          reason: decision.reason,
          speech: decision.speech,
        },
      },
    }),
  });

  const data = (await response.json().catch(() => ({}))) as N8NDispatchResult;
  if (response.status === 404 || response.status === 503) return null;
  if (!response.ok) {
    throw new Error(data.detail || `Falha ao despachar para n8n: HTTP ${response.status}`);
  }
  return data;
}

async function getObsSceneWhitelist() {
  const response = await fetch(apiUrl('/obs/scenes'));
  const data = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    scenes?: string[];
    error?: string;
  };
  if (!response.ok || !data.ok) {
    return {
      scenes: [],
      error: data.error || `Nao foi possivel consultar cenas do OBS: HTTP ${response.status}`,
    };
  }
  return {
    scenes: Array.isArray(data.scenes) ? data.scenes : [],
    error: '',
  };
}

export async function executeAction(
  action: AutopilotAction,
  decision: PersonaDecision,
  options: ActionExecutionOptions,
): Promise<AutopilotAction> {
  const capability = capabilityForAction(action);
  const tool = findTool(options.tools, capability);
  const base = {
    ...action,
    capability,
    simulated: tool?.simulated ?? action.simulated,
    requiresApproval: tool?.requiresApproval ?? action.requiresApproval,
  };

  if (!tool) {
    return { ...base, status: 'blocked', result: `Ferramenta nao registrada: ${capability}` };
  }
  if (!tool.enabled) {
    return { ...base, status: 'blocked', result: `Ferramenta desativada: ${tool.label}` };
  }
  if (tool.requiresApproval || action.requiresApproval) {
    return { ...base, status: 'approval_required', result: `Aguardando aprovacao: ${tool.label}` };
  }

  if (capability === 'tts.speak') {
    const text =
      typeof action.payload.text === 'string' && action.payload.text.trim()
        ? action.payload.text
        : decision.speech;
    try {
      const result = await playTts(text, options.voiceEnabled);
      return { ...base, status: 'done', simulated: false, result };
    } catch (err) {
      return {
        ...base,
        status: 'error',
        simulated: false,
        result: err instanceof Error ? err.message : 'Falha ao executar TTS',
      };
    }
  }

  if (capability === 'log.event') {
    return {
      ...base,
      status: 'done',
      simulated: false,
      result: `Log local: ${actionSummary(base)}`,
    };
  }

  if (capability === 'obs.switch_scene') {
    const requestedScene = String(base.payload?.scene || '').trim();
    if (!requestedScene) {
      return { ...base, status: 'blocked', result: 'Cena OBS ausente no payload da acao' };
    }

    const whitelist = await getObsSceneWhitelist();
    if (whitelist.error) {
      return {
        ...base,
        status: 'blocked',
        result: `Whitelist OBS indisponivel: ${whitelist.error}`,
      };
    }

    const allowedScene = whitelist.scenes.find(
      (scene) => scene.toLowerCase() === requestedScene.toLowerCase(),
    );
    if (!allowedScene) {
      return {
        ...base,
        status: 'blocked',
        result: `Cena bloqueada pela whitelist OBS: ${requestedScene}`,
      };
    }
    base.payload = { ...base.payload, scene: allowedScene };
  }

  let n8nDispatchError = '';
  try {
    const n8nResult = await dispatchExternalActionToN8N(base, decision, tool);
    if (n8nResult?.ok) {
      if (n8nResult.executed && n8nResult.simulated === false) {
        const sceneDetail =
          n8nResult.currentScene || n8nResult.scene || String(base.payload?.scene || '');
        return {
          ...base,
          status: 'done',
          simulated: false,
          result: sceneDetail
            ? `Execucao real confirmada pelo n8n: ${capability} -> ${sceneDetail}`
            : n8nResult.message || `Execucao real confirmada pelo n8n: ${capability}`,
        };
      }

      return {
        ...base,
        status: 'n8n_dispatched',
        simulated: Boolean(n8nResult.simulated ?? base.simulated),
        result:
          n8nResult.message ||
          `Enviado ao n8n (${n8nResult.status_code || 'ok'}): ${actionSummary(base)}`,
      };
    }
  } catch (err) {
    n8nDispatchError = err instanceof Error ? err.message : 'Falha desconhecida no n8n';
  }

  if (base.simulated) {
    await new Promise((resolve) => window.setTimeout(resolve, 220));
    const simulatedResult = simulatedActionResult(base, capability);
    return {
      ...base,
      status: 'simulated',
      simulated: true,
      result: n8nDispatchError
        ? `${simulatedResult}; n8n nao recebeu (${n8nDispatchError})`
        : simulatedResult,
    };
  }

  return {
    ...base,
    status: 'blocked',
    result: `Adaptador real ainda nao implementado: ${capability}`,
  };
}

export async function executeActionQueue(
  actions: AutopilotAction[],
  decision: PersonaDecision,
  options: ActionExecutionOptions & {
    onAction?: (action: AutopilotAction) => void;
  },
) {
  const executed: AutopilotAction[] = [];
  for (const action of actions) {
    const running = { ...action, status: 'running' as const };
    options.onAction?.(running);
    const result = await executeAction(running, decision, options);
    options.onAction?.(result);
    executed.push(result);
  }
  return executed;
}
