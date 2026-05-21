import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  selectContentForEvents,
  buildContentPromptContext,
  markContentUsed,
  DEFAULT_CONTENT_ITEMS,
} from './contentLibrary';
import type { LiveEvent } from '../types';

/**
 * LEGADO — testes da biblioteca de conteúdo (usada para prompts de IA).
 * Esse recurso foi removido do escopo atual do Odessa.
 * O produto agora foca em: OCR → evento → gift → vídeo.
 */
describe.skip('contentLibrary [LEGADO — fora do escopo atual]', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(),
      setItem: vi.fn(),
    });
    vi.clearAllMocks();
  });

  it('should select relevant content for a gift event', () => {
    const event: LiveEvent = {
      id: '1',
      kind: 'gift',
      source: 'ocr',
      text: 'Rosa',
      time: '12:00',
      createdAt: '2026-05-05T00:00:00Z',
      zoneName: 'chat',
      metadata: { giftName: 'Rosa', user: 'Lucas' },
    };

    const selected = selectContentForEvents([event]);
    expect(selected.length).toBeGreaterThan(0);
    // Should include gift-related content
    expect(selected.some((s) => s.type === 'gift_redeem' || s.type === 'cta')).toBe(true);
  });

  it('should build a prompt context string', () => {
    const items = [
      {
        id: '1',
        type: 'topic' as any,
        title: 'Topic 1',
        priority: 'normal' as any,
        usage: 'context' as any,
        reason: 'R1',
        snippet: 'S1',
      },
      {
        id: '2',
        type: 'moderation_policy' as any,
        title: 'Policy 1',
        priority: 'urgent' as any,
        usage: 'safety' as any,
        reason: 'R2',
        snippet: 'S2',
      },
    ];
    const context = buildContentPromptContext(items);
    expect(context).toContain('[BIBLIOTECA DE CONTEUDO DA LIVE]');
    expect(context).toContain('Topic 1');
    expect(context).toContain('Policy 1');
  });

  it('should mark content as used', () => {
    (localStorage.getItem as any).mockReturnValue(JSON.stringify(DEFAULT_CONTENT_ITEMS));
    const itemsToMark = [{ id: DEFAULT_CONTENT_ITEMS[0].id } as any];

    markContentUsed(itemsToMark);

    expect(localStorage.setItem).toHaveBeenCalled();
    const call = (localStorage.setItem as any).mock.calls[0];
    const savedItems = JSON.parse(call[1]);
    const markedItem = savedItems.find((i: any) => i.id === DEFAULT_CONTENT_ITEMS[0].id);
    expect(markedItem.usedCount).toBe(1);
  });
});
