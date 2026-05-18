#!/usr/bin/env node
/**
 * Odessa Agent — roda no PC onde o OBS está instalado.
 * Conecta ao OBS via WebSocket local e recebe comandos do cloud (Hostinger).
 *
 * Uso:  node agent.mjs
 *
 * Env vars (ou edite os defaults abaixo):
 *   ODESSA_CLOUD_URL        - URL do painel Hostinger
 *   ODESSA_AGENT_TOKEN      - Token compartilhado com o cloud
 *   OBS_WEBSOCKET_URL       - URL do OBS WebSocket (default: ws://localhost:4455)
 *   OBS_WEBSOCKET_PASSWORD  - Senha do OBS WebSocket (default: vazio)
 */

import OBSWebSocket from 'obs-websocket-js';

const CLOUD_URL = (process.env.ODESSA_CLOUD_URL || 'https://darkgrey-shark-457698.hostingersite.com').replace(/\/$/, '');
const TOKEN = process.env.ODESSA_AGENT_TOKEN || '+jj4LlhjinNG46KhmJxqgm0g4t4JYizSmiW12g1ZJy8=';
const OBS_URL = process.env.OBS_WEBSOCKET_URL || 'ws://localhost:4455';
const OBS_PASS = process.env.OBS_WEBSOCKET_PASSWORD || '';
const HEARTBEAT_MS = 10_000;
const COMMAND_MS = 2_000;
const OBS_RECONNECT_MS = 15_000;

const headers = { 'X-Odessa-Agent-Token': TOKEN, 'Content-Type': 'application/json' };

// ─── OBS Connection ───────────────────────────────────────────────
const obs = new OBSWebSocket();
let obsConnected = false;
let obsScenes = [];
let obsCurrentScene = null;
let obsStreaming = false;
let obsRecording = false;
let obsReconnectTimer = null;

async function connectToObs() {
  if (obsConnected) return true;
  try {
    console.log(`[obs] Conectando a ${OBS_URL}...`);
    await obs.connect(OBS_URL, OBS_PASS || undefined, { rpcVersion: 1 });
    obsConnected = true;
    console.log(`[obs] ✓ Conectado ao OBS`);
    await refreshObsState();
    return true;
  } catch (err) {
    obsConnected = false;
    console.error(`[obs] ✗ Falha ao conectar: ${err.message}`);
    scheduleObsReconnect();
    return false;
  }
}

function scheduleObsReconnect() {
  if (obsReconnectTimer) clearTimeout(obsReconnectTimer);
  obsReconnectTimer = setTimeout(() => connectToObs(), OBS_RECONNECT_MS);
}

obs.on('ConnectionClosed', () => {
  if (obsConnected) {
    obsConnected = false;
    console.log('[obs] Conexao perdida. Reconectando...');
    scheduleObsReconnect();
  }
});

obs.on('CurrentProgramSceneChanged', (ev) => {
  obsCurrentScene = ev.sceneName;
});

obs.on('StreamStateChanged', (ev) => {
  obsStreaming = ev.outputActive;
});

obs.on('RecordStateChanged', (ev) => {
  obsRecording = ev.outputActive;
});

obs.on('SceneListChanged', () => { refreshObsState(); });

async function refreshObsState() {
  try {
    const { scenes, currentProgramSceneName } = await obs.call('GetSceneList');
    obsScenes = scenes.map((s) => s.sceneName).reverse();
    obsCurrentScene = currentProgramSceneName;

    try {
      const streamStatus = await obs.call('GetStreamStatus');
      obsStreaming = streamStatus.outputActive;
    } catch { /* stream may not be available */ }

    try {
      const recStatus = await obs.call('GetRecordStatus');
      obsRecording = recStatus.outputActive;
    } catch { /* recording may not be available */ }

    console.log(`[obs] Cenas: ${obsScenes.join(', ')} | Atual: ${obsCurrentScene} | Streaming: ${obsStreaming}`);
  } catch (err) {
    console.error(`[obs] Erro ao atualizar estado: ${err.message}`);
  }
}

// ─── Cloud API ────────────────────────────────────────────────────
async function api(path, method = 'GET', body = null) {
  const opts = { method, headers: { ...headers } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${CLOUD_URL}/api/agent?action=${path}`, opts);
  return res.json();
}

async function heartbeat() {
  try {
    const result = await api('heartbeat', 'POST', {
      agentId: 'node-agent',
      host: (await import('os')).hostname(),
      version: '2.0.0',
      capabilities: ['obs', 'obs.scenes', 'obs.stream', 'obs.record', 'obs.screenshot'],
      health: {
        ok: obsConnected,
        obsConnected,
        obs: {
          ok: obsConnected,
          connected: obsConnected,
          sourceReady: obsConnected,
          screenshotReady: obsConnected,
          chatSourceReady: obsConnected,
          stageSourceReady: obsConnected,
          sceneSwitchReady: obsConnected,
          currentScene: obsCurrentScene,
          availableScenes: obsScenes,
          streaming: obsStreaming,
          recording: obsRecording,
        },
      },
    });
    console.log(`[heartbeat] cloud=${result.agentConnected} obs=${obsConnected} scene=${obsCurrentScene}`);
  } catch (err) {
    console.error(`[heartbeat] erro: ${err.message}`);
  }
}

// ─── Command Execution ────────────────────────────────────────────
async function pollCommands() {
  try {
    const data = await api('commands-next');
    if (!data.command) return;
    const cmd = data.command;
    console.log(`[cmd] ← ${cmd.type} (${cmd.id})`);
    const result = await executeCommand(cmd);
    console.log(`[cmd] → ${cmd.type}: ${result.ok ? '✓' : '✗'} ${result.error || ''}`);
    await api('events', 'POST', { commandId: cmd.id, type: cmd.type, result });
  } catch (err) {
    console.error(`[poll] erro: ${err.message}`);
  }
}

async function executeCommand(cmd) {
  if (!obsConnected) {
    // Try to connect on-demand
    const connected = await connectToObs();
    if (!connected) {
      return { ok: false, error: 'OBS nao conectado. Verifique se o OBS esta aberto.', agent: 'node' };
    }
  }

  const { type, payload } = cmd;

  try {
    // ── Scene commands ──
    if (type === 'obs.switch_scene' || type === 'obs.set_scene') {
      const sceneName = payload?.sceneName || payload?.scene;
      if (!sceneName) return { ok: false, error: 'sceneName nao informado' };
      await obs.call('SetCurrentProgramScene', { sceneName });
      obsCurrentScene = sceneName;
      return { ok: true, currentScene: sceneName };
    }

    if (type === 'obs.get_scenes' || type === 'obs.scenes') {
      await refreshObsState();
      return { ok: true, scenes: obsScenes, currentScene: obsCurrentScene };
    }

    // ── Stream / transmission commands ──
    if (type === 'obs.start_stream' || type === 'obs.transmission.start') {
      const mode = payload?.transmissionMode || 'stream';
      if (mode === 'virtual_camera') {
        await obs.call('StartVirtualCam');
        return { ok: true, virtualCamera: true, mode };
      }
      if (mode === 'none') {
        return { ok: true, note: 'transmissionMode=none, nada iniciado.', mode };
      }
      await obs.call('StartStream');
      obsStreaming = true;
      return { ok: true, streaming: true, mode };
    }

    if (type === 'obs.stop_stream' || type === 'obs.transmission.stop') {
      const mode = payload?.transmissionMode || 'stream';
      if (mode === 'virtual_camera') {
        await obs.call('StopVirtualCam');
        return { ok: true, virtualCamera: false, mode };
      }
      if (mode === 'none') {
        return { ok: true, note: 'transmissionMode=none, nada parado.', mode };
      }
      await obs.call('StopStream');
      obsStreaming = false;
      return { ok: true, streaming: false, mode };
    }

    if (type === 'obs.toggle_stream') {
      await obs.call('ToggleStream');
      const status = await obs.call('GetStreamStatus');
      obsStreaming = status.outputActive;
      return { ok: true, streaming: obsStreaming };
    }

    // ── Recording commands ──
    if (type === 'obs.start_record') {
      await obs.call('StartRecord');
      obsRecording = true;
      return { ok: true, recording: true };
    }

    if (type === 'obs.stop_record') {
      await obs.call('StopRecord');
      obsRecording = false;
      return { ok: true, recording: false };
    }

    // ── Screenshot ──
    if (type === 'obs.screenshot' || type === 'obs.get_screenshot') {
      const sourceName = payload?.sourceName || obsCurrentScene;
      const result = await obs.call('GetSourceScreenshot', {
        sourceName,
        imageFormat: payload?.format || 'png',
        imageWidth: payload?.width || 640,
        imageHeight: payload?.height || 360,
      });
      return { ok: true, imageData: result.imageData };
    }

    // ── Setup live scene (create scenes, sources, configure canvas) ──
    if (type === 'obs.setup_live_scene' || type === 'obs.setup') {
      await refreshObsState();
      const startScene = payload?.startupSceneName || 'Odessa START';
      const liveScene = payload?.liveSceneName || 'Odessa LIVE';
      const stageUrl = payload?.stageUrl || '';
      const stageSourceName = payload?.stageSourceName || 'Odessa Stage Overlay';
      const chatSourceName = payload?.chatSourceName || 'Odessa Chat OCR';
      const canvasW = payload?.canvasWidth || 1080;
      const canvasH = payload?.canvasHeight || 1920;
      const created = [];
      const warnings = [];

      // 1. Set canvas resolution (Video Settings)
      try {
        const videoSettings = await obs.call('GetVideoSettings');
        if (videoSettings.baseWidth !== canvasW || videoSettings.baseHeight !== canvasH) {
          await obs.call('SetVideoSettings', {
            baseWidth: canvasW,
            baseHeight: canvasH,
            outputWidth: canvasW,
            outputHeight: canvasH,
            fpsNumerator: videoSettings.fpsNumerator || 30,
            fpsDenominator: videoSettings.fpsDenominator || 1,
          });
          created.push(`canvas:${canvasW}x${canvasH}`);
          console.log(`[setup] Canvas configurado: ${canvasW}x${canvasH}`);
        }
      } catch (err) {
        warnings.push(`Canvas: ${err.message}`);
        console.warn(`[setup] Falha ao configurar canvas: ${err.message}`);
      }

      // 2. Create scenes if they don't exist
      if (!obsScenes.includes(startScene)) {
        try {
          await obs.call('CreateScene', { sceneName: startScene });
          created.push(`scene:${startScene}`);
          console.log(`[setup] Cena '${startScene}' criada`);
        } catch (err) { warnings.push(`Cena ${startScene}: ${err.message}`); }
      }
      if (!obsScenes.includes(liveScene)) {
        try {
          await obs.call('CreateScene', { sceneName: liveScene });
          created.push(`scene:${liveScene}`);
          console.log(`[setup] Cena '${liveScene}' criada`);
        } catch (err) { warnings.push(`Cena ${liveScene}: ${err.message}`); }
      }

      // Helper: ensure a browser source exists, is configured, and fills the canvas
      async function ensureBrowserSource(sceneName, sourceName, url, zOrder) {
        try {
          const { sceneItems } = await obs.call('GetSceneItemList', { sceneName });
          const existing = sceneItems.find((item) => item.sourceName === sourceName);

          if (existing) {
            // Update existing source settings
            await obs.call('SetInputSettings', {
              inputName: sourceName,
              inputSettings: { url, width: canvasW, height: canvasH, css: '' },
              overlay: true,
            });
            // Reset transform to fill canvas
            await obs.call('SetSceneItemTransform', {
              sceneName,
              sceneItemId: existing.sceneItemId,
              sceneItemTransform: {
                positionX: 0,
                positionY: 0,
                boundsType: 'OBS_BOUNDS_STRETCH',
                boundsWidth: canvasW,
                boundsHeight: canvasH,
                boundsAlignment: 0,
                rotation: 0,
                scaleX: 1,
                scaleY: 1,
                cropLeft: 0,
                cropRight: 0,
                cropTop: 0,
                cropBottom: 0,
              },
            });
            console.log(`[setup] Source '${sourceName}' atualizada e reposicionada`);
            return 'updated';
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
          // Position to fill canvas
          const sceneItemId = result.sceneItemId;
          await obs.call('SetSceneItemTransform', {
            sceneName,
            sceneItemId,
            sceneItemTransform: {
              positionX: 0,
              positionY: 0,
              boundsType: 'OBS_BOUNDS_STRETCH',
              boundsWidth: canvasW,
              boundsHeight: canvasH,
              boundsAlignment: 0,
              rotation: 0,
            },
          });
          console.log(`[setup] Source '${sourceName}' criada em '${sceneName}'`);
          return 'created';
        } catch (err) {
          warnings.push(`Source ${sourceName}: ${err.message}`);
          console.warn(`[setup] Falha com source '${sourceName}': ${err.message}`);
          return 'error';
        }
      }

      // 3. Setup sources in LIVE scene
      if (stageUrl) {
        const stageResult = await ensureBrowserSource(liveScene, stageSourceName, stageUrl, 0);
        if (stageResult !== 'error') created.push(`source:${stageSourceName}:${stageResult}`);

        const chatResult = await ensureBrowserSource(liveScene, chatSourceName, stageUrl, 1);
        if (chatResult !== 'error') created.push(`source:${chatSourceName}:${chatResult}`);
      }

      // 4. Also setup stage overlay in START scene
      if (stageUrl) {
        const startResult = await ensureBrowserSource(startScene, stageSourceName, stageUrl, 0);
        if (startResult !== 'error') created.push(`source:${startScene}/${stageSourceName}:${startResult}`);
      }

      await refreshObsState();
      return {
        ok: true,
        scenes: obsScenes,
        currentScene: obsCurrentScene,
        hasStartScene: obsScenes.includes(startScene),
        hasLiveScene: obsScenes.includes(liveScene),
        sourceReady: true,
        canvasResolution: `${canvasW}x${canvasH}`,
        created,
        warnings,
      };
    }

    // ── Show stage (switch to start scene) ──
    if (type === 'obs.show_stage' || type === 'obs.show_start') {
      const sceneName = payload?.startupSceneName || 'Odessa START';
      if (obsScenes.includes(sceneName)) {
        await obs.call('SetCurrentProgramScene', { sceneName });
        obsCurrentScene = sceneName;
        return { ok: true, currentScene: sceneName };
      }
      return { ok: false, error: `Cena '${sceneName}' nao encontrada no OBS.`, scenes: obsScenes };
    }

    // ── Live start (full sequence) ──
    if (type === 'live.start') {
      const results = [];

      // 1. Refresh OBS state
      await refreshObsState();
      results.push({ step: 'refresh', ok: true });

      // 2. Setup scenes & sources if prepareObs is enabled
      if (payload?.prepareObs !== false) {
        const startScene = payload?.startupSceneName || 'Odessa START';
        const liveScene = payload?.liveSceneName || 'Odessa LIVE';
        const stageUrl = payload?.stageUrl || '';
        const stageSourceName = payload?.stageSourceName || 'Odessa Stage Overlay';
        const chatSourceName = payload?.chatSourceName || 'Odessa Chat OCR';
        const canvasW = payload?.canvasWidth || 1080;
        const canvasH = payload?.canvasHeight || 1920;

        // Create scenes if missing
        if (!obsScenes.includes(startScene)) {
          try {
            await obs.call('CreateScene', { sceneName: startScene });
            results.push({ step: 'create_scene', ok: true, scene: startScene });
          } catch (err) { results.push({ step: 'create_scene', ok: false, scene: startScene, error: err.message }); }
        }
        if (!obsScenes.includes(liveScene)) {
          try {
            await obs.call('CreateScene', { sceneName: liveScene });
            results.push({ step: 'create_scene', ok: true, scene: liveScene });
          } catch (err) { results.push({ step: 'create_scene', ok: false, scene: liveScene, error: err.message }); }
        }

        // Ensure browser sources in LIVE scene
        if (stageUrl) {
          for (const srcName of [stageSourceName, chatSourceName]) {
            try {
              const { sceneItems } = await obs.call('GetSceneItemList', { sceneName: liveScene });
              const existing = sceneItems.find((item) => item.sourceName === srcName);
              if (existing) {
                await obs.call('SetInputSettings', {
                  inputName: srcName,
                  inputSettings: { url: stageUrl, width: canvasW, height: canvasH, css: '' },
                  overlay: true,
                });
              } else {
                const created = await obs.call('CreateInput', {
                  sceneName: liveScene,
                  inputName: srcName,
                  inputKind: 'browser_source',
                  inputSettings: { url: stageUrl, width: canvasW, height: canvasH, css: '', shutdown: false, restart_when_active: false },
                });
                await obs.call('SetSceneItemTransform', {
                  sceneName: liveScene,
                  sceneItemId: created.sceneItemId,
                  sceneItemTransform: { positionX: 0, positionY: 0, boundsType: 'OBS_BOUNDS_STRETCH', boundsWidth: canvasW, boundsHeight: canvasH, boundsAlignment: 0, rotation: 0 },
                });
              }
              results.push({ step: 'ensure_source', ok: true, source: srcName });
            } catch (err) { results.push({ step: 'ensure_source', ok: false, source: srcName, error: err.message }); }
          }
        }
        await refreshObsState();
      }

      // 3. Switch to start scene if configured
      if (payload?.showStage !== false) {
        const startScene = payload?.startupSceneName || 'Odessa START';
        if (obsScenes.includes(startScene)) {
          await obs.call('SetCurrentProgramScene', { sceneName: startScene });
          obsCurrentScene = startScene;
          results.push({ step: 'show_stage', ok: true, scene: startScene });
        }
      }

      // 4. Start transmission if configured
      if (payload?.startTransmission) {
        const mode = payload?.transmissionMode || 'stream';
        try {
          if (mode === 'virtual_camera') {
            await obs.call('StartVirtualCam');
            results.push({ step: 'start_transmission', ok: true, mode });
          } else if (mode !== 'none') {
            await obs.call('StartStream');
            obsStreaming = true;
            results.push({ step: 'start_transmission', ok: true, mode });
          }
        } catch (err) {
          results.push({ step: 'start_transmission', ok: false, mode, error: err.message });
        }
      }

      return { ok: true, results, currentScene: obsCurrentScene, streaming: obsStreaming };
    }

    // ── OBS configure ──
    if (type === 'obs.configure') {
      // Settings are stored in cloud — agent just acknowledges
      return { ok: true, note: 'Configuracoes recebidas.' };
    }

    // ── Health/status ──
    if (type === 'obs.health' || type === 'obs.status') {
      await refreshObsState();
      return {
        ok: obsConnected,
        connected: obsConnected,
        currentScene: obsCurrentScene,
        scenes: obsScenes,
        streaming: obsStreaming,
        recording: obsRecording,
      };
    }

    // ── Unknown command — try generic OBS call ──
    console.warn(`[cmd] Comando desconhecido: ${type}`);
    return { ok: true, note: `Comando '${type}' recebido mas sem handler especifico.`, agent: 'node' };
  } catch (err) {
    return { ok: false, error: err.message, agent: 'node', type };
  }
}

// ─── Startup ──────────────────────────────────────────────────────
console.log('');
console.log('╔══════════════════════════════════════╗');
console.log('║       Odessa Agent v2.0              ║');
console.log('╠══════════════════════════════════════╣');
console.log(`║  Cloud:  ${CLOUD_URL.slice(0, 28).padEnd(28)}║`);
console.log(`║  OBS:    ${OBS_URL.padEnd(28)}║`);
console.log('╚══════════════════════════════════════╝');
console.log('');

// Connect to OBS first, then start cloud loops
connectToObs().then(() => {
  setInterval(heartbeat, HEARTBEAT_MS);
  setInterval(pollCommands, COMMAND_MS);
  heartbeat();
});
