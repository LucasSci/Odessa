/**
 * Roda na aba do Tango (a mesma em que o usuário já está logado).
 * Lê o chat com o mesmo observer da bridge (chat_observer.js) e digita as
 * respostas da persona quando o Odessa pede. Fala só com o background.js.
 */
(() => {
  if (window.__odessaExtensionLoaded) return;
  window.__odessaExtensionLoaded = true;

  const CHAT_CONTAINERS = ['[data-testid="virtuoso-item-list"]', '[data-testid*="chat"] [role="list"]', '[role="log"]'];
  const INPUT_FALLBACKS = ['[data-testid="textarea"]', 'textarea', '[contenteditable="true"][role="textbox"]'];
  let port = null;
  let lastUrl = location.href;
  let observerConfig = null;
  let watchTimer = null;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const normalize = (text) => String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();

  function query(selector) {
    if (!selector) return null;
    try {
      return document.querySelector(selector);
    } catch (_) {
      return null;
    }
  }

  function chatVisible() {
    return [observerConfig && observerConfig.containerSelector, ...CHAT_CONTAINERS].some((s) => query(s));
  }

  function post(msg) {
    if (!port) return;
    try {
      port.postMessage(msg);
    } catch (_) {
      port = null;
    }
  }

  function connect() {
    try {
      port = chrome.runtime.connect({ name: 'odessa-chat' });
    } catch (_) {
      // Extensão recarregada/atualizada: este script ficou órfão; a aba recarregada assume.
      clearInterval(watchTimer);
      return;
    }
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(() => {
      port = null; // service worker reiniciou; o watch abaixo reconecta
    });
    post({ type: 'page', url: location.href });
  }

  function onMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'config' && msg.observer) {
      observerConfig = msg.observer;
      window.installOdessaChatObserver(observerConfig, (chat) =>
        post({ type: 'message', username: chat.username, text: chat.text }),
      );
    } else if (msg.type === 'send') {
      void sendToChat(msg);
    } else if (msg.type === 'odessa_status') {
      console.info('[Odessa] extensão:', msg.status, msg.detail || '');
    }
  }

  function readInput(el) {
    return 'value' in el && typeof el.value === 'string' ? el.value : el.textContent || '';
  }

  function setNativeValue(el, text) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && descriptor.set && 'value' in el) descriptor.set.call(el, text);
    else el.textContent = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function pressEnter(el) {
    const init = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent('keydown', init));
    el.dispatchEvent(new KeyboardEvent('keypress', init));
    el.dispatchEvent(new KeyboardEvent('keyup', init));
  }

  function nearbySendButton(el) {
    let scope = el.parentElement;
    for (let depth = 0; scope && depth < 4; depth += 1, scope = scope.parentElement) {
      const button =
        scope.querySelector('button[type="submit"]') ||
        scope.querySelector('button[aria-label*="send" i], button[aria-label*="enviar" i], [data-testid*="send" i]');
      if (button) return button;
    }
    return null;
  }

  function stillInField(input, text) {
    const expected = normalize(text);
    return Boolean(expected) && normalize(readInput(input)).includes(expected);
  }

  async function sendToChat({ id, text, inputSelector, buttonSelector }) {
    const reply = (result) => post({ type: 'send_result', id, ...result });
    const input = [inputSelector, ...INPUT_FALLBACKS].map(query).find(Boolean);
    if (!input) {
      reply({ ok: false, stage: 'input', error: 'Campo do chat não encontrado na aba do Tango.' });
      return;
    }
    try {
      input.focus();
      if (readInput(input).trim()) {
        document.execCommand('selectAll');
        document.execCommand('delete');
        if (readInput(input).trim()) setNativeValue(input, '');
      }
      await sleep(80 + Math.random() * 150);
      // insertText gera os mesmos eventos de digitação que o React do Tango escuta.
      const inserted = document.execCommand('insertText', false, text);
      if (!inserted || normalize(readInput(input)) !== normalize(text)) setNativeValue(input, text);
      await sleep(150 + Math.random() * 250);

      const button = query(buttonSelector);
      if (button) button.click();
      else pressEnter(input);

      await sleep(1200);
      if (stillInField(input, text)) {
        const fallback = nearbySendButton(input);
        if (fallback) {
          fallback.click();
          await sleep(1200);
        }
      }
      if (stillInField(input, text)) {
        reply({ ok: false, stage: 'not_submitted', error: 'O Tango não aceitou o envio: o texto ficou no campo do chat.' });
        return;
      }
      reply({ ok: true });
    } catch (err) {
      reply({ ok: false, stage: 'typing', error: `Falha ao digitar no chat (${err && err.message ? err.message : err}).` });
    }
  }

  // Só conecta quando o chat da live existe na página (outras abas do Tango
  // não disputam a conexão); acompanha a navegação da SPA.
  watchTimer = setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      post({ type: 'page', url: lastUrl });
    }
    if (!port && chatVisible()) connect();
  }, 2000);
  if (chatVisible()) connect();
})();
