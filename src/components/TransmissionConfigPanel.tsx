import { useCallback, useEffect, useState } from 'react';
import { Loader2, RadioTower, Save } from 'lucide-react';
import { cn } from '../lib/utils';
import {
  getPersonaTransmission,
  setPersonaTransmission,
  type TransmissionConfig,
} from '../core/personaManager';

type Props = {
  personaId: string;
  personaName: string;
};

const DEFAULT_CONFIG: TransmissionConfig = {
  startupSceneName: '',
  liveSceneName: '',
  stageSourceName: '',
  stageUrl: '',
  chatSourceName: '',
  transmissionMode: 'stream',
  canvasWidth: 1080,
  canvasHeight: 1920,
};

const TRANSMISSION_MODES = [
  { value: 'stream', label: 'Stream (RTMP)' },
  { value: 'virtual_camera', label: 'Câmera Virtual' },
  { value: 'none', label: 'Nenhuma' },
];

export default function TransmissionConfigPanel({ personaId, personaName }: Props) {
  const [config, setConfig] = useState<TransmissionConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getPersonaTransmission(personaId);
      setConfig({ ...DEFAULT_CONFIG, ...data.transmissionConfig });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao carregar configuração');
    } finally {
      setLoading(false);
    }
  }, [personaId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await setPersonaTransmission(personaId, config);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao salvar configuração');
    } finally {
      setSaving(false);
    }
  };

  const update = <K extends keyof TransmissionConfig>(key: K, value: TransmissionConfig[K]) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-[#0c0e12] p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <RadioTower className="h-4 w-4 text-sky-400" />
          <h3 className="text-sm font-bold text-white">Configuração de Transmissão</h3>
          <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-medium text-sky-300">
            {personaName}
          </span>
        </div>
        {saved && <span className="text-[10px] font-medium text-emerald-400">✓ Salvo</span>}
      </div>

      <p className="mb-4 text-xs text-slate-400">
        Estas configurações são exclusivas desta persona. Defina cenas, fontes e modo de transmissão
        próprios para evitar que o OBS exiba conteúdo de outra persona.
      </p>

      {error && (
        <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-6 text-xs text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
        </div>
      ) : (
        <div className="space-y-3">
          {/* Modo de transmissão */}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-300">Modo de transmissão</label>
            <div className="flex gap-2">
              {TRANSMISSION_MODES.map((mode) => (
                <button
                  key={mode.value}
                  type="button"
                  onClick={() => update('transmissionMode', mode.value)}
                  className={cn(
                    'flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors',
                    config.transmissionMode === mode.value
                      ? 'border-sky-500/50 bg-sky-500/15 text-sky-200'
                      : 'border-white/10 bg-white/[0.03] text-slate-400 hover:bg-white/[0.06]',
                  )}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {/* Cena de startup */}
            <Field
              label="Cena de startup (OBS)"
              value={config.startupSceneName}
              onChange={(v) => update('startupSceneName', v)}
              placeholder="Ex: Odessa START"
            />

            {/* Cena de live */}
            <Field
              label="Cena de live (OBS)"
              value={config.liveSceneName}
              onChange={(v) => update('liveSceneName', v)}
              placeholder="Ex: Odessa LIVE"
            />

            {/* Source do palco */}
            <Field
              label="Source do palco (OBS)"
              value={config.stageSourceName}
              onChange={(v) => update('stageSourceName', v)}
              placeholder="Ex: Odessa Stage Overlay"
            />

            {/* Source do chat */}
            <Field
              label="Source do chat/OCR (OBS)"
              value={config.chatSourceName}
              onChange={(v) => update('chatSourceName', v)}
              placeholder="Ex: Odessa Chat OCR"
            />

            {/* URL do palco */}
            <Field
              label="URL do palco (stage overlay)"
              value={config.stageUrl}
              onChange={(v) => update('stageUrl', v)}
              placeholder="Ex: http://localhost:3000/#overlay"
            />

            {/* Canvas */}
            <div className="grid grid-cols-2 gap-2">
              <Field
                label="Largura (px)"
                type="number"
                value={String(config.canvasWidth)}
                onChange={(v) => update('canvasWidth', parseInt(v) || 1080)}
                placeholder="1080"
              />
              <Field
                label="Altura (px)"
                type="number"
                value={String(config.canvasHeight)}
                onChange={(v) => update('canvasHeight', parseInt(v) || 1920)}
                placeholder="1920"
              />
            </div>
          </div>

          {/* Save button */}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-sky-600 py-2.5 text-sm font-bold text-white transition-colors hover:bg-sky-500 disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? 'Salvando...' : 'Salvar configuração de transmissão'}
          </button>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'number';
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-300">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm text-slate-200 placeholder:text-slate-600 focus:border-sky-500/50 focus:outline-none"
      />
    </div>
  );
}
