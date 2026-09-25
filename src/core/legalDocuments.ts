/**
 * Termos de uso e Política de privacidade (#248).
 *
 * Nenhum texto legal vai para produção sem aprovação do jurídico registrada
 * na issue #248. Um documento só aparece no login e na barra lateral quando
 * tem versão, data de aprovação e o link do comentário de aprovação; o teste
 * `legalDocuments.test.ts` também impede que um arquivo em `public/legal/`
 * seja publicado sem isso. Passo a passo em `docs/legal/README.md`.
 */
export interface LegalDocument {
  id: 'termos' | 'privacidade';
  title: string;
  /** Página estática servida a partir de `public/`. */
  href: string;
  /** Preenchidos só depois da aprovação do jurídico. */
  version: string | null;
  approvedAt: string | null;
  /** Link do comentário de aprovação na issue #248. */
  approvalRef: string | null;
}

export const LEGAL_DOCUMENTS: readonly LegalDocument[] = [
  { id: 'termos', title: 'Termos de uso', href: '/legal/termos-de-uso.html', version: null, approvedAt: null, approvalRef: null },
  {
    id: 'privacidade',
    title: 'Política de privacidade',
    href: '/legal/politica-de-privacidade.html',
    version: null,
    approvedAt: null,
    approvalRef: null,
  },
];

const APPROVAL_REF_RE = /^https:\/\/github\.com\/LucasSci\/Odessa\/issues\/248#issuecomment-\d+$/i;
const APPROVED_AT_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Aprovado = versão + data (AAAA-MM-DD) + link do comentário de aprovação na #248. */
export function isApprovedLegalDocument(doc: LegalDocument): boolean {
  return Boolean(
    doc.version?.trim() &&
      doc.approvedAt &&
      APPROVED_AT_RE.test(doc.approvedAt) &&
      doc.approvalRef &&
      APPROVAL_REF_RE.test(doc.approvalRef),
  );
}

export function publishedLegalDocuments(documents: readonly LegalDocument[] = LEGAL_DOCUMENTS): LegalDocument[] {
  return documents.filter(isApprovedLegalDocument);
}
