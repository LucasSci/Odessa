import { apiUrl } from '../lib/api';
import { loadChatAutomationTarget } from '../lib/chatAutomation';
import { loadTtsSettings } from '../lib/ttsSettings';
import type { AutopilotAction, PersonaDecision, PersonaTool } from '../types';
import { capabilityForAction, findTool } from './toolRegistry';

export interface ActionExecutionOptions {
  tools: PersonaTool[];
  voiceEnabled: boolean;
}

let ttsPlaybackLock: Promise<void> = Promise.resolve();

interface WebhookDispatchResult {
  ok?: boolean;
  status?: string;
  webhookId?: string;
  statusCode?: number;
  error?: string;
  response?: unknown;
}

interface ObsSwitchSceneResult {
  ok?: boolean;
  status?: string;
  scene?: string;
  sceneName?: string;
  currentScene?: string;
  error?: string;
}

interface ChatAutomationSendResult {
  status?: string;
  allowed?: boolean;
  reason?: string;
  text?: string;
  wouldSend?: boolean;
}

export function actionSummary(action: AutopilotAction) {
  const payload = action.payload || {};
  const detail =
    typeof payload.text === 'string'
      ? payload.text
      : typeof payload.message === 'string'
        ? payload.message
        : typeof payload.sceneName === 'string'
          ? payload.sceneName
          : typeof payload.scene === 'string'
            ? payload.scene
            : typeof payload.requestedScene === 'string'
              ? payload.requestedScene
              : typeof payload.webhookId === 'string'
                ? payload.webhookId
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
    return `OBS simulado: trocar cena para ${String(payload.sceneName || payload.scene || payload.requestedScene || actionSummary(action))}`;
  }
  if (capability === 'webhook.call') {
    return `Webhook simulado: ${String(payload.webhookId || actionSummary(action))}`;
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

async function dispatchWebhookAction(
  action: AutopilotAction,
  decision: PersonaDecision,
): Promise<WebhookDispatchResult> {
  const webhookId = String(action.payload?.webhookId || '').trim();
  if (!webhookId) {
    return { ok: false, status: 'blocked', error: 'webhook_id_missing' };
  }

  const response = await fetch(apiUrl('/webhooks/dispatch'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      webhookId,
      action,
      payload: action.payload,
      event: {
        kind: decision.intent,
        text: decision.speech,
        confidence: decision.confidence,
        priority: decision.priority,
        reason: decision.reason,
      },
    }),
  });

  const data = (await response.json().catch(() => ({}))) as WebhookDispatchResult;
  if (!response.ok) {
    throw new Error(data.error || `Falha ao chamar webhook: HTTP ${response.status}`);
  }
  return data;
}

async function dispatchChatReplyAction(action: AutopilotAction): Promise<ChatAutomationSendResult> {
  const text = String(action.payload?.message || action.payload?.text || '').trim();
  const savedTarget = loadChatAutomationTarget();
  const targetMode = action.payload?.targetMode === 'visual' || savedTarget.mode === 'visual' ? 'visual' : 'selector';
  const targetUrl = String(action.payload?.targetUrl || action.payload?.url || savedTarget.url).trim();
  const inputSelector = String(action.payload?.inputSelector || savedTarget.inputSelector).trim();
  const inputPoint = action.payload?.inputPoint || savedTarget.inputPoint;
  const sendPoint = action.payload?.sendPoint || savedTarget.sendPoint;
  const viewport = action.payload?.viewport || savedTarget.viewport;
  if (!text) return { status: 'blocked', allowed: false, reason: 'empty_text' };
  if (targetMode === 'visual') {
    const point = inputPoint as { x?: unknown; y?: unknown } | undefined;
    if (typeof point?.x !== 'number' || typeof point?.y !== 'number') {
      return { status: 'blocked', allowed: false, reason: 'input_point_missing' };
    }
  } else if (!targetUrl) {
    return { status: 'blocked', allowed: false, reason: 'target_url_missing' };
  }

  const response = await fetch(apiUrl('/chat-automation/send'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: targetMode,
      url: targetUrl,
      text,
      inputSelector: inputSelector || undefined,
      inputPoint,
      sendPoint,
      viewport,
      dryRun: action.payload?.dryRun !== false,
    }),
  });
  const data = (await response.json().catch(() => ({}))) as ChatAutomationSendResult;
  if (!response.ok) {
    throw new Error(data.reason || `HTTP ${response.status}`);
  }
  return data;
}

async function getObsSceneReadiness() {
  const response = await fetch(apiUrl('/obs/scenes'));
  const data = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    scenes?: string[];
    allowedScenes?: string[];
    error?: string;
  };
  if (!response.ok || !data.ok) {
    return {
      allowedScenes: [],
      availableScenes: [],
      error: data.error || `Nao foi possivel consultar cenas do OBS: HTTP ${response.status}`,
    };
  }
  const availableScenes = Array.isArray(data.scenes) ? data.scenes : [];
  const allowedScenes = Array.isArray(data.allowedScenes) ? data.allowedScenes : [];
  const sceneSwitchReady = allowedScenes.some((allowed) =>
    availableScenes.some((scene) => scene.toLowerCase() === allowed.toLowerCase()),
  );
  return {
    allowedScenes,
    availableScenes,
    error: sceneSwitchReady
      ? ''
      : 'Troca de cena ainda nao esta pronta; sincronize e permita cenas nas configuracoes.',
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

  if (capability === 'media.play_video') {
    const requestedVideo = String(base.payload?.videoId || base.payload?.video || '').trim();
    if (!requestedVideo) {
      return { ...base, status: 'blocked', result: 'Video ausente no payload da acao' };
    }

    try {
      const response = await fetch(apiUrl('/api/video/force'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId: requestedVideo, state: 'ACTION' }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || `HTTP ${response.status}`);
      return {
        ...base,
        status: 'done',
        simulated: false,
        result: `Video acionado: ${requestedVideo}`,
      };
    } catch (err) {
      return {
        ...base,
        status: 'error',
        simulated: false,
        result: err instanceof Error ? err.message : 'Falha ao acionar video',
      };
    }
  }

  if (capability === 'obs.switch_scene') {
    const requestedScene = String(
      base.payload?.sceneName || base.payload?.scene || base.payload?.requestedScene || '',
    ).trim();
    if (!requestedScene) {
      return { ...base, status: 'blocked', result: 'Cena OBS ausente no payload da acao' };
    }

    const readiness = await getObsSceneReadiness();
    if (readiness.error) {
      return {
        ...base,
        status: 'blocked',
        result: readiness.error,
      };
    }

    const allowedScene = readiness.allowedScenes.find(
      (scene) => scene.toLowerCase() === requestedScene.toLowerCase(),
    );
    if (!allowedScene) {
      return {
        ...base,
        status: 'blocked',
        result: `Cena bloqueada nas configuracoes OBS: ${requestedScene}`,
      };
    }
    base.payload = { ...base.payload, scene: allowedScene, sceneName: allowedScene };

    try {
      const response = await fetch(apiUrl('/obs/switch-scene'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sceneName: allowedScene }),
      });
      const data = (await response.json().catch(() => ({}))) as ObsSwitchSceneResult;
      if (!response.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      const sceneDetail = data.currentScene || data.sceneName || data.scene || allowedScene;
      return {
        ...base,
        status: 'done',
        simulated: false,
        result: `OBS WebSocket: cena alterada para ${sceneDetail}`,
      };
    } catch (err) {
      return {
        ...base,
        status: 'error',
        simulated: false,
        result: err instanceof Error ? err.message : 'Falha ao trocar cena no OBS',
      };
    }
  }

  if (capability === 'webhook.call') {
    try {
      const webhookResult = await dispatchWebhookAction(base, decision);
      if (!webhookResult.ok) {
        return {
          ...base,
          status: webhookResult.status === 'blocked' ? 'blocked' : 'error',
          simulated: false,
          result: webhookResult.error || 'Webhook nao foi executado',
        };
      }
      return {
        ...base,
        status: 'done',
        simulated: false,
        result:
          webhookResult.statusCode
            ? `Webhook executado (${webhookResult.statusCode}): ${String(base.payload?.webhookId)}`
            : `Webhook executado: ${String(base.payload?.webhookId)}`,
      };
    } catch (err) {
      return {
        ...base,
        status: 'error',
        simulated: false,
        result: err instanceof Error ? err.message : 'Falha ao chamar webhook',
      };
    }
  }

  if (capability === 'chat.reply' && !base.simulated) {
    try {
      const chatResult = await dispatchChatReplyAction(base);
      if (!chatResult.allowed) {
        return {
          ...base,
          status: 'blocked',
          simulated: false,
          result:
            chatResult.reason === 'target_url_missing'
              ? 'Resposta no chat bloqueada: configure targetUrl/inputSelector para envio real.'
              : `Resposta no chat bloqueada: ${chatResult.reason || chatResult.status || 'nao permitido'}`,
        };
      }
      return {
        ...base,
        status: chatResult.status === 'ready' ? 'done' : 'simulated',
        simulated: chatResult.status !== 'ready',
        result:
          chatResult.status === 'ready'
            ? 'Resposta enviada para a automacao de chat.'
            : `Resposta validada em dry-run: ${chatResult.text || actionSummary(base)}`,
      };
    } catch (err) {
      return {
        ...base,
        status: 'error',
        simulated: false,
        result: err instanceof Error ? err.message : 'Falha ao enviar resposta no chat',
      };
    }
  }

  if (base.simulated) {
    await new Promise((resolve) => window.setTimeout(resolve, 220));
    const simulatedResult = simulatedActionResult(base, capability);
    return {
      ...base,
      status: 'simulated',
      simulated: true,
      result: simulatedResult,
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
