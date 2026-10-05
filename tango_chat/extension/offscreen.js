/**
 * Documento offscreen: segura o stream do chrome.tabCapture da aba do Tango.
 *
 * Diferente do captureVisibleTab, a captura de aba continua recebendo imagem
 * com a janela minimizada ou a aba em segundo plano — o navegador mantém a
 * aba capturada renderizando. Só vídeo: o áudio da live não é desviado.
 *
 * Mensagens (background → aqui): offscreen_start {tabId, streamId},
 * offscreen_stop {tabId}, offscreen_emit {tabId, on}.
 * Daqui → background: offscreen_frame {tabId, data, w, h}, offscreen_ended {tabId, error?}.
 */
const INTERVAL_MS = 500;
const MAX_WIDTH = 1280;

/** tabId -> { stream, video, canvas, timer, emit } */
const captures = new Map();

function stop(tabId, error) {
  const cap = captures.get(tabId);
  if (!cap) return;
  captures.delete(tabId);
  clearInterval(cap.timer);
  cap.stream.getTracks().forEach((track) => track.stop());
  cap.video.remove();
  chrome.runtime.sendMessage({ type: 'offscreen_ended', tabId, error: error || null }).catch(() => {});
}

function grab(tabId) {
  const cap = captures.get(tabId);
  if (!cap || !cap.emit) return;
  const { video, canvas } = cap;
  if (!video.videoWidth || !video.videoHeight) return;
  const scale = Math.min(1, MAX_WIDTH / video.videoWidth);
  const w = Math.round(video.videoWidth * scale);
  const h = Math.round(video.videoHeight * scale);
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  canvas.getContext('2d').drawImage(video, 0, 0, w, h);
  chrome.runtime
    .sendMessage({ type: 'offscreen_frame', tabId, data: canvas.toDataURL('image/jpeg', 0.6), w, h })
    .catch(() => {});
}

async function start(tabId, streamId, emit) {
  stop(tabId);
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId, maxWidth: 1920, maxHeight: 1080 } },
    });
  } catch (err) {
    chrome.runtime
      .sendMessage({ type: 'offscreen_ended', tabId, error: `Não foi possível capturar a aba: ${err && err.message ? err.message : err}` })
      .catch(() => {});
    return;
  }
  const video = document.createElement('video');
  video.muted = true;
  video.srcObject = stream;
  document.body.append(video);
  await video.play().catch(() => {});
  const cap = { stream, video, canvas: document.createElement('canvas'), timer: null, emit: Boolean(emit) };
  cap.timer = setInterval(() => grab(tabId), INTERVAL_MS);
  captures.set(tabId, cap);
  // Aba fechada ou captura encerrada pelo navegador ("Parar compartilhamento").
  stream.getVideoTracks()[0].addEventListener('ended', () => stop(tabId, 'A captura da aba foi encerrada.'));
  chrome.runtime.sendMessage({ type: 'offscreen_started', tabId }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'offscreen_start') void start(msg.tabId, msg.streamId, msg.emit);
  else if (msg.type === 'offscreen_stop') stop(msg.tabId);
  else if (msg.type === 'offscreen_emit') {
    const cap = captures.get(msg.tabId);
    if (cap) cap.emit = Boolean(msg.on);
  }
});
