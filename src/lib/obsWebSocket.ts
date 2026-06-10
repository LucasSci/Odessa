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
  let canvasW = settings.canvasWidth || 1080;
  let canvasH = settings.canvasHeight || 1920;
  // Tango Live é vertical (9:16). Se vier paisagem/quadrado por engano, força 9:16.
  if (canvasW >= canvasH) { canvasW = 1080; canvasH = 1920; }
  let outputFps = 30; // sobrescrito pelo FPS real do OBS (GetVideoSettings) abaixo
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

    // Define a tela do OBS no formato VERTICAL do Tango Live (9:16) pra o overlay
    // preencher o quadro todo. Só altera quando ainda não está nesse tamanho
    // (idempotente — não reseta à toa). A trava acima garante que isto nunca roda
    // durante uma transmissão ativa.
    try {
      const vs = await obs.call('GetVideoSettings');
      // FPS de saída do OBS — a fonte de navegador será pinada nele pra renderizar
      // exatamente no ritmo da transmissão (sem descasar e gerar microtravadas).
      outputFps = Math.max(1, Math.round((vs.fpsNumerator || 30) / (vs.fpsDenominator || 1)));
      const needsResize =
        vs.baseWidth !== canvasW || vs.baseHeight !== canvasH ||
        vs.outputWidth !== canvasW || vs.outputHeight !== canvasH;
      if (needsResize) {
        await obs.call('SetVideoSettings', {
          baseWidth: canvasW,
          baseHeight: canvasH,
          outputWidth: canvasW,
          outputHeight: canvasH,
        });
        created.push(`canvas:${canvasW}x${canvasH}`);
      }
    } catch (err) {
      warnings.push(`Resolução 9:16: ${err instanceof Error ? err.message : String(err)}`);
    }

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
            await ensureBrowserSource(sceneName, srcName, stageUrl, canvasW, canvasH, outputFps);
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
  fps: number,
) {
  // Configuração ótima da fonte de navegador pra live limpa:
  // - fps_custom + fps = FPS de saída → renderiza no ritmo exato da transmissão;
  // - shutdown:false → NÃO desliga a fonte fora de cena (senão o overlay recarrega
  //   e perde os vídeos pré-carregados da memória, voltando a travar);
  // - restart_when_active:false → não reinicia o Chromium ao ativar a cena.
  const desiredSettings = {
    url,
    width: canvasW,
    height: canvasH,
    css: '',
    fps_custom: true,
    fps,
    shutdown: false,
    restart_when_active: false,
  };

  const { sceneItems } = await obs.call('GetSceneItemList', { sceneName });
  const existing = (sceneItems as Array<{ sourceName: string; sceneItemId: number }>)
    .find((item) => item.sourceName === sourceName);

  if (existing) {
    // SetInputSettings recria o processo Chromium (pico de CPU + recarrega o
    // overlay). Então só reaplica se algo RELEVANTE divergir do desejado —
    // assim "Preparar OBS" rodado de novo não derruba a fonte à toa.
    let needsUpdate = true;
    try {
      const cur = (await obs.call('GetInputSettings', { inputName: sourceName }))
        .inputSettings as Record<string, unknown>;
      // OBS omite configs que estão no padrão (shutdown/restart = false por padrão),
      // então `?? false` evita recarregar a fonte achando que divergiu.
      needsUpdate =
        cur.url !== url ||
        (cur.fps_custom ?? false) !== true ||
        Number(cur.fps) !== fps ||
        (cur.shutdown ?? false) !== false ||
        (cur.restart_when_active ?? false) !== false;
    } catch { /* can't read settings, update anyway */ }

    if (needsUpdate) {
      await obs.call('SetInputSettings', {
        inputName: sourceName,
        inputSettings: desiredSettings,
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
    inputSettings: desiredSettings,
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
