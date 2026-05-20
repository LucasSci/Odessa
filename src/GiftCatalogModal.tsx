import { useEffect, useMemo, useRef, useState } from 'react';
import { Gift, Pencil, Plus, Trash2, Upload, X } from 'lucide-react';
import { Button, Input } from './components/ui';
import {
  type GiftCatalogEntry,
  loadGiftCatalog,
  removeGift,
  saveGiftCatalog,
  upsertGift,
} from './core/giftCatalog';

const MAX_IMAGE_BYTES = 512 * 1024; // 512 KB — gift icons are tiny

type DraftGift = {
  id?: string;
  key: string;
  name: string;
  imageUrl: string;
  emoji: string;
  price: string;
};

const EMPTY_DRAFT: DraftGift = { key: '', name: '', imageUrl: '', emoji: '', price: '' };

function slugifyKey(name: string) {
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug ? `gift.${slug}` : '';
}

export default function GiftCatalogModal({
  open,
  onClose,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  onChange?: (entries: GiftCatalogEntry[]) => void;
}) {
  const [entries, setEntries] = useState<GiftCatalogEntry[]>([]);
  const [draft, setDraft] = useState<DraftGift | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setEntries(loadGiftCatalog());
      setDraft(null);
      setError(null);
    }
  }, [open]);

  const total = useMemo(
    () => entries.reduce((sum, entry) => sum + (Number(entry.price) || 0), 0),
    [entries],
  );

  if (!open) return null;

  const persist = (next: GiftCatalogEntry[]) => {
    setEntries(next);
    saveGiftCatalog(next);
    onChange?.(next);
  };

  const startAdd = () => {
    setError(null);
    setDraft({ ...EMPTY_DRAFT });
  };

  const startEdit = (entry: GiftCatalogEntry) => {
    setError(null);
    setDraft({
      id: entry.id,
      key: entry.key,
      name: entry.name,
      imageUrl: entry.imageUrl || '',
      emoji: entry.emoji || '',
      price: entry.price != null ? String(entry.price) : '',
    });
  };

  const handleDelete = (id: string) => {
    persist(removeGift(entries, id));
    if (draft?.id === id) setDraft(null);
  };

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('O arquivo selecionado nao e uma imagem.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError('Imagem muito grande. Use um icone de ate 512 KB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setError(null);
      setDraft((current) => (current ? { ...current, imageUrl: String(reader.result || '') } : current));
    };
    reader.onerror = () => setError('Falha ao ler a imagem.');
    reader.readAsDataURL(file);
  };

  const saveDraft = () => {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) {
      setError('Informe o nome do presente.');
      return;
    }
    const key = (draft.key.trim() || slugifyKey(name)).toLowerCase();
    if (!key) {
      setError('Nao foi possivel gerar o codigo. Informe um codigo manualmente.');
      return;
    }
    const duplicate = entries.find((e) => e.key === key && e.id !== draft.id);
    if (duplicate) {
      setError(`Ja existe um presente com o codigo "${key}".`);
      return;
    }
    const priceValue = draft.price.trim() ? Number(draft.price) : undefined;
    if (priceValue != null && (Number.isNaN(priceValue) || priceValue < 0)) {
      setError('Preco invalido.');
      return;
    }
    persist(
      upsertGift(entries, {
        id: draft.id,
        key,
        name,
        imageUrl: draft.imageUrl.trim() || undefined,
        emoji: draft.emoji.trim() || undefined,
        price: priceValue,
      }),
    );
    setDraft(null);
    setError(null);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-[28px] border border-white/10 bg-[#0b0d10] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-2">
            <Gift className="h-5 w-5 text-[var(--gold)]" />
            <div>
              <div className="text-sm font-semibold text-white">Catalogo de presentes</div>
              <div className="text-[11px] text-[var(--t3)]">
                {entries.length} presente(s) · {total.toLocaleString('pt-BR')} moedas no catalogo
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
            title="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <div className="mx-5 mt-3 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-100">
            {error}
          </div>
        )}

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {draft ? (
            <GiftForm
              draft={draft}
              setDraft={setDraft}
              fileInputRef={fileInputRef}
              onFile={handleFile}
              onSave={saveDraft}
              onCancel={() => {
                setDraft(null);
                setError(null);
              }}
              onDelete={draft.id ? () => handleDelete(draft.id as string) : undefined}
            />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {entries.map((entry) => (
                <div
                  key={entry.id}
                  className="group relative flex flex-col items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-center"
                >
                  <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-xl bg-black/40">
                    {entry.imageUrl ? (
                      <img src={entry.imageUrl} alt={entry.name} className="h-full w-full object-contain" />
                    ) : (
                      <span className="text-3xl">{entry.emoji || '🎁'}</span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-white">{entry.name}</div>
                    <div className="truncate font-mono text-[10px] text-[var(--t3)]">{entry.key}</div>
                    {entry.price != null && (
                      <div className="mt-0.5 text-[11px] font-semibold text-[var(--gold)]">
                        {entry.price.toLocaleString('pt-BR')} moedas
                      </div>
                    )}
                  </div>
                  <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={() => startEdit(entry)}
                      className="rounded-md bg-black/70 p-1 text-slate-300 hover:text-sky-300"
                      title="Editar"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(entry.id)}
                      className="rounded-md bg-black/70 p-1 text-slate-300 hover:text-red-400"
                      title="Remover"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
              <button
                onClick={startAdd}
                className="flex min-h-[148px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 text-[var(--t3)] transition-colors hover:border-[var(--gold)]/45 hover:text-white"
              >
                <Plus className="h-6 w-6" />
                <span className="text-xs font-semibold">Adicionar presente</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function GiftForm({
  draft,
  setDraft,
  fileInputRef,
  onFile,
  onSave,
  onCancel,
  onDelete,
}: {
  draft: DraftGift;
  setDraft: (updater: (current: DraftGift | null) => DraftGift | null) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFile: (file: File | undefined) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const update = (patch: Partial<DraftGift>) =>
    setDraft((current) => (current ? { ...current, ...patch } : current));

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-4">
        {/* Image preview */}
        <div className="flex flex-col items-center gap-2">
          <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-black/40">
            {draft.imageUrl ? (
              <img src={draft.imageUrl} alt="" className="h-full w-full object-contain" />
            ) : (
              <span className="text-4xl">{draft.emoji || '🎁'}</span>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => onFile(event.target.files?.[0])}
          />
          <Button size="sm" variant="secondary" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-3.5 w-3.5" />
            Imagem
          </Button>
          {draft.imageUrl && (
            <button
              onClick={() => update({ imageUrl: '' })}
              className="text-[10px] text-[var(--t3)] hover:text-red-400"
            >
              remover imagem
            </button>
          )}
        </div>

        {/* Fields */}
        <div className="flex-1 space-y-3">
          <Input
            label="Nome do presente"
            value={draft.name}
            placeholder="Ex: Rosa"
            onChange={(event) => update({ name: event.target.value })}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Preco (moedas)"
              type="number"
              min={0}
              value={draft.price}
              placeholder="Ex: 1"
              onChange={(event) => update({ price: event.target.value })}
            />
            <Input
              label="Emoji (opcional)"
              value={draft.emoji}
              placeholder="🌹"
              onChange={(event) => update({ emoji: event.target.value })}
            />
          </div>
          <Input
            label="Codigo do presente"
            value={draft.key}
            placeholder="gerado pelo nome (ex: gift.rosa)"
            onChange={(event) => update({ key: event.target.value })}
          />
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] leading-relaxed text-[var(--t3)]">
        O <strong className="text-slate-300">codigo</strong> e usado para casar o presente com os eventos da
        live. Se deixar em branco, e gerado a partir do nome. A imagem entra como referencia visual do
        presente.
      </div>

      <div className="flex items-center justify-between gap-2">
        <div>
          {onDelete && (
            <Button variant="danger" size="sm" onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" />
              Excluir
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancelar
          </Button>
          <Button variant="primary" size="sm" onClick={onSave}>
            Salvar presente
          </Button>
        </div>
      </div>
    </div>
  );
}
