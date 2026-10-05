import { describe, expect, it } from 'vitest';
import { resolveStageUrl } from './stageUrl';

describe('resolveStageUrl', () => {
  it('no Odessa instalado troca o endereço antigo de desenvolvimento pelo do próprio app', () => {
    expect(resolveStageUrl('http://localhost:3000/#overlay', 'http://127.0.0.1:8000')).toBe('http://127.0.0.1:8000/#overlay');
  });

  it('vazio vira automático', () => {
    expect(resolveStageUrl('', 'http://127.0.0.1:8000')).toBe('http://127.0.0.1:8000/#overlay');
  });

  it('em desenvolvimento (3000) o endereço antigo continua valendo', () => {
    expect(resolveStageUrl('http://localhost:3000/#overlay', 'http://localhost:3000')).toBe('http://localhost:3000/#overlay');
  });

  it('uma URL escolhida à mão não é tocada', () => {
    expect(resolveStageUrl('http://192.168.0.10:8000/#overlay', 'http://127.0.0.1:8000')).toBe('http://192.168.0.10:8000/#overlay');
  });
});
