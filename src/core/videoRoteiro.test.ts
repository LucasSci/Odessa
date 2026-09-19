import { describe, expect, it } from 'vitest';
import { categorizeVideo, computeCoverage } from './videoRoteiro';

describe('categorizeVideo', () => {
  it('infere pela parte do id e cai em idle para loops sem prefixo', () => {
    expect(categorizeVideo({ id: '09_GATILHO_beijo' })).toBe('gatilho');
    expect(categorizeVideo({ id: '08_TRANSICAO_ajuste' })).toBe('transicao');
    expect(categorizeVideo({ id: 'idle1', loop: true })).toBe('idle');
    expect(categorizeVideo({ id: 'qualquer' })).toBeNull();
  });
});

describe('computeCoverage', () => {
  it('conta por categoria, calcula o que falta e separa os sem categoria', () => {
    const cov = computeCoverage([
      { id: '01_FLUXO_a' },
      { id: '02_FLUXO_b' },
      { id: '09_GATILHO_x' },
      { id: 'solto' },
    ]);
    const byKey = Object.fromEntries(cov.categories.map((c) => [c.key, c]));
    expect(byKey.idle.count).toBe(2);
    expect(byKey.idle.missing).toBe(3);
    expect(byKey.gatilho.count).toBe(1);
    expect(byKey.gatilho.missing).toBe(9);
    expect(byKey.especial.count).toBe(0);
    expect(cov.uncategorized).toBe(1);
  });

  it('missing nunca fica negativo quando passa do recomendado', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ id: `${i}_FLUXO` }));
    expect(computeCoverage(many).categories.find((c) => c.key === 'idle')?.missing).toBe(0);
  });

  it('biblioteca vazia: tudo em falta', () => {
    const cov = computeCoverage([]);
    expect(cov.categories.every((c) => c.count === 0 && c.missing === c.recommended)).toBe(true);
    expect(cov.uncategorized).toBe(0);
  });
});
