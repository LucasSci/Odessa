import { useEffect, useState } from 'react';
import { EyeOff, Eye, Gift, MessageCircle, Search, UserX, Users } from 'lucide-react';
import {
  forgetMemoryProfile,
  listMemoryProfiles,
  setMemoryProfileHidden,
  type MemoryProfile,
} from '../core/chatMemory';
import { EmptyState, ErrorState } from './common/OperationalState';
import { useToast } from './Toast';
import { Badge, Button, ConfirmButton, SkeletonList } from './ui';

const SEARCH_DEBOUNCE_MS = 300;

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

function lastSeenLabel(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/**
 * Espectadores que a Odessa conhece (#252): buscar, ocultar das respostas ou
 * esquecer de vez — o atendimento a "me esquece" de um espectador específico.
 */
export function ChatMemoryProfiles() {
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [result, setResult] = useState<{ key: string; profiles: MemoryProfile[]; error: string | null } | null>(null);
  const [busy, setBusy] = useState<{ id: string; action: 'visibility' | 'forget' } | null>(null);

  // Busca só depois que a digitação para.
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  const requestKey = `${search}|${reloadKey}`;
  useEffect(() => {
    let alive = true;
    listMemoryProfiles(search)
      .then((profiles) => {
        if (alive) setResult({ key: requestKey, profiles, error: null });
      })
      .catch((error: unknown) => {
        if (alive) setResult({ key: requestKey, profiles: [], error: error instanceof Error ? error.message : 'Falha ao carregar.' });
      });
    return () => {
      alive = false;
    };
  }, [search, requestKey]);

  const loading = result?.key !== requestKey;
  const profiles = result?.profiles ?? [];

  const replace = (id: string, next: MemoryProfile | null) =>
    setResult((current) =>
      current && {
        ...current,
        profiles: next ? current.profiles.map((p) => (p.id === id ? next : p)) : current.profiles.filter((p) => p.id !== id),
      },
    );

  const toggleHidden = async (profile: MemoryProfile) => {
    setBusy({ id: profile.id, action: 'visibility' });
    try {
      await setMemoryProfileHidden(profile, !profile.hidden);
      replace(profile.id, { ...profile, hidden: !profile.hidden });
      toast.success(profile.hidden ? `@${profile.username} volta a entrar nas respostas.` : `@${profile.username} não entra mais nas respostas.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível alterar.');
    } finally {
      setBusy(null);
    }
  };

  const forget = async (profile: MemoryProfile) => {
    setBusy({ id: profile.id, action: 'forget' });
    try {
      await forgetMemoryProfile(profile);
      replace(profile.id, null);
      toast.success(`@${profile.username} foi esquecido(a): perfil e interações apagados.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível apagar.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-label="Espectadores na memória" className="rounded-2xl border border-white/10 bg-[#0c0e12] p-4 lg:col-span-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400">
            <Users className="h-3.5 w-3.5" /> Espectadores na memória
          </h4>
          <p className="mt-1 text-[11px] text-slate-500">
            Ocultar tira o espectador das respostas sem apagar; esquecer apaga o perfil e as mensagens guardadas.
          </p>
        </div>
        <label className="relative block w-full max-w-xs">
          <span className="sr-only">Buscar espectador</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar pelo nome…"
            className="h-9 w-full rounded-xl border border-white/10 bg-black/30 pl-8 pr-3 text-xs text-slate-200 outline-none placeholder:text-slate-600"
          />
        </label>
      </div>

      <div className="mt-3">
        {loading ? (
          <SkeletonList label="Carregando espectadores" rows={3} itemClassName="h-11" />
        ) : result?.error ? (
          <ErrorState
            title="Memória indisponível"
            message={result.error}
            retryLabel="Tentar de novo"
            onRetry={() => setReloadKey((key) => key + 1)}
          />
        ) : profiles.length === 0 ? (
          <EmptyState
            icon={Users}
            title={search ? 'Ninguém com esse nome' : 'Ninguém na memória ainda'}
            description={search ? undefined : 'Os espectadores aparecem aqui conforme falam no chat da live.'}
          />
        ) : (
          <ul className="anim-fade-in divide-y divide-white/5">
            {profiles.map((profile) => (
              <li key={profile.id} className="flex flex-wrap items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-slate-200">@{profile.username}</span>
                    {profile.hidden && <Badge variant="warning">oculto</Badge>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                    <span className="inline-flex items-center gap-1">
                      <MessageCircle className="h-3 w-3" /> {plural(profile.totalMessages, 'mensagem', 'mensagens')}
                    </span>
                    {profile.totalGifts > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <Gift className="h-3 w-3" /> {plural(profile.totalGifts, 'presente', 'presentes')}
                      </span>
                    )}
                    {lastSeenLabel(profile.lastSeen) && <span>visto em {lastSeenLabel(profile.lastSeen)}</span>}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  loading={busy?.id === profile.id && busy.action === 'visibility'}
                  disabled={busy !== null}
                  onClick={() => void toggleHidden(profile)}
                >
                  {profile.hidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  {profile.hidden ? 'Mostrar' : 'Ocultar'}
                </Button>
                <ConfirmButton
                  size="sm"
                  variant="danger"
                  confirmLabel="Apagar mesmo?"
                  loading={busy?.id === profile.id && busy.action === 'forget'}
                  disabled={busy !== null}
                  onConfirm={() => forget(profile)}
                >
                  <UserX className="h-3.5 w-3.5" /> Esquecer
                </ConfirmButton>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
