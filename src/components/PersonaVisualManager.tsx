/**
 * PersonaVisualManager.tsx — Kits de roupas e cenários de uma persona.
 *
 * Faz parte da estrutura visual do banco de personas:
 * - Kit de roupas: conjunto nomeado de peças (imagens do guarda-roupa)
 * - Cenário: setup completo que combina rosto + ambiente + kit,
 *   pronto para ser usado na geração de vídeo
 */
import { useCallback, useEffect, useState } from 'react';
import {
  getPersonaVisual,
  createWardrobeKit,
  deleteWardrobeKit,
  createScenario,
  deleteScenario,
  assetUrl,
  type PersonaAssets,
  type PersonaVisual,
} from '../core/personaAssets';

type Props = {
  personaId: string;
  assets: PersonaAssets;
};

const INPUT_CLS =
  'h-9 flex-1 rounded-xl border border-white/10 bg-white/[0.045] px-2 text-sm text-slate-200 placeholder:text-slate-500 outline-none focus:border-violet-500/50';
const SELECT_CLS =
  'h-9 flex-1 rounded-xl border border-white/10 bg-white/[0.045] px-2 text-sm text-slate-200 outline-none focus:border-violet-500/50';

export default function PersonaVisualManager({ personaId, assets }: Props) {
  const [visual, setVisual] = useState<PersonaVisual>({ wardrobeKits: [], scenarios: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Formulário de kit
  const [kitName, setKitName] = useState('');
  const [selectedPieces, setSelectedPieces] = useState<string[]>([]);

  // Formulário de cenário
  const [scenarioName, setScenarioName] = useState('');
  const [scenarioFace, setScenarioFace] = useState('');
  const [scenarioEnv, setScenarioEnv] = useState('');
  const [scenarioKit, setScenarioKit] = useState('');

  const refresh = useCallback(async () => {
    try {
      setVisual(await getPersonaVisual(personaId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao carregar kits e cenários');
    } finally {
      setLoading(false);
    }
  }, [personaId]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  const togglePiece = (id: string) =>
    setSelectedPieces((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );

  const handleCreateKit = async () => {
    setBusy(true);
    setError(null);
    try {
      await createWardrobeKit(personaId, {
        name: kitName.trim(),
        pieceIds: selectedPieces,
      });
      setKitName('');
      setSelectedPieces([]);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao criar kit');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteKit = async (kitId: string) => {
    try {
      await deleteWardrobeKit(personaId, kitId);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao excluir kit');
    }
  };

  const handleCreateScenario = async () => {
    setBusy(true);
    setError(null);
    try {
      await createScenario(personaId, {
        name: scenarioName.trim(),
        faceId: scenarioFace || undefined,
        environmentId: scenarioEnv || undefined,
        wardrobeKitId: scenarioKit || undefined,
      });
      setScenarioName('');
      setScenarioFace('');
      setScenarioEnv('');
      setScenarioKit('');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao criar cenário');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteScenario = async (scenarioId: string) => {
    try {
      await deleteScenario(personaId, scenarioId);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao excluir cenário');
    }
  };

  if (loading) {
    return (
      <p className="p-4 text-center text-sm text-slate-400">
        Carregando kits e cenários...
      </p>
    );
  }

  const wardrobe = assets.wardrobe || [];
  const faces = assets.faces || [];
  const environments = assets.environments || [];

  return (
    <div className="flex flex-col gap-5">
      {error && (
        <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>
      )}

      {/* ── Kits de roupas ── */}
      <section className="flex flex-col gap-3">
        <header>
          <h4 className="text-sm font-semibold text-slate-200">👗 Kits de Roupas</h4>
          <p className="mt-0.5 text-xs text-slate-400">
            Conjuntos nomeados de peças do guarda-roupa (ex.: "Kit Praia" com topo, saia,
            acessórios)
          </p>
        </header>

        {visual.wardrobeKits.length > 0 && (
          <div className="flex flex-col gap-2">
            {visual.wardrobeKits.map((kit) => (
              <div
                key={kit.id}
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3"
              >
                <div className="flex flex-wrap gap-1.5">
                  {kit.pieceIds.map((pid) => {
                    const piece = wardrobe.find((w) => w.id === pid);
                    if (!piece) return null;
                    return (
                      <img
                        key={pid}
                        src={assetUrl(personaId, 'wardrobe', pid)}
                        alt={piece.label}
                        title={piece.label}
                        className="h-10 w-10 rounded-lg border border-white/10 object-cover"
                      />
                    );
                  })}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-200">{kit.name}</p>
                  {kit.description && (
                    <p className="truncate text-xs text-slate-400">{kit.description}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => void handleDeleteKit(kit.id)}
                  className="rounded p-1 text-slate-500 transition-colors hover:bg-red-500/15 hover:text-red-400"
                  title="Excluir kit"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {wardrobe.length > 0 ? (
          <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="flex gap-2">
              <input
                value={kitName}
                onChange={(e) => setKitName(e.target.value)}
                placeholder="Nome do kit (ex.: Kit Praia)"
                className={INPUT_CLS}
              />
              <button
                type="button"
                onClick={() => void handleCreateKit()}
                disabled={busy || !kitName.trim() || selectedPieces.length === 0}
                className="rounded-xl bg-violet-600 px-4 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-40"
              >
                Criar kit
              </button>
            </div>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
              {wardrobe.map((piece) => {
                const selected = selectedPieces.includes(piece.id);
                return (
                  <button
                    key={piece.id}
                    type="button"
                    onClick={() => togglePiece(piece.id)}
                    title={piece.label}
                    className={`relative overflow-hidden rounded-lg border transition-all ${
                      selected
                        ? 'border-violet-500 ring-2 ring-violet-500/40'
                        : 'border-white/10 opacity-70 hover:opacity-100'
                    }`}
                  >
                    <img
                      src={assetUrl(personaId, 'wardrobe', piece.id)}
                      alt={piece.label}
                      className="aspect-square h-full w-full object-cover"
                    />
                    {selected && (
                      <span className="absolute right-1 top-1 rounded-full bg-violet-600 px-1 text-[10px] leading-4 text-white">
                        ✓
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-slate-500">
              Selecione as peças que formam o kit ({selectedPieces.length} selecionada
              {selectedPieces.length === 1 ? '' : 's'})
            </p>
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            Envie imagens de roupas na aba "Imagens" para montar kits.
          </p>
        )}
      </section>

      {/* ── Cenários completos ── */}
      <section className="flex flex-col gap-3 border-t border-white/10 pt-4">
        <header>
          <h4 className="text-sm font-semibold text-slate-200">🎬 Cenários Completos</h4>
          <p className="mt-0.5 text-xs text-slate-400">
            Setups que combinam rosto + ambiente + kit de roupas, prontos para gerar vídeo
          </p>
        </header>

        {visual.scenarios.length > 0 && (
          <div className="flex flex-col gap-2">
            {visual.scenarios.map((s) => {
              const face = faces.find((f) => f.id === s.faceId);
              const env = environments.find((e) => e.id === s.environmentId);
              const kit = visual.wardrobeKits.find((k) => k.id === s.wardrobeKitId);
              return (
                <div
                  key={s.id}
                  className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3"
                >
                  <div className="flex gap-1.5">
                    {face && (
                      <img
                        src={assetUrl(personaId, 'faces', face.id)}
                        alt={face.label}
                        title={`Rosto: ${face.label}`}
                        className="h-10 w-10 rounded-lg border border-white/10 object-cover"
                      />
                    )}
                    {env && (
                      <img
                        src={assetUrl(personaId, 'environments', env.id)}
                        alt={env.label}
                        title={`Ambiente: ${env.label}`}
                        className="h-10 w-10 rounded-lg border border-white/10 object-cover"
                      />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-200">{s.name}</p>
                    <p className="truncate text-xs text-slate-400">
                      {face ? face.label : 'Rosto primário'} ·{' '}
                      {env ? env.label : 'Sem ambiente'} ·{' '}
                      {kit ? kit.name : 'Sem kit'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleDeleteScenario(s.id)}
                    className="rounded p-1 text-slate-500 transition-colors hover:bg-red-500/15 hover:text-red-400"
                    title="Excluir cenário"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-black/20 p-3">
          <input
            value={scenarioName}
            onChange={(e) => setScenarioName(e.target.value)}
            placeholder="Nome do cenário (ex.: Live Praia ao Pôr do Sol)"
            className={INPUT_CLS}
          />
          <div className="flex flex-wrap gap-2">
            <select
              value={scenarioFace}
              onChange={(e) => setScenarioFace(e.target.value)}
              className={SELECT_CLS}
              title="Rosto"
            >
              <option value="">Rosto primário</option>
              {faces.map((f) => (
                <option key={f.id} value={f.id}>
                  Rosto: {f.label}
                </option>
              ))}
            </select>
            <select
              value={scenarioEnv}
              onChange={(e) => setScenarioEnv(e.target.value)}
              className={SELECT_CLS}
              title="Ambiente"
            >
              <option value="">Sem ambiente</option>
              {environments.map((e2) => (
                <option key={e2.id} value={e2.id}>
                  Ambiente: {e2.label}
                </option>
              ))}
            </select>
            <select
              value={scenarioKit}
              onChange={(e) => setScenarioKit(e.target.value)}
              className={SELECT_CLS}
              title="Kit de roupas"
            >
              <option value="">Sem kit</option>
              {visual.wardrobeKits.map((k) => (
                <option key={k.id} value={k.id}>
                  Kit: {k.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void handleCreateScenario()}
              disabled={busy || !scenarioName.trim()}
              className="rounded-xl bg-violet-600 px-4 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-40"
            >
              Criar cenário
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
