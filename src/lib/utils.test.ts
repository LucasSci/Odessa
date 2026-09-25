import { describe, expect, it } from 'vitest';
import { safeImageSrc } from './utils';

describe('safeImageSrc', () => {
  it('aceita http(s), blob, data:image e caminhos relativos', () => {
    for (const url of [
      'https://cdn.exemplo.com/a.png',
      'http://localhost:8000/x.jpg',
      'blob:http://localhost/123',
      'data:image/png;base64,AAAA',
      '/api/v1/personas/p1/assets/faces/f1',
      './avatar.webp',
    ]) {
      expect(safeImageSrc(url)).toBe(url);
    }
  });

  it('mantém URLs já codificadas e escapa marcação', () => {
    expect(safeImageSrc('https://x.com/a%20b.png?q=1&r=2#f')).toBe('https://x.com/a%20b.png?q=1&r=2#f');
    expect(safeImageSrc('https://x.com/a b.png')).toBe('https://x.com/a%20b.png');
    expect(safeImageSrc('https://x.com/"><img>')).toBe('https://x.com/%22%3E%3Cimg%3E');
    expect(safeImageSrc('https://x.com/%E0%A4%A')).toBeUndefined();
  });

  it('descarta esquemas perigosos, protocolo relativo e vazio', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,<script>', 'data:image/svg+xml,<svg onload=x>', '//evil.com/x.png', 'vbscript:x', '', '   ', null, undefined]) {
      expect(safeImageSrc(url)).toBeUndefined();
    }
  });
});
