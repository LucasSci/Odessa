import { describe, expect, it } from 'vitest';
import { apiUrl } from './api';

describe('apiUrl', () => {
  it('rotas do servidor ganham o prefixo /api/v1 (sem ele caíam na página do app e voltavam HTML)', () => {
    for (const path of ['/planning/canvas', '/workflow/draft', '/personas', '/ai/respond', '/idle-studio/viktoria']) {
      expect(apiUrl(path).endsWith(`/api/v1${path}`)).toBe(true);
    }
  });
});
