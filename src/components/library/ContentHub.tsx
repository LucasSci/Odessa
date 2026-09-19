import { useMemo } from 'react';
import { Lightbulb, Scissors, Sparkles } from 'lucide-react';
import { computeCoverage } from '../../core/videoRoteiro';
import { hasVideoEdit } from '../../core/videoEdits';
import { cn } from '../../lib/utils';
import { Button } from '../ui';

export interface HubVideo {
  id: string;
  label: string;
  loop?: boolean;
}

/**
 * Hub de conteúdo da Biblioteca: cobertura do roteiro por categoria (com o que
 * falta), clips editados com atalho para o editor e ponto de partida para gerar.
 */
export function ContentHub({
  videos,
  activeCategory,
  onSelectCategory,
  onOpenEditor,
  onGenerate,
}: {
  videos: HubVideo[];
  activeCategory: string;
  onSelectCategory: (key: string) => void;
  onOpenEditor: (videoId: string, label: string) => void;
  onGenerate?: () => void;
}) {
  const coverage = useMemo(() => computeCoverage(videos), [videos]);
  const edited = useMemo(() => videos.filter((v) => hasVideoEdit(v.id)), [videos]);
  const gaps = coverage.categories.filter((c) => c.missing > 0);

  return (
    <section aria-label="Hub de conteúdo" className="mb-5 grid gap-4 rounded-[28px] border border-white/10 bg-[#101114] p-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--t3)]">Cobertura do roteiro</h2>
          <span className="font-mono text-[11px] text-[var(--t3)]">{videos.length} clips</span>
        </div>
        <ul className="space-y-2">
          {coverage.categories.map((cat) => {
            const ratio = Math.min(1, cat.count / cat.recommended);
            const active = activeCategory === cat.key;
            return (
              <li key={cat.key}>
                <button
                  type="button"
                  onClick={() => onSelectCategory(active ? 'all' : cat.key)}
                  aria-pressed={active}
                  className={cn('w-full rounded-xl border px-3 py-2 text-left transition', active ? 'border-sky-300/40 bg-sky-300/10' : 'border-white/10 hover:border-white/25')}
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-[var(--t1)]">{cat.label}</span>
                    <span className="font-mono text-[var(--t3)]">{cat.count}/{cat.recommended}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--bg4)]">
                    <div className={cn('h-full rounded-full', cat.missing === 0 ? 'bg-emerald-400' : 'bg-[image:var(--accent-grad)]')} style={{ width: `${ratio * 100}%` }} />
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
        {coverage.uncategorized > 0 && (
          <p className="mt-2 text-[11px] text-[var(--t3)]">{coverage.uncategorized} clip(s) sem categoria (o id não tem FLUXO, GATILHO, TRANSICAO ou ESPECIAL).</p>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <div>
          <h2 className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--t3)]"><Lightbulb className="h-3.5 w-3.5" />Sugestões</h2>
          {gaps.length === 0 ? (
            <p className="text-xs text-emerald-300">O roteiro está completo: todas as categorias atingiram o recomendado.</p>
          ) : (
            <ul className="space-y-1 text-xs text-[var(--t2)]">
              {gaps.map((cat) => (
                <li key={cat.key}>Faltam <b className="text-[var(--t1)]">{cat.missing}</b> em {cat.label}</li>
              ))}
            </ul>
          )}
          {onGenerate && gaps.length > 0 && (
            <Button size="sm" variant="secondary" className="mt-2" onClick={onGenerate}><Sparkles className="h-3.5 w-3.5" />Gerar conteúdo</Button>
          )}
        </div>

        <div className="min-w-0">
          <h2 className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--t3)]"><Scissors className="h-3.5 w-3.5" />Editados ({edited.length})</h2>
          {edited.length === 0 ? (
            <p className="text-xs text-[var(--t3)]">Nenhum clip com corte, velocidade ou áudio próprio ainda.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {edited.slice(0, 8).map((v) => (
                <button key={v.id} type="button" onClick={() => onOpenEditor(v.id, v.label)} title="Abrir no editor" className="max-w-full truncate rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-[var(--t2)] transition hover:border-sky-300/40 hover:text-white">
                  {v.label}
                </button>
              ))}
              {edited.length > 8 && <span className="px-1 py-1 text-[11px] text-[var(--t3)]">+{edited.length - 8}</span>}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
