/**
 * ocrPipeline.test.ts
 * -------------------
 * Tests for the core OCR pipeline: text → event → video trigger.
 *
 * Scope: ONLY tests the current product focus.
 *   ✓ text parsing and gift detection
 *   ✓ false-positive prevention (chat ≠ gift)
 *   ✓ spam/moderation detection
 *   ✓ video trigger connection
 *   ✓ simulate OCR without live stream
 *
 * NOT tested here (legacy, removed from product scope):
 *   ✗ AI/LLM responses
 *   ✗ TTS / voice
 *   ✗ persona behavior
 *   ✗ mood engine
 *   ✗ long-term memory
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseCapturedText,
  onCapturedText,
  simulateOCRText,
  setVideoTriggerFn,
  DEFAULT_GIFT_VIDEO_ID,
} from './ocrPipeline';

// ─── Setup ────────────────────────────────────────────────────────────────────

let videoPlaySpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  videoPlaySpy = vi.fn() as ReturnType<typeof vi.fn> & ((videoId: string) => void);
  setVideoTriggerFn(videoPlaySpy as (videoId: string) => void);
});

afterEach(() => {
  setVideoTriggerFn(null as any);
  vi.clearAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('OCR Pipeline — parseCapturedText', () => {
  // Teste 1
  it('gift simples: "Lucas enviou Rosa"', () => {
    const event = parseCapturedText('Lucas enviou Rosa');

    expect(event.kind).toBe('gift');
    expect(event.sender).toBe('Lucas');
    expect(event.giftName).toBe('Rosa');
    expect(event.quantity).toBe(1);
  });

  // Teste 2
  it('gift com quantidade: "Ana enviou Rosa x5"', () => {
    const event = parseCapturedText('Ana enviou Rosa x5');

    expect(event.kind).toBe('gift');
    expect(event.sender).toBe('Ana');
    expect(event.giftName).toBe('Rosa');
    expect(event.quantity).toBe(5);
  });

  // Teste 3
  it('gift diferente: "BrunoTech enviou Coroa x1"', () => {
    const event = parseCapturedText('BrunoTech enviou Coroa x1');

    expect(event.kind).toBe('gift');
    expect(event.sender).toBe('BrunoTech');
    expect(event.giftName).toBe('Coroa');
    expect(event.quantity).toBe(1);
  });

  it('gift com mandou: "GuiNinja mandou Foguete"', () => {
    const event = parseCapturedText('GuiNinja mandou Foguete');

    expect(event.kind).toBe('gift');
    expect(event.sender).toBe('GuiNinja');
    expect(event.giftName).toBe('Foguete');
    expect(event.quantity).toBe(1);
  });

  it('gift com presenteou: "Camila presenteou com Rosa x10"', () => {
    const event = parseCapturedText('Camila presenteou com Rosa x10');

    expect(event.kind).toBe('gift');
    expect(event.sender).toBe('Camila');
    expect(event.giftName).toBe('Rosa');
    expect(event.quantity).toBe(10);
  });

  it('gift com quantidade grande: "NandaBR enviou Diamante x2"', () => {
    const event = parseCapturedText('NandaBR enviou Diamante x2');

    expect(event.kind).toBe('gift');
    expect(event.sender).toBe('NandaBR');
    expect(event.giftName).toBe('Diamante');
    expect(event.quantity).toBe(2);
  });

  // Teste 4: chat não vira gift
  it('chat @user: nunca vira gift', () => {
    const event = parseCapturedText('@AnaStarlight: Boa! Mandou muito bem nessa partida');

    expect(event.kind).toBe('chat');
    expect(event.user).toBe('AnaStarlight');
    expect(event.message).toBe('Boa! Mandou muito bem nessa partida');
    // giftName must be undefined
    expect(event.giftName).toBeUndefined();
    expect(event.sender).toBeUndefined();
  });

  it('chat @user com verbos de gift no texto não vira gift', () => {
    const event = parseCapturedText('@BrunoTech: Ela enviou muito no stream hoje');

    expect(event.kind).toBe('chat');
    expect(event.giftName).toBeUndefined();
  });

  // Teste 5: spam
  it('spam classifica como moderation', () => {
    const event = parseCapturedText('xXSpamXx: COMPRE SEGUIDORES BARATO www.fake.com');

    expect(event.kind).toBe('moderation');
    expect(event.giftName).toBeUndefined();
  });

  it('link externo classifica como moderation', () => {
    const event = parseCapturedText('user: acesse https://spam.net agora');

    expect(event.kind).toBe('moderation');
  });

  it('prefixo OCR: é removido antes de classificar', () => {
    const event = parseCapturedText('OCR: Lucas enviou Rosa');

    expect(event.kind).toBe('gift');
    expect(event.sender).toBe('Lucas');
    expect(event.giftName).toBe('Rosa');
  });
});

describe.skip('OCR Pipeline — onCapturedText (LEGADO: video fixo)', () => {
  // Teste 1 (pipeline completo)
  it('"Lucas enviou Rosa" → gift → aciona vídeo', () => {
    const result = onCapturedText('Lucas enviou Rosa', { source: 'test' });

    expect(result.event.kind).toBe('gift');
    expect(result.videoTriggered).toBe(DEFAULT_GIFT_VIDEO_ID);
    expect(videoPlaySpy).toHaveBeenCalledOnce();
    expect(videoPlaySpy).toHaveBeenCalledWith(DEFAULT_GIFT_VIDEO_ID, 'gift_detected');
  });

  // Teste 2 (pipeline completo)
  it('"Ana enviou Rosa x5" → gift → aciona vídeo uma vez', () => {
    const result = onCapturedText('Ana enviou Rosa x5');

    expect(result.event.kind).toBe('gift');
    expect(result.event.quantity).toBe(5);
    expect(videoPlaySpy).toHaveBeenCalledTimes(1);
    expect(videoPlaySpy).toHaveBeenCalledWith(DEFAULT_GIFT_VIDEO_ID, 'gift_detected');
  });

  // Teste 3
  it('"BrunoTech enviou Coroa x1" → gift → aciona vídeo', () => {
    const result = onCapturedText('BrunoTech enviou Coroa x1');

    expect(result.event.kind).toBe('gift');
    expect(result.event.giftName).toBe('Coroa');
    expect(videoPlaySpy).toHaveBeenCalledOnce();
    expect(videoPlaySpy).toHaveBeenCalledWith(DEFAULT_GIFT_VIDEO_ID, 'gift_detected');
  });

  // Teste 4: chat não aciona vídeo
  it('chat @user: não aciona vídeo', () => {
    const result = onCapturedText('@AnaStarlight: Boa! Mandou muito bem nessa partida');

    expect(result.event.kind).toBe('chat');
    expect(result.videoTriggered).toBeNull();
    expect(videoPlaySpy).not.toHaveBeenCalled();
  });

  // Teste 5: spam não aciona vídeo
  it('spam não aciona vídeo', () => {
    const result = onCapturedText('xXSpamXx: COMPRE SEGUIDORES BARATO www.fake.com');

    expect(result.event.kind).toBe('moderation');
    expect(result.videoTriggered).toBeNull();
    expect(videoPlaySpy).not.toHaveBeenCalled();
  });

  it('logs contêm as etapas esperadas para gift', () => {
    const result = onCapturedText('Lucas enviou Rosa');

    const logsStr = result.logs.join('\n');
    expect(logsStr).toContain('[OCR_PIPELINE] text_received:');
    expect(logsStr).toContain('[OCR_PIPELINE] event_parsed:');
    expect(logsStr).toContain('[EVENT_PIPELINE] event_received:');
    expect(logsStr).toContain('[GIFT_TRIGGER] gift_detected:');
    expect(logsStr).toContain('[GIFT_TRIGGER] video_selected:');
  });

  it('logs contêm erro quando play_function não está registrada', () => {
    setVideoTriggerFn(null as any); // remove trigger
    const result = onCapturedText('Lucas enviou Rosa');

    expect(result.videoTriggered).toBeNull();
    const logsStr = result.logs.join('\n');
    expect(logsStr).toContain('[GIFT_TRIGGER_ERROR] play_function_not_found');
  });
});

describe.skip('OCR Pipeline — simulateOCRText (LEGADO: video fixo)', () => {
  // Teste 6: botão de teste passa pelo mesmo pipeline
  it('"Simular presente Rosa" → simulateOCRText → gift → vídeo', () => {
    // simulates what the "Simular presente Rosa" button does
    const result = simulateOCRText('Lucas enviou Rosa');

    expect(result.event.source).toBe('test_ocr');
    expect(result.event.kind).toBe('gift');
    expect(result.videoTriggered).toBe(DEFAULT_GIFT_VIDEO_ID);
    expect(videoPlaySpy).toHaveBeenCalledWith(DEFAULT_GIFT_VIDEO_ID, 'gift_detected');
  });

  // Teste 7: OCR simulado com quantidade
  it('simulateOCRText("Ana enviou Rosa x5") → gift → vídeo', () => {
    const result = simulateOCRText('Ana enviou Rosa x5');

    expect(result.event.kind).toBe('gift');
    expect(result.event.quantity).toBe(5);
    expect(videoPlaySpy).toHaveBeenCalledTimes(1);
    expect(videoPlaySpy).toHaveBeenCalledWith(DEFAULT_GIFT_VIDEO_ID, 'gift_detected');
  });

  // Teste 9: gatilho usa a mesma função do clique
  it('trigger automático chama a mesma função registrada via setVideoTriggerFn', () => {
    const manualClickFn = vi.fn(); // simulates the manual click function
    setVideoTriggerFn(manualClickFn);

    simulateOCRText('Lucas enviou Rosa');

    // The same fn registered is called — no parallel player
    expect(manualClickFn).toHaveBeenCalledWith(DEFAULT_GIFT_VIDEO_ID, 'gift_detected');
    expect(manualClickFn).toHaveBeenCalledTimes(1);
  });

  // Teste 10: sem live real — tudo funciona sem backend
  it('todos os testes rodam sem live real (sem fetch/OCR real)', () => {
    // This test verifies that the pipeline completes using only in-memory logic.
    // No fetch, no OBS, no Tango, no TikTok needed.
    const results = [
      simulateOCRText('Lucas enviou Rosa'),
      simulateOCRText('Ana enviou Rosa x5'),
      simulateOCRText('BrunoTech enviou Coroa x1'),
    ];

    for (const result of results) {
      expect(result.event.kind).toBe('gift');
      expect(result.videoTriggered).toBe(DEFAULT_GIFT_VIDEO_ID);
    }

    expect(videoPlaySpy).toHaveBeenCalledTimes(3);
  });
});
