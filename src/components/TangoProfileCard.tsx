/**
 * Configuração limpa do perfil do Tango no OBS, direto do Odessa — no lugar de
 * abrir o OBS, apagar o perfil, importar o .zip de novo e colar a chave.
 *
 * Mostra o diagnóstico (perfis duplicados, tela diferente do modelo, quando a
 * chave vence) e faz a configuração: fecha o OBS, guarda um backup, apaga os
 * perfis do Tango, cria um só e abre o OBS de novo. A chave nunca volta do
 * servidor e o campo é limpo depois do uso.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, FileArchive, RefreshCw, Sparkles, TriangleAlert } from 'lucide-react';
import { apiFetch } from '../lib/apiFetch';
import { useToast } from './Toast';
import { Badge, Button, ConfirmButton, Input, SkeletonList } from './ui';

interface KeyInfo {
  present: boolean;
  expiresAt: string | null;
  daysLeft: number | null;
  expired: boolean;
  expiringSoon: boolean;
}

interface ProfileInfo {
  name: string;
  folder: string;
  active: boolean;
  canvas: string;
  differences: string[];
  key: KeyInfo;
}

interface TangoProfileStatus {
  ok: boolean;
  obsRunning: boolean | null;
  activeProfile: string;
  profiles: ProfileInfo[];
  problems: string[];
}

interface CleanResult {
  ok: boolean;
  removed: string[];
  backup: string | null;
  keySource: 'colada' | 'zip' | 'perfil atual';
  key: KeyInfo;
  obsRestarted: boolean;
  obsWasRunning: boolean;
  canvas: { width: number; height: number };
}

function formatDate(iso: string | null) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function KeyBadge({ info }: { info: KeyInfo }) {
  if (!info.present) return <Badge variant="danger">sem chave</Badge>;
  if (!info.expiresAt) return <Badge variant="default">chave sem validade</Badge>;
  if (info.expired) return <Badge variant="danger">chave venceu {formatDate(info.expiresAt)}</Badge>;
  const days = Math.max(0, Math.floor(info.daysLeft ?? 0));
  return (
    <Badge variant={info.expiringSoon ? 'warning' : 'success'}>
      chave vence {formatDate(info.expiresAt)} · {days === 0 ? 'hoje' : `${days} dia${days === 1 ? '' : 's'}`}
    </Badge>
  );
}

export function TangoProfileCard({ onRebuilt }: { onRebuilt?: (canvas: CleanResult['canvas']) => void }) {
  const toast = useToast();
  const [status, setStatus] = useState<TangoProfileStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [key, setKey] = useState('');
  const [zip, setZip] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CleanResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setChecking(true);
    try {
      setStatus(await apiFetch<TangoProfileStatus>('/obs/tango-profile/status', { timeoutMs: 30_000 }));
      setStatusError(null);
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : 'Não consegui ler os perfis do OBS.');
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(first);
  }, [refresh]);

  const clean = async () => {
    setBusy(true);
    setResult(null);
    try {
      const form = new FormData();
      if (key.trim()) form.append('streamKey', key.trim());
      if (zip) form.append('profileZip', zip);
      const done = await apiFetch<CleanResult>('/obs/tango-profile/clean', {
        method: 'POST',
        rawBody: form,
        // Fecha o OBS (até ~25 s), escreve e abre de novo.
        timeoutMs: 90_000,
      });
      setKey('');
      setZip(null);
      if (fileRef.current) fileRef.current.value = '';
      setResult(done);
      toast.success(done.obsRestarted ? 'Perfil do Tango configurado do zero. O OBS está abrindo de novo.' : 'Perfil do Tango configurado do zero.');
      onRebuilt?.(done.canvas);
      void refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não consegui fazer a configuração limpa.');
    } finally {
      setBusy(false);
    }
  };

  const hasProfiles = Boolean(status?.profiles.length);

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-[var(--t3)]">
        Fecha o OBS, guarda um backup, apaga os perfis do Tango (inclusive duplicados), cria um só com as configurações do Tango
        (saída avançada, 720×1280, keyframe de 1 s) e a chave, e abre o OBS de novo. As cenas não mudam. Não roda com a live no ar.
      </p>

      {/* Diagnóstico */}
      <div className="rounded-xl border border-[var(--border2)] bg-[var(--bg3)]/40 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--t3)]">Como está o OBS</span>
          <Button variant="ghost" size="sm" loading={checking} onClick={() => void refresh()} aria-label="Verificar de novo">
            <RefreshCw className="h-3.5 w-3.5" />
            Verificar
          </Button>
        </div>
        {!status && !statusError && <SkeletonList rows={2} label="Lendo os perfis do OBS…" />}
        {statusError && <p className="text-xs text-red-300">{statusError}</p>}
        {status && (
          <div className="anim-fade-in space-y-2">
            {hasProfiles ? (
              <ul className="space-y-1.5">
                {status.profiles.map((profile) => (
                  <li key={profile.folder} className="flex flex-wrap items-center gap-2 text-xs text-[var(--t2)]">
                    <span className="font-semibold text-[var(--t1)]">{profile.name}</span>
                    <span className="font-mono text-[var(--t4)]">{profile.folder}</span>
                    {profile.active && <Badge variant="lavender">ativo</Badge>}
                    <span className="text-[var(--t3)]">{profile.canvas}</span>
                    <KeyBadge info={profile.key} />
                  </li>
                ))}
              </ul>
            ) : null}
            {status.ok ? (
              <p className="flex items-center gap-1.5 text-xs text-emerald-300">
                <CheckCircle2 className="h-3.5 w-3.5" /> Perfil do Tango em ordem.
              </p>
            ) : (
              <ul className="space-y-1">
                {status.problems.map((problem) => (
                  <li key={problem} className="flex gap-1.5 text-xs text-amber-200">
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {problem}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Configuração limpa */}
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <Input
          label="Chave de transmissão do Tango"
          type="password"
          autoComplete="off"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Vazio = usa a do .zip ou a que já está no OBS (se não venceu)"
        />
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            aria-label="Perfil exportado do Tango (.zip)"
            onChange={(e) => setZip(e.target.files?.[0] ?? null)}
          />
          <Button variant="ghost" onClick={() => fileRef.current?.click()}>
            <FileArchive className="h-4 w-4" />
            {zip ? zip.name : '.zip do Tango (opcional)'}
          </Button>
          <ConfirmButton variant="secondary" confirmLabel="Fechar o OBS e configurar?" loading={busy} onConfirm={clean}>
            <Sparkles className="h-4 w-4" />
            Configuração limpa
          </ConfirmButton>
        </div>
      </div>

      {result && (
        <div className="anim-fade-in space-y-1 rounded-xl border border-emerald-400/20 bg-emerald-500/5 p-3 text-xs text-emerald-200">
          <p className="flex items-center gap-1.5 font-semibold">
            <CheckCircle2 className="h-3.5 w-3.5" /> Perfil do Tango criado do zero ({result.canvas.width}×{result.canvas.height}).
          </p>
          <p>
            Chave {result.keySource === 'colada' ? 'colada agora' : result.keySource === 'zip' ? 'do .zip' : 'que já estava no OBS'}
            {result.key.expiresAt ? `, vale até ${formatDate(result.key.expiresAt)}` : ''}.
          </p>
          {result.removed.length > 0 && (
            <p>
              Removidos: {result.removed.join(', ')} (backup guardado na pasta do OBS).
            </p>
          )}
          <p>{result.obsRestarted ? 'O OBS foi reaberto.' : result.obsWasRunning ? 'Abra o OBS de novo.' : 'O OBS estava fechado: abra quando quiser.'}</p>
        </div>
      )}
    </div>
  );
}
