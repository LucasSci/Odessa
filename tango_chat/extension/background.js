/**
 * Service worker da extensão do Odessa.
 *
 * Cada aba do Tango com o chat aberto (content.js) abre uma porta aqui; para
 * cada porta este worker mantém um WebSocket com o backend do Odessa
 * (ws://127.0.0.1:<porta>/tango-bridge/extension). A aba não fala direto com o
 * localhost porque a página do Tango é https e bloquearia o ws:// (conteúdo misto).
 *
 * config.js é gerado pelo Odessa ao preparar a pasta da extensão
 * (endereço do backend + token de pareamento). Nunca vai para o repositório.
 */
try {
  importScripts('config.js');
} catch (_) {
  /* pasta sem config.js: o popup avisa para prepará-la pelo Odessa */
}
const CFG = self.ODESSA_CONFIG || {};
const RETRY_MS = 3000;
const RETRY_SLOW_MS = 15000;
const PING_MS = 20000; // tráfego no WebSocket mantém o service worker vivo durante a live
const CAPTURE_MS = 550; // captureVisibleTab aceita no máximo 2 capturas por segundo
const CAPTURE_MAX_WIDTH = 1280;

/** tabId -> { port, url, ws, timer, ping, closed, status, detail } */
const tabs = new Map();

function browserName() {
  const brands = (navigator.userAgentData && navigator.userAgentData.brands) || [];
  const names = brands.map((b) => b.brand);
  if (names.includes('Microsoft Edge')) return 'Microsoft Edge';
  if (names.includes('Opera')) return 'Opera';
  if (names.includes('Brave')) return 'Brave';
  if (names.includes('Vivaldi')) return 'Vivaldi';
  if (names.includes('Google Chrome')) return 'Google Chrome';
  if (names.includes('Chromium')) return 'Chromium';
  return 'Navegador';
}

function setStatus(tabId, entry, status, detail) {
  entry.status = status;
  entry.detail = detail || '';
  const badge = status === 'conectado' ? 'ON' : status === 'erro' ? '!' : '';
  chrome.action.setBadgeText({ tabId, text: badge }).catch(() => {});
  if (badge) {
    chrome.action
      .setBadgeBackgroundColor({ tabId, color: status === 'conectado' ? '#16a34a' : '#dc2626' })
      .catch(() => {});
  }
  try {
    entry.port.postMessage({ type: 'odessa_status', status, detail: entry.detail });
  } catch (_) {
    /* aba fechando */
  }
}

function scheduleReconnect(tabId, entry, delay) {
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => openSocket(tabId, entry), delay);
}

function openSocket(tabId, entry) {
  if (entry.closed) return;
  clearTimeout(entry.timer);
  if (entry.ws && entry.ws.readyState <= WebSocket.OPEN) return; // já conectando/conectado
  if (!CFG.wsUrl || !CFG.pairToken) {
    setStatus(tabId, entry, 'erro', 'Extensão sem configuração. No Odessa, clique em "Preparar extensão" e recarregue-a.');
    return;
  }
  let ws;
  try {
    ws = new WebSocket(CFG.wsUrl);
  } catch (err) {
    setStatus(tabId, entry, 'erro', String(err));
    scheduleReconnect(tabId, entry, RETRY_SLOW_MS);
    return;
  }
  entry.ws = ws;
  if (entry.status !== 'erro') setStatus(tabId, entry, 'conectando');

  ws.onopen = () => {
    ws.send(
      JSON.stringify({
        type: 'hello',
        pairToken: CFG.pairToken,
        url: entry.url,
        browser: browserName(),
        version: chrome.runtime.getManifest().version,
      }),
    );
    // O content script manda o tamanho da aba antes do WebSocket abrir: reenvia.
    if (entry.page) ws.send(JSON.stringify(entry.page));
    clearInterval(entry.ping);
    entry.ping = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send('{"type":"ping"}');
    }, PING_MS);
  };

  ws.onmessage = (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch (_) {
      return;
    }
    if (data.type === 'pong') return;
    if (data.type === 'screencast') {
      setScreencast(tabId, entry, Boolean(data.on));
      return;
    }
    if (data.type === 'navigate') {
      // A bridge já validou (só tango.me); confere de novo antes de mexer na aba.
      try {
        const host = new URL(data.url).hostname;
        if (host === 'tango.me' || host.endsWith('.tango.me')) chrome.tabs.update(tabId, { url: data.url }).catch(() => {});
      } catch (_) {
        /* URL inválida */
      }
      return;
    }
    if (data.type === 'config') setStatus(tabId, entry, 'conectado');
    if (data.type === 'error') setStatus(tabId, entry, 'erro', data.error);
    try {
      entry.port.postMessage(data);
    } catch (_) {
      /* aba fechando */
    }
  };

  ws.onclose = (event) => {
    clearInterval(entry.ping);
    setScreencast(tabId, entry, false);
    if (entry.ws === ws) entry.ws = null;
    if (entry.closed) return;
    if (event.code === 4000) {
      setStatus(tabId, entry, 'pausado', 'Outra aba do Tango assumiu o chat. Clique nesta aba para voltar a usá-la.');
      return;
    }
    if (event.code === 4001) {
      setStatus(tabId, entry, 'erro', 'Token de pareamento recusado. No Odessa, prepare a extensão de novo e recarregue-a.');
      return;
    }
    if (event.code === 4002) {
      setStatus(tabId, entry, 'pausado', event.reason || 'A bridge está parada no Odessa.');
      scheduleReconnect(tabId, entry, RETRY_SLOW_MS);
      return;
    }
    if (entry.status === 'erro') {
      scheduleReconnect(tabId, entry, RETRY_SLOW_MS);
      return;
    }
    setStatus(tabId, entry, 'desconectado', 'Odessa fechado ou reiniciando; tentando de novo…');
    scheduleReconnect(tabId, entry, RETRY_MS);
  };
}

// ── Vídeo da aba: só enquanto o painel Ao Vivo do Odessa está assistindo ──

function setScreencast(tabId, entry, on) {
  clearInterval(entry.capture);
  entry.capture = null;
  entry.captureWarning = '';
  if (on) entry.capture = setInterval(() => void captureFrame(tabId, entry), CAPTURE_MS);
}

function captureWarning(entry, text) {
  if (entry.captureWarning === text) return;
  entry.captureWarning = text;
  if (entry.ws && entry.ws.readyState === WebSocket.OPEN) entry.ws.send(JSON.stringify({ type: 'capture_error', error: text }));
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function shrink(dataUrl) {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const scale = Math.min(1, CAPTURE_MAX_WIDTH / bitmap.width);
  if (scale === 1) {
    bitmap.close();
    return dataUrl;
  }
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return blobToDataUrl(await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.6 }));
}

async function captureFrame(tabId, entry) {
  if (entry.capturing || !entry.ws || entry.ws.readyState !== WebSocket.OPEN) return;
  entry.capturing = true;
  try {
    const tab = await chrome.tabs.get(tabId);
    const win = await chrome.windows.get(tab.windowId);
    if (!tab.active || win.state === 'minimized') {
      captureWarning(entry, 'A aba do Tango não está visível: deixe-a como aba ativa numa janela não minimizada para o vídeo aparecer no Odessa.');
      return;
    }
    const shot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 60 });
    const data = await shrink(shot);
    entry.captureWarning = '';
    if (entry.ws && entry.ws.readyState === WebSocket.OPEN) {
      const vp = entry.viewport || {};
      entry.ws.send(JSON.stringify({ type: 'frame', data, w: vp.w, h: vp.h }));
    }
  } catch (err) {
    captureWarning(entry, `Falha ao capturar a aba: ${err && err.message ? err.message : err}`);
  } finally {
    entry.capturing = false;
  }
}

function closeEntry(entry) {
  entry.closed = true;
  clearInterval(entry.capture);
  clearTimeout(entry.timer);
  clearInterval(entry.ping);
  if (entry.ws) {
    try {
      entry.ws.close(1000);
    } catch (_) {
      /* já fechado */
    }
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'odessa-chat' || !port.sender || !port.sender.tab) return;
  const tabId = port.sender.tab.id;
  const previous = tabs.get(tabId);
  if (previous) closeEntry(previous);
  const entry = { port, url: port.sender.url || '', ws: null, timer: null, ping: null, closed: false, status: 'conectando', detail: '' };
  tabs.set(tabId, entry);

  port.onMessage.addListener((msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'page') {
      entry.url = msg.url || entry.url;
      if (msg.w && msg.h) entry.viewport = { w: msg.w, h: msg.h };
      entry.page = msg;
    }
    if (msg.type === 'resume') {
      // Usuário voltou para esta aba depois que outra assumiu (4000): retoma.
      if (entry.status === 'pausado' && !entry.ws) openSocket(tabId, entry);
      return;
    }
    if (entry.ws && entry.ws.readyState === WebSocket.OPEN) entry.ws.send(JSON.stringify(msg));
  });
  port.onDisconnect.addListener(() => {
    closeEntry(entry);
    if (tabs.get(tabId) === entry) tabs.delete(tabId);
    chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
  });
  openSocket(tabId, entry);
});

// Popup: estado de cada aba conectada.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'odessa_popup_status') {
    sendResponse({
      configured: Boolean(CFG.wsUrl && CFG.pairToken),
      preparedAt: CFG.preparedAt || null,
      tabs: [...tabs.entries()].map(([tabId, e]) => ({ tabId, url: e.url, status: e.status, detail: e.detail })),
    });
  }
});
