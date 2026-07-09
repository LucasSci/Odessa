import { useCallback, useEffect, useState } from 'react';
import type { MouseEvent } from 'react';
import { Crosshair, MapPin, MessageCircle, RefreshCw, Save, ShieldCheck } from 'lucide-react';
import { cn } from '../lib/utils';
import { Badge, Button, Input, StatusDot } from './ui';
import { getAiConfig } from '../core/aiConfig';
import {
  LIVE_CHAT_SCREENSHOT_TARGET,
  getChatAutomationConfig,
  loadChatAutomationTarget,
  saveChatAutomationConfig,
  saveChatAutomationTarget,
  sendChatAutomationMessage,
  validateChatAutomationTarget,
  type ChatAutomationAllowEntry,
  type ChatAutomationSendResult,
  type ChatAutomationTarget,
} from '../lib/chatAutomation';

function isVisualTargetReady(target: ChatAutomationTarget) {
  return Boolean(
    target.mode === 'visual' &&
      target.inputPoint &&
      typeof target.inputPoint.x === 'number' &&
      typeof target.inputPoint.y === 'number' &&
      target.viewport &&
      typeof target.viewport.width === 'number' &&
      typeof target.viewport.height === 'number',
  );
}

function pixelFromPoint(target: ChatAutomationTarget, point = target.inputPoint) {
  if (!point || !target.viewport) return null;
  return {
    x: Math.round(point.x * target.viewport.width),
    y: Math.round(point.y * target.viewport.height),
  };
}

function visualTargetErrors(target: ChatAutomationTarget, allowlistReady = true) {
  const errors: string[] = [];
  if (!target.viewport?.width || !target.viewport?.height) {
    errors.push('Viewport ausente: informe largura e altura antes de validar.');
  }
  if (typeof target.inputPoint?.x !== 'number' || typeof target.inputPoint?.y !== 'number') {
    errors.push('inputPoint ausente: clique no preview para marcar onde digitar.');
  }
  if (!allowlistReady) {
    errors.push('Allowlist ausente: salve o alvo visual no backend como tango-live-chat.');
  }
  return errors;
}

export function ChatVisualTargetPanel({
  className,
  maxPerMinute,
}: {
  className?: string;
  maxPerMinute?: number;
}) {
  const [chatTarget, setChatTarget] = useState<ChatAutomationTarget>(() => ({
    ...LIVE_CHAT_SCREENSHOT_TARGET,
    ...loadChatAutomationTarget(),
    mode: 'visual',
  }));
  const [status, setStatus] = useState<'unknown' | 'ready' | 'blocked' | 'saving'>('unknown');
  const [message, setMessage] = useState('Pendente');
  const [logs, setLogs] = useState<Array<Record<string, unknown>>>([]);
  const [calibrationPoint, setCalibrationPoint] = useState<'input' | 'send'>('input');
  const [testText, setTestText] = useState('Teste Odessa: alvo visual calibrado.');
  const [busy, setBusy] = useState<'dry' | 'fill' | null>(null);
  const [lastResult, setLastResult] = useState<ChatAutomationSendResult | null>(null);
  const [saved, setSaved] = useState(false);

  const inputPixel = pixelFromPoint(chatTarget, chatTarget.inputPoint);
  const sendPixel = pixelFromPoint(chatTarget, chatTarget.sendPoint);
  const visualReady = isVisualTargetReady(chatTarget);
  const visualErrors = visualTargetErrors(chatTarget, status === 'ready');
  const effectiveMaxPerMinute = maxPerMinute ?? getAiConfig().chatReplyMaxPerMinute;

  const refresh = useCallback(async () => {
    const savedTarget = { ...LIVE_CHAT_SCREENSHOT_TARGET, ...loadChatAutomationTarget(), mode: 'visual' as const };
    setChatTarget(savedTarget);
    try {
      const config = await getChatAutomationConfig();
      setLogs(config.logs.slice(-5).reverse());
      const localErrors = visualTargetErrors(savedTarget);
      if (localErrors.length > 0) {
        setStatus('unknown');
        setMessage(localErrors[0]);
        return;
      }
      const validation = await validateChatAutomationTarget(savedTarget);
      setStatus(validation.allowed ? 'ready' : 'blocked');
      setMessage(validation.allowed ? 'Alvo visual validado' : 'Allowlist ausente: salve o alvo visual no backend.');
    } catch (err) {
      setStatus('blocked');
      setMessage(err instanceof Error ? err.message : 'Falha ao validar chat');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handlePreviewClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const point = {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    };
    setChatTarget((current) => ({
      ...current,
      mode: 'visual',
      url: current.url || LIVE_CHAT_SCREENSHOT_TARGET.url,
      inputSelector: '',
      sendSelector: '',
      [calibrationPoint === 'send' ? 'sendPoint' : 'inputPoint']: point,
    }));
    setStatus('unknown');
    setMessage(calibrationPoint === 'send' ? 'Ponto de envio capturado. Salve para validar.' : 'Ponto de entrada capturado. Salve para validar.');
  }, [calibrationPoint]);

  const handleSave = useCallback(async () => {
    setStatus('saving');
    setMessage('Salvando alvo visual...');
    const normalized: ChatAutomationTarget = {
      ...chatTarget,
      mode: 'visual',
      url: chatTarget.url || LIVE_CHAT_SCREENSHOT_TARGET.url,
      inputSelector: '',
      sendSelector: '',
    };
    const localErrors = visualTargetErrors(normalized);
    if (localErrors.length > 0) {
      setStatus('blocked');
      setMessage(localErrors[0]);
      return;
    }
    try {
      const config = await getChatAutomationConfig().catch(() => ({ allowlist: [], logs: [] }));
      const entry: ChatAutomationAllowEntry = {
        id: 'tango-live-chat',
        label: 'Tango live chat',
        mode: 'visual',
        domain: 'visual:tango-live',
        urlPattern: '.*',
        inputSelector: 'visual-point',
        sendSelector: '',
        inputPoint: normalized.inputPoint,
        sendPoint: normalized.sendPoint,
        viewport: normalized.viewport,
        submitWithEnter: true,
        typingDelayMs: 25,
        maxPerMinute: effectiveMaxPerMinute,
        enabled: true,
      };
      await saveChatAutomationConfig([
        entry,
        ...config.allowlist.filter((item) => item.id !== entry.id),
      ]);
      saveChatAutomationTarget(normalized);
      setSaved(true);
      await refresh();
      window.setTimeout(() => setSaved(false), 1800);
    } catch (err) {
      setStatus('blocked');
      setMessage(err instanceof Error ? err.message : 'Falha ao salvar alvo visual');
    }
  }, [chatTarget, effectiveMaxPerMinute, refresh]);

  const handleTest = useCallback(async (mode: 'dry' | 'fill') => {
    const text = testText.trim();
    if (!text) {
      setStatus('blocked');
      setMessage('Texto de teste ausente.');
      return;
    }
    const localErrors = visualTargetErrors(chatTarget, status === 'ready');
    if (localErrors.length > 0) {
      setStatus('blocked');
      setMessage(localErrors[0]);
      return;
    }
    setBusy(mode);
    setLastResult(null);
    try {
      const result = await sendChatAutomationMessage({
        mode: 'visual',
        url: chatTarget.url || LIVE_CHAT_SCREENSHOT_TARGET.url,
        inputSelector: '',
        inputPoint: chatTarget.inputPoint,
        sendPoint: chatTarget.sendPoint,
        viewport: chatTarget.viewport,
        text,
        dryRun: mode === 'dry',
        submit: false,
      });
      setLastResult(result);
      const ok = result.allowed && result.status !== 'blocked';
      setStatus(ok ? 'ready' : 'blocked');
      if (mode === 'dry' && ok) {
        setMessage('Dry-run validado: ponto, texto e envio planejado conferidos.');
      } else if (ok && result.queued) {
        setMessage('Digitacao enfileirada sem enviar. O agente vai clicar e colar sem Enter.');
      } else {
        setMessage(result.reason || result.execution?.error || 'Teste bloqueado');
      }
    } catch (err) {
      setStatus('blocked');
      setMessage(err instanceof Error ? err.message : 'Falha no teste do alvo visual');
    } finally {
      setBusy(null);
    }
  }, [chatTarget, status, testText]);

  return (
    <section className={cn('rounded-lg border border-[var(--odessa-border)] bg-[var(--odessa-surface-strong)]', className)}>
      <div className="border-b border-[var(--border)] px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-black text-[var(--t1)]">Alvo visual do chat</h3>
            <p className="mt-1 text-xs leading-5 text-[var(--t3)]">
              Calibre onde o agente local deve clicar para digitar no chat da live.
            </p>
          </div>
          <Badge variant={status === 'ready' ? 'success' : status === 'blocked' ? 'danger' : 'warning'} className="shrink-0">
            <StatusDot status={status === 'ready' ? 'online' : status === 'blocked' ? 'error' : 'warn'} pulse={status === 'saving'} />
            {status === 'ready' ? 'validado' : status === 'saving' ? 'salvando' : 'pendente'}
          </Badge>
        </div>
        <p className="mt-2 text-[11px] leading-5 text-[var(--t3)]">{message}</p>
      </div>

      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant={calibrationPoint === 'input' ? 'primary' : 'secondary'}
            onClick={() => setCalibrationPoint('input')}
          >
            <MapPin className="h-3.5 w-3.5" />
            Entrada
          </Button>
          <Button
            type="button"
            size="sm"
            variant={calibrationPoint === 'send' ? 'primary' : 'secondary'}
            onClick={() => setCalibrationPoint('send')}
          >
            <MapPin className="h-3.5 w-3.5" />
            Envio
          </Button>
          <span className="ml-auto font-mono text-[10px] text-[var(--t3)]">
            {chatTarget.viewport?.width || 0}x{chatTarget.viewport?.height || 0}
          </span>
        </div>

        <button
          type="button"
          data-testid="chat-calibration-preview"
          onClick={handlePreviewClick}
          className="relative block aspect-[16/9] w-full overflow-hidden rounded-md border border-[var(--border)] bg-[#07090d] text-left outline-none transition hover:border-sky-400/50 focus:border-sky-300"
        >
          <div className="absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.08)_1px,transparent_1px)] bg-[size:10%_10%]" />
          <div className="absolute inset-x-[6%] top-[7%] h-[58%] rounded-md border border-slate-700/70 bg-slate-900/40" />
          <div className="absolute inset-x-[6%] bottom-[7%] h-[13%] rounded-md border border-slate-600/80 bg-slate-950/80" />
          <div className="absolute bottom-[10%] left-[8%] flex items-center gap-1 rounded bg-black/60 px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-slate-400">
            <Crosshair className="h-3 w-3" />
            clique para marcar {calibrationPoint === 'input' ? 'entrada' : 'envio'}
          </div>
          {chatTarget.inputPoint && (
            <span
              className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-sky-200 bg-sky-400 shadow-[0_0_18px_rgba(56,189,248,0.65)]"
              style={{ left: `${chatTarget.inputPoint.x * 100}%`, top: `${chatTarget.inputPoint.y * 100}%` }}
            />
          )}
          {chatTarget.sendPoint && (
            <span
              className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-emerald-200 bg-emerald-400 shadow-[0_0_18px_rgba(52,211,153,0.65)]"
              style={{ left: `${chatTarget.sendPoint.x * 100}%`, top: `${chatTarget.sendPoint.y * 100}%` }}
            />
          )}
        </button>

        <div className="grid grid-cols-2 gap-2 text-[10px]">
          <div className="rounded-md border border-sky-400/20 bg-sky-500/8 px-2 py-1.5 text-sky-100">
            <span className="block font-bold uppercase tracking-widest text-sky-300">inputPoint</span>
            <span className="font-mono">
              {chatTarget.inputPoint
                ? `${chatTarget.inputPoint.x.toFixed(4)}, ${chatTarget.inputPoint.y.toFixed(4)}`
                : 'ausente'}
            </span>
            <span className="block font-mono text-sky-200/70">
              {inputPixel ? `${inputPixel.x}px, ${inputPixel.y}px` : 'pixel pendente'}
            </span>
          </div>
          <div className="rounded-md border border-emerald-400/20 bg-emerald-500/8 px-2 py-1.5 text-emerald-100">
            <span className="block font-bold uppercase tracking-widest text-emerald-300">sendPoint</span>
            <span className="font-mono">
              {chatTarget.sendPoint
                ? `${chatTarget.sendPoint.x.toFixed(4)}, ${chatTarget.sendPoint.y.toFixed(4)}`
                : 'Enter'}
            </span>
            <span className="block font-mono text-emerald-200/70">
              {sendPixel ? `${sendPixel.x}px, ${sendPixel.y}px` : 'sem clique de envio'}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Input
            label="Viewport W"
            type="number"
            value={chatTarget.viewport?.width || ''}
            onChange={(event) =>
              setChatTarget((current) => ({
                ...current,
                viewport: {
                  width: Math.max(1, Number(event.target.value) || 1),
                  height: current.viewport?.height || LIVE_CHAT_SCREENSHOT_TARGET.viewport?.height || 938,
                },
              }))
            }
          />
          <Input
            label="Viewport H"
            type="number"
            value={chatTarget.viewport?.height || ''}
            onChange={(event) =>
              setChatTarget((current) => ({
                ...current,
                viewport: {
                  width: current.viewport?.width || LIVE_CHAT_SCREENSHOT_TARGET.viewport?.width || 1920,
                  height: Math.max(1, Number(event.target.value) || 1),
                },
              }))
            }
          />
        </div>

        <Input
          label="Texto de teste"
          value={testText}
          onChange={(event) => setTestText(event.target.value)}
        />

        {visualErrors.length > 0 && (
          <div className="rounded-md border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-[11px] leading-5 text-amber-200">
            {visualErrors[0]}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setChatTarget(LIVE_CHAT_SCREENSHOT_TARGET)}>
            <MapPin className="h-3.5 w-3.5" />
            Layout print
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void refresh()}>
            <RefreshCw className="h-3.5 w-3.5" />
            Validar
          </Button>
          <Button variant="primary" size="sm" loading={status === 'saving'} onClick={() => void handleSave()}>
            <Save className="h-3.5 w-3.5" />
            {saved ? 'Salvo' : 'Salvar'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            loading={busy === 'dry'}
            disabled={!visualReady}
            onClick={() => void handleTest('dry')}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Dry-run
          </Button>
          <Button
            variant="secondary"
            size="sm"
            loading={busy === 'fill'}
            disabled={!visualReady}
            onClick={() => void handleTest('fill')}
          >
            <MessageCircle className="h-3.5 w-3.5" />
            Digitar
          </Button>
        </div>

        {lastResult && (
          <div data-testid="chat-calibration-test-result" className="grid gap-2 rounded-md border border-[var(--border)] bg-[var(--bg1)]/50 p-3 text-[11px]">
            <div>
              <span className="block text-[9px] font-bold uppercase tracking-widest text-[var(--t4)]">Texto</span>
              <span className="text-[var(--t2)]">{lastResult.text || testText}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <span className="font-mono text-sky-300">
                {lastResult.plannedInputPixel
                  ? `input ${lastResult.plannedInputPixel.x}px, ${lastResult.plannedInputPixel.y}px`
                  : 'input pendente'}
              </span>
              <span className="font-mono text-emerald-300">
                {lastResult.submit === false
                  ? 'sem Enter'
                  : lastResult.plannedSendPixel
                    ? `send ${lastResult.plannedSendPixel.x}px, ${lastResult.plannedSendPixel.y}px`
                    : 'Enter'}
              </span>
            </div>
          </div>
        )}

        <div className="rounded-md border border-white/8 bg-black/20 px-3 py-2 text-[11px] leading-5 text-[var(--t3)]">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-[var(--t3)]">
            <ShieldCheck className="h-3.5 w-3.5 text-amber-300" />
            Seguranca
          </div>
          <p className="mt-1">
            Salvar aqui prepara apenas o alvo fisico. O envio real ainda depende da Diretoria,
            autonomia, OCR confiavel, cooldown e agente local.
          </p>
        </div>

        {logs.length > 0 && (
          <div className="space-y-1">
            <span className="text-[9px] font-bold uppercase tracking-widest text-[var(--t4)]">
              Ultimos testes
            </span>
            {logs.slice(0, 3).map((entry, index) => {
              const result = entry.result as Record<string, unknown> | undefined;
              const logStatus = String(result?.status || 'log');
              return (
                <div
                  key={String(entry.id || index)}
                  className="flex items-center justify-between gap-2 rounded-md border border-white/8 bg-black/20 px-2 py-1.5 text-[10px]"
                >
                  <span className="truncate text-[var(--t2)]">{String(entry.text || '')}</span>
                  <span className={cn('shrink-0 font-mono', logStatus === 'blocked' || logStatus === 'failed' ? 'text-red-300' : 'text-sky-300')}>
                    {String(result?.reason || logStatus)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
