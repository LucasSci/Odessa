/**
 * PersonaAssetManager.tsx — Gerenciador de assets visuais e templates de prompt.
 *
 * Permite gerenciar três categorias de imagens por persona:
 * - Rostos (faces): referência facial para identificação e geração de vídeo
 * - Ambiente (environments): local onde os vídeos são gravados
 * - Roupas (wardrobe): kit de roupas disponíveis
 *
 * E os templates de prompt por tipo de vídeo (FLUXO, GATILHO, ESPECIAL, TRANSICAO),
 * que usam placeholders preenchidos com os assets da persona ativa.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getPersonaAssets,
  uploadAsset,
  deleteAsset,
  renameAsset,
  getTemplates,
  saveTemplates,
  renderTemplate,
  assetUrl,
  type AssetCategory,
  type PersonaAsset,
  type PersonaAssets,
  type VideoTemplates,
} from '../core/personaAssets';

type Props = {
  personaId: string;
  personaName: string;
};

const CATEGORY_META: Record<
  AssetCategory,
  { label: string; icon: string; desc: string; placeholder: string }
> = {
  faces: {
    label: 'Rostos',
    icon: '😀',
    desc: 'Imagens de referência do rosto da persona para identificação e geração de vídeo',
    placeholder: 'Rosto frontal, rosto perfil, expressões...',
  },
  environments: {
    label: 'Ambiente da Live',
    icon: '🎬',
    desc: 'Imagens do local onde os vídeos da persona são gravados',
    placeholder: 'Quarto decorado, estúdio, sala...',
  },
  wardrobe: {
    label: 'Kit de Roupas',
    icon: '👗',
    desc: 'Imens de roupas que a persona pode usar nos vídeos',
    placeholder: 'Vestido vermelho, top jeans, look casual...',
  },
};

const CATEGORIES: AssetCategory[] = ['faces', 'environments', 'wardrobe'];

const VIDEO_TYPE_COLORS: Record<string, string> = {
  FLUXO: 'text-blue-300 border-blue-500/30 bg-blue-500/10',
  GATILHO: 'text-amber-300 border-amber-500/30 bg-amber-500/10',
  ESPECIAL: 'text-violet-300 border-violet-500/30 bg-violet-500/10',
  TRANSICAO: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10',
};

export default function PersonaAssetManager({ personaId, personaName }: Props) {
  const [assets, setAssets] = useState<PersonaAssets>({
    faces: [],
    environments: [],
    wardrobe: [],
  });
  const [templates, setTemplates] = useState<VideoTemplates>({});
  const [videoTypes, setVideoTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<AssetCategory | null>(null);
  const [activeTab, setActiveTab] = useState<'assets' | 'templates'>('assets');
  const [activeCategory, setActiveCategory] = useState<AssetCategory>('faces');
  const [editingLabel, setEditingLabel] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState('');
  const [savingTemplates, setSavingTemplates] = useState(false);
  const [templatesSaved, setTemplatesSaved] = useState(false);
  const [renderedPrompts, setRenderedPrompts] = useState<Record<string, string>>({});
  const [rendering, setRendering] = useState<string | null>(null);
  const fileInputRefs = useRef<Record<AssetCategory, HTMLInputElement | null>>({
    faces: null,
    environments: null,
    wardrobe: null,
  });

  const refresh = useCallback(async () => {
    try {
      const [assetData, templateData] = await Promise.all([
        getPersonaAssets(personaId),
        getTemplates(personaId),
      ]);
      setAssets(assetData.assets);
      setTemplates(templateData.templates);
      setVideoTypes(templateData.videoTypes);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao carregar dados');
    } finally {
      setLoading(false);
    }
  }, [personaId]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  const handleUpload = async (category: AssetCategory, file: File) => {
    setUploading(category);
    setError(null);
    try {
      await uploadAsset(personaId, category, file, '');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao enviar imagem');
    } finally {
      setUploading(null);
    }
  };

  const handleDelete = async (category: AssetCategory, assetId: string) => {
    try {
      await deleteAsset(personaId, category, assetId);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao excluir imagem');
    }
  };

  const handleRename = async (category: AssetCategory, assetId: string) => {
    const label = labelDraft.trim();
    if (!label) return;
    try {
      await renameAsset(personaId, category, assetId, label);
      setEditingLabel(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao renomear');
    }
  };

  const handleSaveTemplates = async () => {
    setSavingTemplates(true);
    setTemplatesSaved(false);
    try {
      await saveTemplates(personaId, templates);
      setTemplatesSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao salvar templates');
    } finally {
      setSavingTemplates(false);
    }
  };

  const handleRender = async (videoType: string) => {
    setRendering(videoType);
    try {
      const result = await renderTemplate(personaId, videoType);
      setRenderedPrompts((prev) => ({ ...prev, [videoType]: result.prompt }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao renderizar template');
    } finally {
      setRendering(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8 text-sm text-slate-400">
        Carregando assets de {personaName}...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.045] p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">
            Assets Visuais — {personaName}
          </h3>
          <p className="mt-0.5 text-xs text-slate-400">
            Rostos, ambiente e roupas para produção automatizada de vídeos
          </p>
        </div>
        <div className="flex gap-1 rounded-xl border border-white/10 bg-black/20 p-1">
          <button
            type="button"
            onClick={() => setActiveTab('assets')}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === 'assets'
                ? 'bg-violet-600 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Imagens
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('templates')}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === 'templates'
                ? 'bg-violet-600 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Templates de Prompt
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>
      )}

      {/* ── Tab: Assets ── */}
      {activeTab === 'assets' && (
        <>
          {/* Category selector */}
          <div className="flex gap-2">
            {CATEGORIES.map((cat) => {
              const meta = CATEGORY_META[cat];
              const count = assets[cat]?.length || 0;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setActiveCategory(cat)}
                  className={`flex flex-1 items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors ${
                    activeCategory === cat
                      ? 'border-violet-500/50 bg-violet-500/10 text-violet-200'
                      : 'border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.06]'
                  }`}
                >
                  <span className="text-base">{meta.icon}</span>
                  <span className="flex-1 text-left font-medium">{meta.label}</span>
                  <span className="rounded-full bg-black/30 px-1.5 py-0.5 text-xs text-slate-400">
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Active category panel */}
          <div className="flex flex-col gap-3">
            <p className="text-xs text-slate-400">
              {CATEGORY_META[activeCategory].desc}
            </p>

            {/* Upload zone */}
            <div
              className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-4 transition-colors hover:border-violet-500/30"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files[0];
                if (file) void handleUpload(activeCategory, file);
              }}
            >
              <input
                ref={(el) => {
                  fileInputRefs.current[activeCategory] = el;
                }}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleUpload(activeCategory, file);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRefs.current[activeCategory]?.click()}
                disabled={uploading === activeCategory}
                className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-40"
              >
                {uploading === activeCategory ? 'Enviando...' : '+ Adicionar imagem'}
              </button>
              <span className="text-xs text-slate-500">
                ou arraste uma imagem aqui (PNG, JPG, WebP — máx 10MB)
              </span>
            </div>

            {/* Image grid */}
            {assets[activeCategory] && assets[activeCategory].length > 0 ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {assets[activeCategory].map((asset, idx) => (
                  <div
                    key={asset.id}
                    className="group relative overflow-hidden rounded-xl border border-white/10 bg-black/30"
                  >
                    <div className="relative aspect-[3/4]">
                      <img
                        src={assetUrl(personaId, activeCategory, asset.id)}
                        alt={asset.label}
                        className="h-full w-full object-cover"
                      />
                      {idx === 0 && (
                        <span className="absolute left-1 top-1 rounded-md bg-emerald-500/80 px-1.5 py-0.5 text-[10px] font-medium text-white">
                          Primária
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 p-1.5">
                      {editingLabel === asset.id ? (
                        <input
                          autoFocus
                          value={labelDraft}
                          onChange={(e) => setLabelDraft(e.target.value)}
                          onBlur={() => void handleRename(activeCategory, asset.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void handleRename(activeCategory, asset.id);
                            if (e.key === 'Escape') setEditingLabel(null);
                          }}
                          className="flex-1 rounded bg-white/10 px-1.5 py-1 text-xs text-slate-200 outline-none"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingLabel(asset.id);
                            setLabelDraft(asset.label);
                          }}
                          className="flex-1 truncate text-left text-xs text-slate-300 hover:text-violet-300"
                          title={asset.label}
                        >
                          {asset.label}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleDelete(activeCategory, asset.id)}
                        className="rounded p-1 text-slate-500 transition-colors hover:bg-red-500/15 hover:text-red-400"
                        title="Excluir"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-4 text-center text-xs text-slate-500">
                Nenhuma imagem nesta categoria ainda
              </p>
            )}
          </div>
        </>
      )}

      {/* ── Tab: Templates ── */}
      {activeTab === 'templates' && (
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <p className="text-xs text-slate-400">
              Os templates usam placeholders que são preenchidos automaticamente
              com os assets da persona ativa:
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {[
                '{persona_name}',
                '{face_ref}',
                '{environment_ref}',
                '{wardrobe_ref}',
                '{action}',
              ].map((ph) => (
                <code
                  key={ph}
                  className="rounded bg-violet-500/15 px-1.5 py-0.5 text-xs text-violet-300"
                >
                  {ph}
                </code>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              O mesmo template produz vídeos diferentes para Barbara e Viktoria,
              trocando apenas as imagens de referência.
            </p>
          </div>

          {videoTypes.map((vtype) => {
            const tmpl = templates[vtype] || { label: vtype, prompt: '', description: '' };
            const colorClass = VIDEO_TYPE_COLORS[vtype] || 'text-slate-300 border-white/10 bg-white/5';
            return (
              <div key={vtype} className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="flex items-center gap-2">
                  <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${colorClass}`}>
                    {vtype}
                  </span>
                  <input
                    value={tmpl.label || ''}
                    onChange={(e) => {
                      setTemplates((prev) => ({
                        ...prev,
                        [vtype]: { ...tmpl, label: e.target.value },
                      }));
                      setTemplatesSaved(false);
                    }}
                    placeholder={`Label ${vtype}`}
                    className="flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-sm text-slate-200"
                  />
                </div>
                {tmpl.description && (
                  <p className="text-xs text-slate-500">{tmpl.description}</p>
                )}
                <textarea
                  value={tmpl.prompt || ''}
                  onChange={(e) => {
                    setTemplates((prev) => ({
                      ...prev,
                      [vtype]: { ...tmpl, prompt: e.target.value },
                    }));
                    setTemplatesSaved(false);
                  }}
                  rows={4}
                  placeholder={`Prompt template para vídeos do tipo ${vtype}...`}
                  className="resize-y rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 font-mono text-xs text-slate-200"
                />
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => void handleRender(vtype)}
                    disabled={rendering !== null}
                    className="self-start rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-white/20 disabled:opacity-40"
                  >
                    {rendering === vtype ? 'Renderizando...' : '👁️ Pré-visualizar prompt'}
                  </button>
                  {renderedPrompts[vtype] && (
                    <div className="rounded-lg bg-black/30 p-2 text-xs text-slate-400">
                      <span className="text-slate-500">Prompt renderizado: </span>
                      {renderedPrompts[vtype]}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          <div className="flex items-center gap-3 border-t border-white/10 pt-3">
            <button
              type="button"
              onClick={handleSaveTemplates}
              disabled={savingTemplates}
              className="h-9 flex-1 rounded-xl bg-violet-600 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-40"
            >
              {savingTemplates ? 'Salvando...' : 'Salvar templates'}
            </button>
            {templatesSaved && (
              <span className="text-xs text-emerald-400">Salvo ✓</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
