/**
 * "Desligar Odessa": para servidor, bridge do Tango e IA local. Avisa quando a
 * live está no ar (desligar derruba o overlay no OBS).
 */
import { useEffect, useState } from 'react';
import { Power } from 'lucide-react';
import { ASK_SHUTDOWN_EVENT, isLiveOnAir, shutdownOdessa } from '../core/desktopBridge';
import { useToast } from './Toast';
import { Button, Modal } from './ui';

export function ShutdownButton({ className }: { className?: string }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [onAir, setOnAir] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const ask = () => {
    setOnAir(null);
    setOpen(true);
    void isLiveOnAir().then(setOnAir);
  };

  // A Paleta de Comandos pede o mesmo diálogo.
  useEffect(() => {
    const onAsk = () => ask();
    window.addEventListener(ASK_SHUTDOWN_EVENT, onAsk);
    return () => window.removeEventListener(ASK_SHUTDOWN_EVENT, onAsk);
  }, []);

  const confirm = async () => {
    setBusy(true);
    try {
      const mode = await shutdownOdessa();
      if (mode === 'browser') setDone(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não consegui desligar o Odessa.');
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="anim-fade-in fixed inset-0 z-[80] grid place-items-center bg-[#050608] p-6 text-center">
        <div className="max-w-sm space-y-2">
          <Power className="mx-auto h-8 w-8 text-slate-400" />
          <h2 className="text-lg font-semibold text-white">Odessa desligado</h2>
          <p className="text-sm text-slate-400">Servidor, bridge do Tango e IA local foram encerrados. Pode fechar esta aba.</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <Button size="sm" variant="ghost" className={className} onClick={ask} aria-label="Desligar Odessa">
        <Power className="h-3.5 w-3.5" />
        Desligar
      </Button>
      <Modal open={open} onClose={() => !busy && setOpen(false)} label="Desligar o Odessa" className="max-w-md">
        <div className="space-y-4 rounded-[26px] border border-white/10 bg-[#0b0d10] p-5">
          <div className="space-y-1.5">
            <h2 className="flex items-center gap-2 text-base font-semibold text-white">
              <Power className="h-4 w-4 text-red-300" />
              Desligar o Odessa?
            </h2>
            <p className="text-sm leading-relaxed text-slate-400">
              Para o servidor, a bridge do Tango e a IA local. O OBS continua aberto. Para usar de novo, abra pelo atalho.
            </p>
            {onAir === null && <p className="text-xs text-slate-500">Conferindo se a live está no ar…</p>}
            {onAir && (
              <p className="anim-fade-in rounded-2xl border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-200">
                A live está no ar: desligar agora deixa o overlay do OBS vazio e para as respostas no chat.
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancelar
            </Button>
            <Button size="sm" variant="danger" onClick={() => void confirm()} loading={busy}>
              {onAir ? 'Desligar mesmo assim' : 'Desligar'}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
