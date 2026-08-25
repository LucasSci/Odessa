import { describe, expect, it } from 'vitest';
import {
  normalizeDirectorDecision,
  parseDirectorDecision,
  type RawDirectorDecision,
} from './aiDecisionContract';

const tools = [
  { capability: 'tts.speak', enabled: true },
  { capability: 'chat.reply', enabled: true },
  { capability: 'media.play_video', enabled: true },
  { capability: 'obs.switch_scene', enabled: true },
  { capability: 'memory.remember', enabled: true },
];

describe('director decision contract', () => {
  it('parses incomplete JSON decisions with actions but no speech', () => {
    const parsed = parseDirectorDecision(
      JSON.stringify({
        intent: 'react_visual',
        actions: [{ type: 'play_video', payload: { videoId: 'gift-rose' } }],
      }),
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.speech).toBe('');
    expect(parsed?.actions).toHaveLength(1);
  });

  it('returns null for invalid JSON decisions', () => {
    expect(parseDirectorDecision('{ "speech": "oi", actions: [')).toBeNull();
    expect(parseDirectorDecision('sem json')).toBeNull();
  });

  it('keeps speech, chat reply and video in one round without duplicating public text', () => {
    const decision = normalizeDirectorDecision(
      {
        speech: 'Obrigada pelo presente, Ana!',
        intent: 'ack_gift',
        confidence: 0.92,
        reason: 'presente recebido',
        priority: 'high',
        actions: [
          { type: 'chat_reply', payload: { message: 'Obrigada pelo presente, Ana!' } },
          { type: 'play_video', payload: { videoId: 'gift-rose' } },
        ],
      },
      {
        videos: [{ id: 'gift-rose', label: 'Rosa' }],
        scenes: ['Gameplay'],
        tools,
        fallbackText: '@Ana: rosa pra voce',
      },
    );

    expect(decision.actions.map((action) => action.type)).toEqual([
      'speak',
      'chat_reply',
      'play_video',
    ]);
    const chat = decision.actions.find((action) => action.type === 'chat_reply');
    expect(chat?.payload.message).not.toBe(decision.speech);
    expect(String(chat?.payload.message).length).toBeLessThanOrEqual(140);
  });

  it('drops video and scene ids that are outside the real catalog', () => {
    const decision = normalizeDirectorDecision(
      {
        speech: '',
        intent: 'bad_catalog',
        confidence: 0.8,
        reason: 'modelo tentou operar catalogo inexistente',
        priority: 'normal',
        actions: [
          { type: 'play_video', payload: { videoId: 'invented-video' } },
          { type: 'switch_scene', payload: { sceneName: 'Cena Inventada' } },
          { type: 'play_video', payload: { videoId: 'gift-rose' } },
        ],
      },
      {
        videos: [{ id: 'gift-rose', label: 'Rosa' }],
        scenes: ['Gameplay'],
        tools,
      },
    );

    expect(decision.actions).toHaveLength(1);
    expect(decision.actions[0].payload.videoId).toBe('gift-rose');
    expect(decision.reason).toContain('videoId fora do catalogo');
    expect(decision.reason).toContain('sceneName fora do catalogo');
  });

  it('drops actions whose tools are not enabled', () => {
    const raw: RawDirectorDecision = {
      speech: '',
      intent: 'tool_gate',
      confidence: 0.7,
      reason: 'sem ferramenta',
      priority: 'normal',
      actions: [{ type: 'remember', payload: { memory: 'Ana gosta de jogos de ritmo' } }],
    };

    const decision = normalizeDirectorDecision(raw, {
      tools: [{ capability: 'chat.reply', enabled: true }],
    });

    expect(decision.actions).toEqual([]);
    expect(decision.reason).toContain('sem ferramenta habilitada');
  });
});
