import { describe, expect, it } from 'vitest';
import { prepareChatReplyQueue, updateChatReplyQueueFromAction } from './chatReplyQueue';
import type { AutopilotAction, AutopilotCycle, PersonaDecision } from '../types';

const chatAction: AutopilotAction = {
  id: 'chat-a1',
  type: 'chat_reply',
  label: 'Responder',
  capability: 'chat.reply',
  payload: { message: 'Oi Lucas!', governorAllowed: true },
  simulated: true,
  status: 'queued',
};

const videoAction: AutopilotAction = {
  id: 'video-a1',
  type: 'play_video',
  label: 'Video',
  capability: 'media.play_video',
  payload: { videoId: 'rose' },
  simulated: false,
  status: 'queued',
};

const cycle: Pick<AutopilotCycle, 'id' | 'event'> = {
  id: 'cycle-1',
  event: {
    id: 'event-1',
    source: 'ocr',
    zoneName: 'Chat Tango',
    text: 'Lucas: oi',
    kind: 'chat',
    createdAt: '2026-07-09T12:00:00.000Z',
    time: '12:00:00',
    metadata: { confidence: 0.91 },
  },
};

const decision: PersonaDecision = {
  speech: 'Oi!',
  intent: 'respond_chat',
  confidence: 0.91,
  reason: 'Mensagem direta no chat.',
  priority: 'normal',
  actions: [chatAction, videoAction],
};

describe('chatReplyQueue', () => {
  it('keeps chat replies in approval preview on manual mode while operational actions execute', () => {
    const prepared = prepareChatReplyQueue([chatAction, videoAction], cycle, decision, 'manual');

    expect(prepared.queueItems).toHaveLength(1);
    expect(prepared.queueItems[0].status).toBe('approval_required');
    expect(prepared.queueItems[0].text).toBe('Oi Lucas!');
    expect(prepared.executableActions).toEqual([videoAction]);
  });

  it('lets governed autonomous chat replies continue to execution', () => {
    const prepared = prepareChatReplyQueue([chatAction], cycle, decision, 'auto');

    expect(prepared.queueItems[0].status).toBe('queued');
    expect(prepared.executableActions).toEqual([chatAction]);
  });

  it('records governor blocks and prevents execution', () => {
    const blocked = {
      ...chatAction,
      payload: { ...chatAction.payload, governorBlockedReason: 'low_ocr_confidence' },
    };
    const prepared = prepareChatReplyQueue([blocked], cycle, decision, 'auto');

    expect(prepared.queueItems[0].status).toBe('blocked');
    expect(prepared.queueItems[0].governorBlockedReason).toBe('low_ocr_confidence');
    expect(prepared.executableActions).toEqual([]);
  });

  it('updates queued items from executor actions', () => {
    const prepared = prepareChatReplyQueue([chatAction], cycle, decision, 'auto');
    const updated = updateChatReplyQueueFromAction(prepared.queueItems, {
      ...chatAction,
      status: 'simulated',
      result: 'Resposta validada em dry-run',
    });

    expect(updated[0].status).toBe('sent');
    expect(updated[0].result).toBe('Resposta validada em dry-run');
    expect(updated[0].sentAt).toBeTruthy();
  });
});
