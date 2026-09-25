import { describe, expect, it } from 'vitest';
import { createOwnEchoFilter } from './ownEchoFilter';

describe('createOwnEchoFilter', () => {
  it('reconhece o eco mesmo quando ele chega antes do envio terminar', () => {
    const filter = createOwnEchoFilter();
    filter.expect('Oi Ana! Falo de São Paulo', 1_000);
    // O eco chega pelo chat enquanto o /send ainda espera a confirmação.
    expect(filter.consume('  oi ana!  falo de são paulo ', 1_500)).toBe(true);
  });

  it('cada envio reconhece um eco só: a mesma frase depois vem de espectador', () => {
    const filter = createOwnEchoFilter();
    filter.expect('boa noite', 0);
    expect(filter.consume('boa noite', 100)).toBe(true);
    expect(filter.consume('boa noite', 200)).toBe(false);
  });

  it('esquece o registro depois da janela e quando o envio falha', () => {
    const filter = createOwnEchoFilter(10_000);
    filter.expect('antiga', 0);
    expect(filter.consume('antiga', 10_001)).toBe(false);

    const cancel = filter.expect('falhou', 0);
    cancel();
    expect(filter.consume('falhou', 1)).toBe(false);
  });
});
