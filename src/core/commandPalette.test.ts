import { describe, expect, it } from 'vitest';
import { filterCommands, normalizeText, scoreCommand, type PaletteCommand } from './commandPalette';

const cmd = (id: string, title: string, group = 'Geral', keywords?: string): PaletteCommand => ({
  id, title, group, keywords, run: () => undefined,
});

describe('normalizeText', () => {
  it('remove acentos e coloca em minúsculas', () => {
    expect(normalizeText('  Transições ÁÉÍ ')).toBe('transicoes aei');
  });
});

describe('scoreCommand', () => {
  it('consulta vazia casa com tudo', () => {
    expect(scoreCommand(cmd('a', 'Qualquer'), '')).toBeGreaterThan(0);
  });

  it('exige todos os termos (título, grupo ou palavras-chave)', () => {
    const c = cmd('a', 'Ir ao ar: 03 Fluxo', 'Clips', 'idle sorriso');
    expect(scoreCommand(c, 'fluxo 03')).toBeGreaterThan(0);
    expect(scoreCommand(c, 'clips sorriso')).toBeGreaterThan(0);
    expect(scoreCommand(c, 'fluxo inexistente')).toBe(0);
  });

  it('acha sem acento e pontua início de título acima de meio de palavra', () => {
    const start = cmd('a', 'Transições');
    const middle = cmd('b', 'Editar transições');
    const inside = cmd('c', 'Retransmitir');
    expect(scoreCommand(start, 'transicoes')).toBeGreaterThan(scoreCommand(middle, 'transicoes'));
    expect(scoreCommand(middle, 'transicoes')).toBeGreaterThan(0);
    expect(scoreCommand(inside, 'transm')).toBeGreaterThan(0);
  });
});

describe('filterCommands', () => {
  const commands = [
    cmd('nav-lib', 'Ir para Biblioteca', 'Navegação'),
    cmd('clip-1', 'Ir ao ar: Sorriso leve', 'Clips'),
    cmd('clip-2', 'Ir ao ar: Olha o chat', 'Clips'),
    cmd('voz', 'Ligar voz', 'Live'),
  ];

  it('sem consulta mantém a ordem original', () => {
    expect(filterCommands(commands, '').map((c) => c.id)).toEqual(['nav-lib', 'clip-1', 'clip-2', 'voz']);
  });

  it('filtra e ordena por relevância, estável no empate', () => {
    expect(filterCommands(commands, 'ir ao ar').map((c) => c.id)).toEqual(['clip-1', 'clip-2']);
    expect(filterCommands(commands, 'voz').map((c) => c.id)).toEqual(['voz']);
    expect(filterCommands(commands, 'zzz')).toEqual([]);
  });

  it('respeita o limite', () => {
    expect(filterCommands(commands, '', 2)).toHaveLength(2);
  });
});
