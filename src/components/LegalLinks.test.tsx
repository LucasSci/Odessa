import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { LegalDocument } from '../core/legalDocuments';
import { LegalLinks } from './LegalLinks';

afterEach(cleanup);

const draft: LegalDocument = {
  id: 'privacidade',
  title: 'Política de privacidade',
  href: '/legal/politica-de-privacidade.html',
  version: null,
  approvedAt: null,
  approvalRef: null,
};

describe('LegalLinks (#248)', () => {
  it('sem aprovação não mostra nada', () => {
    const { container } = render(<LegalLinks documents={[draft]} />);
    expect(container.innerHTML).toBe('');
  });

  it('aprovado mostra o link com versão e data', () => {
    render(
      <LegalLinks
        documents={[
          draft,
          {
            ...draft,
            id: 'termos',
            title: 'Termos de uso',
            href: '/legal/termos-de-uso.html',
            version: '1.0',
            approvedAt: '2026-10-01',
            approvalRef: 'https://github.com/LucasSci/Odessa/issues/248#issuecomment-123',
          },
        ]}
      />,
    );
    const link = screen.getByRole('link', { name: /Termos de uso/ });
    expect(link.getAttribute('href')).toBe('/legal/termos-de-uso.html');
    expect(link.textContent).toContain('v1.0, 01/10/2026');
    expect(screen.queryByRole('link', { name: /Política/ })).toBeNull();
  });
});
