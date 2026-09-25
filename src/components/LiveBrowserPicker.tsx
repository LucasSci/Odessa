/**
 * LiveBrowserPicker — escolhe o navegador que abre a página do Tango para a
 * bridge (Edge, Chrome, Brave…). "Automático" = navegador padrão do sistema,
 * depois Edge, depois Chrome. A escolha fica no config da bridge (backend),
 * então vale para o botão "Abrir página", o atalho e o modo standalone.
 */
import { useCallback, useEffect, useState } from 'react';
import { Globe } from 'lucide-react';
import { BRIDGE_API, type BridgeConfig } from '../core/tangoChatSession';
import { apiUrl } from '../lib/api';

export type LiveBrowser = { id: string; name: string; path: string; isDefault: boolean };
type BrowsersResponse = { preference: string; resolved: LiveBrowser | null; browsers: LiveBrowser[] };

async function fetchBrowsers(): Promise<BrowsersResponse> {
  const res = await fetch(apiUrl(`${BRIDGE_API}/browsers`));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as BrowsersResponse;
}

export function LiveBrowserPicker({
  bridgeConfig,
  onResolved,
}: {
  bridgeConfig: BridgeConfig;
  /** Navegador efetivo (o escolhido ou o do Automático), para os textos da tela. */
  onResolved?: (browser: LiveBrowser | null) => void;
}) {
  const [data, setData] = useState<BrowsersResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback(
    (next: BrowsersResponse) => {
      setData(next);
      onResolved?.(next.resolved);
    },
    [onResolved],
  );

  useEffect(() => {
    let alive = true;
    fetchBrowsers()
      .then((next) => {
        if (alive) apply(next);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : 'Falha ao listar navegadores');
      });
    return () => {
      alive = false;
    };
  }, [apply]);

  const choose = async (browser: string) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(apiUrl(`${BRIDGE_API}/config`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...bridgeConfig, browser }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      apply(await fetchBrowsers());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const autoTarget = data?.preference === 'auto' ? data?.resolved?.name : null;
  const defaultBrowser = data?.browsers.find((b) => b.isDefault);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-2 text-xs font-semibold text-slate-300">
        <Globe className="h-3.5 w-3.5 text-sky-300" />
        Navegador da live
        <select
          value={data?.preference ?? 'auto'}
          disabled={!data || saving}
          onChange={(event) => void choose(event.target.value)}
          className="h-8 rounded-lg border border-white/10 bg-black/40 px-2 text-xs text-white outline-none focus:border-sky-400/50"
        >
          <option value="auto">Automático{autoTarget ? ` (${autoTarget})` : ''}</option>
          {(data?.browsers ?? []).map((browser) => (
            <option key={browser.id} value={browser.id}>
              {browser.name}
              {browser.isDefault ? ' — padrão do sistema' : ''}
            </option>
          ))}
        </select>
      </label>
      {data && data.browsers.length === 0 && (
        <span className="text-[11px] text-amber-300">Nenhum Edge/Chrome encontrado — a bridge usa o navegador interno do Odessa.</span>
      )}
      {data && data.preference === 'auto' && defaultBrowser && (
        <span className="text-[11px] text-slate-500">Automático segue o navegador padrão do Windows.</span>
      )}
      {error && <span className="text-[11px] text-red-300">{error}</span>}
    </div>
  );
}
