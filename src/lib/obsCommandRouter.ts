/**
 * OBS Command Router — routes commands through direct WebSocket when
 * connected, falls back to cloud API relay (agent) otherwise.
 */

import {
  isObsDirectAvailable,
  obsSetupLiveScene,
  obsSwitchScene,
  obsStartTransmission,
  obsStopTransmission,
  obsLiveHealth,
  type ObsSetupSettings,
} from './obsWebSocket';
import { apiUrl } from './api';

export type CommandResult = {
  ok: boolean;
  route: 'direct' | 'relay';
  error?: string;
  [key: string]: unknown;
};

type ObsSettings = ObsSetupSettings & {
  transmissionMode?: string;
  websocketUrl?: string;
  websocketPassword?: string;
  allowedScenes?: string[];
  ocrSourceName?: string;
  enabled?: boolean;
};

async function relayPost(path: string, body?: Record<string, unknown>): Promise<CommandResult> {
  try {
    const response = await fetch(apiUrl(path), {
      method: 'POST',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      ok: Boolean(response.ok && data.ok !== false),
      route: 'relay',
      error: (data.error as string) || (!response.ok ? `HTTP ${response.status}` : undefined),
      ...data,
    };
  } catch (err) {
    return { ok: false, route: 'relay', error: err instanceof Error ? err.message : 'Falha de rede' };
  }
}

async function relayGet(path: string): Promise<CommandResult> {
  try {
    const response = await fetch(apiUrl(path));
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      ok: Boolean(response.ok && data.ok !== false),
      route: 'relay',
      error: (data.error as string) || (!response.ok ? `HTTP ${response.status}` : undefined),
      ...data,
    };
  } catch (err) {
    return { ok: false, route: 'relay', error: err instanceof Error ? err.message : 'Falha de rede' };
  }
}

// --- Routed commands ---

export async function routeSetupLiveScene(settings: ObsSettings | null): Promise<CommandResult> {
  if (isObsDirectAvailable() && settings) {
    try {
      const result = await obsSetupLiveScene(settings);
      return { ...result, route: 'direct' };
    } catch (err) {
      return { ok: false, route: 'direct', error: err instanceof Error ? err.message : String(err) };
    }
  }
  return relayPost('/obs/setup-live-scene', settings ? {
    stageUrl: settings.stageUrl,
    startupSceneName: settings.startupSceneName,
    liveSceneName: settings.liveSceneName,
    stageSourceName: settings.stageSourceName,
    chatSourceName: settings.chatSourceName,
    canvasWidth: settings.canvasWidth,
    canvasHeight: settings.canvasHeight,
  } : undefined);
}

export async function routeShowStart(settings: ObsSettings | null): Promise<CommandResult> {
  const sceneName = settings?.startupSceneName || 'Odessa START';
  if (isObsDirectAvailable()) {
    try {
      const result = await obsSwitchScene(sceneName);
      return { ...result, route: 'direct', currentScene: sceneName };
    } catch (err) {
      return { ok: false, route: 'direct', error: err instanceof Error ? err.message : String(err) };
    }
  }
  return relayPost('/obs/show-start', { startupSceneName: sceneName });
}

export async function routeShowStage(settings: ObsSettings | null): Promise<CommandResult> {
  const sceneName = settings?.liveSceneName || 'Odessa LIVE';
  if (isObsDirectAvailable()) {
    try {
      const result = await obsSwitchScene(sceneName);
      return { ...result, route: 'direct', currentScene: sceneName };
    } catch (err) {
      return { ok: false, route: 'direct', error: err instanceof Error ? err.message : String(err) };
    }
  }
  return relayPost('/obs/show-stage', { liveSceneName: sceneName });
}

export async function routeStartTransmission(settings: ObsSettings | null): Promise<CommandResult> {
  const mode = settings?.transmissionMode || 'stream';
  if (isObsDirectAvailable()) {
    try {
      const result = await obsStartTransmission(mode);
      return { ...result, route: 'direct', mode };
    } catch (err) {
      return { ok: false, route: 'direct', error: err instanceof Error ? err.message : String(err) };
    }
  }
  return relayPost('/obs/transmission/start', { transmissionMode: mode });
}

export async function routeStopTransmission(settings: ObsSettings | null): Promise<CommandResult> {
  const mode = settings?.transmissionMode || 'stream';
  if (isObsDirectAvailable()) {
    try {
      const result = await obsStopTransmission(mode);
      return { ...result, route: 'direct', mode };
    } catch (err) {
      return { ok: false, route: 'direct', error: err instanceof Error ? err.message : String(err) };
    }
  }
  return relayPost('/obs/transmission/stop', { transmissionMode: mode });
}

export async function routeSwitchScene(sceneName: string): Promise<CommandResult> {
  if (isObsDirectAvailable()) {
    try {
      const result = await obsSwitchScene(sceneName);
      return { ...result, route: 'direct', currentScene: sceneName };
    } catch (err) {
      return { ok: false, route: 'direct', error: err instanceof Error ? err.message : String(err) };
    }
  }
  return relayPost('/obs/switch-scene', { sceneName });
}

export async function routeLiveHealth(settings: ObsSettings | null): Promise<CommandResult> {
  if (isObsDirectAvailable()) {
    try {
      const result = await obsLiveHealth(settings || undefined);
      return { ...result, route: 'direct' };
    } catch (err) {
      return { ok: false, route: 'direct', error: err instanceof Error ? err.message : String(err) };
    }
  }
  return relayGet('/obs/live-health');
}
