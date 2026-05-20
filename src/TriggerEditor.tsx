import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Plus, Save, Trash2, Zap } from 'lucide-react';
import { apiUrl } from './lib/api';
import { cn } from './lib/utils';

type ActionType = 'play_video' | 'switch_scene' | 'webhook' | 'log_event';

interface Action {
  type: ActionType;
  videoId?: string;
  capability?: string;
  payload?: {
    videoId?: string;
    sceneName?: string;
    scene?: string;
    requestedScene?: string;
    webhookId?: string;
    message?: string;
  };
}

interface Trigger {
  id: string;
  name: string;
  enabled: boolean;
  eventType: 'gift' | 'comment' | 'like' | 'follow' | 'join' | 'manual';
  conditions: {
    giftKey?: string;
    keyword?: string;
  };
  actions: Action[];
  cooldown_ms: number;
  priority?: number;
}

interface VideoState {
  id: string;
  label: string;
}

interface WebhookConfig {
  id: string;
  name: string;
  enabled: boolean;
}

interface TriggerEditorProps {
  onConfigChange?: () => void;
}

function actionKind(action?: Action): ActionType {
  if (!action) return 'play_video';
  if (action.capability === 'obs.switch_scene' || action.type === 'switch_scene')
    return 'switch_scene';
  if (action.capability === 'webhook.call' || action.type === 'webhook') return 'webhook';
  if (action.capability === 'log.event' || action.type === 'log_event') return 'log_event';
  return 'play_video';
}

function sceneFromAction(action?: Action) {
  return (
    action?.payload?.sceneName || action?.payload?.scene || action?.payload?.requestedScene || ''
  );
}

function videoFromAction(action?: Action) {
  return action?.videoId || action?.payload?.videoId || '';
}

function webhookFromAction(action?: Action) {
  return action?.payload?.webhookId || '';
}

export default function TriggerEditor({ onConfigChange }: TriggerEditorProps) {
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [videos, setVideos] = useState<VideoState[]>([]);
  const [allowedScenes, setAllowedScenes] = useState<string[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchConfig = useCallback(async () => {
    try {
      setIsLoading(true);
      const [configRes, obsRes, webhooksRes] = await Promise.all([
        fetch(apiUrl('/api/video/config')),
        fetch(apiUrl('/obs/settings')),
        fetch(apiUrl('/webhooks')),
      ]);
      const config = await configRes.json();
      const obs = await obsRes.json().catch(() => ({}));
      const webhookData = await webhooksRes.json().catch(() => ({}));

      setVideos(config.videos || []);
      setTriggers(config.triggers || []);
      setAllowedScenes(
        Array.isArray(obs?.settings?.allowedScenes)
          ? obs.settings.allowedScenes
          : Array.isArray(obs?.settings?.sceneWhitelist)
            ? obs.settings.sceneWhitelist
            : [],
      );
      setWebhooks(Array.isArray(webhookData.webhooks) ? webhookData.webhooks : []);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch config:', err);
      setError('Falha ao carregar configuracoes.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchConfig();
  }, [fetchConfig]);

  const videoOptions = useMemo(
    () =>
      videos.map((video) => ({
        ...video,
        label: video.label || video.id,
      })),
    [videos],
  );

  const handleSave = async () => {
    try {
      setIsSaving(true);
      setError(null);

      const res = await fetch(apiUrl('/api/video/config'));
      const fullConfig = await res.json();
      fullConfig.triggers = triggers;

      const saveRes = await fetch(apiUrl('/api/video/config'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fullConfig),
      });

      if (!saveRes.ok) throw new Error('Failed to save config');
      await fetch(apiUrl('/api/automation/refresh'), { method: 'POST' });
      onConfigChange?.();
    } catch (err) {
      console.error('Save failed:', err);
      setError('Falha ao salvar as alteracoes.');
    } finally {
      setIsSaving(false);
    }
  };

  const addTrigger = () => {
    const newTrigger: Trigger = {
      id: `trigger_${Date.now()}`,
      name: 'Novo Gatilho',
      enabled: true,
      eventType: 'gift',
      conditions: { giftKey: 'gift.rosa' },
      actions: [{ type: 'play_video', videoId: videoOptions[0]?.id || '' }],
      cooldown_ms: 3000,
    };
    setTriggers((current) => [newTrigger, ...current]);
  };

  const updateTrigger = (id: string, updates: Partial<Trigger>) => {
    setTriggers((current) =>
      current.map((trigger) => (trigger.id === id ? { ...trigger, ...updates } : trigger)),
    );
  };

  const updateAction = (trigger: Trigger, action: Action) => {
    updateTrigger(trigger.id, { actions: [action] });
  };

  const buildAction = (kind: ActionType, value = ''): Action => {
    if (kind === 'switch_scene') {
      return {
        type: 'switch_scene',
        capability: 'obs.switch_scene',
        payload: { sceneName: value || allowedScenes[0] || '' },
      };
    }
    if (kind === 'webhook') {
      return {
        type: 'webhook',
        capability: 'webhook.call',
        payload: { webhookId: value || webhooks[0]?.id || '' },
      };
    }
    if (kind === 'log_event') {
      return {
        type: 'log_event',
        capability: 'log.event',
        payload: { message: value || 'Gatilho executado: {text}' },
      };
    }
    return { type: 'play_video', videoId: value || videoOptions[0]?.id || '' };
  };

  const removeTrigger = (id: string) => {
    setTriggers((current) => current.filter((trigger) => trigger.id !== id));
  };

  if (isLoading) {
    return <div className="p-8 text-center text-slate-400">Carregando gatilhos...</div>;
  }

  return (
    <div className="flex h-full flex-col bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-800 p-6">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-white">
            <Zap className="h-5 w-5 text-blue-500" />
            Editor de Gatilhos
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Configure quando um evento do OCR deve tocar video, trocar cena OBS, chamar webhook ou
            registrar log.
          </p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={addTrigger}
            className="flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-700"
          >
            <Plus className="h-4 w-4" /> Novo Gatilho
          </button>

          <button
            onClick={handleSave}
            disabled={isSaving}
            className={cn(
              'flex items-center gap-2 rounded-lg px-6 py-2 text-sm font-bold text-white shadow-lg',
              isSaving ? 'cursor-not-allowed bg-blue-600/50' : 'bg-blue-600 hover:bg-blue-500',
            )}
          >
            <Save className="h-4 w-4" />
            {isSaving ? 'Salvando...' : 'Salvar Alteracoes'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-6 mt-6 flex items-center gap-3 rounded-xl border border-red-500/50 bg-red-900/30 p-4 text-red-200">
          <AlertCircle className="h-5 w-5 text-red-400" />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-6xl space-y-4">
          {triggers.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-slate-800 py-12 text-center">
              <Zap className="mx-auto mb-4 h-12 w-12 text-slate-600" />
              <p className="font-medium text-slate-400">Nenhum gatilho configurado.</p>
              <p className="mt-1 text-sm text-slate-500">
                Crie um gatilho para automatizar reacoes da live.
              </p>
            </div>
          ) : (
            triggers.map((trigger) => {
              const currentAction = trigger.actions[0] || buildAction('play_video');
              const currentKind = actionKind(currentAction);
              return (
                <div
                  key={trigger.id}
                  className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-5"
                >
                  <div className="grid gap-5 lg:grid-cols-[160px_1fr_1fr_150px]">
                    <div className="space-y-4 border-b border-slate-700/50 pb-4 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-5">
                      <div className="flex items-center justify-between gap-2 lg:flex-col lg:items-start">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                          Status
                        </span>
                        <button
                          onClick={() => updateTrigger(trigger.id, { enabled: !trigger.enabled })}
                          className={cn(
                            'relative inline-flex h-6 w-11 items-center rounded-full',
                            trigger.enabled ? 'bg-emerald-500' : 'bg-slate-600',
                          )}
                        >
                          <span
                            className={cn(
                              'inline-block h-4 w-4 rounded-full bg-white',
                              trigger.enabled ? 'translate-x-6' : 'translate-x-1',
                            )}
                          />
                        </button>
                      </div>

                      <button
                        onClick={() => removeTrigger(trigger.id)}
                        className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-red-300 hover:bg-red-400/10"
                      >
                        <Trash2 className="h-4 w-4" />
                        Excluir
                      </button>
                    </div>

                    <div className="space-y-3">
                      <input
                        type="text"
                        value={trigger.name}
                        onChange={(event) =>
                          updateTrigger(trigger.id, { name: event.target.value })
                        }
                        className="w-full border-b border-transparent bg-transparent pb-1 text-lg font-bold text-white outline-none focus:border-blue-500"
                        placeholder="Nome do Gatilho"
                      />

                      <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                        <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-blue-400">
                          <div className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                          Quando ocorrer
                        </div>
                        <div className="space-y-2">
                          <select
                            value={trigger.eventType}
                            onChange={(event) =>
                              updateTrigger(trigger.id, {
                                eventType: event.target.value as Trigger['eventType'],
                                conditions:
                                  event.target.value === 'gift'
                                    ? { giftKey: trigger.conditions.giftKey || 'gift.rosa' }
                                    : { keyword: trigger.conditions.keyword || 'oi' },
                              })
                            }
                            className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-blue-500"
                          >
                            <option value="gift">Presente / Gift</option>
                            <option value="comment">Comentario / Palavra-chave</option>
                            <option value="manual">Manual</option>
                          </select>

                          {trigger.eventType === 'gift' ? (
                            <input
                              type="text"
                              value={trigger.conditions.giftKey || ''}
                              onChange={(event) =>
                                updateTrigger(trigger.id, {
                                  conditions: {
                                    ...trigger.conditions,
                                    giftKey: event.target.value,
                                  },
                                })
                              }
                              placeholder="gift.rosa"
                              className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-blue-500"
                            />
                          ) : (
                            <input
                              type="text"
                              value={trigger.conditions.keyword || ''}
                              onChange={(event) =>
                                updateTrigger(trigger.id, {
                                  conditions: {
                                    ...trigger.conditions,
                                    keyword: event.target.value,
                                  },
                                })
                              }
                              placeholder="Palavra-chave"
                              className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-blue-500"
                            />
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-amber-400">
                        <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        Entao executar
                      </div>

                      <select
                        value={currentKind}
                        onChange={(event) =>
                          updateAction(trigger, buildAction(event.target.value as ActionType))
                        }
                        className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-amber-500"
                      >
                        <option value="play_video">Tocar video</option>
                        <option value="switch_scene">Trocar cena OBS</option>
                        <option value="webhook">Chamar webhook</option>
                        <option value="log_event">Registrar log</option>
                      </select>

                      {currentKind === 'play_video' && (
                        <select
                          value={videoFromAction(currentAction)}
                          onChange={(event) =>
                            updateAction(trigger, buildAction('play_video', event.target.value))
                          }
                          className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-amber-500"
                        >
                          {videoOptions.map((video) => (
                            <option key={video.id} value={video.id}>
                              {video.label} ({video.id})
                            </option>
                          ))}
                        </select>
                      )}

                      {currentKind === 'switch_scene' && (
                        <select
                          value={sceneFromAction(currentAction)}
                          onChange={(event) =>
                            updateAction(trigger, buildAction('switch_scene', event.target.value))
                          }
                          className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-amber-500"
                        >
                          <option value="">Selecione uma cena permitida</option>
                          {allowedScenes.map((scene) => (
                            <option key={scene} value={scene}>
                              {scene}
                            </option>
                          ))}
                        </select>
                      )}

                      {currentKind === 'webhook' && (
                        <select
                          value={webhookFromAction(currentAction)}
                          onChange={(event) =>
                            updateAction(trigger, buildAction('webhook', event.target.value))
                          }
                          className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-amber-500"
                        >
                          <option value="">Selecione um webhook</option>
                          {webhooks.map((webhook) => (
                            <option key={webhook.id} value={webhook.id}>
                              {webhook.name} {webhook.enabled ? '' : '(pausado)'}
                            </option>
                          ))}
                        </select>
                      )}

                      {currentKind === 'log_event' && (
                        <input
                          type="text"
                          value={currentAction.payload?.message || ''}
                          onChange={(event) =>
                            updateAction(trigger, buildAction('log_event', event.target.value))
                          }
                          className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-amber-500"
                        />
                      )}
                    </div>

                    <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                      <div className="text-xs font-bold uppercase tracking-widest text-slate-400">
                        Ajustes
                      </div>
                      <label className="block space-y-1">
                        <span className="text-[10px] font-bold uppercase text-slate-500">
                          Cooldown ms
                        </span>
                        <input
                          type="number"
                          value={trigger.cooldown_ms}
                          onChange={(event) =>
                            updateTrigger(trigger.id, {
                              cooldown_ms: parseInt(event.target.value, 10) || 0,
                            })
                          }
                          className="w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 outline-none focus:border-blue-500"
                          step="500"
                        />
                      </label>
                      <label className="block space-y-1">
                        <span className="text-[10px] font-bold uppercase text-slate-500">
                          Prioridade
                        </span>
                        <input
                          type="number"
                          value={trigger.priority || 0}
                          onChange={(event) =>
                            updateTrigger(trigger.id, {
                              priority: parseInt(event.target.value, 10) || 0,
                            })
                          }
                          className="w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 outline-none focus:border-blue-500"
                        />
                      </label>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
