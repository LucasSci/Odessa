import React, { useEffect, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import {
  Activity,
  BookOpen,
  Bot,
  Camera,
  ChevronUp,
  ClipboardList,
  LayoutDashboard,
  Play,
  RadioTower,
  ShieldCheck,
  Wand2,
  Zap,
  Video,
} from 'lucide-react';
import AIPersonaTrainer from './AIPersonaTrainer';
import PersonaStudio from './PersonaStudio';
import CaptureStudio from './CaptureStudio';
import ContentLibrary from './ContentLibrary';
import LiveAutopilotConsole from './LiveAutopilotConsole';
import { loadContentItems } from './core/contentLibrary';
import { usePersonaTriggers } from './core/usePersonaTriggers';
import type { AutopilotRuntimeState } from './core/useAutopilotRuntime';
import { cn } from './lib/utils';
import { apiUrl } from './lib/api';
import { loadTtsSettings, type TtsSettings } from './lib/ttsSettings';
import type { AutopilotAction, CapturedMessage, ContentItem } from './types';

export type AdvancedPanel = 'overview' | 'capture' | 'persona' | 'content' | 'runtime';

interface OdessaLiveCenterProps {
  capturedText: CapturedMessage[];
  setCapturedText: Dispatch<SetStateAction<CapturedMessage[]>>;
  runtime: AutopilotRuntimeState;
  requestedPanel: AdvancedPanel;
}

function trimText(text: string, max = 130) {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}...` : clean;
}

function selectPrimaryAction(actions: AutopilotAction[]) {
  return (
    actions.find((action) => action.status === 'approval_required') ||
    actions.find((action) => action.status === 'running') ||
    actions.find((action) => action.status === 'queued') ||
    actions[actions.length - 1]
  );
}

function formatActionStatus(status?: AutopilotAction['status']) {
  if (!status) return 'aguardando';
  const labels: Record<AutopilotAction['status'], string> = {
    queued: 'na fila',
    running: 'executando',
    done: 'feito',
    simulated: 'simulado',
    n8n_dispatched: 'n8n',
    error: 'erro',
    blocked: 'bloqueado',
    approval_required: 'aprovar',
  };
  return labels[status];
}

function panelToTab(
  panel: AdvancedPanel,
): 'studio' | 'signals' | 'persona' | 'content' | 'actions' | 'audit' {
  if (panel === 'capture') return 'signals';
  if (panel === 'persona') return 'persona';
  if (panel === 'content') return 'content';
  if (panel === 'runtime') return 'audit';
  return 'studio';
}

export default function OdessaLiveCenter({
  capturedText,
  setCapturedText,
  runtime,
  requestedPanel,
}: OdessaLiveCenterProps) {
  const [activeTab, setActiveTab] = useState<
    'studio' | 'signals' | 'persona' | 'persona-studio' | 'content' | 'actions' | 'audit'
  >(() => panelToTab(requestedPanel));
  const [contentItems, setContentItems] = useState<ContentItem[]>(() => loadContentItems());
  const [ttsSettings, setTtsSettings] = useState<TtsSettings>(() => loadTtsSettings());
  const [videoTransitionCallback, setVideoTransitionCallback] = useState<{
    gift: (data?: any) => void;
    message: (data?: any) => void;
    reaction: (data?: any) => void;
  } | null>(null);
  const [personaConfig, setPersonaConfig] = useState<any>(null);

  useEffect(() => {
    fetch(apiUrl('/api/video/config'))
      .then(res => res.json())
      .then(setPersonaConfig)
      .catch(console.error);
  }, []);

  // Setup triggers for video transitions based on chat events
  usePersonaTriggers(
    capturedText,
    {
      enableGiftTrigger: true,
      enableMessageTrigger: Boolean(
        personaConfig?.triggers && Array.isArray(personaConfig.triggers.message_keywords) &&
          personaConfig.triggers.message_keywords.length > 0,
      ),
      enableReactionTrigger: true,
      giftKeywords: personaConfig?.triggers?.gift_keywords,
      messageKeywords: personaConfig?.triggers?.message_keywords,
    },
    (type, data) => {
      if (videoTransitionCallback && videoTransitionCallback[type]) {
        try {
          videoTransitionCallback[type](data);
        } catch (err) {
          console.error('[Trigger] videoTransitionCallback error', err);
        }
      }
    },
  );

  useEffect(() => {
    const handleContentChange = (event: Event) => {
      const custom = event as CustomEvent<ContentItem[]>;
      setContentItems(Array.isArray(custom.detail) ? custom.detail : loadContentItems());
    };
    const handleTtsChange = (event: Event) => {
      const custom = event as CustomEvent<TtsSettings>;
      setTtsSettings(custom.detail || loadTtsSettings());
    };
    window.addEventListener('odessa:content-library-changed', handleContentChange);
    window.addEventListener('odessa:tts-settings-changed', handleTtsChange);
    return () => {
      window.removeEventListener('odessa:content-library-changed', handleContentChange);
      window.removeEventListener('odessa:tts-settings-changed', handleTtsChange);
    };
  }, []);

  const view = useMemo(() => {
    const health = runtime.health;
    const backendReady = health?.status === 'ok';
    const aiReady = Boolean(health?.gemini_configured || health?.openai_ai_configured);
    const ttsReady =
      ttsSettings.provider === 'openai'
        ? health?.openai_tts_configured === true
        : ttsSettings.provider === 'kokoro'
          ? health?.kokoro_tts_configured === true
          : backendReady;
    const ready = Boolean(backendReady && aiReady && ttsReady);
    const lastOcr = capturedText
      .slice()
      .reverse()
      .find((event) => event.source === 'ocr');
    const nextAction = selectPrimaryAction(runtime.actionQueue);
    const activeContent = contentItems.filter((item) => item.enabled);
    const obsReady = runtime.obsScenes.length > 0 && !runtime.obsError;

    return {
      ready,
      backendReady,
      aiReady,
      ttsReady,
      obsReady,
      lastOcr,
      nextAction,
      activeContent,
      topics: contentItems.filter((item) => item.enabled && item.type === 'topic'),
      ctas: contentItems.filter((item) => item.enabled && item.type === 'cta'),
      redeems: contentItems.filter((item) => item.enabled && item.type === 'gift_redeem'),
      safety: contentItems.filter(
        (item) => item.enabled && ['moderation_policy', 'blocked_topic'].includes(item.type),
      ),
      tangoReady: Boolean(ready && obsReady && lastOcr && activeContent.length > 0),
    };
  }, [capturedText, contentItems, runtime, ttsSettings.provider]);

  return (
    <div className="content flex h-full flex-col gap-4 overflow-y-auto p-5 pb-8 lg:p-6 lg:pb-10">
      {activeTab === 'studio' ? (
        <>
          {/* ── COMMAND CENTER ── */}
          <div className="command-center grid gap-3.5 xl:grid-cols-[1fr_300px]">
            <div className="cmd-main relative overflow-hidden rounded-2xl border border-[var(--border2)] bg-[var(--bg2)] p-6 shadow-xl">
              <div className="cmd-main-glow-a absolute -left-10 -top-16 h-72 w-72 rounded-full bg-[var(--glow-a)] blur-[60px] pointer-events-none"></div>
              <div className="cmd-main-glow-p absolute -bottom-16 -right-5 h-52 w-52 rounded-full bg-[var(--glow-p)] blur-[50px] pointer-events-none"></div>

              <div className="cmd-breadcrumb relative z-10 mb-3 flex items-center gap-1.5">
                <span className="cmd-crumb text-[11px] text-[var(--t3)]">
                  Odessa Creator Studio
                </span>
                <span className="cmd-crumb-sep text-[var(--t3)]">·</span>
                <span className="cmd-crumb active text-[11px] text-[var(--t2)]">
                  {view.tangoReady ? 'Tango-ready' : 'Preparando live'}
                </span>
              </div>

              <h1 className="cmd-title relative z-10 text-2xl font-semibold tracking-tight text-[var(--t1)]">
                Odessa Live Studio
              </h1>
              <p className="cmd-desc relative z-10 mb-4.5 mt-1.5 max-w-lg text-xs leading-relaxed text-[var(--t2)]">
                Criação e automação de conteúdo para Tango Live — sinais de chat, gifts, diamantes,
                resgates, voz e auditoria em uma única direção.
              </p>

              <div className="cmd-tags relative z-10 flex flex-wrap gap-1.5">
                <Badge label="💬 Chat" dim />
                <Badge label="🎁 Gifts" dim />
                <Badge label="💎 Diamantes" dim />
                <Badge label="🔁 Resgates" dim />
                <Badge label="🛡 Moderação" dim />
                <Badge label="🔊 TTS" dim />
              </div>
            </div>

            <div className="cmd-side flex flex-col gap-2.5">
              <div className="cmd-side-card rounded-xl border border-[var(--border2)] bg-[var(--bg2)] p-3.5 shadow-sm">
                <div className="csc-label text-[10px] font-semibold uppercase tracking-widest text-[var(--t3)] mb-1.5">
                  Status da live
                </div>
                <div className="csc-value text-base font-semibold text-[var(--green)]">
                  {runtime.autopilotEnabled ? 'Em execução' : 'Pronta'}
                </div>
                <div className="csc-sub text-[11px] text-[var(--t3)] mt-0.5">
                  {runtime.autopilotEnabled ? 'Direção automática ativa' : 'Pronta para iniciar'}
                </div>
              </div>
              <div className="cmd-side-card rounded-xl border border-[var(--border2)] bg-[var(--bg2)] p-3.5 shadow-sm">
                <div className="csc-label text-[10px] font-semibold uppercase tracking-widest text-[var(--t3)] mb-1.5">
                  Última fala
                </div>
                <div className="csc-value text-[11px] leading-relaxed text-[var(--t2)] italic">
                  "
                  {runtime.latestDecision?.speech
                    ? trimText(runtime.latestDecision.speech, 90)
                    : 'Aguardando a primeira rodada da live.'}
                  "
                </div>
              </div>
              <div className="cmd-side-card rounded-xl border border-[var(--border2)] bg-[var(--bg2)] p-3.5 shadow-sm">
                <div className="csc-label mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-[var(--t3)]">
                  OBS e memoria
                </div>
                <div
                  className={cn(
                    'csc-value text-sm font-semibold',
                    view.obsReady ? 'text-[var(--green)]' : 'text-[var(--amber)]',
                  )}
                >
                  {view.obsReady ? runtime.currentObsScene || 'Cenas carregadas' : 'OBS aguardando'}
                </div>
                <div className="csc-sub mt-1 text-[11px] text-[var(--t3)]">
                  {runtime.obsScenes.length} cena(s) permitidas / {runtime.recognizedUsersCount}{' '}
                  usuario(s) reconhecidos
                </div>
              </div>
            </div>
          </div>

          {/* ── TABS ── */}
          <div className="flex items-center justify-between mt-2">
            <div className="tab-bar flex gap-0.5 rounded-xl border border-[var(--border)] bg-[var(--bg2)] p-0.5 shadow-inner">
              <TabButton
                active={activeTab === 'studio'}
                onClick={() => setActiveTab('studio')}
                label="Studio"
                icon={<LayoutDashboard className="h-3.5 w-3.5" />}
              />
              <TabButton
                active={(activeTab as string) === 'signals'}
                onClick={() => setActiveTab('signals')}
                label="Sinais"
                icon={<RadioTower className="h-3.5 w-3.5" />}
              />
              <TabButton
                active={(activeTab as string) === 'persona'}
                onClick={() => setActiveTab('persona')}
                label="Odessa"
                icon={<Bot className="h-3.5 w-3.5" />}
              />
              <TabButton
                active={(activeTab as string) === 'persona-studio'}
                onClick={() => setActiveTab('persona-studio')}
                label="Studio Video"
                icon={<Video className="h-3.5 w-3.5" />}
              />
              <TabButton
                active={(activeTab as string) === 'content'}
                onClick={() => setActiveTab('content')}
                label="Conteúdo"
                icon={<BookOpen className="h-3.5 w-3.5" />}
              />
              <TabButton
                active={(activeTab as string) === 'actions'}
                onClick={() => setActiveTab('actions')}
                label="Ações"
                icon={<Zap className="h-3.5 w-3.5" />}
              />
              <TabButton
                active={(activeTab as string) === 'audit'}
                onClick={() => setActiveTab('audit')}
                label="Auditoria"
                icon={<ClipboardList className="h-3.5 w-3.5" />}
              />
            </div>
            <button className="btn btn-sm btn-ghost">+ Nova ação manual</button>
          </div>

          {/* ── PANELS ── */}
          <div className="panels grid gap-3 xl:grid-cols-4">
            {/* SINAIS */}
            <div className="panel panel-accent-purple flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--bg2)] p-4 border-t-2 border-t-[var(--accent)] shadow-sm hover:border-[var(--border3)] transition-colors">
              <div className="panel-head flex items-start justify-between">
                <div className="panel-title flex items-center gap-1.5 text-xs font-semibold text-[var(--t1)]">
                  <RadioTower className="h-3.5 w-3.5 text-[var(--accent)]" />
                  Sinais da live
                </div>
                <button className="btn btn-ghost btn-sm h-6 w-6 p-0">
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="stat-row grid grid-cols-3 gap-1.5">
                <Stat value={capturedText.length} label="Eventos" />
                <Stat value={runtime.pendingEvents.length} label="Pendentes" />
                <Stat value={view.lastOcr ? 'ativo' : '—'} label="OCR" />
              </div>
              <div className="stat-row grid grid-cols-2 gap-1.5">
                <Stat value={runtime.obsScenes.length} label="Cenas OBS" sm />
                <Stat value={runtime.recognizedUsersCount} label="Usuarios" sm />
              </div>
              <div className="signal-row flex items-center gap-2">
                <div
                  className={cn(
                    'signal-dot h-2 w-2 shrink-0 rounded-full',
                    view.obsReady ? 'bg-[var(--green)]' : 'bg-[var(--amber)]',
                  )}
                ></div>
                <div className="text-[11px] italic text-[var(--t3)] truncate">
                  {runtime.obsError
                    ? trimText(runtime.obsError, 52)
                    : runtime.currentObsScene
                      ? `OBS em ${runtime.currentObsScene}`
                      : capturedText.length > 0
                        ? trimText(capturedText[capturedText.length - 1].text, 40)
                        : 'Aguardando evento manual.'}
                </div>
              </div>
              <button
                onClick={() => setActiveTab('signals')}
                className="btn btn-full bg-[rgba(124,111,247,0.06)] border-[rgba(124,111,247,0.2)] text-[#a89eff]"
              >
                Ajustar sinais
              </button>
            </div>

            {/* ODESSA */}
            <div className="panel panel-accent-pink flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--bg2)] p-4 border-t-2 border-t-[var(--pink)] shadow-sm hover:border-[var(--border3)] transition-colors">
              <div className="panel-head flex items-start justify-between">
                <div className="panel-title flex items-center gap-1.5 text-xs font-semibold text-[var(--pink)]">
                  <Bot className="h-3.5 w-3.5" />
                  Odessa no palco
                </div>
                <div className="flex gap-1">
                  <Badge label="pronta" ok />
                  <Badge label="voz" info />
                </div>
              </div>
              <div className="voice-box rounded-lg border border-[var(--border)] bg-[var(--bg3)] p-2.5 px-3">
                <div className="voice-box-label text-[10px] uppercase tracking-widest text-[var(--t3)] mb-1">
                  Voz atual
                </div>
                <div className="voice-box-name text-xs font-medium text-[var(--t1)]">
                  {ttsSettings.provider} / {ttsSettings.voice}
                </div>
                <div className="voice-box-sub text-[10px] text-[var(--t3)] mt-0.5">
                  Velocidade {ttsSettings.speed.toFixed(2)}×
                </div>
              </div>
              <div className="fala-card flex gap-2.5 rounded-lg border border-[var(--border)] border-l-2 border-l-[var(--pink)] bg-[var(--bg2)] p-2.5 px-3 shadow-sm">
                <div className="fala-avatar flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--accent)] to-[var(--pink)] text-xs text-white">
                  🎭
                </div>
                <div className="min-w-0">
                  <div className="fala-label text-[10px] uppercase tracking-widest text-[var(--t3)] mb-1">
                    Fala no palco
                  </div>
                  <div className="fala-text text-[11px] leading-relaxed italic text-[var(--t2)] line-clamp-2">
                    {runtime.latestDecision?.speech || 'Aguardando a primeira rodada da live.'}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setActiveTab('persona')}
                className="btn btn-full bg-[rgba(244,114,182,0.06)] border-[rgba(244,114,182,0.2)] text-[var(--pink)]"
              >
                Ajustar palco e voz
              </button>
            </div>

            {/* ROTEIRO */}
            <div className="panel panel-accent-amber flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--bg2)] p-4 border-t-2 border-t-[var(--amber)] shadow-sm hover:border-[var(--border3)] transition-colors">
              <div className="panel-head flex items-start justify-between">
                <div className="panel-title flex items-center gap-1.5 text-xs font-semibold text-[var(--t1)]">
                  <BookOpen className="h-3.5 w-3.5 text-[var(--amber)]" />
                  Roteiro e conteúdo
                </div>
                <button className="btn btn-ghost btn-sm h-6 w-6 p-0">
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="stat-row grid grid-cols-4 gap-1">
                <Stat value={view.activeContent.length} label="Ativos" sm />
                <Stat value={view.topics.length} label="Pautas" sm />
                <Stat value={view.ctas.length} label="CTAs" sm />
                <Stat value={view.redeems.length} label="Resgates" sm />
              </div>
              <div className="pautas-list space-y-2 max-h-[120px] overflow-y-auto pr-1">
                {view.safety.length > 0 && (
                  <PautaItem item={view.safety[0]} color="var(--red)" urgent />
                )}
                {view.topics.slice(0, 2).map((topic) => (
                  <PautaItem key={topic.id} item={topic} color="var(--amber)" />
                ))}
                {view.topics.length === 0 && view.safety.length === 0 && (
                  <div className="text-[11px] text-[var(--t3)] text-center py-4 italic">
                    Nenhum conteúdo configurado.
                  </div>
                )}
              </div>
              <button
                onClick={() => setActiveTab('content')}
                className="btn btn-full bg-[rgba(251,191,36,0.06)] border-[rgba(251,191,36,0.2)] text-[var(--amber)]"
              >
                Planejar conteúdo
              </button>
            </div>

            {/* DIREÇÃO */}
            <div className="panel panel-accent-green flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--bg2)] p-4 border-t-2 border-t-[var(--green)] shadow-sm hover:border-[var(--border3)] transition-colors">
              <div className="panel-head flex items-start justify-between">
                <div className="panel-title flex items-center gap-1.5 text-xs font-semibold text-[var(--green)]">
                  <Activity className="h-3.5 w-3.5" />
                  Direção automática
                </div>
                <button className="btn btn-ghost btn-sm h-6 w-6 p-0">
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="stat-row grid grid-cols-3 gap-1.5">
                <Stat value={runtime.completedCycles} label="Ciclos" />
                <Stat value={`${runtime.averageConfidence}%`} label="Confiança" />
                <Stat value={runtime.actionQueue.length} label="Ações" />
              </div>
              <div className="next-action-box">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-[var(--t3)] mb-1">
                  Próxima ação
                </div>
                <div className="text-xs font-medium text-[var(--t1)] truncate">
                  {view.nextAction?.label || 'Nenhuma ação em fila'}
                </div>
                <div className="text-[11px] text-[var(--t3)] mt-0.5 italic">
                  {view.nextAction
                    ? formatActionStatus(view.nextAction.status)
                    : 'aguardando próxima rodada'}
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <button
                  onClick={runtime.autopilotEnabled ? runtime.pause : runtime.start}
                  className="btn btn-full bg-[rgba(52,211,153,0.12)] border-[rgba(52,211,153,0.35)] text-[var(--green)] font-semibold"
                >
                  {runtime.autopilotEnabled ? '⏸ Pausar' : '▶ Iniciar'}
                </button>
                <div className="grid grid-cols-2 gap-1.5">
                  <button onClick={runtime.toggleVoice} className="btn btn-sm justify-center">
                    {runtime.voiceEnabled ? '🔊 Voz' : '🔇 Voz'}
                  </button>
                  <button
                    onClick={() => setActiveTab('audit')}
                    className="btn btn-sm btn-ghost justify-center"
                  >
                    📊 Auditoria
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* ── FLOW TIMELINE ── */}
          <div className="timeline-strip mt-2 rounded-2xl border border-[var(--border)] bg-[var(--bg2)] p-4.5 px-5 shadow-sm">
            <div className="timeline-head mb-4 flex items-center justify-between">
              <span className="timeline-title text-xs font-semibold text-[var(--t1)]">
                Fluxo da rodada
              </span>
              <div className="flex items-center gap-2">
                <Badge label={`Ciclos: ${runtime.completedCycles}`} dim />
                <Badge label={`Erros: ${runtime.lastError ? 1 : 0}`} dim />
                <Badge
                  label={`Confiança: ${runtime.averageConfidence}%`}
                  warn={runtime.averageConfidence < 60}
                />
                <button className="btn btn-sm btn-ghost h-6 text-[10px]">Exportar JSON</button>
              </div>
            </div>
            <div className="flow-steps flex items-center">
              <FlowStep
                label="Entrada"
                icon={<Camera className="h-3 w-3" />}
                done={capturedText.length > 0}
              />
              <FlowStep
                label="Interpretação"
                icon={<Wand2 className="h-3 w-3" />}
                done={Boolean(runtime.latestCycle)}
              />
              <FlowStep
                label="Decisão"
                icon={<Zap className="h-3 w-3" />}
                active={runtime.isProcessing}
                done={Boolean(runtime.latestDecision)}
              />
              <FlowStep
                label="Execução"
                icon={<Play className="h-3 w-3" />}
                done={runtime.actionQueue.some((a) => a.status === 'done')}
              />
              <FlowStep
                label="Auditoria"
                icon={<ShieldCheck className="h-3 w-3" />}
                done={Boolean(runtime.latestCycle)}
              />
            </div>
          </div>
        </>
      ) : (
        <div className="h-full min-h-[600px] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg1)]">
          <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--bg2)] px-4 py-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold capitalize text-[var(--t1)]">{activeTab}</span>
              <span className="text-xs text-[var(--t3)]">Configurações avançadas</span>
            </div>
            <button onClick={() => setActiveTab('studio')} className="btn btn-sm btn-ghost">
              Voltar ao Studio
            </button>
          </div>
          <div className="h-[calc(100%-40px)] overflow-hidden">
            {activeTab === 'signals' ? (
              <CaptureStudio
                capturedText={capturedText}
                setCapturedText={setCapturedText}
                autopilotEnabled={runtime.autopilotEnabled}
                pendingAutopilotEvents={runtime.pendingEvents.length}
                latestAutopilotActionStatus={runtime.latestAction?.status}
                onStartAutopilot={runtime.start}
              />
            ) : activeTab === 'persona' ? (
              <AIPersonaTrainer capturedText={capturedText} />
            ) : activeTab === 'persona-studio' ? (
              <PersonaStudio
                videoPath="/api/video/play/"
                onVideoChange={(videoId) => {
                  console.log(`[Persona Studio] Video changed to: ${videoId}`);
                }}
                autoPlayNext={true}
                onRegisterTriggers={setVideoTransitionCallback}
              />
            ) : activeTab === 'content' ? (
              <ContentLibrary />
            ) : (
              <LiveAutopilotConsole capturedText={capturedText} runtime={runtime} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Badge({
  label,
  ok,
  warn,
  err,
  info,
  dim,
  purple,
  pink,
}: {
  label: string;
  ok?: boolean;
  warn?: boolean;
  err?: boolean;
  info?: boolean;
  dim?: boolean;
  purple?: boolean;
  pink?: boolean;
}) {
  const base =
    'badge inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold';
  const styles = cn(
    base,
    ok && 'b-ok bg-[rgba(52,211,153,0.1)] text-[var(--green)]',
    warn && 'b-warn bg-[rgba(251,191,36,0.1)] text-[var(--amber)]',
    err && 'b-err bg-[rgba(248,113,113,0.1)] text-[var(--red)]',
    info && 'b-info bg-[rgba(96,165,250,0.1)] text-[var(--blue)]',
    dim && 'b-dim bg-[var(--bg4)] text-[var(--t2)] border border-[var(--border2)]',
    purple && 'b-purple bg-[rgba(124,111,247,0.12)] text-[#a89eff]',
    pink && 'b-pink bg-[rgba(244,114,182,0.1)] text-[var(--pink)]',
  );
  return <span className={styles}>{label}</span>;
}

function Stat({ value, label, sm }: { value: string | number; label: string; sm?: boolean }) {
  return (
    <div className="stat rounded-xl bg-[var(--bg3)] p-2.5 px-3">
      <div
        className={cn(
          'stat-n font-semibold text-[var(--t1)] leading-tight',
          sm ? 'text-base' : 'text-xl',
        )}
      >
        {value}
      </div>
      <div className="stat-l mt-0.5 text-[9px] font-semibold uppercase tracking-widest text-[var(--t3)]">
        {label}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'tab cursor-pointer rounded-lg border-none bg-none px-4 py-1.5 text-xs font-medium transition-all duration-150 flex items-center gap-2',
        active
          ? 'active bg-[var(--bg4)] text-[var(--t1)] border border-[var(--border2)] shadow-sm'
          : 'text-[var(--t2)] hover:text-[var(--t1)]',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function PautaItem({
  item,
  color,
  urgent,
}: {
  key?: string;
  item: ContentItem;
  color: string;
  urgent?: boolean;
}) {
  return (
    <div className="pauta flex items-start gap-2.5 py-1.5 border-b border-[var(--border)] last:border-0">
      <div
        className="pauta-line w-0.5 shrink-0 rounded-full self-stretch min-h-[16px]"
        style={{ backgroundColor: color }}
      ></div>
      <div className="pauta-body min-w-0 flex-1">
        <div className="pauta-name text-xs font-medium text-[var(--t1)] leading-snug truncate">
          {item.title}
        </div>
        <div className="pauta-desc text-[10px] text-[var(--t3)] mt-0.5 truncate">{item.body}</div>
      </div>
      {urgent && <Badge label="urgent" err />}
    </div>
  );
}

function FlowStep({
  label,
  icon,
  active,
  done,
}: {
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  done?: boolean;
}) {
  return (
    <div
      className={cn(
        'flow-step relative flex flex-1 flex-col items-center',
        done && 'done',
        active && 'active',
      )}
    >
      <div
        className={cn(
          'flow-step-node relative z-10 flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border2)] bg-[var(--bg3)] text-[11px] font-semibold text-[var(--t3)] transition-all duration-300',
          done && 'bg-[rgba(52,211,153,0.12)] border-[rgba(52,211,153,0.3)] text-[var(--green)]',
          active &&
            'bg-[rgba(124,111,247,0.15)] border-[var(--accent)] text-[var(--accent)] animate-[pulse-node_2s_ease-in-out_infinite]',
        )}
      >
        {icon}
      </div>
      <div className="flow-step-label mt-1.5 text-center text-[10px] text-[var(--t3)]">{label}</div>
      <div
        className={cn(
          'flow-step-line absolute left-[-50%] right-[50%] top-3.5 h-px bg-[var(--border2)]',
          (done || active) && 'bg-[rgba(52,211,153,0.3)]',
        )}
      ></div>
    </div>
  );
}
