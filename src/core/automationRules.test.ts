import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  applyAutomationRules,
  loadAutomationRules,
  updateAutomationRule,
  DEFAULT_AUTOMATION_RULES,
} from './automationRules';
import type { LiveEvent } from '../types';

describe('automationRules', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(),
      setItem: vi.fn(),
    });
    vi.clearAllMocks();
  });

  it('should match a gift rule', () => {
    const event: LiveEvent = {
      id: '1',
      kind: 'gift',
      source: 'ocr',
      text: 'Rosa',
      time: '12:00',
      metadata: { giftName: 'Rosa', user: 'Lucas', quantity: 10 },
    };

    const matches = applyAutomationRules(event, DEFAULT_AUTOMATION_RULES);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].rule.id).toBe('rule-gift-rose');
    expect(matches[0].actions[0].payload.message).toContain('Rosa x10 de Lucas');
  });

  it('should match a redeem scene rule', () => {
    const event: LiveEvent = {
      id: '2',
      kind: 'gift',
      source: 'ocr',
      text: 'Resgate',
      time: '12:00',
      metadata: { redeemable: true, mappedAction: 'obs.switch_scene', requestedScene: 'Gaming' },
    };

    const matches = applyAutomationRules(event, DEFAULT_AUTOMATION_RULES);
    const redeemMatch = matches.find((m) => m.rule.id === 'rule-redeem-scene');
    expect(redeemMatch).toBeDefined();
    expect(redeemMatch?.actions.find((a) => a.type === 'switch_scene')?.payload.scene).toBe(
      'Gaming',
    );
  });

  it('should not match if rule is disabled', () => {
    const event: LiveEvent = {
      id: '1',
      kind: 'gift',
      source: 'ocr',
      text: 'Rosa',
      time: '12:00',
      metadata: { giftName: 'Rosa' },
    };
    const disabledRules = DEFAULT_AUTOMATION_RULES.map((r) => ({ ...r, enabled: false }));
    const matches = applyAutomationRules(event, disabledRules);
    expect(matches.length).toBe(0);
  });

  it('should load rules from localStorage', () => {
    const saved = [{ id: 'rule-gift-rose', enabled: false }];
    (localStorage.getItem as any).mockReturnValue(JSON.stringify(saved));
    const rules = loadAutomationRules();
    const roseRule = rules.find((r) => r.id === 'rule-gift-rose');
    expect(roseRule?.enabled).toBe(false);
  });

  it('should update and save a rule', () => {
    const nextRules = updateAutomationRule(DEFAULT_AUTOMATION_RULES, 'rule-gift-rose', {
      enabled: false,
    });
    expect(nextRules.find((r) => r.id === 'rule-gift-rose')?.enabled).toBe(false);
    expect(localStorage.setItem).toHaveBeenCalled();
  });
});
