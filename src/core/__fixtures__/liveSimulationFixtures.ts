import type { LiveEvent, PersonaDecision, PersonaTool } from '../../types';

const baseCreatedAt = '2026-07-09T18:00:00.000Z';

export const liveFixtures = {
  chat: event('fixture-chat', 'chat', '@Lucas: oi Odessa, tudo bem?', {
    user: 'Lucas',
    message: 'oi Odessa, tudo bem?',
    confidence: 0.94,
  }),
  gift: event('fixture-gift', 'gift', 'Ana enviou Rosa x1', {
    user: 'Ana',
    giftName: 'Rosa',
    giftKey: 'rose',
    quantity: 1,
    confidence: 0.98,
  }),
  alert: event('fixture-alert', 'alert', 'Bia comecou a seguir', {
    user: 'Bia',
    alertType: 'follow',
    confidence: 0.91,
  }),
  moderation: event('fixture-moderation', 'moderation', 'SpamBot: compre seguidores barato', {
    user: 'SpamBot',
    message: 'compre seguidores barato',
    confidence: 0.93,
    risk: 'spam',
  }),
  lowConfidenceOcr: event('fixture-low-confidence', 'chat', '@Nina: isso foi lido meio torto', {
    user: 'Nina',
    message: 'isso foi lido meio torto',
    confidence: 0.42,
  }),
};

export const chatVisualTarget = {
  mode: 'visual',
  url: 'tango-live-window',
  inputPoint: { x: 0.12, y: 0.88 },
  sendPoint: { x: 0.94, y: 0.88 },
  viewport: { width: 1920, height: 1080 },
};

export const personaTools: PersonaTool[] = [
  {
    id: 'tool-tts',
    label: 'TTS',
    capability: 'tts.speak',
    enabled: true,
    simulated: true,
    requiresApproval: false,
  },
  {
    id: 'tool-chat',
    label: 'Chat',
    capability: 'chat.reply',
    enabled: true,
    simulated: true,
    requiresApproval: false,
  },
  {
    id: 'tool-video',
    label: 'Video',
    capability: 'media.play_video',
    enabled: true,
    simulated: true,
    requiresApproval: false,
  },
  {
    id: 'tool-moderation',
    label: 'Moderacao',
    capability: 'moderation.message',
    enabled: true,
    simulated: true,
    requiresApproval: false,
  },
];

export const predictableDirectorDecision: PersonaDecision = {
  speech: 'Oi, Lucas. Vi voce chegando no chat.',
  intent: 'respond_chat',
  confidence: 0.92,
  reason: 'Mock previsivel para teste de live sem Tango.',
  priority: 'normal',
  actions: [
    {
      id: 'mock-chat-reply',
      type: 'chat_reply',
      label: 'Resposta no chat',
      capability: 'chat.reply',
      payload: { message: 'Oi, Lucas! Chega mais.' },
      simulated: true,
      status: 'queued',
      source: 'ai',
      createdAt: baseCreatedAt,
    },
    {
      id: 'mock-play-video',
      type: 'play_video',
      label: 'Tocar video',
      capability: 'media.play_video',
      payload: { videoId: 'clip-chat-wave' },
      simulated: true,
      status: 'queued',
      source: 'ai',
      createdAt: baseCreatedAt,
    },
  ],
};

export function event(
  id: string,
  kind: LiveEvent['kind'],
  text: string,
  metadata: Record<string, unknown> = {},
): LiveEvent {
  return {
    id,
    source: 'ocr',
    zoneName: 'Chat fake',
    text,
    kind,
    createdAt: baseCreatedAt,
    time: '18:00:00',
    metadata,
  };
}

export function cloneDecision(patch: Partial<PersonaDecision> = {}): PersonaDecision {
  return {
    ...predictableDirectorDecision,
    ...patch,
    actions: (patch.actions || predictableDirectorDecision.actions).map((action) => ({
      ...action,
      payload: { ...action.payload },
    })),
  };
}
