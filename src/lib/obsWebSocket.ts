import OBSWebSocket from 'obs-websocket-js';

export type ObsConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export type ObsDirectStatus = {
  state: ObsConnectionState;
  error: string | null;
  scenes: string[];
  currentScene: string | null;
};

type Listener = (status: ObsDirectStatus) => void;

const obs = new OBSWebSocket();
let state: ObsDirectStatus = {
  state: 'disconnected',
  error: null,
  scenes: [],
  currentScene: null,
};
const listeners = new Set<Listener>();
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let connectedUrl = '';

function notify() {
  for (const fn of listeners) {
    try { fn({ ...state }); } catch {}
  }
}

function setState(patch: Partial<ObsDirectStatus>) {
  Object.assign(state, patch);
  notify();
}

export function onObsStatus(fn: Listener): () => void {
  listeners.add(fn);
  fn({ ...state });
  return () => { listeners.delete(fn); };
}

export function getObsStatus(): ObsDirectStatus {
  return { ...state };
}

export async function connectObs(url: string, password?: string): Promise<boolean> {
  if (state.state === 'connected' && connectedUrl === url) return true;
  disconnectObs();
  setState({ state: 'connecting', error: null });
  try {
    await obs.connect(url, password || undefined, { rpcVersion: 1 });
    connectedUrl = url;
    setState({ state: 'connected', error: null });
    await refreshScenes();
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setState({ state: 'error', error: msg });
    scheduleReconnect(url, password);
    return false;
  }
}

export function disconnectObs() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  try { obs.disconnect(); } catch {}
  connectedUrl = '';
  setState({ state: 'disconnected', error: null, scenes: [], currentScene: null });
}

function scheduleReconnect(url: string, password?: string) {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => { connectObs(url, password); }, 10_000);
}

obs.on('ConnectionClosed', () => {
  if (state.state === 'connected') {
    setState({ state: 'disconnected', error: 'Conexao com OBS perdida.' });
    if (connectedUrl) scheduleReconnect(connectedUrl);
  }
});

obs.on('CurrentProgramSceneChanged', (ev) => {
  setState({ currentScene: ev.sceneName });
});

obs.on('SceneListChanged', () => { refreshScenes(); });

async function refreshScenes() {
  try {
    const { scenes, currentProgramSceneName } = await obs.call('GetSceneList');
    setState({
      scenes: (scenes as Array<{ sceneName: string }>).map((s) => s.sceneName).reverse(),
      currentScene: currentProgramSceneName,
    });
  } catch {}
}

// --- Public commands ---

export async function obsSwitchScene(sceneName: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await obs.call('SetCurrentProgramScene', { sceneName });
    setState({ currentScene: sceneName });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function obsGetScenes(): Promise<string[]> {
  if (state.state !== 'connected') return state.scenes;
  await refreshScenes();
  return state.scenes;
}

export async function obsStartStream(): Promise<{ ok: boolean; error?: string }> {
  try {
    await obs.call('StartStream');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function obsStopStream(): Promise<{ ok: boolean; error?: string }> {
  try {
    await obs.call('StopStream');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function obsGetSourceScreenshot(
  sourceName: string,
  format = 'png',
  width?: number,
  height?: number,
): Promise<{ ok: boolean; imageData?: string; error?: string }> {
  try {
    const result = await obs.call('GetSourceScreenshot', {
      sourceName,
      imageFormat: format,
      imageWidth: width || 640,
      imageHeight: height || 360,
    });
    return { ok: true, imageData: result.imageData };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function isObsDirectAvailable(): boolean {
  return state.state === 'connected';
}
