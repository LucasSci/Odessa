const LABELS = {
  conectado: ['Conectado ao Odessa', 'ok'],
  conectando: ['Conectando…', 'warn'],
  desconectado: ['Odessa não encontrado', 'warn'],
  pausado: ['Pausado', 'warn'],
  erro: ['Erro', 'err'],
};

function paragraph(text, cls) {
  const p = document.createElement('p');
  if (cls) p.className = cls;
  p.textContent = text;
  return p;
}

function render(state) {
  const out = document.getElementById('out');
  out.textContent = '';
  if (!state || !state.configured) {
    out.append(
      paragraph('Extensão sem configuração.', 'err'),
      paragraph('No Odessa: Central da Live → Bridge → "Preparar extensão"; depois recarregue a extensão em edge://extensions.'),
    );
    return;
  }
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

chrome.runtime.sendMessage({ type: 'odessa_popup_status' }, render);
