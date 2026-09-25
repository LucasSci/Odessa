import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isApprovedLegalDocument, LEGAL_DOCUMENTS, publishedLegalDocuments, type LegalDocument } from './legalDocuments';

// Trava de publicação (#248): texto legal só vai ao ar com aprovação do
// jurídico registrada na issue #248.

const PUBLIC_DIR = join(import.meta.dirname, '..', '..', 'public');
const LEGAL_DIR = join(PUBLIC_DIR, 'legal');

const approved: LegalDocument = {
  id: 'termos',
  title: 'Termos de uso',
  href: '/legal/termos-de-uso.html',
  version: '1.0',
  approvedAt: '2026-10-01',
  approvalRef: 'https://github.com/LucasSci/Odessa/issues/248#issuecomment-123',
};

describe('documentos legais (#248)', () => {
  it('nada em public/legal/ sem aprovação registrada', () => {
    const files = existsSync(LEGAL_DIR) ? readdirSync(LEGAL_DIR) : [];
    const approvedFiles = publishedLegalDocuments().map((doc) => doc.href.replace('/legal/', ''));
    expect(files.filter((file) => !approvedFiles.includes(file))).toEqual([]);
  });

  it('documento aprovado tem a página publicada', () => {
    for (const doc of publishedLegalDocuments()) {
      expect(existsSync(join(PUBLIC_DIR, doc.href))).toBe(true);
    }
  });

  it('aprovação exige versão, data e o comentário na issue #248', () => {
    expect(isApprovedLegalDocument(approved)).toBe(true);
    expect(isApprovedLegalDocument({ ...approved, version: ' ' })).toBe(false);
    expect(isApprovedLegalDocument({ ...approved, approvedAt: '01/10/2026' })).toBe(false);
    expect(isApprovedLegalDocument({ ...approved, approvalRef: 'https://github.com/LucasSci/Odessa/issues/999#issuecomment-1' })).toBe(false);
    expect(isApprovedLegalDocument({ ...approved, approvalRef: null })).toBe(false);
  });

  it('hoje nenhum documento está aprovado (aguardando o jurídico)', () => {
    expect(LEGAL_DOCUMENTS.map((doc) => doc.id)).toEqual(['termos', 'privacidade']);
    expect(publishedLegalDocuments()).toEqual([]);
  });
});
