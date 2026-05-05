import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MoodEngine } from './moodEngine';
import type { LiveEvent } from '../types';

describe('MoodEngine', () => {
  let engine: MoodEngine;

  beforeEach(() => {
    engine = new MoodEngine(60, 80);
    vi.useFakeTimers();
  });

  it('should start with default cozy mood', () => {
    const mood = engine.getCurrentMood();
    expect(mood.state).toBe('cozy');
    expect(mood.energy).toBe(60);
    expect(mood.warmth).toBe(90); // baseWarmth + 10 because hype is 0
  });

  it('should increase hype with gift events', () => {
    const events: LiveEvent[] = [
      { id: '1', kind: 'gift', source: 'ocr', text: 'Rosa', time: '12:00' },
    ];
    engine.processEvents(events);
    const mood = engine.getCurrentMood();
    // 1 gift = 25 hype. 25 is not > 40, so it remains cozy but with less warmth than 0-hype
    expect(mood.state).toBe('cozy');
    expect(mood.warmth).toBe(80); // baseWarmth (80) because hype (25) is not < 10
  });

  it('should reach focused state with two gifts', () => {
    const events: LiveEvent[] = [
      { id: '1', kind: 'gift', source: 'ocr', text: 'Rosa', time: '12:00' },
      { id: '2', kind: 'gift', source: 'ocr', text: 'Rosa', time: '12:00' },
    ];
    engine.processEvents(events); // 2 * 25 = 50 hype
    const mood = engine.getCurrentMood();
    expect(mood.state).toBe('focused');
    expect(mood.energy).toBe(70); // 60 + 10
  });

  it('should reach hype state with four gifts', () => {
    const events: LiveEvent[] = [
      { id: '1', kind: 'gift', source: 'ocr', text: 'Rosa', time: '12:00' },
      { id: '2', kind: 'gift', source: 'ocr', text: 'Rosa', time: '12:00' },
      { id: '3', kind: 'gift', source: 'ocr', text: 'Rosa', time: '12:00' },
      { id: '4', kind: 'gift', source: 'ocr', text: 'Rosa', time: '12:00' },
    ];
    engine.processEvents(events); // 4 * 25 = 100 hype
    const mood = engine.getCurrentMood();
    expect(mood.state).toBe('hype');
    expect(mood.energy).toBe(90); // 60 + 30
  });

  it('should decrease hype with moderation events', () => {
    // Set 50 hype (focused)
    engine.processEvents([
      { id: '1', kind: 'gift', source: 'ocr', text: 'Rosa', time: '12:00' },
      { id: '2', kind: 'gift', source: 'ocr', text: 'Rosa', time: '12:00' },
    ]);
    let mood = engine.getCurrentMood();
    expect(mood.state).toBe('focused');

    // Add moderation event (-10 hype) -> 40 hype
    engine.processEvents([
      { id: '3', kind: 'moderation', source: 'ocr', text: 'Spam', time: '12:00' },
    ]);
    mood = engine.getCurrentMood();
    // 40 is not > 40, so it falls back to cozy
    expect(mood.state).toBe('cozy');
  });

  it('should decay hype over time', () => {
    // Set 100 hype
    engine.processEvents(Array(4).fill({ kind: 'gift' }));
    expect(engine.getCurrentMood().state).toBe('hype');

    // Fast forward 10 minutes (should lose 50 points)
    vi.advanceTimersByTime(10 * 60 * 1000);
    engine.processEvents([]); // Trigger decay calculation

    const mood = engine.getCurrentMood();
    expect(mood.state).toBe('focused'); // 100 - 50 = 50
  });

  it('should return a prompt injection string', () => {
    const injection = engine.getMoodPromptInjection();
    expect(injection).toContain('[HUMOR ATUAL: COZY');
    expect(injection).toContain('Sua energia: 60/100');
  });
});
