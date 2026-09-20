import { afterEach, describe, expect, it, vi } from 'vitest';
import { safeLocal, safeSession } from './safeStorage';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('safeStorage', () => {
  it('lê e escreve normalmente', () => {
    expect(safeLocal.set('k', 'v')).toBe(true);
    expect(safeLocal.get('k')).toBe('v');
    safeLocal.remove('k');
    expect(safeLocal.get('k')).toBeNull();
  });

  it('JSON: devolve o padrão para valor ausente ou corrompido', () => {
    expect(safeLocal.getJSON('nada', { a: 1 })).toEqual({ a: 1 });
    window.localStorage.setItem('ruim', '{lixo');
    expect(safeLocal.getJSON('ruim', [])).toEqual([]);
    safeLocal.setJSON('ok', { x: [1, 2] });
    expect(safeLocal.getJSON('ok', null)).toEqual({ x: [1, 2] });
  });

  it('não lança quando o acesso ao storage falha e degrada para memória', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('bloqueado', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('cota', 'QuotaExceededError');
    });
    expect(() => safeLocal.get('a')).not.toThrow();
    expect(safeLocal.set('a', '1')).toBe(false);
    expect(safeLocal.get('a')).toBe('1'); // ficou na memória
  });

  it('dados apagados por fora do app não ressuscitam a partir da memória', () => {
    safeLocal.set('k', 'v');
    window.localStorage.clear(); // outra aba / ferramentas do navegador
    expect(safeLocal.get('k')).toBeNull();
  });

  it('quando a escrita volta a funcionar, o valor da memória é descartado', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new DOMException('cota', 'QuotaExceededError');
    });
    expect(safeLocal.set('k', 'na-memoria')).toBe(false);
    spy.mockRestore();
    expect(safeLocal.set('k', 'no-storage')).toBe(true);
    window.localStorage.clear();
    expect(safeLocal.get('k')).toBeNull();
  });

  it('sessionStorage é independente do localStorage', () => {
    safeLocal.set('mesma', 'local');
    safeSession.set('mesma', 'sessao');
    expect(safeLocal.get('mesma')).toBe('local');
    expect(safeSession.get('mesma')).toBe('sessao');
  });
});
