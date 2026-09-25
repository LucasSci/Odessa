/**
 * chat_observer.js — leitor do chat do Tango (MutationObserver).
 *
 * Fonte única usada nos dois caminhos da bridge:
 *  - bridge com navegador próprio (tango_chat.py injeta este arquivo na página);
 *  - extensão do Edge/Chrome (tango_chat/extension), que roda na aba em que o
 *    usuário já está logado.
 *
 * Uso: installOdessaChatObserver({ containerSelector, messageSelector,
 *   usernameSelector, textSelector }, (msg) => { ...msg = { username, text } })
 * Pode ser chamado de novo (reconfiguração/navegação): desfaz a instalação anterior.
 */
(function (root) {
  const FALLBACK_MESSAGE = ['[data-testid^="chat-event-"]', '[data-testid*="chat-message"]', '[data-testid*="comment"]'];
  const FALLBACK_USERNAME = ['[data-testid*="username"]', '[data-testid*="author"]', '[class*="username"]', '[class*="author"]'];
  const FALLBACK_TEXT = ['[data-testid*="message-text"]', '[data-testid*="comment-text"]', '[class*="messageText"]', '[class*="commentText"]'];
  const FALLBACK_CONTAINER = ['[data-testid="virtuoso-item-list"]', '[data-testid*="chat"] [role="list"]', '[role="log"]'];
  // O próprio Tango mostra um texto PROVISÓRIO (ex.: "A traduzir...") no mesmo
  // elemento enquanto a tradução automática carrega; o texto final chega numa
  // mutação seguinte. Sem este filtro o placeholder virava mensagem fantasma.
  const PLACEHOLDER_TEXT_RE = /^(a\s+traduzir|traduciendo|translating)\.{0,3}$/i;

  root.installOdessaChatObserver = function installOdessaChatObserver(cfg, emit) {
    const containerSelector = (cfg && cfg.containerSelector) || '';
    const messageSelector = (cfg && cfg.messageSelector) || '';
    const usernameSelector = (cfg && cfg.usernameSelector) || '';
    const textSelector = (cfg && cfg.textSelector) || '';

    // Reinstalação segura após navegação/reconexão/configuração nova.
    root.__tangoChatObserver?.disconnect();
    root.__tangoChatContainerWatcher?.disconnect();
    if (root.__tangoChatAttachTimer) clearInterval(root.__tangoChatAttachTimer);
    root.__tangoChatObservedContainer = null;
    root.__tangoChatObserverActive = true;

    // Virtualizadores reutilizam o mesmo elemento para mensagens novas: guarda o
    // último conteúdo por elemento e deduplica pelo conteúdo real da mensagem.
    const lastContentByElement = new WeakMap();
    const recentKeys = new Map();

    function firstMatch(scope, primary, fallbacks) {
      if (primary) {
        try {
          const found = scope.querySelector(primary);
          if (found) return found;
        } catch (_) { /* seletor configurado inválido */ }
      }
      for (const selector of fallbacks) {
        const found = scope.querySelector(selector);
        if (found) return found;
      }
      return null;
    }

    function extractMessage(node) {
      if (!node || !node.querySelector) return null;
      let msgEl = null;
      try {
        msgEl = messageSelector && node.matches(messageSelector) ? node : firstMatch(node, messageSelector, FALLBACK_MESSAGE);
      } catch (_) { /* fallback abaixo */ }
      if (!msgEl) return null;

      const usernameEl = firstMatch(msgEl, usernameSelector, FALLBACK_USERNAME);
      const textEl = firstMatch(msgEl, textSelector, FALLBACK_TEXT);
      const username = usernameEl?.textContent?.trim() || 'Espectador';
      const text = textEl?.textContent?.trim() || '';
      if (!text || PLACEHOLDER_TEXT_RE.test(text)) return null;

      const key = `${username}::${text}`;
      if (lastContentByElement.get(msgEl) === key) return null;
      lastContentByElement.set(msgEl, key);

      const now = Date.now();
      if (now - (recentKeys.get(key) || 0) < 1500) return null;
      recentKeys.set(key, now);
      if (recentKeys.size > 1000) {
        for (const [oldKey, timestamp] of recentKeys) {
          if (now - timestamp > 60000) recentKeys.delete(oldKey);
        }
      }
      return { username, text };
    }

    function emitFrom(node) {
      const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
      if (!element) return;
      const candidates = new Set([element]);
      try {
        const closest = messageSelector ? element.closest(messageSelector) : null;
        if (closest) candidates.add(closest);
      } catch (_) { /* seletor configurado inválido */ }
      for (const selector of FALLBACK_MESSAGE) {
        const closest = element.closest?.(selector);
        if (closest) candidates.add(closest);
      }
      const descendants = element.querySelectorAll ? Array.from(element.querySelectorAll('*')) : [];
      for (const candidate of [element, ...descendants, ...candidates]) {
        const msg = extractMessage(candidate);
        if (msg) emit(msg);
      }
    }

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') emitFrom(mutation.target);
        for (const node of mutation.addedNodes) emitFrom(node);
      }
    });

    function attachToContainer() {
      const container = firstMatch(document, containerSelector, FALLBACK_CONTAINER);
      if (!container) return false;
      const current = root.__tangoChatObservedContainer;
      if (current !== container || !current?.isConnected) {
        root.__tangoChatObserver?.disconnect();
        observer.observe(container, { childList: true, subtree: true, characterData: true });
        root.__tangoChatObserver = observer;
        root.__tangoChatObservedContainer = container;
      }
      // Captura também mensagens que já estavam visíveis antes da instalação.
      const existing = [];
      try {
        if (messageSelector) existing.push(...container.querySelectorAll(messageSelector));
      } catch (_) { /* usa fallbacks */ }
      for (const selector of FALLBACK_MESSAGE) existing.push(...container.querySelectorAll(selector));
      for (const node of [...new Set(existing)]) {
        const msg = extractMessage(node);
        if (msg) emit(msg);
      }
      return true;
    }

    if (!attachToContainer()) {
      console.warn('[OdessaBot] Chat ainda não apareceu; aguardando no DOM:', containerSelector);
      const watcher = new MutationObserver(() => {
        if (attachToContainer()) watcher.disconnect();
      });
      watcher.observe(document.documentElement, { childList: true, subtree: true });
      root.__tangoChatContainerWatcher = watcher;
    } else {
      console.log('[OdessaBot] MutationObserver ativo');
    }
    // Mantém a ligação viva quando a SPA substitui o container do chat.
    root.__tangoChatAttachTimer = setInterval(attachToContainer, 2000);
  };
})(typeof window !== 'undefined' ? window : globalThis);
