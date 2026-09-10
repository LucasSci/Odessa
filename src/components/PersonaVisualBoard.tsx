/**
 * PersonaVisualBoard.tsx — Painel visual das personas.
 *
 * Mostra todas as personas em cards lado a lado, cada um exibindo:
 * - Rosto: imagem de referência principal da persona
 * - Cenário atual: selecionável por dropdown (salvo no banco) + imagem do ambiente
 * - Peças do kit: peças do kit de roupas do cenário atual
 */
import { useEffect, useState } from 'react';
import { listPersonas, type PersonaMeta } from '../core/personaManager';
import {
  getPersonaAssets,
  getPersonaVisual,
  setActiveScenario,
  assetUrl,
  type PersonaAssets,
  type PersonaVisual,
} from '../core/personaAssets';

const EMPTY_ASSETS: PersonaAssets = { faces: [], environments: [], wardrobe: [] };

const COLUMN_TITLE_CLS =
  'mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500';
const PLACEHOLDER_CLS =
  'flex aspect-[3/4] w-full items-center justify-center rounded-xl border border-dashed border-white/15 bg-black/20 px-2 text-center text-[10px] leading-tight text-slate-600';

export default function PersonaVisualBoard() {
  const [personas, setPersonas] = useState<PersonaMeta[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    listPersonas()
      .then((data) => {
        if (alive) setPersonas(data.personas);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : 'Falha ao carregar personas');
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="rounded-2xl border border-white/10 bg-[#0c0e12] p-5">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-violet-200/70">
        🎞️ Painel Visual
      </div>
      <p className="mt-1 text-xs text-slate-400">
        Rosto, cenário atual e peças do kit de roupas de cada persona — a troca de cenário é
        salva no banco.
      </p>
      {error && (
        <p className="mt-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>
      )}
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        {personas.map((p) => (
          <PersonaVisualCard key={p.id} persona={p} />
        ))}
      </div>
    </div>
  );
}

function PersonaVisualCard({ persona }: { persona: PersonaMeta }) {
  const [assets, setAssets] = useState<PersonaAssets>(EMPTY_ASSETS);
  const [visual, setVisual] = useState<PersonaVisual>({
    activeScenarioId: null,
    wardrobeKits: [],
    scenarios: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([getPersonaAssets(persona.id), getPersonaVisual(persona.id)])
      .then(([assetData, visualData]) => {
        if (!alive) return;
        setAssets(assetData.assets);
        setVisual(visualData);
        setError(null);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : 'Falha ao carregar dados visuais');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [persona.id]);

  const handleScenarioChange = async (scenarioId: string) => {
    setVisual((prev) => ({ ...prev, activeScenarioId: scenarioId }));
    try {
      await setActiveScenario(persona.id, scenarioId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao salvar cenário atual');
    }
  };

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-xs text-slate-500">
        Carregando {persona.name}...
      </div>
    );
  }

  const scenario =
    visual.scenarios.find((s) => s.id === visual.activeScenarioId) ??
    visual.scenarios[0] ??
    null;
  const face = assets.faces[0] ?? null;
  const env = scenario?.environmentId
    ? (assets.environments.find((a) => a.id === scenario.environmentId) ?? null)
    : null;
  const kit = scenario?.wardrobeKitId
    ? (visual.wardrobeKits.find((k) => k.id === scenario.wardrobeKitId) ?? null)
    : null;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      {/* Header: nome + seletor de cenário atual */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4 className="truncate text-sm font-bold text-white">{persona.name}</h4>
        {visual.scenarios.length > 0 ? (
          <select
            value={scenario?.id ?? ''}
            onChange={(e) => void handleScenarioChange(e.target.value)}
            className="h-8 max-w-[220px] rounded-lg border border-white/10 bg-white/[0.05] px-2 text-xs text-slate-200 outline-none focus:border-violet-500/50"
            title="Cenário atual"
          >
            {visual.scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-[11px] text-slate-500">Sem cenários</span>
        )}
      </div>
      {error && (
        <p className="mb-2 rounded-lg bg-red-500/10 px-2 py-1 text-[11px] text-red-400">
          {error}
        </p>
      )}

      {/* Rosto | Cenário atual | Peças do kit — lado a lado */}
      <div className="grid grid-cols-3 gap-3">
        {/* Rosto */}
        <div>
          <p className={COLUMN_TITLE_CLS}>Rosto</p>
          {face ? (
            <img
              src={assetUrl(persona.id, 'faces', face.id)}
              alt={face.label}
              title={face.label}
              className="aspect-[3/4] w-full rounded-xl border border-white/10 object-cover"
            />
          ) : (
            <div className={PLACEHOLDER_CLS}>Sem imagem de rosto</div>
          )}
        </div>

        {/* Cenário atual */}
        <div>
          <p className={COLUMN_TITLE_CLS}>Cenário atual</p>
          {env ? (
            <img
              src={assetUrl(persona.id, 'environments', env.id)}
              alt={env.label}
              title={env.label}
              className="aspect-[3/4] w-full rounded-xl border border-white/10 object-cover"
            />
          ) : (
            <div className={PLACEHOLDER_CLS}>
              {scenario ? 'Cenário sem ambiente' : 'Nenhum cenário'}
            </div>
          )}
          {scenario && (
            <p className="mt-1 truncate text-[11px] text-slate-400" title={scenario.name}>
              {scenario.name}
            </p>
          )}
        </div>

        {/* Peças do kit */}
        <div>
          <p className={COLUMN_TITLE_CLS}>Peças do kit</p>
          {kit && kit.pieceIds.length > 0 ? (
            <div className="grid grid-cols-2 gap-1.5">
              {kit.pieceIds.map((pid) => {
                const piece = assets.wardrobe.find((a) => a.id === pid);
                if (!piece) return null;
                return (
                  <img
                    key={pid}
                    src={assetUrl(persona.id, 'wardrobe', pid)}
                    alt={piece.label}
                    title={piece.label}
                    className="aspect-[3/4] w-full rounded-lg border border-white/10 object-cover"
                  />
                );
              })}
            </div>
          ) : (
            <div className={PLACEHOLDER_CLS}>
              {kit ? 'Kit sem peças' : 'Cenário sem kit'}
            </div>
          )}
          {kit && (
            <p className="mt-1 truncate text-[11px] text-slate-400" title={kit.name}>
              {kit.name}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
