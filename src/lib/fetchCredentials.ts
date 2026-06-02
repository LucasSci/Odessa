let installed = false;

const SESSION_TOKEN_KEY = 'odessa:admin-session-token:v1';
const SESSION_TOKEN_ORIGIN_PREFIX = 'odessa:admin-session-token-origin:';

function originFor(value?: string | URL | null) {
  if (typeof window === 'undefined') return '';
  if (!value) return window.location.origin;
  try {
    return new URL(String(value), window.location.origin).origin;
  } catch {
    return window.location.origin;
  }
}

export function saveAdminSessionToken(token: string | null | undefined, origin?: string) {
  if (typeof window === 'undefined') return;
  const originKey = `${SESSION_TOKEN_ORIGIN_PREFIX}${originFor(origin)}`;
  if (!token) {
    window.localStorage.removeItem(SESSION_TOKEN_KEY);
    window.localStorage.removeItem(originKey);
    return;
  }
  window.localStorage.setItem(SESSION_TOKEN_KEY, token);
  window.localStorage.setItem(originKey, token);
}

export function clearAdminSessionToken(origin?: string) {
  saveAdminSessionToken(null, origin);
}

export function installCredentialedFetch() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  // Migração: o token antes ficava em sessionStorage (sumia ao fechar a aba,
  // causando logout constante). Se houver um token legado lá e ainda não em
  // localStorage, copia uma vez — assim a sessão persiste sem relogar.
  try {
    if (!window.localStorage.getItem(SESSION_TOKEN_KEY)) {
      const legacy = window.sessionStorage.getItem(SESSION_TOKEN_KEY);
      if (legacy) window.localStorage.setItem(SESSION_TOKEN_KEY, legacy);
    }
  } catch { /* ignore */ }
  const nativeFetch = window.fetch.bind(window);

  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const requestOrigin = originFor(input instanceof Request ? input.url : input);
    const sessionToken =
      window.localStorage.getItem(`${SESSION_TOKEN_ORIGIN_PREFIX}${requestOrigin}`) ||
      window.localStorage.getItem(SESSION_TOKEN_KEY);
    if (sessionToken && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${sessionToken}`);
    }
    return nativeFetch(input, { ...init, headers, credentials: init?.credentials || 'include' });
  };
}
