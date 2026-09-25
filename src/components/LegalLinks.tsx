import { publishedLegalDocuments, type LegalDocument } from '../core/legalDocuments';
import { cn } from '../lib/utils';

function approvalDate(iso: string) {
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
}

/**
 * Links para Termos de uso e Política de privacidade com versão e data de
 * aprovação (#248). Enquanto o jurídico não aprovar, não mostra nada.
 */
export function LegalLinks({ documents, className }: { documents?: readonly LegalDocument[]; className?: string }) {
  const published = publishedLegalDocuments(documents);
  if (!published.length) return null;
  return (
    <nav aria-label="Documentos legais" className={cn('flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500', className)}>
      {published.map((doc) => (
        <a
          key={doc.id}
          href={doc.href}
          target="_blank"
          rel="noreferrer"
          className="underline-offset-2 transition-colors hover:text-slate-300 hover:underline"
        >
          {doc.title}{' '}
          <span className="text-slate-600">
            (v{doc.version}, {approvalDate(doc.approvedAt!)})
          </span>
        </a>
      ))}
    </nav>
  );
}
