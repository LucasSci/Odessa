import { beforeEach, describe, expect, it } from 'vitest';
import { LongTermMemoryManager } from './longTermMemory';

// Memória de fatos por espectador, lida pela Diretora (#254).

function factLines(context: string) {
  return context.split('\n').filter((line) => line.startsWith('- '));
}

describe('LongTermMemoryManager', () => {
  beforeEach(() => window.localStorage.clear());

  it('guarda e devolve fatos de quem está na live, sem duplicar', () => {
    const memory = new LongTermMemoryManager();
    memory.storeFact('ana', 'gosta', 'gosta de pizza');
    memory.storeFact('ana', 'gosta', 'gosta de pizza');
    memory.storeFact('bia', 'pedido', 'toca funk');
    const context = memory.retrieveContext(['@Ana', 'bia']);
    expect(factLines(context)).toEqual(['- [ana] sobre gosta: gosta de pizza', '- [bia] sobre pedido: toca funk']);
    expect(memory.retrieveContext([])).toBe('');
    expect(memory.retrieveContext(['caio'])).toBe('');
  });

  it('sobrevive ao recarregar a página', () => {
    new LongTermMemoryManager().storeFact('ana', 'gosta', 'gosta de pizza');
    expect(new LongTermMemoryManager().retrieveContext(['ana'])).toContain('gosta de pizza');
  });

  it('esquecer apaga só os fatos daquele espectador, inclusive do navegador', () => {
    const memory = new LongTermMemoryManager();
    memory.storeFact('Ana', 'gosta', 'gosta de pizza');
    memory.storeFact('bia', 'pedido', 'toca funk');
    memory.forgetUser('@ana');
    expect(memory.retrieveContext(['ana'])).toBe('');
    expect(new LongTermMemoryManager().retrieveContext(['ana', 'bia'])).not.toContain('pizza');
    expect(memory.retrieveContext(['bia'])).toContain('toca funk');
  });

  it('oculto fica fora do contexto e não ganha fatos novos; mostrar devolve', () => {
    const memory = new LongTermMemoryManager();
    memory.storeFact('ana', 'gosta', 'gosta de pizza');
    memory.setHidden('ana', true);
    memory.storeFact('ana', 'pedido', 'manda beijo');
    expect(memory.retrieveContext(['ana'])).toBe('');
    // Continua oculto depois de recarregar.
    expect(new LongTermMemoryManager().retrieveContext(['ana'])).toBe('');

    memory.setHidden('ana', false);
    expect(factLines(memory.retrieveContext(['ana']))).toEqual(['- [ana] sobre gosta: gosta de pizza']);
  });

  it('resetar apaga tudo, no navegador também', () => {
    const memory = new LongTermMemoryManager();
    memory.storeFact('ana', 'gosta', 'gosta de pizza');
    memory.setHidden('bia', true);
    memory.clear();
    expect(memory.retrieveContext(['ana'])).toBe('');
    expect(window.localStorage.getItem('odessa:rag-memory:v1')).toBeNull();
    expect(window.localStorage.getItem('odessa:rag-memory:hidden:v1')).toBeNull();
  });

  it('tem teto por espectador (ficam os mais recentes) e no total', () => {
    const memory = new LongTermMemoryManager();
    for (let i = 1; i <= 15; i += 1) memory.storeFact('ana', 'pedido', `pedido ${i}`);
    const lines = factLines(memory.retrieveContext(['ana']));
    expect(lines).toHaveLength(10);
    expect(lines[0]).toContain('pedido 6');
    expect(lines[9]).toContain('pedido 15');

    for (let i = 0; i < 600; i += 1) memory.storeFact(`user${i}`, 'gosta', 'x');
    const stored = JSON.parse(window.localStorage.getItem('odessa:rag-memory:v1') || '[]') as unknown[];
    expect(stored).toHaveLength(500);
  });

  it('dado corrompido no navegador não quebra a memória', () => {
    window.localStorage.setItem('odessa:rag-memory:v1', '{nao é json');
    window.localStorage.setItem('odessa:rag-memory:hidden:v1', JSON.stringify([1, 'ana']));
    const memory = new LongTermMemoryManager();
    memory.storeFact('bia', 'gosta', 'x');
    expect(memory.retrieveContext(['bia'])).toContain('x');
    expect(memory.retrieveContext(['ana'])).toBe('');
  });
});
