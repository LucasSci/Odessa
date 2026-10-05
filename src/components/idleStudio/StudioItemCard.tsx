/**
 * Uma etapa do Estúdio da IDLE: imagem do kit ou clipe. Prompt pronto para
 * copiar, as imagens que entram (com copiar/baixar já no nome certo), os
 * resultados anexados e o status.
 */
import { memo, useRef, useState, type DragEvent } from 'react';
import { Check, Copy, Download, ExternalLink, ImagePlus, Sparkles, Star, Trash2 } from 'lucide-react';
import {
  assetDownloadHref,
  assetSrc,
  chosenAsset,
  copyImage,
  EMPTY_ITEM,
  inputKeys,
  type ItemStatus,
  type StudioAsset,
  type StudioImage,
  type StudioItemState,
  type StudioVideo,
} from '../../core/idleStudioApi';
import { cn } from '../../lib/utils';
import { Badge, Button, ConfirmButton } from '../ui';
import { useToast } from '../Toast';

export type StudioEntry =
  | { kind: 'image'; key: string; image: StudioImage | null }
  | { kind: 'video'; key: string; video: StudioVideo };

const STATUS_LABEL: Record<ItemStatus, string> = {
  pendente: 'Pendente',
  gerado: 'Gerado · conferir',
  refazer: 'Refazer',
  aprovado: 'Aprovado',
};
const STATUS_BADGE: Record<ItemStatus, 'default' | 'warning' | 'danger' | 'success'> = {
  pendente: 'default',
  gerado: 'warning',
  refazer: 'danger',
  aprovado: 'success',
};

const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp';
const VIDEO_ACCEPT = 'video/mp4,video/webm';

function isVideo(asset: StudioAsset) {
  return asset.type.startsWith('video/');
}

function Media({ asset, controls, className }: { asset: StudioAsset; controls?: boolean; className?: string }) {
  return isVideo(asset) ? (
    <video src={assetSrc(asset)} muted controls={controls} preload="metadata" className={className} />
  ) : (
    <img src={`${assetSrc(asset)}?w=320`} alt={asset.name} loading="lazy" decoding="async" className={className} />
  );
}

/** Copiar (só imagem), Baixar já com o nome da etapa e Abrir. */
function FileActions({ asset }: { asset: StudioAsset }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const onCopy = () => {
    copyImage(asset).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      },
      () => toast.warning('O sistema bloqueou a cópia da imagem. Use Baixar.'),
    );
  };
  const link = 'inline-flex items-center gap-1 text-[11px] font-semibold text-sky-300 hover:text-sky-200';
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {!isVideo(asset) && (
        <button type="button" className={link} onClick={onCopy}>
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copiada' : 'Copiar'}
        </button>
      )}
      <a className={link} href={assetDownloadHref(asset)} download={asset.name}>
        <Download className="h-3 w-3" />
        Baixar
      </a>
      <a className={link} href={assetSrc(asset)} target="_blank" rel="noreferrer">
        <ExternalLink className="h-3 w-3" />
        Abrir
      </a>
    </span>
  );
}

function InputRef({ label, itemKey, state }: { label: string; itemKey: string; state: StudioItemState }) {
  const asset = state.assets.length ? chosenAsset(state) : null;
  const ok = state.status === 'aprovado';
  return (
    <div className={cn('flex items-center gap-3 rounded-2xl border bg-white/[0.03] p-1.5 pr-3', ok ? 'border-white/10' : 'border-amber-400/30')}>
      <div className="grid h-[72px] w-[41px] shrink-0 place-items-center overflow-hidden rounded-xl bg-black/50">
        {asset ? <Media asset={asset} className="h-full w-full object-cover" /> : <span className="px-1 text-center text-[9px] text-slate-500">ainda não gerada</span>}
      </div>
      <div className="min-w-0 space-y-1 text-[11px] leading-tight">
        <div className="text-slate-400">{label}</div>
        <code className="block truncate text-[11px] font-medium text-slate-200">{asset ? asset.name : itemKey}</code>
        {!ok && <div className="text-amber-300">aprovar antes</div>}
        {asset && <FileActions asset={asset} />}
      </div>
    </div>
  );
}

function AssetThumb({
  asset,
  chosen,
  onChoose,
  onRemove,
}: {
  asset: StudioAsset;
  chosen: boolean;
  onChoose: () => void;
  onRemove: () => void;
}) {
  const renamed = asset.originalName && asset.originalName !== asset.name;
  return (
    <figure className={cn('m-0 overflow-hidden rounded-2xl border-2 bg-white/[0.03]', chosen ? 'border-sky-400/70' : 'border-white/10')}>
      <Media asset={asset} controls className="block aspect-[9/16] w-full bg-black object-cover" />
      <figcaption className="space-y-1.5 p-2 text-[11px]">
        <code className="block truncate font-semibold text-slate-100" title={asset.name}>{asset.name}</code>
        {renamed && <div className="truncate text-[10px] text-slate-500" title={`Nome original: ${asset.originalName}`}>era {asset.originalName}</div>}
        <div className="flex items-center justify-between gap-2">
          {chosen ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-300"><Star className="h-3 w-3" />Escolhida</span>
          ) : (
            <button type="button" onClick={onChoose} className="text-[11px] font-semibold text-slate-300 hover:text-white">Escolher</button>
          )}
          <ConfirmButton size="sm" variant="ghost" confirmLabel="Remover?" onConfirm={onRemove} className="h-6 px-2 text-[11px]" aria-label="Remover anexo">
            <Trash2 className="h-3 w-3" />
          </ConfirmButton>
        </div>
        <FileActions asset={asset} />
      </figcaption>
    </figure>
  );
}

function StudioItemCardBase({
  entry,
  state,
  states,
  negative,
  busy,
  generateReady,
  generateHint,
  onUpload,
  onStatus,
  onChoose,
  onRemove,
  onGenerate,
}: {
  entry: StudioEntry;
  state: StudioItemState;
  states: Record<string, StudioItemState>;
  negative: string;
  busy?: string;
  generateReady: boolean;
  generateHint: string;
  onUpload: (key: string, files: File[]) => void;
  onStatus: (key: string, status: ItemStatus) => void;
  onChoose: (key: string, assetId: string) => void;
  onRemove: (key: string, assetId: string) => void;
  onGenerate: (key: string) => void;
}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [copied, setCopied] = useState<'prompt' | 'neg' | null>(null);
  const { key } = entry;
  const prompt = entry.kind === 'video' ? entry.video.prompt : entry.image?.prompt ?? '';
  const chosen = chosenAsset(state);

  const refs =
    entry.kind === 'video'
      ? entry.video.firstFrame === entry.video.lastFrame
        ? [{ label: '1º e último frame', key: entry.video.firstFrame }]
        : [
            { label: '1º frame', key: entry.video.firstFrame },
            { label: 'último frame', key: entry.video.lastFrame },
          ]
      : inputKeys(entry.image?.inputs ?? '').map((k) => ({ label: 'entra no gerador', key: k }));

  const copy = async (what: 'prompt' | 'neg') => {
    try {
      await navigator.clipboard.writeText(what === 'prompt' ? prompt : negative);
      setCopied(what);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      toast.warning('Não consegui copiar. Selecione o texto e use Ctrl+C.');
    }
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const files = Array.from(event.dataTransfer.files || []);
    if (files.length) onUpload(key, files);
  };

  return (
    <article
      id={`studio-item-${key}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cn(
        'space-y-3 rounded-[26px] border bg-[#0b0d10] p-4 [content-visibility:auto] [contain-intrinsic-size:auto_520px]',
        state.status === 'aprovado' ? 'border-emerald-400/30' : state.status === 'refazer' ? 'border-red-400/30' : 'border-white/10',
        dragging && 'outline-dashed outline-2 outline-offset-2 outline-sky-400/60',
      )}
    >
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-white">{entry.kind === 'video' ? `${key}.mp4` : key === 'foto_rosto' ? 'Foto de rosto' : key}</h3>
        {entry.kind === 'video' ? (
          <>
            <Badge variant={entry.video.lote === 0 ? 'gold' : 'default'}>Lote {entry.video.lote}</Badge>
            <Badge>{entry.video.categoryLabel}</Badge>
            <Badge>{entry.video.duration}</Badge>
            {entry.video.event && <Badge variant="lavender">evento: {entry.video.event}</Badge>}
          </>
        ) : (
          entry.image && (
            <>
              <Badge>Etapa {entry.image.step}</Badge>
              <Badge>{entry.image.ratio}</Badge>
            </>
          )
        )}
        <Badge variant={STATUS_BADGE[state.status]} className="ml-auto">{STATUS_LABEL[state.status]}</Badge>
      </header>

      {entry.kind === 'image' && !entry.image && (
        <p className="text-xs text-slate-400">A referência de identidade: entra em quase todas as imagens. Anexe a foto de rosto da persona e aprove.</p>
      )}
      {entry.kind === 'image' && entry.image?.why && <p className="text-xs leading-relaxed text-slate-400">{entry.image.why}</p>}

      {refs.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {refs.map((r) => (
            <InputRef key={r.key + r.label} label={r.label} itemKey={r.key} state={states[r.key] ?? EMPTY_ITEM} />
          ))}
        </div>
      )}

      {prompt && (
        <>
          <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-2xl border border-white/5 bg-black/40 p-3 text-xs leading-relaxed text-slate-300">{prompt}</pre>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => void copy('prompt')}>
              {copied === 'prompt' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied === 'prompt' ? 'Copiado' : 'Copiar prompt'}
            </Button>
            {entry.kind === 'video' && (
              <Button size="sm" variant="ghost" onClick={() => void copy('neg')}>
                {copied === 'neg' ? 'Copiado' : 'Copiar negativo'}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onGenerate(key)}
              disabled={!generateReady}
              loading={busy === 'Gerando…'}
              title={generateHint}
            >
              <Sparkles className="h-3.5 w-3.5" />
              Gerar por API
            </Button>
          </div>
        </>
      )}

      <section className="space-y-3 border-t border-dashed border-white/10 pt-3">
        <div className="flex flex-wrap items-baseline gap-2 text-xs">
          <strong className="text-slate-200">Resultado{state.assets.length > 1 ? 's' : ''}</strong>
          <span className="text-slate-500">
            {state.assets.length
              ? `${state.assets.length} anexado${state.assets.length > 1 ? 's' : ''} · o escolhido leva o nome da etapa`
              : entry.kind === 'video'
                ? 'anexe o vídeo gerado'
                : 'anexe as variações e escolha a mais fiel ao rosto'}
          </span>
          {busy && <span className="anim-fade-in text-sky-300">{busy}</span>}
        </div>
        {state.assets.length > 0 && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-2.5">
            {state.assets.map((asset) => (
              <AssetThumb
                key={asset.id}
                asset={asset}
                chosen={chosen?.id === asset.id}
                onChoose={() => onChoose(key, asset.id)}
                onRemove={() => onRemove(key, asset.id)}
              />
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            hidden
            multiple
            accept={entry.kind === 'video' ? VIDEO_ACCEPT : IMAGE_ACCEPT}
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              e.target.value = '';
              if (files.length) onUpload(key, files);
            }}
          />
          <Button size="sm" variant="default" onClick={() => fileRef.current?.click()} loading={busy === 'Enviando…'}>
            <ImagePlus className="h-3.5 w-3.5" />
            Anexar{state.assets.length ? ' mais' : ''}
          </Button>
          <span className="text-[11px] text-slate-500">ou arraste o arquivo para este card</span>
          <div className="ml-auto flex gap-1.5" role="group" aria-label="Status">
            {(['aprovado', 'refazer', 'pendente'] as ItemStatus[]).map((s) => (
              <Button
                key={s}
                size="sm"
                variant={state.status === s ? (s === 'aprovado' ? 'success' : s === 'refazer' ? 'danger' : 'secondary') : 'ghost'}
                aria-pressed={state.status === s}
                disabled={s === 'aprovado' && !state.assets.length}
                onClick={() => onStatus(key, s)}
              >
                {s === 'aprovado' ? 'Aprovar' : s === 'refazer' ? 'Refazer' : 'Pendente'}
              </Button>
            ))}
          </div>
        </div>
      </section>
    </article>
  );
}

export const StudioItemCard = memo(StudioItemCardBase);
