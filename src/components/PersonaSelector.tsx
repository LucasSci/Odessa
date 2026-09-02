import { useCallback, useEffect, useState } from 'react';
import {
  listPersonas,
  setActivePersona,
  createPersona,
  deletePersona,
  getActivePersonality,
  setPersonality,
  type PersonaMeta,
} from '../core/personaManager';
import { saveAiConfig } from '../core/aiConfig';

type PersonaSelectorProps = {
  onPersonaChange?: (personaId: string) => void;
};

export default function PersonaSelector({ onPersonaChange }: PersonaSelectorProps) {
  const [personas, setPersonas] = useState<PersonaMeta[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [personality, setPersonalityState] = useState('');
  const [savingPersonality, setSavingPersonality] = useState(false);
  const [personalitySaved, setPersonalitySaved] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await listPersonas();
      setPersonas(data.personas);
      setActiveId(data.activePersonaId);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao carregar personas');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPersonality = useCallback(async (id: string) => {
    try {
      const data = await getActivePersonality();
      if (data.personaId === id) {
        setPersonalityState(data.personality || '');
      }
    } catch {
      // silencioso
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (activeId) void loadPersonality(activeId);
  }, [activeId, loadPersonality]);

  const handleSelect = async (id: string) => {
    if (id === activeId) return;
    try {
      await setActivePersona(id);
      setActiveId(id);
      onPersonaChange?.(id);
      await loadPersonality(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao trocar persona');
    }
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      await createPersona({ name, description: newDesc.trim() });
      setNewName('');
      setNewDesc('');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao criar persona');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (id === activeId) return;
    try {
      await deletePersona(id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao excluir persona');
    }
  };

  const handleSavePersonality = async () => {
    if (!activeId) return;
    setSavingPersonality(true);
    setPersonalitySaved(false);
    try {
      await setPersonality(activeId, personality);
      // Aplica a personalidade como prompt de sistema efetivo da IA
      saveAiConfig({ systemPrompt: personality });
      setPersonalitySaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao salvar personalidade');
    } finally {
      setSavingPersonality(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.045] p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-200">Perfis de IA (Personas)</h3>
        <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-xs text-violet-300">
          {activeId || '—'}
        </span>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {loading ? (
        <p className="text-xs text-slate-400">Carregando personas...</p>
      ) : (
        <div className="flex flex-col gap-2">
          {personas.map((p) => (
            <div
              key={p.id}
              className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm transition-colors ${
                p.id === activeId
                  ? 'border-violet-500/50 bg-violet-500/10 text-violet-200'
                  : 'border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.06]'
              }`}
            >
              <button
                type="button"
                className="flex-1 text-left"
                onClick={() => handleSelect(p.id)}
                title={p.description || p.name}
              >
                <span className="font-medium">{p.name}</span>
                {p.description && (
                  <span className="ml-2 text-xs text-slate-400">{p.description}</span>
                )}
              </button>
              {p.id !== activeId && p.id !== 'odessa' && (
                <button
                  type="button"
                  onClick={() => handleDelete(p.id)}
                  className="rounded-lg p-1 text-slate-500 transition-colors hover:bg-red-500/15 hover:text-red-400"
                  title="Excluir persona"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {activeId && (
        <div className="flex flex-col gap-2 border-t border-white/10 pt-3">
          <label className="text-xs font-medium text-slate-300">
            Personalidade da persona ({activeId})
          </label>
          <textarea
            value={personality}
            onChange={(e) => {
              setPersonalityState(e.target.value);
              setPersonalitySaved(false);
            }}
            rows={4}
            placeholder="Descreva a personalidade, o tom e o estilo de resposta desta persona..."
            className="resize-y rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSavePersonality}
              disabled={savingPersonality}
              className="h-9 flex-1 rounded-xl bg-violet-600 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-40"
            >
              {savingPersonality ? 'Salvando...' : 'Salvar personalidade'}
            </button>
            {personalitySaved && (
              <span className="text-xs text-emerald-400">Salvo ✓</span>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2 border-t border-white/10 pt-3">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Nome da nova persona"
          className="h-9 rounded-xl border border-white/10 bg-white/[0.045] px-3 text-sm text-slate-200 placeholder:text-slate-500"
        />
        <input
          value={newDesc}
          onChange={(e) => setNewDesc(e.target.value)}
          placeholder="Descrição (opcional)"
          className="h-9 rounded-xl border border-white/10 bg-white/[0.045] px-3 text-sm text-slate-200 placeholder:text-slate-500"
        />
        <button
          type="button"
          onClick={handleCreate}
          disabled={creating || !newName.trim()}
          className="h-9 rounded-xl bg-violet-600 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-40"
        >
          {creating ? 'Criando...' : '+ Criar persona'}
        </button>
      </div>
    </div>
  );
}
