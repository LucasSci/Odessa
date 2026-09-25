/**
 * BrowserExtensionCard — usar a aba do Tango em que o usuário JÁ está logado
 * (Edge/Chrome dele, qualquer perfil) através da extensão do Odessa, em vez de
 * abrir um navegador próprio que pede login de novo.
 *
 * Backend: /bridge/extension (info), /bridge/extension/prepare (gera a pasta
 * "sem pacote" com o token de pareamento) e o WebSocket /tango-bridge/extension.
 */
import { useEffect, useState } from 'react';
import { CheckCircle2, FolderOpen, Loader2, PlugZap } from 'lucide-react';
import { BRIDGE_API, type BridgeConfig, type BridgeProcessStatus } from '../core/tangoChatSession';
import { apiUrl } from '../lib/api';
import { Button } from './ui';

type ExtensionInfo = { path: string; prepared: boolean; version: string };

export function BrowserExtensionCard({
  processStatus,
  bridgeConfig,
  onUseExtension,
}: {
  processStatus: BridgeProcessStatus | null;
  bridgeConfig: BridgeConfig;
  /** Salva o modo "extension" e (re)inicia a bridge esperando a extensão. */
  onUseExtension: () => Promise<void>;
}) {
  const [info, setInfo] = useState<ExtensionInfo | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(apiUrl(`${BRIDGE_API}/extension`))
      .then((res) => (res.ok ? (res.json() as Promise<ExtensionInfo>) : null))
      .then((next) => {
        if (alive && next) setInfo(next);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const bridge = processStatus?.bridgeStatus;
  const extensionMode = bridgeConfig.mode === 'extension' || bridge?.mode === 'extension';
  const connected = bridge?.mode === 'extension' && bridge?.status === 'connected';
  const waiting = extensionMode && !connected && Boolean(processStatus?.bridgeReachable);

  const prepare = async () => {
    setPreparing(true);
    setError(null);
    try {
      const res = await fetch(apiUrl(`${BRIDGE_API}/extension/prepare`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reveal: true }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setInfo({ ...(await res.json()), prepared: true } as ExtensionInfo);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao preparar a extensão');
    } finally {
      setPreparing(false);
    }
  };

  const switchToExtension = async () => {
    setSwitching(true);
    setError(null);
    try {
      await onUseExtension();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao trocar o modo da bridge');
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-violet-500/25 bg-violet-500/[0.06] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h5 className="flex items-center gap-2 text-sm font-bold text-white">
            <PlugZap className="h-4 w-4 text-violet-300" /> Usar a aba já logada (extensão)
          </h5>
          <p className="mt-1 text-xs text-slate-400">
            Sem novo login e sem número de telefone: a extensão do Odessa lê o chat e envia as respostas pela aba do
            Tango que você já usa no Edge ou no Chrome — em qualquer perfil.
          </p>
        </div>
        {connected ? (
          <span className="flex items-center gap-1 rounded-lg bg-emerald-500/15 px-2 py-1 text-[11px] font-bold text-emerald-300">
            <CheckCircle2 className="h-3.5 w-3.5" /> Conectado via extensão{bridge?.browserName ? ` (${bridge.browserName})` : ''}
          </span>
        ) : waiting ? (
          <span className="flex items-center gap-1 rounded-lg bg-amber-500/15 px-2 py-1 text-[11px] font-bold text-amber-300">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Aguardando a aba do Tango…
          </span>
        ) : null}
      </div>

      {!connected && (
        <ol className="list-decimal space-y-1.5 pl-5 text-xs text-slate-300">
          <li>
            <Button size="sm" variant="secondary" disabled={preparing} onClick={() => void prepare()}>
              {preparing ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <FolderOpen className="mr-1 h-3.5 w-3.5" />}
              {info?.prepared ? 'Atualizar extensão' : 'Preparar extensão'}
            </Button>
            {info?.prepared && (
              <span className="ml-2 break-all text-[11px] text-slate-500">
                Pasta: <code className="text-slate-300">{info.path}</code>
              </span>
            )}
          </li>
          <li>
            No navegador logado (ex.: Edge, perfil da live), abra <code className="text-slate-200">edge://extensions</code>{' '}
            (ou <code className="text-slate-200">chrome://extensions</code>), ligue o <b>Modo de desenvolvedor</b> e clique em{' '}
            <b>Carregar sem pacote</b> escolhendo a pasta acima. Depois de “Atualizar extensão”, clique em recarregar nela.
          </li>
          <li>
            {extensionMode ? (
              'Abra (ou recarregue) a sua live no Tango nesse navegador — a conexão é automática.'
            ) : (
              <>
                <Button size="sm" variant="primary" disabled={switching} onClick={() => void switchToExtension()}>
                  {switching && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                  Usar este modo
                </Button>{' '}
                e depois abra (ou recarregue) a sua live no Tango nesse navegador.
              </>
            )}
          </li>
        </ol>
      )}
      {connected && bridge?.pageUrl && <p className="break-all text-[11px] text-slate-500">Aba: {bridge.pageUrl}</p>}
      {error && <p className="text-[11px] text-red-300">{error}</p>}
    </div>
  );
}
