/**
 * localStorage/sessionStorage que nunca lançam exceção.
 *
 * Os dois podem falhar: janela privada, dados do site bloqueados, cota cheia ou
 * preview/miniatura sem acesso. Um `getItem` solto derrubava o painel inteiro;
 * aqui a leitura devolve o valor padrão e a escrita degrada para memória (vale
 * até recarregar a página).
 */

type Area = 'local' | 'session';

const memory: Record<Area, Map<string, string>> = { local: new Map(), session: new Map() };

function area(kind: Area): Storage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function makeStore(kind: Area) {
  return {
    get(key: string): string | null {
      try {
        const value = area(kind)?.getItem(key);
        if (value !== undefined && value !== null) return value;
      } catch {
        // cai na memória
      }
      return memory[kind].get(key) ?? null;
    },
    set(key: string, value: string): boolean {
      memory[kind].set(key, value);
      try {
        const storage = area(kind);
        if (!storage) return false;
        storage.setItem(key, value);
        return true;
      } catch {
        return false;
      }
    },
    remove(key: string): void {
      memory[kind].delete(key);
      try {
        area(kind)?.removeItem(key);
      } catch {
        // nada a fazer
      }
    },
    getJSON<T>(key: string, fallback: T): T {
      const raw = this.get(key);
      if (raw === null) return fallback;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return fallback;
      }
    },
    setJSON(key: string, value: unknown): boolean {
      try {
        return this.set(key, JSON.stringify(value));
      } catch {
        return false;
      }
    },
  };
}

export const safeLocal = makeStore('local');
export const safeSession = makeStore('session');
