import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  processRawEvent,
  registerVideoPlayCallback,
  registerPipelineLogCallback,
  loadRulesFromFlowTriggers,
  getGiftLedger,
  resetGiftLedger,
  resetCooldowns,
  type GiftPipelineResult,
} from './giftEventBus';

beforeEach(() => {
  resetGiftLedger();
  resetCooldowns();
  // Reset rules to defaults by passing empty array (adds fallback automatically)
  loadRulesFromFlowTriggers([]);
});

/**
 * LEGADO — antigo gerenciador de eventos de presente.
 * Substituído por src/core/ocrPipeline.ts.
 */
describe.skip('GiftEventBus — full pipeline [LEGADO]', () => {
  it('Test 1: "Lucas enviou Rosa" → classifies as gift → triggers video', () => {
    const videoPlaySpy = vi.fn();
    registerVideoPlayCallback(videoPlaySpy);

    const result = processRawEvent('Lucas enviou Rosa');

    expect(result.classified).toBe(true);
    expect(result.event.kind).toBe('gift');
    expect(result.event.metadata?.giftName).toBe('Rosa');
    expect(result.ledgerUpdated).toBe(true);
    expect(result.videoTriggered).toBeTruthy();
    expect(videoPlaySpy).toHaveBeenCalled();
  });

  it('Test 2: "@AnaStarlight: Boa! Mandou muito bem" → chat, NOT gift → no video', () => {
    const videoPlaySpy = vi.fn();
    registerVideoPlayCallback(videoPlaySpy);

    const result = processRawEvent('@AnaStarlight: Boa! Mandou muito bem nessa partida');

    expect(result.event.kind).toBe('chat');
    expect(result.classified).toBe(false);
    expect(result.videoTriggered).toBeNull();
    expect(videoPlaySpy).not.toHaveBeenCalled();
  });

  it('Test 3: "Ana enviou Rosa x5" → gift x5 → one video trigger', () => {
    const videoPlaySpy = vi.fn();
    registerVideoPlayCallback(videoPlaySpy);

    const result = processRawEvent('Ana enviou Rosa x5');

    expect(result.event.kind).toBe('gift');
    expect(result.event.metadata?.quantity).toBe(5);
    expect(result.ledgerUpdated).toBe(true);
    expect(videoPlaySpy).toHaveBeenCalledTimes(1);
  });

  it('Test 4: Spam → moderation → no video', () => {
    const videoPlaySpy = vi.fn();
    registerVideoPlayCallback(videoPlaySpy);

    const result = processRawEvent('xXSpamXx: COMPRE SEGUIDORES BARATO www.fake.com');

    expect(result.event.kind).toBe('moderation');
    expect(result.videoTriggered).toBeNull();
    expect(videoPlaySpy).not.toHaveBeenCalled();
  });

  it('Test 5: GiftLedger accumulates correctly', () => {
    const videoPlaySpy = vi.fn();
    registerVideoPlayCallback(videoPlaySpy);

    processRawEvent('Lucas enviou Rosa');
    processRawEvent('Lucas enviou Rosa');
    processRawEvent('Lucas enviou Rosa');

    const ledger = getGiftLedger();
    expect(ledger.totalGiftEvents).toBe(3);
    expect(ledger.totalByGiftName['Rosa']).toBe(3);
    expect(ledger.totalBySender['Lucas'].totalGiftQuantity).toBe(3);
  });

  it('Test 6: Cooldown prevents second video within cooldown window', () => {
    const videoPlaySpy = vi.fn();
    loadRulesFromFlowTriggers([
      {
        id: 'test-rule',
        name: 'Test Rosa',
        enabled: true,
        eventType: 'gift',
        conditions: { giftKey: 'gift.rosa' },
        actions: [{ type: 'play_video', videoId: 'thank_you_video' }],
        cooldown_ms: 60000, // 60s cooldown
      },
    ]);
    registerVideoPlayCallback(videoPlaySpy);

    processRawEvent('Lucas enviou Rosa');
    processRawEvent('Lucas enviou Rosa'); // Second one within cooldown

    // Only 1 video should play
    expect(videoPlaySpy).toHaveBeenCalledTimes(1);
    expect(videoPlaySpy.mock.calls[0][0]).toBe('thank_you_video');
  });

  it('Test 7: Pipeline steps are logged', () => {
    const pipelineSpy = vi.fn<(result: GiftPipelineResult) => void>();
    registerPipelineLogCallback(pipelineSpy as unknown as (result: GiftPipelineResult) => void);

    processRawEvent('Lucas enviou Rosa');

    expect(pipelineSpy).toHaveBeenCalled();
    const result = pipelineSpy.mock.calls[0][0] as GiftPipelineResult;
    const stepNames = result.steps.map((s) => s.step);
    expect(stepNames).toContain('raw_received');
    expect(stepNames).toContain('classified');
    expect(stepNames).toContain('ledger_updated');
    expect(stepNames).toContain('rule_matched');
    expect(stepNames).toContain('video_trigger');
  });

  it('Test 8: "CamilaBR resgatou Trocar Cena: Gameplay Focus" → gift+redeem, classified', () => {
    const videoPlaySpy = vi.fn();
    registerVideoPlayCallback(videoPlaySpy);

    const result = processRawEvent('CamilaBR resgatou Trocar Cena: Gameplay Focus');

    expect(result.event.kind).toBe('gift');
    expect(result.event.metadata?.redeemable).toBe(true);
    expect(result.event.metadata?.mappedAction).toBe('obs.switch_scene');
    // Gift ledger should be updated
    expect(result.ledgerUpdated).toBe(true);
  });

  it('Test 9: Rules from flow triggers are loaded correctly', () => {
    const videoPlaySpy = vi.fn();
    loadRulesFromFlowTriggers([
      {
        id: 'my-trigger',
        name: 'Rosa Trigger',
        enabled: true,
        eventType: 'gift',
        conditions: { giftKey: 'gift.rosa' },
        actions: [{ type: 'play_video', videoId: 'special_rosa_video' }],
        cooldown_ms: 5000,
      },
    ]);
    registerVideoPlayCallback(videoPlaySpy);

    processRawEvent('Lucas enviou Rosa');

    expect(videoPlaySpy).toHaveBeenCalled();
    expect(videoPlaySpy.mock.calls[0][0]).toBe('special_rosa_video');
  });

  it('Test 10: Disabled rule does not trigger', () => {
    const videoPlaySpy = vi.fn();
    loadRulesFromFlowTriggers([
      {
        id: 'disabled-rule',
        name: 'Disabled',
        enabled: false,
        eventType: 'gift',
        conditions: { giftKey: 'gift.rosa' },
        actions: [{ type: 'play_video', videoId: 'some_video' }],
        cooldown_ms: 0,
      },
    ]);
    registerVideoPlayCallback(videoPlaySpy);

    const result = processRawEvent('Lucas enviou Rosa');

    // Falls through to the fallback rule (any gift)
    // The fallback is added automatically
    expect(result.classified).toBe(true);
  });
});
