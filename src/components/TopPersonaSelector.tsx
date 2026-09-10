import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Users } from 'lucide-react';
import { listPersonas, setActivePersona, type PersonaMeta } from '../core/personaManager';
import { cn } from '../lib/utils';

type Props = {
  onPersonaChanged?: (personaId: string) => void;
};

export default function TopPersonaSelector({ onPersonaChanged }: Props) {
  const [personas, setPersonas] = useState<PersonaMeta[]>([]);
  const [activeId, setActiveId] = useState('');
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await listPersonas();
      setPersonas(data.personas);
      setActiveId(data.activePersonaId);
    } catch {
      /* silencioso — o seletor não bloqueia a UI */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Fecha o dropdown ao clicar fora
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleSelect = async (id: string) => {
    if (id === activeId || switching) return;
    setSwitching(true);
    setOpen(false);
    try {
      await setActivePersona(id);
      setActiveId(id);
      onPersonaChanged?.(id);
    } catch {
      /* silencioso */
    } finally {
      setSwitching(false);
    }
  };

  const active = personas.find((p) => p.id === activeId);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={switching}
        className={cn(
          'flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm font-medium text-slate-200 transition-colors hover:bg-white/[0.08]',
          open && 'bg-white/[0.08]',
          switching && 'opacity-50',
        )}
        title={active?.description || active?.name || 'Selecionar persona'}
      >
        <Users style={{ width: 14, height: 14 }} className="text-violet-400" />
        <span className="max-w-[120px] truncate">{active?.name || activeId || '—'}</span>
        <ChevronDown
          style={{ width: 14, height: 14 }}
          className={cn('text-slate-400 transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 min-w-[200px] overflow-hidden rounded-xl border border-white/10 bg-[#101114] shadow-2xl shadow-black/50">
          {personas.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => handleSelect(p.id)}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
                p.id === activeId
                  ? 'bg-violet-500/15 text-violet-200'
                  : 'text-slate-300 hover:bg-white/[0.06]',
              )}
            >
              <span className="flex-1 truncate">
                <span className="font-medium">{p.name}</span>
                {p.description && (
                  <span className="ml-1.5 text-xs text-slate-500">{p.description}</span>
                )}
              </span>
              {p.id === activeId && <Check style={{ width: 14, height: 14 }} className="text-violet-400" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
