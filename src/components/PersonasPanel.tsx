/**
 * PersonasPanel — Aba dedicada à gestão de personas de IA.
 *
 * As personas são o coração do projeto: cada uma tem sua imagem, personalidade,
 * inteligência e roteiro de vídeos (IDLE, ações, gatilhos, transições).
 *
 * Este painel permite:
 * 1. Listar, criar, editar e excluir personas.
 * 2. Definir imagem (avatar), personalidade e descrição de cada persona.
 * 3. Visualizar o "roteiro de vídeos" — o caminho pré-definido e copiável que
 *    cada persona deve seguir: IDLE → ações → gatilhos → transições.
 * 4. Ver quais vídeos do roteiro já estão configurados para a persona ativa.
 * 5. Copiar o template do roteiro para criar vídeos de uma nova persona.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Film,
  Image as ImageIcon,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Users,
  Video,
  Zap,
  Clapperboard,
  Edit3,
  Save,
  X,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { apiUrl } from '../lib/api';
import {
  listPersonas,
  setActivePersona,
  createPersona,
  deletePersona,
  updatePersona,
  getPersonaConfig,
  setPersonality,
  type PersonaMeta,
} from '../core/personaManager';
import { saveAiConfig } from '../core/aiConfig';

// ─── Roteiro de Vídeos (template copiável) ───────────────────────────
// Cada persona deve ter estes categorias de vídeo. O nome do arquivo segue
// o padrão: NN_CATEGORIA_descrição. Ex: 01_FLUXO_idle_sorriso_leve

export type VideoCategory = {
  key: string;
  prefix: string;
  label: string;
  description: string;
  color: string;
  icon: typeof Film;
  /** Quantidade recomendada de vídeos nesta categoria */
  recommendedCount: number;
  /** Prompt-base para gerar vídeos desta categoria */
  promptTemplate: string;
};

export const VIDEO_ROTEIRO: VideoCategory[] = [
  {
    key: 'idle',
    prefix: 'FLUXO',
    label: 'IDLE / Fluxo',
    description: 'Vídeos em loop que tocam continuamente como fundo. A persona fica "viva" mesmo sem interações.',
    color: 'sky',
    icon: Film,
    recommendedCount: 5,
    promptTemplate:
      'Vídeo IDLE em loop da persona [NOME], [DESCRIÇÃO_DA_AÇÃO]. ' +
      'Movimento sutil e contínuo, sem início ou fim abrupto. ' +
      'Expressão: [EXPRESSÃO]. Olhar para a câmera de forma natural.',
  },
  {
    key: 'gatilho',
    prefix: 'GATILHO',
    label: 'Gatilhos / Reações',
    description: 'Vídeos acionados por presentes ou palavras-chave do chat. A persona reage a interações específicas.',
    color: 'amber',
    icon: Zap,
    recommendedCount: 10,
    promptTemplate:
      'Vídeo de REAÇÃO da persona [NOME] ao receber [TIPO_DE_GATILHO]. ' +
      'Ação: [AÇÃO_ESPECÍFICA]. Duração curta (3-8s). ' +
      'Expressão: [EXPRESSÃO]. Retorna ao idle ao final.',
  },
  {
    key: 'transicao',
    prefix: 'TRANSICAO',
    label: 'Transições',
    description: 'Vídeos curtos que conectam um estado a outro suavemente (ex: ajustar roupa, mudar postura).',
    color: 'violet',
    icon: Video,
    recommendedCount: 4,
    promptTemplate:
      'Vídeo de TRANSIÇÃO da persona [NOME]. ' +
      'Ação: [AÇÃO_DE_TRANSIÇÃO]. Duração muito curta (2-4s). ' +
      'Movimento natural que liga um idle a outro.',
  },
  {
    key: 'especial',
    prefix: 'ESPECIAL',
    label: 'Especiais',
    description: 'Ações especiais e únicas: alongamentos, mudanças de ângulo, momentos marcantes da live.',
    color: 'rose',
    icon: Clapperboard,
    recommendedCount: 3,
    promptTemplate:
      'Vídeo ESPECIAL da persona [NOME]. ' +
      'Ação: [AÇÃO_ESPECIAL]. Momento marcante e único. ' +
      'Duração média (5-10s). Expressão: [EXPRESSÃO].',
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────

type VideoEntry = {
  id: string;
  label?: string;
  group?: string;
  loop?: boolean;
};

type PersonaConfigData = {
  videos: VideoEntry[];
  idleVideoId?: string;
  triggers?: Array<{ id: string; name: string; enabled: boolean; eventType: string }>;
};

function categorizeVideo(video: VideoEntry): string | null {
  const id = (video.id || '').toUpperCase();
  for (const cat of VIDEO_ROTEIRO) {
    if (id.includes(cat.prefix)) return cat.key;
  }
  // Heuristic: loop videos without a prefix are likely idle
  if (video.loop) return 'idle';
  return null;
}

function copyToClipboard(text: string) {
  try {
    navigator.clipboard.writeText(text);
  } catch {
    // fallback
  }
}

const COLOR_CLASSES: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  sky: { bg: 'bg-sky-500/10', border: 'border-sky-500/30', text: 'text-sky-300', dot: 'bg-sky-400' },
  amber: { bg: 'bg-amber-500/10', border: 'border-amber-500/30', text: 'text-amber-300', dot: 'bg-amber-400' },
  violet: { bg: 'bg-violet-500/10', border: 'border-violet-500/30', text: 'text-violet-300', dot: 'bg-violet-400' },
  rose: { bg: 'bg-rose-500/10', border: 'border-rose-500/30', text: 'text-rose-300', dot: 'bg-rose-400' },
};

// ─── Main Component ──────────────────────────────────────────────────

export function PersonasPanel() {
  const [personas, setPersonas] = useState<PersonaMeta[]>([]);
  const [activeId, setActiveId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [personaConfig, setPersonaConfig] = useState<PersonaConfigData | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [showRoteiro, setShowRoteiro] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await listPersonas();
      setPersonas(data.personas);
      setActiveId(data.activePersonaId);
      if (!selectedId) setSelectedId(data.activePersonaId);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao carregar personas');
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  const loadConfig = useCallback(async (id: string) => {
    setConfigLoading(true);
    try {
      const data = await getPersonaConfig(id);
      const cfg = data.config as PersonaConfigData;
      setPersonaConfig({
        videos: Array.isArray(cfg?.videos) ? cfg.videos : [],
        idleVideoId: cfg?.idleVideoId || '',
        triggers: Array.isArray(cfg?.triggers) ? cfg.triggers : [],
      });
    } catch {
      setPersonaConfig({ videos: [], idleVideoId: '', triggers: [] });
    } finally {
      setConfigLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (selectedId) void loadConfig(selectedId);
  }, [selectedId, loadConfig]);

  const handleActivate = async (id: string) => {
    try {
      await setActivePersona(id);
      setActiveId(id);
      setSelectedId(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao ativar persona');
    }
  };

  const selectedPersona = personas.find((p) => p.id === selectedId) || null;

  // Categorize videos for the selected persona
  const videoStats = useMemo(() => {
    const videos = personaConfig?.videos || [];
    const stats: Record<string, VideoEntry[]> = {};
    for (const cat of VIDEO_ROTEIRO) stats[cat.key] = [];
    const uncategorized: VideoEntry[] = [];

    for (const v of videos) {
      const cat = categorizeVideo(v);
      if (cat && stats[cat]) stats[cat].push(v);
      else uncategorized.push(v);
    }
    return { stats, uncategorized, total: videos.length };
  }, [personaConfig]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-6">
      {/* Header */}
      <div className="mb-5 rounded-2xl border border-white/10 bg-[#101114] p-5">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-violet-200/70">
          <Users className="h-4 w-4" />
          Personas de IA
        </div>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-white">
          Gestão de Personas
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-400">
          As personas são o coração do projeto. Cada uma tem sua imagem, personalidade, inteligência e roteiro
          de vídeos. Com um clique, a persona assume o controle da live — respondendo ao chat, reagindo a
          presentes e executando seu roteiro automaticamente.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-12">
        {/* ─── Lista de Personas ─── */}
        <div className="lg:col-span-4">
          <PersonaList
            personas={personas}
            activeId={activeId}
            selectedId={selectedId}
            loading={loading}
            onSelect={setSelectedId}
            onActivate={handleActivate}
            onChanged={refresh}
            onError={setError}
          />
        </div>

        {/* ─── Detalhe da Persona + Roteiro ─── */}
        <div className="lg:col-span-8 space-y-4">
          {selectedPersona ? (
            <>
              <PersonaDetail
                persona={selectedPersona}
                isActive={selectedPersona.id === activeId}
                onActivate={() => handleActivate(selectedPersona.id)}
                onChanged={refresh}
                onError={setError}
              />

              {/* Roteiro de Vídeos */}
              <div className="rounded-2xl border border-white/10 bg-[#0c0e12] p-5">
                <button
                  onClick={() => setShowRoteiro((v) => !v)}
                  className="flex w-full items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <Clapperboard className="h-4 w-4 text-violet-400" />
                    <h3 className="text-sm font-bold text-white">Roteiro de Vídeos</h3>
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-slate-400">
                      {videoStats.total} vídeos
                    </span>
                  </div>
                  {showRoteiro ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                </button>

                {showRoteiro && (
                  <div className="mt-4 space-y-3">
                    <p className="text-xs text-slate-400">
                      O roteiro é o caminho pré-definido que cada persona segue. Os vídeos são organizados por
                      categoria — copie o template abaixo para gerar os vídeos de uma nova persona.
                    </p>

                    {configLoading ? (
                      <div className="flex items-center gap-2 py-4 text-xs text-slate-500">
                        <Loader2 className="h-4 w-4 animate-spin" /> Carregando vídeos da persona...
                      </div>
                    ) : (
                      <div className="grid gap-3 sm:grid-cols-2">
                        {VIDEO_ROTEIRO.map((cat) => {
                          const count = videoStats.stats[cat.key]?.length || 0;
                          const colors = COLOR_CLASSES[cat.color];
                          const Icon = cat.icon;
                          return (
                            <div key={cat.key} className={cn('rounded-xl border p-3', colors.bg, colors.border)}>
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <Icon className={cn('h-4 w-4', colors.text)} />
                                  <span className={cn('text-xs font-bold', colors.text)}>{cat.label}</span>
                                </div>
                                <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold', colors.bg, colors.text)}>
                                  {count}/{cat.recommendedCount}
                                </span>
                              </div>
                              <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">{cat.description}</p>

                              {/* Lista de vídeos nesta categoria */}
                              {count > 0 && (
                                <div className="mt-2 space-y-1">
                                  {videoStats.stats[cat.key].slice(0, 5).map((v) => (
                                    <div key={v.id} className="flex items-center gap-1.5 rounded bg-black/30 px-2 py-1 text-[10px] text-slate-400">
                                      <span className={cn('h-1.5 w-1.5 rounded-full', colors.dot)} />
                                      <span className="truncate">{v.label || v.id}</span>
                                      {personaConfig?.idleVideoId === v.id && (
                                        <span className="ml-auto shrink-0 rounded bg-sky-500/20 px-1 text-[9px] text-sky-300">IDLE</span>
                                      )}
                                    </div>
                                  ))}
                                  {count > 5 && (
                                    <p className="text-[10px] text-slate-600">+{count - 5} mais...</p>
                                  )}
                                </div>
                              )}

                              {/* Prompt template */}
                              <div className="mt-2 rounded-lg border border-white/5 bg-black/40 p-2">
                                <div className="flex items-center justify-between">
                                  <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">Prompt-base</span>
                                  <button
                                    onClick={() => copyToClipboard(cat.promptTemplate)}
                                    className="flex items-center gap-1 text-[9px] text-violet-400 hover:text-violet-300"
                                  >
                                    <Copy className="h-2.5 w-2.5" /> Copiar
                                  </button>
                                </div>
                                <p className="mt-1 text-[10px] leading-relaxed text-slate-500 font-mono">
                                  {cat.promptTemplate}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Template copiável completo */}
                    <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-3">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5 text-xs font-bold text-violet-300">
                          <Sparkles className="h-3.5 w-3.5" /> Template completo do roteiro
                        </span>
                        <button
                          onClick={() => copyToClipboard(buildFullTemplate(selectedPersona))}
                          className="flex items-center gap-1 rounded-md bg-violet-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-violet-500"
                        >
                          <Copy className="h-3 w-3" /> Copiar roteiro
                        </button>
                      </div>
                      <pre className="mt-2 max-h-48 overflow-y-auto rounded-lg bg-black/40 p-3 text-[10px] leading-relaxed text-slate-400 font-mono whitespace-pre-wrap">
                        {buildFullTemplate(selectedPersona)}
                      </pre>
                    </div>

                    {/* Vídeos não categorizados */}
                    {videoStats.uncategorized.length > 0 && (
                      <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                          Sem categoria ({videoStats.uncategorized.length})
                        </span>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {videoStats.uncategorized.slice(0, 15).map((v) => (
                            <span key={v.id} className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-500">
                              {v.label || v.id}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex h-full min-h-[300px] items-center justify-center rounded-2xl border border-white/10 bg-[#0c0e12]">
              <div className="text-center">
                <Users className="mx-auto h-10 w-10 text-slate-600" />
                <p className="mt-2 text-sm text-slate-500">Selecione uma persona para ver os detalhes</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Persona List (sidebar) ─────────────────────────────────────────

function PersonaList({
  personas,
  activeId,
  selectedId,
  loading,
  onSelect,
  onActivate,
  onChanged,
  onError,
}: {
  personas: PersonaMeta[];
  activeId: string;
  selectedId: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
  onActivate: (id: string) => Promise<void>;
  onChanged: () => Promise<void>;
  onError: (e: string | null) => void;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newAvatar, setNewAvatar] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      await createPersona({ name, description: newDesc.trim(), avatarUrl: newAvatar.trim() });
      setNewName('');
      setNewDesc('');
      setNewAvatar('');
      setShowCreate(false);
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Falha ao criar persona');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (id === activeId) return;
    if (!confirm('Excluir esta persona? Os vídeos e configurações serão perdidos.')) return;
    try {
      await deletePersona(id);
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Falha ao excluir persona');
    }
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-[#0c0e12] p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-200">Personas</h3>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="flex items-center gap-1 rounded-lg bg-violet-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-violet-500"
        >
          <Plus className="h-3 w-3" /> Nova
        </button>
      </div>

      {showCreate && (
        <div className="mb-3 space-y-2 rounded-xl border border-white/10 bg-black/30 p-3">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nome da persona"
            className="h-9 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-slate-200 placeholder:text-slate-500"
          />
          <input
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder="Descrição (opcional)"
            className="h-9 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-slate-200 placeholder:text-slate-500"
          />
          <input
            value={newAvatar}
            onChange={(e) => setNewAvatar(e.target.value)}
            placeholder="URL da imagem (opcional)"
            className="h-9 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-slate-200 placeholder:text-slate-500"
          />
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
              className="h-8 flex-1 rounded-lg bg-violet-600 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-40"
            >
              {creating ? 'Criando...' : 'Criar'}
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="h-8 rounded-lg border border-white/10 px-3 text-xs text-slate-400 hover:bg-white/5"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-4 text-xs text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
        </div>
      ) : (
        <div className="space-y-2">
          {personas.map((p) => (
            <div
              key={p.id}
              className={cn(
                'group rounded-xl border transition-colors',
                p.id === selectedId
                  ? 'border-violet-500/50 bg-violet-500/10'
                  : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]',
              )}
            >
              <div className="flex items-center gap-2.5 p-2.5">
                {/* Avatar */}
                <div className="h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-violet-500/20">
                  {p.avatarUrl ? (
                    <img src={p.avatarUrl} alt={p.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs font-bold text-violet-300">
                      {p.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>

                <button
                  onClick={() => onSelect(p.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-slate-200">{p.name}</span>
                    {p.id === activeId && (
                      <span className="shrink-0 rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-bold text-emerald-300">
                        ATIVA
                      </span>
                    )}
                  </div>
                  {p.description && (
                    <p className="truncate text-[11px] text-slate-500">{p.description}</p>
                  )}
                </button>

                {p.id !== activeId && p.id !== 'odessa' && (
                  <button
                    onClick={() => handleDelete(p.id)}
                    className="shrink-0 rounded-lg p-1 text-slate-600 opacity-0 transition-opacity hover:bg-red-500/15 hover:text-red-400 group-hover:opacity-100"
                    title="Excluir"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {p.id !== activeId && (
                <button
                  onClick={() => onActivate(p.id)}
                  className="w-full border-t border-white/5 py-1.5 text-[10px] font-medium text-violet-400 hover:bg-violet-500/10"
                >
                  Ativar esta persona
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Persona Detail (editor) ────────────────────────────────────────

function PersonaDetail({
  persona,
  isActive,
  onActivate,
  onChanged,
  onError,
}: {
  persona: PersonaMeta;
  isActive: boolean;
  onActivate: () => void;
  onChanged: () => Promise<void>;
  onError: (e: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(persona.name);
  const [description, setDescription] = useState(persona.description || '');
  const [avatarUrl, setAvatarUrl] = useState(persona.avatarUrl || '');
  const [personality, setPersonalityState] = useState(persona.personality || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setName(persona.name);
    setDescription(persona.description || '');
    setAvatarUrl(persona.avatarUrl || '');
    setPersonalityState(persona.personality || '');
  }, [persona.id, persona.name, persona.description, persona.avatarUrl, persona.personality]);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await updatePersona(persona.id, { name, description, avatarUrl });
      await setPersonality(persona.id, personality);
      saveAiConfig({ systemPrompt: personality });
      setSaved(true);
      setEditing(false);
      await onChanged();
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Falha ao salvar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-[#0c0e12] p-5">
      <div className="flex items-start gap-4">
        {/* Avatar */}
        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-violet-500/20">
          {avatarUrl ? (
            <img src={avatarUrl} alt={name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xl font-bold text-violet-300">
              {name.charAt(0).toUpperCase()}
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="space-y-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-9 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm font-semibold text-slate-200"
              />
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Descrição da persona"
                className="h-9 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-xs text-slate-300"
              />
              <input
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
                placeholder="URL da imagem de avatar"
                className="h-9 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-xs text-slate-300"
              />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-white">{persona.name}</h2>
                {isActive && (
                  <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                    PERSONA ATIVA
                  </span>
                )}
              </div>
              {persona.description && (
                <p className="text-xs text-slate-400">{persona.description}</p>
              )}
            </>
          )}
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-2">
          {saved && <span className="text-[10px] text-emerald-400">✓ Salvo</span>}
          {editing ? (
            <>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-40"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Salvar
              </button>
              <button
                onClick={() => setEditing(false)}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-400 hover:bg-white/5"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="flex items-center gap-1 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5"
            >
              <Edit3 className="h-3.5 w-3.5" /> Editar
            </button>
          )}
        </div>
      </div>

      {/* Personalidade */}
      <div className="mt-4">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
          <Brain className="h-3.5 w-3.5 text-violet-400" />
          Personalidade / Inteligência da IA
        </div>
        <textarea
          value={personality}
          onChange={(e) => setPersonalityState(e.target.value)}
          rows={4}
          placeholder="Descreva a personalidade, o tom e o estilo de resposta desta persona. Este é o prompt de sistema que define como a IA age no chat..."
          className="mt-1.5 w-full resize-y rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600"
        />
        <p className="mt-1 text-[10px] text-slate-500">
          A personalidade é o prompt de sistema da IA — define como a persona responde no chat, reage a presentes e interage com o público.
        </p>
      </div>

      {!isActive && (
        <button
          onClick={onActivate}
          className="mt-4 w-full rounded-xl bg-emerald-600 py-2 text-sm font-bold text-white hover:bg-emerald-500"
        >
          Ativar esta persona
        </button>
      )}
    </div>
  );
}

// ─── Template builder ───────────────────────────────────────────────

function buildFullTemplate(persona: PersonaMeta): string {
  const name = persona.name || '[NOME]';
  const lines = [
    `# Roteiro de Vídeos — ${name}`,
    `# Copie este template e preencha os prompts para gerar os vídeos da persona.`,
    '',
    `## Persona: ${name}`,
    persona.description ? `Descrição: ${persona.description}` : '',
    '',
    '## Categorias de Vídeo (padrão de nomeação: NN_CATEGORIA_descrição)',
    '',
  ];

  for (const cat of VIDEO_ROTEIRO) {
    lines.push(`### ${cat.label} (prefixo: ${cat.prefix})`);
    lines.push(`Quantidade recomendada: ${cat.recommendedCount} vídeos`);
    lines.push(`Descrição: ${cat.description}`);
    lines.push(`Prompt-base:`);
    lines.push(`  ${cat.promptTemplate}`);
    lines.push('');
    lines.push(`Exemplos de nomes:`);
    for (let i = 1; i <= Math.min(3, cat.recommendedCount); i++) {
      lines.push(`  ${String(i).padStart(2, '0')}_${cat.prefix}_descricao_da_acao`);
    }
    lines.push('');
  }

  lines.push('## Fluxo de Execução');
  lines.push('1. IDLE toca em loop continuamente');
  lines.push('2. GATILHO dispara quando um presente/palavra-chave chega do chat');
  lines.push('3. TRANSICAO conecta estados suavemente');
  lines.push('4. ESPECIAL executa em momentos marcantes ou agendamentos');
  lines.push('5. Após cada reação, retorna ao IDLE automaticamente');
  lines.push('');
  lines.push('## Geração de Vídeo');
  lines.push('Use os prompts acima com a ferramenta de geração de vídeo.');
  lines.push('O frame base (último frame da live) é usado como referência.');

  return lines.filter((l) => l !== undefined).join('\n');
}
