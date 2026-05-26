import { useMemo, useRef, useState } from 'react';
import { BookOpen, Download, FileJson, Plus, Save, Search, Trash2, Upload } from 'lucide-react';
import {
  buildContentPromptContext,
  CONTENT_TYPES,
  contentTypeLabel,
  createContentItem,
  loadContentItems,
  normalizeContentItem,
  saveContentItems,
} from './core/contentLibrary';
import { cn } from './lib/utils';
import type {
  ContentItem,
  ContentItemType,
  ContentPriority,
  ContentUsage,
  ToolCapability,
  UsedContentItem,
} from './types';

const PRIORITIES: ContentPriority[] = ['low', 'normal', 'high', 'urgent'];
const USAGES: ContentUsage[] = ['context', 'prompt', 'safety', 'action'];
const CAPABILITIES: Array<ToolCapability | ''> = [
  '',
  'tts.speak',
  'chat.reply',
  'gift.acknowledge',
  'moderation.message',
  'obs.switch_scene',
  'obs.show_overlay',
  'media.play_music',
  'media.play_video',
  'media.stop',
  'topic.set',
  'topic.suggest',
  'memory.remember',
  'log.event',
];

function tagsToText(tags: string[]) {
  return tags.join(', ');
}

function textToTags(value: string) {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function usedFromItem(item: ContentItem): UsedContentItem {
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    priority: item.priority,
    usage: item.usage,
    reason: item.linkedCapability ? `capacidade: ${item.linkedCapability}` : 'item ativo',
    snippet: item.body.slice(0, 420),
    linkedCapability: item.linkedCapability,
  };
}

export default function ContentLibrary() {
  const [items, setItems] = useState<ContentItem[]>(() => loadContentItems());
  const [selectedId, setSelectedId] = useState(() => loadContentItems()[0]?.id || '');
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<ContentItemType | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selected = items.find((item) => item.id === selectedId) || items[0];

  const filteredItems = useMemo(() => {
    const cleanQuery = query.trim().toLowerCase();
    return items
      .filter((item) => (typeFilter === 'all' ? true : item.type === typeFilter))
      .filter((item) =>
        statusFilter === 'all' ? true : statusFilter === 'enabled' ? item.enabled : !item.enabled,
      )
      .filter((item) => {
        if (!cleanQuery) return true;
        return [item.title, item.body, item.type, item.priority, ...item.tags]
          .join(' ')
          .toLowerCase()
          .includes(cleanQuery);
      })
      .sort((a, b) => {
        if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
        const priorityOrder: Record<ContentPriority, number> = {
          urgent: 0,
          high: 1,
          normal: 2,
          low: 3,
        };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      });
  }, [items, query, statusFilter, typeFilter]);

  const contentPreview = useMemo(() => {
    const used = items
      .filter((item) => item.enabled)
      .sort((a, b) => b.usedCount - a.usedCount)
      .slice(0, 8)
      .map(usedFromItem);
    return buildContentPromptContext(used) || 'Nenhum conteudo ativo para enviar a IA.';
  }, [items]);

  const persist = (next: ContentItem[]) => {
    const saved = saveContentItems(next);
    setItems(saved);
    if (!saved.some((item) => item.id === selectedId)) setSelectedId(saved[0]?.id || '');
  };

  const updateSelected = (patch: Partial<ContentItem>) => {
    if (!selected) return;
    persist(
      items.map((item) =>
        item.id === selected.id
          ? normalizeContentItem({ ...item, ...patch, updatedAt: new Date().toISOString() })
          : item,
      ),
    );
  };

  const addItem = () => {
    const item = createContentItem();
    persist([item, ...items]);
    setSelectedId(item.id);
  };

  const deleteSelected = () => {
    if (!selected) return;
    persist(items.filter((item) => item.id !== selected.id));
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `odessa-content-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const contentItemsFromTextFile = (file: File, text: string): ContentItem[] => {
    const baseTitle = file.name.replace(/\.[^.]+$/, '').trim() || 'Pauta do dia';
    const rawLines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const bulletLines = rawLines
      .filter((line) => /^(?:[-*]|\d+[.)])\s+/.test(line))
      .map((line) => line.replace(/^(?:[-*]|\d+[.)])\s+/, '').trim())
      .filter(Boolean);
    const compactTopicLines =
      bulletLines.length >= 2
        ? bulletLines
        : rawLines.length >= 2 && rawLines.every((line) => line.length <= 180)
          ? rawLines
          : [];

    if (compactTopicLines.length >= 2) {
      return compactTopicLines.slice(0, 60).map((line, index) =>
        createContentItem({
          type: 'topic',
          title: `${baseTitle} ${index + 1}`,
          body: line,
          tags: ['pauta-do-dia'],
          priority: 'normal',
          enabled: true,
          usage: 'prompt',
        }),
      );
    }

    return [
      createContentItem({
        type: 'script',
        title: baseTitle,
        body: text.trim(),
        tags: ['pauta-do-dia'],
        priority: 'normal',
        enabled: true,
        usage: 'prompt',
      }),
    ];
  };

  const importContentFile = async (file: File | null) => {
    if (!file) return;
    setError(null);
    try {
      const text = await file.text();
      const isTextFile =
        file.name.toLowerCase().endsWith('.txt') || file.type.toLowerCase().includes('text');
      if (isTextFile) {
        const imported = contentItemsFromTextFile(file, text);
        const next = [...imported, ...items];
        persist(next);
        setSelectedId(imported[0]?.id || next[0]?.id || '');
      } else {
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed)) throw new Error('JSON precisa ser uma lista de conteudos.');
        const next = parsed.map((item) => normalizeContentItem(item));
        persist(next);
        setSelectedId(next[0]?.id || '');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao importar arquivo');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // ⚡ Bolt: Single-pass iteration inside useMemo to calculate multiple stats
  const stats = useMemo(() => {
    let enabled = 0;
    let safety = 0;
    let action = 0;
    for (const item of items) {
      if (item.enabled) {
        enabled++;
        if (item.usage === 'safety') safety++;
        if (item.usage === 'action') action++;
      }
    }
    return {
      total: items.length,
      enabled,
      safety,
      action,
    };
  }, [items]);

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--odessa-bg)] text-slate-100">
      <header className="border-b border-[var(--odessa-border)] bg-[var(--odessa-surface)] px-4 py-4 lg:px-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-cyan-400/20 bg-cyan-500/15 text-cyan-300">
              <BookOpen className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">Conteudo Live</h1>
              <p className="text-xs text-slate-400">
                Biblioteca operacional usada pela Odessa nas rodadas da live.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2 text-center text-xs">
            {[
              ['Total', stats.total],
              ['Ativos', stats.enabled],
              ['Seguranca', stats.safety],
              ['Acoes', stats.action],
            ].map(([label, value]) => (
              <div
                key={String(label)}
                className="rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2"
              >
                <p className="font-mono text-base font-black text-white">{value}</p>
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  {label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 xl:grid-cols-[340px_minmax(420px,1fr)_360px] xl:overflow-hidden">
        <aside className="flex min-h-0 flex-col rounded-lg border border-[var(--odessa-border)] bg-[var(--odessa-surface)]">
          <div className="border-b border-slate-800 p-3">
            <div className="flex gap-2">
              <label className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-300 focus-within:border-cyan-400">
                <Search className="h-4 w-4 text-slate-500" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-600"
                  placeholder="Buscar conteudo"
                />
              </label>
              <button
                onClick={addItem}
                className="rounded-md bg-cyan-500 px-3 py-2 text-slate-950 transition hover:bg-cyan-300"
                title="Novo conteudo"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <select
                value={typeFilter}
                onChange={(event) => setTypeFilter(event.target.value as ContentItemType | 'all')}
                className="rounded-md border border-slate-800 bg-slate-950 px-2 py-2 text-xs text-slate-200 outline-none"
              >
                <option value="all">Todos os tipos</option>
                {CONTENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {contentTypeLabel(type)}
                  </option>
                ))}
              </select>
              <select
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as 'all' | 'enabled' | 'disabled')
                }
                className="rounded-md border border-slate-800 bg-slate-950 px-2 py-2 text-xs text-slate-200 outline-none"
              >
                <option value="all">Todos</option>
                <option value="enabled">Ativos</option>
                <option value="disabled">Pausados</option>
              </select>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {filteredItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setSelectedId(item.id)}
                className={cn(
                  'mb-2 w-full rounded-md border p-3 text-left transition',
                  selected?.id === item.id
                    ? 'border-cyan-400/50 bg-cyan-500/10'
                    : 'border-slate-800 bg-slate-950/50 hover:border-slate-600',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-white">{item.title}</p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {contentTypeLabel(item.type)} / {item.priority}
                    </p>
                  </div>
                  <span
                    className={cn(
                      'rounded px-2 py-0.5 text-[10px] font-black uppercase',
                      item.enabled
                        ? 'bg-emerald-500/10 text-emerald-300'
                        : 'bg-slate-800 text-slate-500',
                    )}
                  >
                    {item.enabled ? 'ativo' : 'off'}
                  </span>
                </div>
                <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-400">{item.body}</p>
              </button>
            ))}
            {filteredItems.length === 0 && (
              <p className="rounded-md border border-dashed border-slate-800 p-4 text-center text-sm text-slate-600">
                Nenhum conteudo encontrado.
              </p>
            )}
          </div>
        </aside>

        <section className="min-h-0 rounded-lg border border-[var(--odessa-border)] bg-[var(--odessa-surface)]">
          {selected ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
                <div>
                  <h2 className="text-sm font-black text-white">Editor</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Atualizado {new Date(selected.updatedAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => updateSelected({ enabled: !selected.enabled })}
                    className={cn(
                      'rounded-md border px-3 py-2 text-xs font-black transition',
                      selected.enabled
                        ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200'
                        : 'border-slate-800 bg-slate-950 text-slate-500',
                    )}
                  >
                    {selected.enabled ? 'Ativo' : 'Pausado'}
                  </button>
                  <button
                    onClick={deleteSelected}
                    className="rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-rose-300 transition hover:bg-rose-500/10"
                    title="Excluir"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-black uppercase tracking-wide text-slate-500">
                    Titulo
                  </span>
                  <input
                    value={selected.title}
                    onChange={(event) => updateSelected({ title: event.target.value })}
                    className="w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400"
                  />
                </label>

                <div className="grid gap-3 md:grid-cols-4">
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-black uppercase tracking-wide text-slate-500">
                      Tipo
                    </span>
                    <select
                      value={selected.type}
                      onChange={(event) =>
                        updateSelected({ type: event.target.value as ContentItemType })
                      }
                      className="w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none"
                    >
                      {CONTENT_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {contentTypeLabel(type)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-black uppercase tracking-wide text-slate-500">
                      Prioridade
                    </span>
                    <select
                      value={selected.priority}
                      onChange={(event) =>
                        updateSelected({ priority: event.target.value as ContentPriority })
                      }
                      className="w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none"
                    >
                      {PRIORITIES.map((priority) => (
                        <option key={priority} value={priority}>
                          {priority}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-black uppercase tracking-wide text-slate-500">
                      Uso
                    </span>
                    <select
                      value={selected.usage}
                      onChange={(event) =>
                        updateSelected({ usage: event.target.value as ContentUsage })
                      }
                      className="w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none"
                    >
                      {USAGES.map((usage) => (
                        <option key={usage} value={usage}>
                          {usage}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-black uppercase tracking-wide text-slate-500">
                      Tool
                    </span>
                    <select
                      value={selected.linkedCapability || ''}
                      onChange={(event) =>
                        updateSelected({
                          linkedCapability: event.target.value
                            ? (event.target.value as ToolCapability)
                            : undefined,
                        })
                      }
                      className="w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none"
                    >
                      {CAPABILITIES.map((capability) => (
                        <option key={capability || 'none'} value={capability}>
                          {capability || 'sem tool'}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="block">
                  <span className="mb-1 block text-[11px] font-black uppercase tracking-wide text-slate-500">
                    Conteudo
                  </span>
                  <textarea
                    value={selected.body}
                    onChange={(event) => updateSelected({ body: event.target.value })}
                    className="h-64 w-full resize-none rounded-md border border-slate-800 bg-slate-950 p-3 text-sm leading-6 text-slate-200 outline-none focus:border-cyan-400"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-[11px] font-black uppercase tracking-wide text-slate-500">
                    Tags
                  </span>
                  <input
                    value={tagsToText(selected.tags)}
                    onChange={(event) => updateSelected({ tags: textToTags(event.target.value) })}
                    className="w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400"
                    placeholder="chat quieto, presente, cena"
                  />
                </label>

                <div className="grid gap-2 md:grid-cols-3">
                  <div className="rounded-md border border-slate-800 bg-slate-950/60 p-3">
                    <p className="text-[11px] font-black uppercase text-slate-500">Usos</p>
                    <p className="mt-1 font-mono text-lg font-black text-white">
                      {selected.usedCount}
                    </p>
                  </div>
                  <div className="rounded-md border border-slate-800 bg-slate-950/60 p-3">
                    <p className="text-[11px] font-black uppercase text-slate-500">Ultimo uso</p>
                    <p className="mt-1 truncate text-xs text-slate-300">
                      {selected.lastUsedAt
                        ? new Date(selected.lastUsedAt).toLocaleString()
                        : 'sem registro'}
                    </p>
                  </div>
                  <div className="rounded-md border border-slate-800 bg-slate-950/60 p-3">
                    <p className="text-[11px] font-black uppercase text-slate-500">ID</p>
                    <p className="mt-1 truncate font-mono text-xs text-slate-300">{selected.id}</p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-600">
              Crie um conteudo para comecar.
            </div>
          )}
        </section>

        <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto">
          <section className="rounded-lg border border-[var(--odessa-border)] bg-[var(--odessa-surface)] p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-black text-cyan-300">
                <FileJson className="h-4 w-4" />
                Preview IA
              </div>
              <button
                onClick={() => persist(items)}
                className="inline-flex items-center gap-1 rounded-md border border-slate-800 bg-slate-950 px-2 py-1.5 text-xs font-black text-slate-200 transition hover:border-cyan-400/40"
              >
                <Save className="h-3.5 w-3.5" />
                Salvar
              </button>
            </div>
            <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-md border border-slate-800 bg-slate-950 p-3 text-[11px] leading-5 text-slate-300">
              {contentPreview}
            </pre>
          </section>

          <section className="rounded-lg border border-[var(--odessa-border)] bg-[var(--odessa-surface)] p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-black text-emerald-300">
              <Download className="h-4 w-4" />
              Exportacao
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={exportJson}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-500 px-3 py-2 text-xs font-black text-slate-950 transition hover:bg-emerald-300"
              >
                <Download className="h-4 w-4" />
                Exportar
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-black text-slate-200 transition hover:border-emerald-400/40"
              >
                <Upload className="h-4 w-4" />
                Importar
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json,text/plain,.txt"
                onChange={(event) => importContentFile(event.target.files?.[0] || null)}
                className="hidden"
              />
            </div>
            {error && (
              <p className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                {error}
              </p>
            )}
          </section>

          <section className="rounded-lg border border-[var(--odessa-border)] bg-[var(--odessa-surface)] p-4">
            <h3 className="mb-3 text-sm font-black text-white">Tipos ativos</h3>
            <div className="space-y-2">
              {CONTENT_TYPES.map((type) => {
                const count = items.filter((item) => item.enabled && item.type === type).length;
                return (
                  <div
                    key={type}
                    className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs"
                  >
                    <span className="text-slate-400">{contentTypeLabel(type)}</span>
                    <span className="font-mono font-black text-cyan-300">{count}</span>
                  </div>
                );
              })}
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
