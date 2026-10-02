/**
 * Memória que cresce, à vista do operador: o que a IA sabe de cada pessoa e o
 * que a persona já contou de si. Tudo pode ser apagado (vale para qualquer IA).
 */
import { useEffect, useState } from 'react';
import { BookUser, Sparkles, X } from 'lucide-react';
import {
  deletePersonaFact,
  deleteViewerFact,
  getMemoryDetails,
  listPersonaFacts,
  type MemoryFact,
} from '../core/chatMemory';
import { getActivePersona } from '../core/personaManager';
import { useToast } from './Toast';
import { SkeletonList } from './ui';

function FactChip({ fact, onDelete, busy }: { fact: MemoryFact; onDelete: () => void; busy: boolean }) {
  return (
    <li className="anim-fade-in inline-flex max-w-full items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] py-1 pl-3 pr-1 text-[11px] text-slate-300">
      <span className="truncate" title={fact.fact}>{fact.fact}</span>
      <button
        type="button"
        onClick={onDelete}
        disabled={busy}
        aria-label={`Apagar: ${fact.fact}`}
        className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-slate-500 hover:bg-red-500/15 hover:text-red-300 disabled:opacity-40"
      >
        <X className="h-3 w-3" />
      </button>
    </li>
  );
}

/** Fatos e último resumo de um espectador (aberto na lista da tela de Memória). */
export function ViewerMemoryDetails({ profileId, username }: { profileId: string; username: string }) {
  const toast = useToast();
  const [data, setData] = useState<{ facts: MemoryFact[]; lastSummary: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getMemoryDetails(profileId)
      .then((value) => alive && setData(value))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : 'Falha ao carregar.'));
    return () => {
      alive = false;
    };
  }, [profileId]);

  const remove = async (fact: MemoryFact) => {
    setBusyId(fact.id);
    try {
      await deleteViewerFact(fact.id);
      setData((current) => current && { ...current, facts: current.facts.filter((f) => f.id !== fact.id) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível apagar.');
    } finally {
      setBusyId(null);
    }
  };

  if (error) return <p className="py-2 text-[11px] text-red-300">{error}</p>;
  if (!data) return <SkeletonList label={`Carregando o que a IA sabe de @${username}`} rows={1} itemClassName="h-7" />;
  return (
    <div className="space-y-2 rounded-xl border border-white/5 bg-black/20 p-3">
      {data.facts.length ? (
        <ul className="flex flex-wrap gap-1.5">
          {data.facts.map((fact) => (
            <FactChip key={fact.id} fact={fact} busy={busyId === fact.id} onDelete={() => void remove(fact)} />
          ))}
        </ul>
      ) : (
        <p className="text-[11px] text-slate-500">Ainda não sabe nada pessoal de @{username}. Aprende conforme a conversa (quando o chat dá uma pausa).</p>
      )}
      {data.lastSummary && (
        <p className="text-[11px] leading-relaxed text-slate-400">
          <span className="font-semibold text-slate-300">Última conversa:</span> {data.lastSummary}
        </p>
      )}
    </div>
  );
}

/** "O que a Viktoria já contou de si": coerência entre lives, com apagar. */
export function PersonaSelfFacts() {
  const toast = useToast();
  const [state, setState] = useState<{ name: string; facts: MemoryFact[] } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getActivePersona()
      .then(async ({ persona }) => {
        const facts = await listPersonaFacts(persona.id);
        if (alive) setState({ name: persona.name, facts });
      })
      .catch(() => alive && setState({ name: 'a persona', facts: [] }));
    return () => {
      alive = false;
    };
  }, []);

  const remove = async (fact: MemoryFact) => {
    setBusyId(fact.id);
    try {
      await deletePersonaFact(fact.id);
      setState((current) => current && { ...current, facts: current.facts.filter((f) => f.id !== fact.id) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível apagar.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section aria-label="O que a persona já contou de si" className="rounded-2xl border border-white/10 bg-[#0c0e12] p-4 lg:col-span-3">
      <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400">
        <Sparkles className="h-3.5 w-3.5" /> O que {state?.name ?? 'a persona'} já contou de si
      </h4>
      <p className="mt-1 text-[11px] text-slate-500">
        Ela mantém isso nas próximas conversas, com qualquer IA. Apague o que não quiser que ela repita.
      </p>
      <div className="mt-3">
        {!state ? (
          <SkeletonList label="Carregando" rows={1} itemClassName="h-7" />
        ) : state.facts.length ? (
          <ul className="flex flex-wrap gap-1.5">
            {state.facts.map((fact) => (
              <FactChip key={fact.id} fact={fact} busy={busyId === fact.id} onDelete={() => void remove(fact)} />
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 text-[11px] text-slate-500">
            <BookUser className="h-3.5 w-3.5" /> Nada ainda: aparece aqui conforme ela conta coisas de si no chat.
          </p>
        )}
      </div>
    </section>
  );
}
