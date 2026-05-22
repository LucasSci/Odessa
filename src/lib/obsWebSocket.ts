import OBSWebSocket from 'obs-websocket-js';

export type ObsConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export type ObsDirectStatus = {
  state: ObsConnectionState;
  error: string | null;
  scenes: string[];
  currentScene: string | null;
  streaming: boolean;
  recording: boolean;
};

export type ObsSetupSettings = {
  startupSceneName?: string;
  liveSceneName?: string;
  stageSourceName?: string;
  chatSourceName?: string;
  stageUrl?: string;
  canvasWidth?: number;
  canvasHeight?: number;
};

type ObsResult = { ok: boolean; error?: string };

type Listener = (status: ObsDirectStatus) => void;

const obs = new OBSWebSocket();
let state: ObsDirectStatus = {
  state: 'disconnected',
  error: null,
  scenes: [],
  currentScene: null,
  streaming: false,
  recording: false,
};
const listeners = new Set<Listener>();
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let connectedUrl = '';
let connectedPassword = '';

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
    connectedPassword = password || '';
    setState({ state: 'connected', error: null });
    await refreshFullState();
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
  connectedPassword = '';
  setState({ state: 'disconnected', error: null, scenes: [], currentScene: null, streaming: false, recording: false });
}

function scheduleReconnect(url: string, password?: string) {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => { connectObs(url, password); }, 10_000);
}

obs.on('ConnectionClosed', () => {
  if (state.state === 'connected') {
    setState({ state: 'disconnected', error: 'Conexao com OBS perdida.' });
    if (connectedUrl) scheduleReconnect(connectedUrl, connectedPassword);
  }
});

obs.on('CurrentProgramSceneChanged', (ev) => {
  setState({ currentScene: ev.sceneName });
});

obs.on('StreamStateChanged', (ev) => {
  setState({ streaming: ev.outputActive });
});

obs.on('RecordStateChanged', (ev) => {
  setState({ recording: ev.outputActive });
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

async function refreshFullState() {
  await refreshScenes();
  try {
    const streamStatus = await obs.call('GetStreamStatus');
    setState({ streaming: streamStatus.outputActive });
  } catch {}
  try {
    const recStatus = await obs.call('GetRecordStatus');
    setState({ recording: recStatus.outputActive });
  } catch {}
}

// --- Public commands ---

export async function obsSwitchScene(sceneName: string): Promise<ObsResult> {
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

export async function obsStartStream(): Promise<ObsResult> {
  try {
    await obs.call('StartStream');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function obsStopStream(): Promise<ObsResult> {
  try {
    await obs.call('StopStream');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// --- Transmission with mode support ---

export async function obsStartTransmission(mode: string = 'stream'): Promise<ObsResult> {
  try {
    if (mode === 'virtual_camera') {
      try {
        const vcStatus = await obs.call('GetVirtualCamStatus');
        if (vcStatus.outputActive) return { ok: true }; // Already active
      } catch { /* proceed to start */ }
      await obs.call('StartVirtualCam');
      return { ok: true };
    }
    if (mode === 'none') return { ok: true };
    // Check if already streaming — calling StartStream while active can cause issues
    try {
      const streamStatus = await obs.call('GetStreamStatus');
      if (streamStatus.outputActive) {
        setState({ streaming: true });
        return { ok: true }; // Already streaming, skip
      }
    } catch { /* proceed to start */ }
    await obs.call('StartStream');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function obsStopTransmission(mode: string = 'stream'): Promise<ObsResult> {
  try {
    if (mode === 'virtual_camera') {
      await obs.call('StopVirtualCam');
      return { ok: true };
    }
    if (mode === 'none') return { ok: true };
    await obs.call('StopStream');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// --- Setup live scene (port of agent.mjs obs.setup_live_scene) ---

export async function obsSetupLiveScene(settings: ObsSetupSettings): Promise<ObsResult & { created?: string[]; warnings?: string[]; skipped?: boolean }> {
  const startScene = settings.startupSceneName || 'Odessa START';
  const liveScene = settings.liveSceneName || 'Odessa LIVE';
  const stageUrl = settings.stageUrl || '';
  const stageSourceName = settings.stageSourceName || 'Odessa Stage Overlay';
  const chatSourceName = settings.chatSourceName || 'Odessa Chat OCR';
  const canvasW = settings.canvasWidth || 1080;
  const canvasH = settings.canvasHeight || 1920;
  const created: string[] = [];
  const warnings: string[] = [];

  try {
    // SAFETY: Never modify OBS settings while actively streaming — this can kill the stream
    try {
      const streamStatus = await obs.call('GetStreamStatus');
      if (streamStatus.outputActive) {
        return { ok: true, skipped: true, created: [], warnings: ['Setup ignorado: OBS esta transmitindo. Parar a transmissao antes de reconfigurar.'] };
      }
    } catch { /* not connected or error — proceed with setup */ }

    // NOTE: SetVideoSettings is intentionally NOT called here.
    // OBS canvas/output resolution is a per-profile setting managed by the user.
    // Calling SetVideoSettings would corrupt the active profile (e.g. Tango Profile)
    // every time "Iniciar Live" is triggered.

    // 2. Get current scenes
    await refreshScenes();
    const currentScenes = state.scenes;

    // 3. Create scenes if missing
    if (!currentScenes.includes(startScene)) {
      try {
        await obs.call('CreateScene', { sceneName: startScene });
        created.push(`scene:${startScene}`);
      } catch (err) { warnings.push(`Cena ${startScene}: ${err instanceof Error ? err.message : String(err)}`); }
    }
    if (!currentScenes.includes(liveScene)) {
      try {
        await obs.call('CreateScene', { sceneName: liveScene });
        created.push(`scene:${liveScene}`);
      } catch (err) { warnings.push(`Cena ${liveScene}: ${err instanceof Error ? err.message : String(err)}`); }
    }

    // 4. Ensure browser sources in scenes
    if (stageUrl) {
      for (const [sceneName, sources] of [
        [liveScene, [stageSourceName, chatSourceName]] as const,
        [startScene, [stageSourceName]] as const,
      ]) {
        for (const srcName of sources) {
          try {
            await ensureBrowserSource(sceneName, srcName, stageUrl, canvasW, canvasH);
            created.push(`source:${sceneName}/${srcName}`);
          } catch (err) {
            warnings.push(`Source ${srcName}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
    }

    await refreshScenes();
    return { ok: true, created, warnings };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), created, warnings };
  }
}

async function ensureBrowserSource(
  sceneName: string,
  sourceName: string,
  url: string,
  canvasW: number,
  canvasH: number,
) {
  const { sceneItems } = await obs.call('GetSceneItemList', { sceneName });
  const existing = (sceneItems as Array<{ sourceName: string; sceneItemId: number }>)
    .find((item) => item.sourceName === sourceName);

  if (existing) {
    // Only update settings if the URL actually changed — SetInputSettings reloads
    // the browser source (spins up new Chromium process), causing CPU spikes and
    // potential stream disruption.
    let needsUpdate = true;
    try {
      const currentSettings = await obs.call('GetInputSettings', { inputName: sourceName });
      const currentUrl = (currentSettings.inputSettings as Record<string, unknown>)?.url;
      if (currentUrl === url) needsUpdate = false;
    } catch { /* can't read settings, update anyway */ }

    if (needsUpdate) {
      await obs.call('SetInputSettings', {
        inputName: sourceName,
        inputSettings: { url, width: canvasW, height: canvasH, css: '' },
        overlay: true,
      });
    }
    await obs.call('SetSceneItemTransform', {
      sceneName,
      sceneItemId: existing.sceneItemId,
      sceneItemTransform: {
        positionX: 0, positionY: 0,
        boundsType: 'OBS_BOUNDS_STRETCH',
        boundsWidth: canvasW, boundsHeight: canvasH,
        boundsAlignment: 0, rotation: 0,
        scaleX: 1, scaleY: 1,
        cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0,
      },
    });
    return;
  }

  // Create new source
  const result = await obs.call('CreateInput', {
    sceneName,
    inputName: sourceName,
    inputKind: 'browser_source',
    inputSettings: {
      url,
      width: canvasW,
      height: canvasH,
      css: '',
      shutdown: false,
      restart_when_active: false,
    },
  });

  await obs.call('SetSceneItemTransform', {
    sceneName,
    sceneItemId: result.sceneItemId,
    sceneItemTransform: {
      positionX: 0, positionY: 0,
      boundsType: 'OBS_BOUNDS_STRETCH',
      boundsWidth: canvasW, boundsHeight: canvasH,
      boundsAlignment: 0, rotation: 0,
    },
  });
}

// --- Live health check ---

export async function obsLiveHealth(settings?: ObsSetupSettings): Promise<{
  ok: boolean;
  connected: boolean;
  sourceReady: boolean;
  screenshotReady: boolean;
  currentScene: string | null;
  availableScenes: string[];
  streaming: boolean;
  recording: boolean;
  error: string | null;
}> {
  if (state.state !== 'connected') {
    return {
      ok: false, connected: false, sourceReady: false, screenshotReady: false,
      currentScene: null, availableScenes: [], streaming: false, recording: false,
      error: state.error || 'OBS nao conectado',
    };
  }

  await refreshFullState();
  const liveScene = settings?.liveSceneName || 'Odessa LIVE';
  let sourceReady = false;
  try {
    const { sceneItems } = await obs.call('GetSceneItemList', { sceneName: liveScene });
    sourceReady = (sceneItems as Array<{ sourceName: string }>).length > 0;
  } catch { /* scene might not exist yet */ }

  return {
    ok: true,
    connected: true,
    sourceReady,
    screenshotReady: true,
    currentScene: state.currentScene,
    availableScenes: state.scenes,
    streaming: state.streaming,
    recording: state.recording,
    error: null,
  };
}

// --- Screenshot ---

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
