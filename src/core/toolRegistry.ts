import type { AutopilotAction, PersonaTool, ToolCapability } from '../types';

const STORAGE_KEY = 'odessa:tool-registry:v1';

export const DEFAULT_TOOLS: PersonaTool[] = [
  {
    id: 'tool-tts-speak',
    label: 'TTS local',
    capability: 'tts.speak',
    enabled: true,
    requiresApproval: false,
    simulated: false,
  },
  {
    id: 'tool-chat-reply',
    label: 'Resposta no chat',
    capability: 'chat.reply',
    enabled: true,
    requiresApproval: false,
    simulated: true,
  },
  {
    id: 'tool-gift-ack',
    label: 'Agradecer presente',
    capability: 'gift.acknowledge',
    enabled: true,
    requiresApproval: false,
    simulated: true,
  },
  {
    id: 'tool-moderation',
    label: 'Moderacao',
    capability: 'moderation.message',
    enabled: true,
    requiresApproval: true,
    simulated: true,
  },
  {
    id: 'tool-obs-scene',
    label: 'OBS cena',
    capability: 'obs.switch_scene',
    enabled: true,
    requiresApproval: false,
    simulated: false,
  },
  {
    id: 'tool-obs-overlay',
    label: 'OBS overlay',
    capability: 'obs.show_overlay',
    enabled: true,
    requiresApproval: false,
    simulated: true,
  },
  {
    id: 'tool-media-music',
    label: 'Musica',
    capability: 'media.play_music',
    enabled: true,
    requiresApproval: false,
    simulated: true,
  },
  {
    id: 'tool-media-video',
    label: 'Video',
    capability: 'media.play_video',
    enabled: true,
    requiresApproval: false,
    simulated: false,
  },
  {
    id: 'tool-webhook-call',
    label: 'Webhook',
    capability: 'webhook.call',
    enabled: true,
    requiresApproval: false,
    simulated: false,
  },
  {
    id: 'tool-media-stop',
    label: 'Parar midia',
    capability: 'media.stop',
    enabled: true,
    requiresApproval: false,
    simulated: true,
  },
  {
    id: 'tool-topic-set',
    label: 'Definir topico',
    capability: 'topic.set',
    enabled: true,
    requiresApproval: false,
    simulated: true,
  },
  {
    id: 'tool-topic-suggest',
    label: 'Sugestao de topico',
    capability: 'topic.suggest',
    enabled: true,
    requiresApproval: false,
    simulated: true,
  },
  {
    id: 'tool-memory-remember',
    label: 'Memoria',
    capability: 'memory.remember',
    enabled: true,
    requiresApproval: false,
    simulated: true,
  },
  {
    id: 'tool-log-event',
    label: 'Log local',
    capability: 'log.event',
    enabled: true,
    requiresApproval: false,
    simulated: false,
  },
];

export const ACTION_CAPABILITY: Record<AutopilotAction['type'], ToolCapability> = {
  speak: 'tts.speak',
  chat_reply: 'chat.reply',
  ack_gift: 'gift.acknowledge',
  moderate_message: 'moderation.message',
  switch_scene: 'obs.switch_scene',
  show_overlay: 'obs.show_overlay',
  play_music: 'media.play_music',
  play_video: 'media.play_video',
  webhook: 'webhook.call',
  stop_media: 'media.stop',
  set_topic: 'topic.set',
  suggest_topic: 'topic.suggest',
  remember: 'memory.remember',
  log_event: 'log.event',
};

function canUseStorage() {
  return typeof window !== 'undefined' && Boolean(window.localStorage);
}

export function capabilityForAction(
  action: Pick<AutopilotAction, 'type' | 'capability'>,
): ToolCapability {
  return action.capability || ACTION_CAPABILITY[action.type] || 'log.event';
}

export function loadToolRegistry(): PersonaTool[] {
  if (!canUseStorage()) return DEFAULT_TOOLS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_TOOLS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_TOOLS;
    const existingByCapability = new Map(
      parsed
        .filter((tool): tool is PersonaTool => Boolean(tool?.capability))
        .map((tool) => [tool.capability, tool]),
    );
    return DEFAULT_TOOLS.map((tool) => {
      const merged = { ...tool, ...existingByCapability.get(tool.capability) };
      return merged.capability === 'obs.switch_scene' ||
        merged.capability === 'media.play_video' ||
        merged.capability === 'webhook.call'
        ? { ...merged, simulated: false }
        : merged;
    });
  } catch {
    return DEFAULT_TOOLS;
  }
}

export function saveToolRegistry(tools: PersonaTool[]): PersonaTool[] {
  if (!canUseStorage()) return tools;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tools));
  } catch {
    // Ignore storage failures.
  }
  return tools;
}

export function updateToolRegistry(
  tools: PersonaTool[],
  capability: ToolCapability,
  patch: Partial<Pick<PersonaTool, 'enabled' | 'requiresApproval' | 'simulated'>>,
): PersonaTool[] {
  const next = tools.map((tool) => (tool.capability === capability ? { ...tool, ...patch } : tool));
  return saveToolRegistry(next);
}

export function findTool(
  tools: PersonaTool[],
  capability: ToolCapability,
): PersonaTool | undefined {
  return tools.find((tool) => tool.capability === capability);
}
