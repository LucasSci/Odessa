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

  function pageInfo() {
    return { type: 'page', url: location.href, title: document.title, w: window.innerWidth, h: window.innerHeight };
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
    post(pageInfo());
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
    } else if (msg.type === 'input') {
      handleInput(msg);
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

  // ── Interação vinda do painel Ao Vivo do Odessa (coordenadas CSS da aba) ──

  function mouseInit(x, y, extra) {
    return { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, button: 0, ...extra };
  }

  function clickAt(x, y) {
    const target = document.elementFromPoint(x, y);
    if (!target) return;
    const pointer = { pointerId: 1, pointerType: 'mouse', isPrimary: true };
    target.dispatchEvent(new PointerEvent('pointerover', mouseInit(x, y, pointer)));
    target.dispatchEvent(new PointerEvent('pointerdown', mouseInit(x, y, { ...pointer, buttons: 1 })));
    target.dispatchEvent(new MouseEvent('mousedown', mouseInit(x, y, { buttons: 1 })));
    const focusable = target.closest('input, textarea, select, button, a, [contenteditable="true"], [tabindex]');
    if (focusable && typeof focusable.focus === 'function') focusable.focus();
    target.dispatchEvent(new PointerEvent('pointerup', mouseInit(x, y, pointer)));
    target.dispatchEvent(new MouseEvent('mouseup', mouseInit(x, y)));
    target.dispatchEvent(new MouseEvent('click', mouseInit(x, y, { detail: 1 })));
  }

  function scrollableAt(x, y) {
    let el = document.elementFromPoint(x, y);
    while (el && el !== document.body && el !== document.documentElement) {
      const style = getComputedStyle(el);
      if (/(auto|scroll|overlay)/.test(style.overflowY + style.overflowX) && (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth)) {
        return el;
      }
      el = el.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  function keyEvents(target, key) {
    const codes = { Enter: 13, Backspace: 8, Tab: 9, Escape: 27, Delete: 46, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, ' ': 32 };
    const init = { key, code: key, keyCode: codes[key] || 0, which: codes[key] || 0, bubbles: true, cancelable: true, composed: true };
    const down = target.dispatchEvent(new KeyboardEvent('keydown', init));
    if (key === 'Enter') target.dispatchEvent(new KeyboardEvent('keypress', init));
    target.dispatchEvent(new KeyboardEvent('keyup', init));
    return down; // false = a página tratou (preventDefault)
  }

  function editable(el) {
    return el && (el.isContentEditable || /^(INPUT|TEXTAREA)$/.test(el.tagName));
  }

  function typeText(text) {
    const el = document.activeElement;
    if (!editable(el)) return;
    if (!document.execCommand('insertText', false, text) && 'value' in el) setNativeValue(el, readInput(el) + text);
  }

  function pressKey(key) {
    const el = document.activeElement || document.body;
    const notHandled = keyEvents(el, key);
    if (!notHandled) return;
    // Efeito padrão que eventos sintéticos não têm: aplicado à mão.
    if (key === 'Backspace' && editable(el)) document.execCommand('delete');
    else if (key === 'Delete' && editable(el)) document.execCommand('forwardDelete');
    else if (key === 'Tab') {
      const focusables = [...document.querySelectorAll('a[href], button, input, textarea, select, [tabindex]:not([tabindex="-1"])')].filter((f) => !f.disabled && f.offsetParent !== null);
      const next = focusables[(focusables.indexOf(el) + 1) % Math.max(focusables.length, 1)];
      if (next) next.focus();
    } else if (key === 'Escape' && el !== document.body) el.blur();
    else if ((key === 'ArrowUp' || key === 'ArrowDown') && !editable(el)) window.scrollBy({ top: key === 'ArrowDown' ? 120 : -120 });
  }

  function handleInput(msg) {
    try {
      const x = Number(msg.x) || 0;
      const y = Number(msg.y) || 0;
      if (msg.kind === 'mouse') clickAt(x, y);
      else if (msg.kind === 'wheel') {
        const deltaX = Number(msg.deltaX) || 0;
        const deltaY = Number(msg.deltaY) || 0;
        const target = document.elementFromPoint(x, y) || document.body;
        const wheel = new WheelEvent('wheel', { ...mouseInit(x, y), deltaX, deltaY, deltaMode: 0 });
        if (target.dispatchEvent(wheel)) scrollableAt(x, y).scrollBy({ left: deltaX, top: deltaY });
      } else if (msg.kind === 'key') {
        if (msg.text && msg.text.length === 1) typeText(msg.text);
        else if (msg.key) pressKey(msg.key);
      } else if (msg.kind === 'type' && msg.text) typeText(String(msg.text));
    } catch (err) {
      console.warn('[Odessa] interação do painel falhou:', err);
    }
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
      post(pageInfo());
    }
    if (!port && chatVisible()) connect();
  }, 2000);
  if (chatVisible()) connect();

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => post(pageInfo()), 300);
  });
  // Voltar para a aba retoma a conexão se outra aba tinha assumido o chat.
  const resume = () => {
    if (document.visibilityState === 'visible') post({ type: 'resume' });
  };
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('focus', resume);
})();
