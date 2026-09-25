/**
 * pageRoutes — páginas do shell, rotas na URL e atalhos de teclado.
 *
 * Várias "abas" internas são apelidos da mesma página (ex.: 'chat', 'home' e
 * 'stage' são todas "Ao Vivo"). A página é a unidade que o shell monta, mantém
 * viva e mostra na URL (`#/biblioteca`), para o voltar/avançar do navegador e
 * o recarregar funcionarem.
 *
 * As rotas usam o prefixo `#/` de propósito: os hashes antigos (`#overlay` da
 * fonte de navegador do OBS, `#settings`, `#canvas`, `#login`…) continuam com o
 * significado de antes e são tratados pelo App.
 */

export type PageKey = 'live' | 'library' | 'flow' | 'conversation' | 'personas' | 'history' | 'settings' | 'admin';

/** Ordem da barra lateral — também define os atalhos Alt+1…Alt+8. */
export const PAGE_ORDER: readonly PageKey[] = ['live', 'library', 'flow', 'conversation', 'personas', 'history', 'settings', 'admin'];

const PAGE_SLUGS: Record<PageKey, string> = {
  live: 'ao-vivo',
  library: 'biblioteca',
  flow: 'automacoes',
  conversation: 'conversar',
  personas: 'personas',
  history: 'historico',
  settings: 'configuracoes',
  admin: 'diagnostico',
};

const TAB_ALIASES: Record<string, PageKey> = {
  chat: 'live',
  home: 'live',
  stage: 'live',
  logs: 'flow',
  ai: 'settings',
  canvas: 'settings',
};

/** Página a que uma aba interna pertence (apelidos incluídos). */
export function pageOfTab(tab: string): PageKey {
  if (tab in TAB_ALIASES) return TAB_ALIASES[tab];
  return (PAGE_ORDER as readonly string[]).includes(tab) ? (tab as PageKey) : 'live';
}

/** `#/biblioteca` → 'library'. Hash fora do formato de rota → null. */
export function pageFromHash(hash: string): PageKey | null {
  if (!hash.startsWith('#/')) return null;
  const slug = hash.slice(2).split(/[/?]/)[0].toLowerCase();
  const found = (Object.keys(PAGE_SLUGS) as PageKey[]).find((page) => PAGE_SLUGS[page] === slug);
  return found ?? null;
}

export function hashForPage(page: PageKey): string {
  return `#/${PAGE_SLUGS[page]}`;
}

/** Alt+1…Alt+8 → página correspondente; qualquer outra tecla → null. */
export function pageForShortcut(event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'key' | 'code'>): PageKey | null {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  // `code` resiste a layouts em que Alt+número vira outro caractere.
  const digit = /^Digit([1-9])$/.exec(event.code)?.[1] ?? (/^[1-9]$/.test(event.key) ? event.key : null);
  if (!digit) return null;
  return PAGE_ORDER[Number(digit) - 1] ?? null;
}
