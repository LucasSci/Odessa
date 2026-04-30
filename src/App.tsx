import { useEffect, useState } from 'react';
import { Bot, Camera, RadioTower } from 'lucide-react';
import AIPersonaTrainer from './AIPersonaTrainer';
import CaptureStudio from './CaptureStudio';
import LiveAutopilotConsole from './LiveAutopilotConsole';
import { cn } from './lib/utils';
import type { CapturedMessage } from './types';

type AppTab = 'capture' | 'persona' | 'live';

function getTabFromHash(): AppTab {
  if (window.location.hash === '#persona') return 'persona';
  if (window.location.hash === '#live') return 'live';
  return window.location.hash === '#persona' ? 'persona' : 'capture';
}

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>(() => getTabFromHash());
  const [capturedText, setCapturedText] = useState<CapturedMessage[]>([]);

  useEffect(() => {
    const handleHashChange = () => setActiveTab(getTabFromHash());
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const changeTab = (tab: AppTab) => {
    setActiveTab(tab);
    window.location.hash = tab;
  };

  return (
    <div className="flex h-screen flex-col bg-[#070A0F] font-sans text-white">
      <header className="flex flex-col gap-3 border-b border-slate-800 bg-[#111722] px-4 py-3 lg:flex-row lg:items-center lg:justify-between lg:px-6">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
          <div className="flex items-center gap-3 sm:border-r sm:border-slate-700 sm:pr-6">
            <div className="rounded-md bg-rose-500/10 p-2">
              <Camera className="h-5 w-5 text-rose-300" />
            </div>
            <div>
              <h1 className="text-lg font-black tracking-tight text-white">Odessa</h1>
              <p className="text-xs font-semibold text-slate-500">Odessa local studio</p>
            </div>
          </div>

          <nav className="flex max-w-full gap-2 overflow-x-auto">
            <button
              onClick={() => changeTab('capture')}
              className={cn(
                'inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-black transition',
                activeTab === 'capture'
                  ? 'bg-sky-500/10 text-sky-200 ring-1 ring-sky-400/30'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-white',
              )}
            >
              <Camera className="h-4 w-4" />
              Extrator OCR
            </button>
            <button
              onClick={() => changeTab('persona')}
              className={cn(
                'inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-black transition',
                activeTab === 'persona'
                  ? 'bg-violet-500/10 text-violet-200 ring-1 ring-violet-400/30'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-white',
              )}
            >
              <Bot className="h-4 w-4" />
              Persona IA
            </button>
            <button
              onClick={() => changeTab('live')}
              className={cn(
                'inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-black transition',
                activeTab === 'live'
                  ? 'bg-emerald-500/10 text-emerald-200 ring-1 ring-emerald-400/30'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-white',
              )}
            >
              <RadioTower className="h-4 w-4" />
              Controle Live
            </button>
          </nav>
        </div>

        <div className="flex w-fit items-center gap-2 rounded-md border border-slate-800 bg-slate-950/60 px-3 py-1.5 text-xs font-bold text-slate-300">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          {capturedText.length} capturas roteadas
        </div>
      </header>

      {activeTab === 'capture' ? (
        <CaptureStudio capturedText={capturedText} setCapturedText={setCapturedText} />
      ) : activeTab === 'persona' ? (
        <AIPersonaTrainer capturedText={capturedText} setCapturedText={setCapturedText} />
      ) : (
        <LiveAutopilotConsole capturedText={capturedText} setCapturedText={setCapturedText} />
      )}
    </div>
  );
}
