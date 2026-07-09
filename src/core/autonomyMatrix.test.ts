import { describe, expect, it } from 'vitest';
import type { PersonaTool } from '../types';
import { applyAutonomyToTools, buildAutonomyToolPolicies } from './autonomyMatrix';

const tools: PersonaTool[] = [
  { id: 'tts', label: 'TTS', capability: 'tts.speak', enabled: true, simulated: false, requiresApproval: false },
  { id: 'chat', label: 'Chat', capability: 'chat.reply', enabled: true, simulated: true, requiresApproval: false },
  { id: 'video', label: 'Video', capability: 'media.play_video', enabled: true, simulated: false, requiresApproval: false },
  { id: 'obs', label: 'OBS', capability: 'obs.switch_scene', enabled: true, simulated: false, requiresApproval: false },
  { id: 'webhook', label: 'Webhook', capability: 'webhook.call', enabled: true, simulated: false, requiresApproval: false },
  { id: 'moderation', label: 'Moderacao', capability: 'moderation.message', enabled: true, simulated: true, requiresApproval: false },
  { id: 'memory', label: 'Memoria', capability: 'memory.remember', enabled: true, simulated: true, requiresApproval: false },
];

function byCapability(list: PersonaTool[], capability: PersonaTool['capability']) {
  const tool = list.find((item) => item.capability === capability);
  if (!tool) throw new Error(`Missing tool: ${capability}`);
  return tool;
}

describe('applyAutonomyToTools', () => {
  it('manual asks approval for every public/external tool except safe memory', () => {
    const applied = applyAutonomyToTools(tools, 'manual');

    expect(byCapability(applied, 'tts.speak').requiresApproval).toBe(true);
    expect(byCapability(applied, 'chat.reply').requiresApproval).toBe(true);
    expect(byCapability(applied, 'media.play_video').requiresApproval).toBe(true);
    expect(byCapability(applied, 'obs.switch_scene').requiresApproval).toBe(true);
    expect(byCapability(applied, 'webhook.call').requiresApproval).toBe(true);
    expect(byCapability(applied, 'moderation.message').requiresApproval).toBe(true);
    expect(byCapability(applied, 'memory.remember').requiresApproval).toBe(false);
  });

  it('assistido allows voice/video and keeps chat real/moderation sensitive out of real execution', () => {
    const applied = applyAutonomyToTools(tools, 'assistido', {
      autoChatEnabled: true,
      chatRealRequested: true,
      visualTargetReady: true,
      localAgentReady: true,
    });

    expect(byCapability(applied, 'tts.speak').simulated).toBe(false);
    expect(byCapability(applied, 'tts.speak').requiresApproval).toBe(false);
    expect(byCapability(applied, 'media.play_video').simulated).toBe(false);
    expect(byCapability(applied, 'media.play_video').requiresApproval).toBe(false);
    expect(byCapability(applied, 'chat.reply').simulated).toBe(true);
    expect(byCapability(applied, 'moderation.message').requiresApproval).toBe(true);
  });

  it('auto blocks chat.reply real until target and local agent are ready', () => {
    const missingAgent = applyAutonomyToTools(tools, 'auto', {
      autoChatEnabled: true,
      chatRealRequested: true,
      visualTargetReady: true,
      localAgentReady: false,
    });
    expect(byCapability(missingAgent, 'chat.reply').enabled).toBe(false);

    const ready = applyAutonomyToTools(tools, 'auto', {
      autoChatEnabled: true,
      chatRealRequested: true,
      visualTargetReady: true,
      localAgentReady: true,
    });
    expect(byCapability(ready, 'chat.reply').enabled).toBe(true);
    expect(byCapability(ready, 'chat.reply').simulated).toBe(false);
    expect(byCapability(ready, 'chat.reply').requiresApproval).toBe(false);
  });

  it('explains why each policy is simulated, approval, real, or blocked', () => {
    const policies = buildAutonomyToolPolicies(tools, 'auto', {
      autoChatEnabled: true,
      chatRealRequested: true,
      visualTargetReady: false,
      localAgentReady: true,
    });
    const chat = policies.find((policy) => policy.capability === 'chat.reply');

    expect(chat?.status).toBe('blocked');
    expect(chat?.reason).toContain('alvo visual');
  });
});
