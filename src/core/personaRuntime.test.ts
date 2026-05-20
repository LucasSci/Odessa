import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runPersonaRound } from './personaRuntime';
import type { PersonaRuntimeOptions } from './personaRuntime';
import type { LiveEvent } from '../types';

// Mock dependencies
vi.mock('./actionExecutor', () => ({
  executeActionQueue: vi.fn().mockResolvedValue([]),
}));

vi.mock('./eventClassifier', () => ({
  classifyEvent: vi.fn((e) => ({ ...e, metadata: { ...e.metadata, classified: true } })),
}));

vi.mock('./eventBus', () => ({
  markEventProcessed: vi.fn(),
}));

vi.mock('../lib/memory', () => ({
  loadMemory: vi.fn(() => []),
  addTurn: vi.fn(),
  loadUserProfiles: vi.fn(() => ({})),
  trackUserInteraction: vi.fn((p) => p),
  buildMemoryContext: vi.fn(() => 'Mock Memory Context'),
  buildUserContext: vi.fn(() => 'Mock User Context'),
}));

vi.mock('./contentLibrary', () => ({
  selectContentForEvents: vi.fn(() => []),
  buildContentPromptContext: vi.fn(() => 'Mock Content Context'),
  markContentUsed: vi.fn(),
}));

vi.mock('./automationRules', () => ({
  applyAutomationRules: vi.fn(() => []),
}));

vi.mock('./toolRegistry', () => ({
  capabilityForAction: vi.fn(() => 'mock.capability'),
}));

// Mock global fetch
global.fetch = vi.fn();

vi.mock('./moodEngine', () => ({
  globalMoodEngine: {
    processEvents: vi.fn(),
    getMoodPromptInjection: vi.fn(() => 'Mock Mood Prompt'),
  },
}));

vi.mock('./longTermMemory', () => ({
  globalRAGMemory: {
    retrieveContext: vi.fn(() => 'Mock RAG Context'),
  },
}));

/**
 * LEGADO — testes da persona IA, TTS e comportamento conversacional.
 * Esses recursos foram removidos do escopo atual do Odessa.
 * O produto agora foca em: OCR → evento → gift → vídeo.
 *
 * Mantidos aqui apenas para referência histórica.
 * Para rodar: remova o .skip desta describe.
 */
describe.skip('personaRuntime [LEGADO — fora do escopo atual]', () => {
  const events: LiveEvent[] = [
    {
      id: '1',
      source: 'ocr',
      zoneName: 'chat',
      text: 'Olá',
      kind: 'chat',
      createdAt: '2026-05-05T00:00:00Z',
      time: '12:00:00',
    },
  ];
  const options: PersonaRuntimeOptions = {
    personaPrompt: 'You are Juju.',
    tools: [],
    rules: [],
    voiceEnabled: true,
    onUpdate: vi.fn(),
    onAction: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should run a successful persona round', async () => {
    const events: LiveEvent[] = [
      {
        id: '1',
        source: 'ocr',
        zoneName: 'chat',
        text: 'Olá Juju!',
        kind: 'chat',
        createdAt: '2026-05-05T00:00:00Z',
        time: '12:00:00',
      },
    ];

    // Mock backend memory response
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ context: 'Backend Context', usersRecognized: 1 }),
    });

    // Mock AI decision response
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          speech: 'Oi pessoal!',
          intent: 'respond_chat',
          confidence: 0.9,
          actions: [{ type: 'speak', payload: { text: 'Oi pessoal!' } }],
        }),
    });

    const cycle = await runPersonaRound(events, options);

    expect(cycle.stage).toBe('concluido');
    expect(cycle.decision?.speech).toBe('Oi pessoal!');
    expect(options.onUpdate).toHaveBeenCalled();
  });

  it('should fallback to local decision if AI fails', async () => {
    const events: LiveEvent[] = [
      {
        id: '2',
        source: 'ocr',
        zoneName: 'chat',
        text: 'Olá Juju!',
        kind: 'chat',
        createdAt: '2026-05-05T00:00:00Z',
        time: '12:00:00',
      },
    ];

    // Mock backend memory success
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    });

    // Mock AI decision failure
    (fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ detail: 'AI Error' }),
    });

    const cycle = await runPersonaRound(events, options);

    // It should be 'concluido' because the error is caught and local fallback is used
    expect(cycle.stage).toBe('concluido');
    expect(cycle.decision?.reason).toContain('Fallback local acionado: AI Error');
    expect(cycle.decision?.speech).toBeDefined();
  });

  it('should handle memory error and continue', async () => {
    (fetch as any).mockImplementation((url: string) => {
      if (url.includes('/memory/round-context')) {
        return Promise.reject(new Error('Memory Down'));
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ speech: 'OK', intent: 'test', actions: [] }),
      });
    });

    const cycle = await runPersonaRound(events, options);
    expect(cycle.stage).toBe('concluido');
    expect(cycle.logs.length).toBeGreaterThan(0);
  });

  it('should handle decision error and use local decision', async () => {
    (fetch as any).mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ detail: 'AI Down' }),
    });

    const cycle = await runPersonaRound(events, options);
    expect(cycle.stage).toBe('concluido');
    expect(cycle.logs.length).toBeGreaterThan(0);
    expect(cycle.decision).toBeDefined();
  });

  it('should handle action execution error', async () => {
    const { executeActionQueue } = await import('./actionExecutor');
    (executeActionQueue as any).mockResolvedValueOnce([
      { id: 'a1', label: 'Action 1', status: 'error', result: 'Failed', type: 'speak' },
    ]);

    const cycle = await runPersonaRound(events, options);
    expect(cycle.stage).toBe('concluido');
    expect(cycle.actions[0].status).toBe('error');
    expect(cycle.logs.some((l) => l.status === 'error')).toBe(true);
  });

  it('should throw error if events list is empty', async () => {
    await expect(runPersonaRound([], options)).rejects.toThrow('Rodada sem eventos');
  });

  it('should record an error if a critical step fails outside local try/catches', async () => {
    const events: LiveEvent[] = [
      {
        id: '3',
        source: 'ocr',
        zoneName: 'test',
        text: 'fail',
        kind: 'chat',
        createdAt: '2026-05-05T00:00:00Z',
        time: '12:00:00',
      },
    ];

    // Force a critical failure in classifyEvent which is not caught locally
    const { classifyEvent } = await import('./eventClassifier');
    (classifyEvent as any).mockImplementationOnce(() => {
      throw new Error('Critical classification failure');
    });

    const cycle = await runPersonaRound(events, options);

    expect(cycle.stage).toBe('erro');
    expect(cycle.error).toBe('Critical classification failure');
  });
});
