const LABELS = {
  conectado: ['Conectado ao Odessa', 'ok'],
  conectando: ['Conectando…', 'warn'],
  desconectado: ['Odessa não encontrado', 'warn'],
  pausado: ['Pausado', 'warn'],
  erro: ['Erro', 'err'],
};

function isTango(url) {
  try {
    const host = new URL(url).hostname;
    return host === 'tango.me' || host.endsWith('.tango.me');
  } catch (_) {
    return false;
  }
}

function paragraph(text, cls) {
  const p = document.createElement('p');
  if (cls) p.className = cls;
  p.textContent = text;
  return p;
}

function button(label, cls, onClick) {
  const b = document.createElement('button');
  b.className = cls;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

async function refresh() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.runtime.sendMessage({ type: 'odessa_popup_status' }, (state) => render(state, active));
}

/**
 * Captura da aba (chrome.tabCapture): continua com a janela minimizada.
 * O navegador exige que ela comece por um clique na extensão — por isso o botão.
 */
async function startCapture(tab, feedback) {
  feedback.textContent = 'Iniciando a captura…';
  try {
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
    const res = await chrome.runtime.sendMessage({ type: 'odessa_start_tab_capture', tabId: tab.id, streamId });
    if (res && res.ok === false) throw new Error(res.error);
    setTimeout(refresh, 600);
  } catch (err) {
    feedback.className = 'err';
    feedback.textContent = `Não foi possível capturar: ${err && err.message ? err.message : err}`;
  }
}

async function stopCapture(tab) {
  await chrome.runtime.sendMessage({ type: 'odessa_stop_tab_capture', tabId: tab.id });
  setTimeout(refresh, 400);
}

function renderCapture(out, state, active) {
  if (!active || !isTango(active.url || '')) return;
  const box = document.createElement('div');
  box.className = 'tab';
  const feedback = paragraph('');
  if ((state.capturing || []).includes(active.id)) {
    box.append(
      paragraph('Transmitindo esta aba para o Odessa', 'ok'),
      paragraph('Continua mesmo com a janela minimizada.'),
      button('Parar transmissão', 'secondary', () => void stopCapture(active)),
    );
  } else {
    box.append(
      paragraph('Vídeo da aba no painel Ao Vivo', 'warn'),
      paragraph('Para capturar também com a janela minimizada ou em segundo plano:'),
      button('Transmitir esta aba', 'primary', () => void startCapture(active, feedback)),
      feedback,
    );
  }
  out.append(box);
}

function render(state, active) {
  const out = document.getElementById('out');
  out.textContent = '';
  if (!state || !state.configured) {
    out.append(
      paragraph('Extensão sem configuração.', 'err'),
      paragraph('No Odessa: Central da Live → Bridge → "Preparar extensão"; depois recarregue a extensão em edge://extensions.'),
    );
    return;
  }
  renderCapture(out, state, active);
  if (!state.tabs.length) {
    out.append(
      paragraph('Nenhuma aba do Tango com o chat aberto.', 'warn'),
      paragraph('Abra a sua live em tango.me neste navegador.'),
    );
    return;
  }
  for (const tab of state.tabs) {
    const [label, cls] = LABELS[tab.status] || [tab.status, 'warn'];
    const box = document.createElement('div');
    box.className = 'tab';
    box.append(paragraph(label, cls));
    if (tab.detail) box.append(paragraph(tab.detail));
    const url = document.createElement('small');
    url.textContent = tab.url;
    box.append(url);
    out.append(box);
  }
}

void refresh();
