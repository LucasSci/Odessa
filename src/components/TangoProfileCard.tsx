/**
 * Recriar o perfil do Tango no OBS com um clique — no lugar de abrir o OBS,
 * apagar o perfil, importar o .zip de novo e colar a chave.
 * A chave é opcional (sem ela, reaproveita a que já está no OBS) e nunca é
 * guardada pelo Odessa.
 */
import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { apiFetch } from '../lib/apiFetch';
import { useToast } from './Toast';
import { ConfirmButton, Input } from './ui';

interface RebuildResult {
  ok: boolean;
  keyReused: boolean;
  encoderApplied: boolean;
  canvas: { width: number; height: number };
}

export function TangoProfileCard({ onRebuilt }: { onRebuilt?: (canvas: RebuildResult['canvas']) => void }) {
  const toast = useToast();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const rebuild = async () => {
    setBusy(true);
    setDone(null);
    try {
      const result = await apiFetch<RebuildResult>('/obs/tango-profile/rebuild', {
        method: 'POST',
        json: { streamKey: key.trim() || undefined },
        timeoutMs: 60_000,
      });
      setKey('');
      const summary = `Perfil do Tango recriado ${result.keyReused ? 'com a chave que já estava no OBS' : 'com a chave colada'}, tela ${result.canvas.width}×${result.canvas.height}.`;
      setDone(result.encoderApplied ? summary : `${summary} Atenção: não achei a pasta do perfil, então o ajuste do encoder (keyframe 1 s) não foi aplicado.`);
      toast.success('Perfil do Tango recriado no OBS.');
      onRebuilt?.(result.canvas);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não consegui recriar o perfil.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-[var(--t3)]">
        Quando o perfil do Tango der erro no OBS: apaga o perfil quebrado, cria um novo com as configurações do Tango (servidor,
        saída avançada, 720×1280, keyframe de 1 s) e coloca a chave. As cenas não mudam. Não funciona com a live no ar.
      </p>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <Input
          label="Chave de transmissão do Tango (opcional)"
          type="password"
          autoComplete="off"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Vazio = usa a chave que já está no OBS"
        />
        <ConfirmButton variant="secondary" confirmLabel="Recriar agora?" loading={busy} onConfirm={rebuild}>
          <RotateCcw className="h-4 w-4" />
          Recriar perfil do Tango
        </ConfirmButton>
      </div>
      {done && <p className="anim-fade-in text-xs text-emerald-300">{done}</p>}
    </div>
  );
}
