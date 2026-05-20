import { useState, useEffect } from 'react';
import { Settings, ScanText, Activity, RefreshCw } from 'lucide-react';
import { apiUrl } from './lib/api';

export default function OcrSetup() {
  const [zones, setZones] = useState<Record<string, string>>({});
  const [isPolling] = useState(true);
  const [testText, setTestText] = useState('');
  const [testResult, setTestResult] = useState<any>(null);

  // OCR Config State
  const [ocrConfig, setOcrConfig] = useState({
    x: 0,
    y: 0,
    width: 400,
    height: 600,
    interval_ms: 2000,
    enabled: false,
  });
  const [isSaving, setIsSaving] = useState(false);

  // Fetch Initial OCR Config
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const res = await fetch(apiUrl('/api/ocr/config'));
        const data = await res.json();
        setOcrConfig(data);
      } catch (err) {
        console.error('Failed to fetch OCR config:', err);
      }
    };
    fetchConfig();
  }, []);

  const handleSaveConfig = async () => {
    try {
      setIsSaving(true);
      await fetch(apiUrl('/api/ocr/config'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ocrConfig),
      });
      setTimeout(() => setIsSaving(false), 500);
    } catch (err) {
      console.error('Failed to save config:', err);
      setIsSaving(false);
    }
  };

  const toggleOcrEngine = async () => {
    const newConfig = { ...ocrConfig, enabled: !ocrConfig.enabled };
    setOcrConfig(newConfig);
    try {
      await fetch(apiUrl('/api/ocr/config'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig),
      });
    } catch (err) {
      console.error('Failed to toggle OCR engine:', err);
    }
  };

  // Poll OCR Zones
  useEffect(() => {
    if (!isPolling) return;

    const fetchZones = async () => {
      try {
        const res = await fetch(apiUrl('/api/ocr/zones'));
        const data = await res.json();
        setZones(data);
      } catch (err) {
        console.error('Failed to fetch OCR zones:', err);
      }
    };

    const interval = setInterval(fetchZones, 2000);
    fetchZones(); // Initial fetch

    return () => clearInterval(interval);
  }, [isPolling]);

  // Test Automation Flow manually
  const handleTestText = async () => {
    if (!testText.trim()) return;
    try {
      const res = await fetch(
        apiUrl(`/api/automation/test-trigger?text=${encodeURIComponent(testText)}`),
        {
          method: 'POST',
        },
      );
      const data = await res.json();
      setTestResult({ status: 'success', data });
      setTestText('');

      // Auto-clear result after 3s
      setTimeout(() => setTestResult(null), 3000);
    } catch (err) {
      setTestResult({ status: 'error', message: 'Failed to inject text.' });
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-900">
      <div className="flex items-center justify-between p-6 border-b border-slate-800">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Settings className="text-blue-500 w-5 h-5" />
            Configuração do OCR & Eventos
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Monitore o que o sistema está lendo da tela e simule entradas de texto.
          </p>
        </div>

        <div className="flex gap-4">
          <button
            onClick={toggleOcrEngine}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition shadow-lg ${ocrConfig.enabled ? 'bg-emerald-600 text-white shadow-emerald-600/20' : 'bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700'}`}
          >
            <Activity className={`w-4 h-4 ${ocrConfig.enabled ? 'animate-pulse' : ''}`} />
            {ocrConfig.enabled ? 'Motor OCR: LIGADO' : 'Motor OCR: DESLIGADO'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 grid grid-cols-2 gap-6">
        {/* Left Column: Live OCR Reading & Config */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-300 uppercase tracking-wider">
            <ScanText className="w-4 h-4 text-blue-400" />
            Configuração da Região de Captura
          </div>

          <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">
                  X (Esquerda)
                </label>
                <input
                  type="number"
                  value={ocrConfig.x}
                  onChange={(e) => setOcrConfig({ ...ocrConfig, x: parseInt(e.target.value) || 0 })}
                  className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-xs text-slate-200 outline-none focus:border-blue-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Y (Topo)</label>
                <input
                  type="number"
                  value={ocrConfig.y}
                  onChange={(e) => setOcrConfig({ ...ocrConfig, y: parseInt(e.target.value) || 0 })}
                  className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-xs text-slate-200 outline-none focus:border-blue-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Largura</label>
                <input
                  type="number"
                  value={ocrConfig.width}
                  onChange={(e) =>
                    setOcrConfig({ ...ocrConfig, width: parseInt(e.target.value) || 0 })
                  }
                  className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-xs text-slate-200 outline-none focus:border-blue-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Altura</label>
                <input
                  type="number"
                  value={ocrConfig.height}
                  onChange={(e) =>
                    setOcrConfig({ ...ocrConfig, height: parseInt(e.target.value) || 0 })
                  }
                  className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-xs text-slate-200 outline-none focus:border-blue-500"
                />
              </div>
            </div>
            <button
              onClick={handleSaveConfig}
              className={`w-full py-2 text-white text-xs font-bold rounded transition ${isSaving ? 'bg-emerald-600' : 'bg-slate-700 hover:bg-slate-600'}`}
            >
              {isSaving ? 'Salvo!' : 'Salvar Configuração'}
            </button>
          </div>

          <div className="flex items-center gap-2 text-sm font-bold text-slate-300 uppercase tracking-wider mt-6">
            <Activity className="w-4 h-4 text-emerald-400" />
            Leitura ao Vivo (Zonas)
          </div>

          <div className="bg-black/50 border border-slate-800 rounded-xl p-4 min-h-[200px] flex flex-col gap-4">
            {Object.keys(zones).length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-500">
                <RefreshCw className="w-8 h-8 mb-2 animate-spin-slow opacity-50" />
                <p>Nenhuma zona detectada ainda.</p>
                <p className="text-xs mt-1">Inicie a captura de tela no OBS.</p>
              </div>
            ) : (
              Object.entries(zones).map(([zoneId, text]) => (
                <div
                  key={zoneId}
                  className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50"
                >
                  <div className="text-[10px] text-blue-400 font-bold uppercase mb-1">
                    Zona: {zoneId}
                  </div>
                  <div className="font-mono text-sm text-emerald-300 whitespace-pre-wrap break-words">
                    {text || <span className="text-slate-600 italic">Vazio...</span>}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right Column: Event Simulation */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-300 uppercase tracking-wider">
            <Activity className="w-4 h-4 text-amber-400" />
            Simulador de Eventos
          </div>

          <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-5 space-y-4">
            <p className="text-sm text-slate-400">
              Digite um texto para testar se os seus gatilhos estão configurados corretamente. Isso
              ignora o OCR e injeta o texto direto no Parser.
            </p>

            <div className="space-y-2">
              <textarea
                value={testText}
                onChange={(e) => setTestText(e.target.value)}
                placeholder='Ex: "Lucas enviou Rosa" ou "Maria comentou: linda!"'
                className="w-full h-24 bg-slate-900 border border-slate-700 rounded-lg p-3 text-slate-200 outline-none focus:border-blue-500 resize-none font-mono text-sm"
              />
              <button
                onClick={handleTestText}
                disabled={!testText.trim()}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-bold rounded-lg transition"
              >
                Injetar Texto
              </button>
            </div>

            {testResult && (
              <div
                className={`p-3 rounded-lg text-sm font-mono ${testResult.status === 'success' ? 'bg-emerald-900/30 text-emerald-400 border border-emerald-800' : 'bg-red-900/30 text-red-400 border border-red-800'}`}
              >
                {testResult.status === 'success'
                  ? 'Texto processado pelo Motor de Automação!'
                  : testResult.message}
              </div>
            )}
          </div>

          {/* Instructions Box */}
          <div className="bg-blue-900/10 border border-blue-900/30 rounded-xl p-5">
            <h3 className="text-sm font-bold text-blue-400 mb-2">Como o Parser Funciona?</h3>
            <ul className="text-xs text-slate-400 space-y-2 list-disc pl-4">
              <li>
                Padrão Gift:{' '}
                <code className="bg-slate-800 px-1 py-0.5 rounded text-amber-200">
                  [Usuário] enviou [Presente]
                </code>
              </li>
              <li>
                Padrão Comment:{' '}
                <code className="bg-slate-800 px-1 py-0.5 rounded text-amber-200">
                  [Usuário]: [Mensagem]
                </code>
              </li>
              <li>
                O Parser ignora maiúsculas e minúsculas e mapeia sinônimos (ex: 🌹 vira gift.rosa).
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
