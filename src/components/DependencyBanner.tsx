import { useCallback, useState } from 'react';
import { AlertTriangle, ExternalLink, Loader2, X } from 'lucide-react';
import { ApiError, apiFetch } from '../lib/apiFetch';
import { safeSession } from '../lib/safeStorage';
import { parseDepsReport, pickIssueToShow, type DepsIssue, type DepsReport } from '../core/depsHealth';
import { usePolling } from '../core/usePolling';
import { cn } from '../lib/utils';

const POLL_MS = 30_000;
// Depois de "Baixar modelo" o download leva minutos: reconsulta mais rápido.
const FAST_POLL_MS = 6_000;

const DISMISSED_KEY = 'odessa.deps.dismissed';

function readDismissed(): Set<string> {
  const stored = safeSession.getJSON<unknown>(DISMISSED_KEY, []);
  return new Set(Array.isArray(stored) ? stored.filter((item): item is string => typeof item === 'string') : []);
}

function saveDismissed(codes: Set<string>) {
  safeSession.setJSON(DISMISSED_KEY, [...codes]);
}

/**
 * Avisa quando o Ollama não está instalado/rodando ou falta o modelo, com o
 * botão que resolve. Antes o operador só percebia que a IA local não estava
 * sendo usada porque a Odessa repetia a mesma frase.
 */
export function DependencyBanner() {
  const [report, setReport] = useState<DepsReport | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(readDismissed);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [fast, setFast] = useState(false);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const parsed = parseDepsReport(await apiFetch<unknown>('/health/deps', { timeoutMs: 8_000, signal }));
      if (parsed && !signal?.aborted) setReport(parsed);
    } catch {
      // backend fora do ar: os outros indicadores do app já mostram isso
    }
  }, []);

  usePolling(refresh, fast ? FAST_POLL_MS : POLL_MS);

  const issue = pickIssueToShow(report, dismissed);
  if (!issue) return null;

  const runAction = async (item: DepsIssue) => {
    const action = item.action;
    if (!action) return;
    if (action.kind === 'link') {
      window.open(action.url, '_blank', 'noopener,noreferrer');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const data = await apiFetch<{ message?: string } | undefined>(action.path, { method: 'POST', timeoutMs: 30_000 });
      setMessage(data?.message || 'Pronto.');
      setFast(true);
    } catch (error) {
      setMessage(error instanceof ApiError || error instanceof Error ? error.message : 'Não foi possível concluir a ação.');
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  const dismiss = (code: string) => {
    const next = new Set(dismissed).add(code);
    setDismissed(next);
    saveDismissed(next);
  };

  return (
    <div
      role="status"
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2 text-[13px]',
        issue.severity === 'error'
          ? 'border-red-500/30 bg-red-500/10 text-red-100'
          : 'border-amber-500/30 bg-amber-500/10 text-amber-100',
      )}
    >
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        {issue.message}
        {message && <span className="ml-2 opacity-80">{message}</span>}
      </span>
      {issue.action && (
        <button
          type="button"
          className="odsa-btn odsa-btn-secondary odsa-btn-md"
          disabled={busy}
          onClick={() => void runAction(issue)}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : issue.action.kind === 'link' ? <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> : null}
          {issue.action.label}
        </button>
      )}
      <button
        type="button"
        className="odsa-btn odsa-btn-icon odsa-btn-md"
        aria-label="Dispensar este aviso"
        onClick={() => dismiss(issue.code)}
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
