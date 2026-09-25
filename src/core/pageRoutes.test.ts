import { describe, expect, it } from 'vitest';
import { PAGE_ORDER, hashForPage, pageForShortcut, pageFromHash, pageOfTab } from './pageRoutes';

describe('pageRoutes', () => {
  it('ida e volta entre página e hash para todas as páginas', () => {
    for (const page of PAGE_ORDER) {
      expect(pageFromHash(hashForPage(page))).toBe(page);
    }
    expect(hashForPage('library')).toBe('#/biblioteca');
  });

  it('apelidos internos caem na página certa', () => {
    expect(pageOfTab('chat')).toBe('live');
    expect(pageOfTab('stage')).toBe('live');
    expect(pageOfTab('logs')).toBe('flow');
    expect(pageOfTab('canvas')).toBe('settings');
    expect(pageOfTab('personas')).toBe('personas');
    expect(pageOfTab('desconhecida')).toBe('live');
  });

  it('não confunde os hashes antigos (#overlay do OBS, #settings, #login) com rotas', () => {
    for (const hash of ['#overlay', '#settings', '#canvas', '#login', '', '#']) {
      expect(pageFromHash(hash)).toBeNull();
    }
    expect(pageFromHash('#/nao-existe')).toBeNull();
    expect(pageFromHash('#/Biblioteca')).toBe('library');
    expect(pageFromHash('#/automacoes/logs')).toBe('flow');
  });

  it('Alt+1…Alt+8 seguem a ordem da barra lateral; outras combinações não', () => {
    const key = (digit: string, extra: Partial<KeyboardEvent> = {}) => ({
      altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, key: digit, code: `Digit${digit}`, ...extra,
    });
    expect(pageForShortcut(key('1'))).toBe('live');
    expect(pageForShortcut(key('4'))).toBe('conversation');
    expect(pageForShortcut(key('8'))).toBe('admin');
    expect(pageForShortcut(key('9'))).toBeNull();
    expect(pageForShortcut(key('2', { altKey: false }))).toBeNull();
    expect(pageForShortcut(key('2', { ctrlKey: true }))).toBeNull();
    // Layout em que Alt+número gera outro caractere: vale o `code`.
    expect(pageForShortcut(key('2', { key: '²' }))).toBe('library');
  });
});
