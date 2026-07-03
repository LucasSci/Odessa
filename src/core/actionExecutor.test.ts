import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeAction } from './actionExecutor';
import type { AutopilotAction, PersonaDecision, PersonaTool } from '../types';

// Mock global fetch
global.fetch = vi.fn();

// Mock Audio
global.Audio = vi.fn().mockImplementation(function () {
  const instance = {
    play: vi.fn().mockImplementation(function () {
      if (instance.onended) {
        setTimeout(() => instance.onended(), 0);
      }
      return Promise.resolve();
    }),
    onended: null as any,
    onerror: null as any,
  };
  return instance;
});

describe('actionExecutor chat.reply visual safety', () => {
  const tools: PersonaTool[] = [
    {
      id: 'chat',
      label: 'Chat',
      capability: 'chat.reply',
      enabled: true,
      simulated: true,
      requiresApproval: false,
    },
  ];
  const decision: PersonaDecision = {
    speech: 'Oi!',
    intent: 'respond_chat',
    confidence: 0.9,
    reason: 'Teste',
    priority: 'normal',
    actions: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.localStorage.setItem(
      'odessa:ai:config:v2',
      JSON.stringify({
        autoChatReplyEnabled: true,
        autoChatReplyMode: 'dry_run',
        chatReplyCooldownMs: 15000,
        chatReplyMaxPerMinute: 4,
        chatReplyMinConfidence: 0.65,
      }),
    );
    window.localStorage.setItem(
      'odessa:chat-automation-target:v1',
      JSON.stringify({
        mode: 'visual',
        url: 'tango-live-window',
        inputSelector: '',
        inputPoint: { x: 0.1, y: 0.9 },
        viewport: { width: 1920, height: 1080 },
      }),
    );
  });

  it('dispatches allowed dry-run chat replies to visual automation', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'dry_run', allowed: true, text: 'Oi!' }),
    });

    const result = await executeAction(
      {
        id: 'chat-1',
        type: 'chat_reply',
        label: 'Responder',
        capability: 'chat.reply',
        payload: { message: 'Oi!', governorAllowed: true, dryRun: true },
        simulated: true,
        status: 'queued',
      },
      decision,
      { tools, voiceEnabled: false },
    );

    expect(result.status).toBe('simulated');
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/chat-automation/send'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"mode":"visual"'),
      }),
    );
    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.dryRun).toBe(true);
    expect(body.submit).toBe(true);
    expect(body.inputPoint).toEqual({ x: 0.1, y: 0.9 });
  });

  it('blocks governor-denied chat replies before fetch', async () => {
    const result = await executeAction(
      {
        id: 'chat-2',
        type: 'chat_reply',
        label: 'Responder',
        capability: 'chat.reply',
        payload: { message: 'Oi!', governorBlockedReason: 'cooldown' },
        simulated: false,
        status: 'queued',
      },
      decision,
      { tools: [{ ...tools[0], simulated: false }], voiceEnabled: false },
    );

    expect(result.status).toBe('blocked');
    expect(result.result).toContain('cooldown');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('blocks real chat replies when the visual target is missing', async () => {
    window.localStorage.setItem(
      'odessa:chat-automation-target:v1',
      JSON.stringify({ mode: 'visual', url: 'tango-live-window', inputSelector: '' }),
    );
    const result = await executeAction(
      {
        id: 'chat-3',
        type: 'chat_reply',
        label: 'Responder',
        capability: 'chat.reply',
        payload: { message: 'Oi!', governorAllowed: true, dryRun: false },
        simulated: false,
        status: 'queued',
      },
      decision,
      { tools: [{ ...tools[0], simulated: false }], voiceEnabled: false },
    );

    expect(result.status).toBe('blocked');
    expect(result.result).toContain('input_point_missing');
  });
});

// Mock URL.createObjectURL and revokeObjectURL
global.URL.createObjectURL = vi.fn(() => 'blob:abc');
global.URL.revokeObjectURL = vi.fn();

/**
 * LEGADO — testes do executor de ações: TTS, chat reply, OBS, n8n dispatch.
 * Esses recursos foram removidos do escopo atual do Odessa.
 * O produto agora foca em: OCR → evento → gift → vídeo.
 *
 * Mantidos aqui apenas para referência histórica.
 * Para rodar: remova o .skip desta describe.
 */
describe.skip('actionExecutor [LEGADO — fora do escopo atual]', () => {
  const tools: PersonaTool[] = [
    { id: 'tts', label: 'TTS', capability: 'tts.speak', enabled: true, simulated: false, requiresApproval: false },
    { id: 'chat', label: 'Chat', capability: 'chat.reply', enabled: true, simulated: true, requiresApproval: false },
    { id: 'obs', label: 'OBS', capability: 'obs.switch_scene', enabled: true, simulated: true, requiresApproval: false },
  ];

  const decision: PersonaDecision = {
    speech: 'Olá!',
    intent: 'respond_chat',
    confidence: 0.9,
    reason: 'Teste',
    priority: 'normal',
    actions: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should execute tts.speak successfully', async () => {
    const action: AutopilotAction = {
      id: '1',
      type: 'speak',
      label: 'Falar',
      capability: 'tts.speak',
      payload: { text: 'Oi' },
      simulated: false,
      status: 'queued',
      source: 'ai',
      createdAt: new Date().toISOString(),
    };

    (fetch as any).mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(['audio'], { type: 'audio/mpeg' })),
    });

    const result = await executeAction(action, decision, { tools, voiceEnabled: true });

    expect(result.status).toBe('done');
    expect(result.result).toContain('Audio reproduzido');
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/tts'), expect.any(Object));
  });

  it('should execute simulated chat_reply', async () => {
    const action: AutopilotAction = {
      id: '2',
      type: 'chat_reply',
      label: 'Responder',
      capability: 'chat.reply',
      payload: { message: 'Olá chat' },
      simulated: true,
      status: 'queued',
      source: 'ai',
      createdAt: new Date().toISOString(),
    };

    // No fetch expected for simulated unless it's dispatched to n8n
    // Our implementation tries to dispatch to n8n first
    (fetch as any).mockResolvedValue({
      ok: false, // Simulate n8n not available
      status: 503,
    });

    const result = await executeAction(action, decision, { tools, voiceEnabled: true });

    expect(result.status).toBe('simulated');
    expect(result.result).toContain('Mensagem que seria enviada ao chat');
  });

  it('should block execution if tool is disabled', async () => {
    const disabledTools: PersonaTool[] = [
      { id: 'tts', label: 'TTS', capability: 'tts.speak', enabled: false, simulated: false, requiresApproval: false },
    ];
    const action: AutopilotAction = {
      id: '3',
      type: 'speak',
      label: 'Falar',
      capability: 'tts.speak',
      payload: { text: 'Oi' },
      simulated: false,
      status: 'queued',
      source: 'ai',
      createdAt: new Date().toISOString(),
    };

    const result = await executeAction(action, decision, {
      tools: disabledTools,
      voiceEnabled: true,
    });

    expect(result.status).toBe('blocked');
    expect(result.result).toContain('Ferramenta desativada');
  });

  it('should require approval if tool requires it', async () => {
    const approvalTools: PersonaTool[] = [
      {
        id: 'obs',
        label: 'OBS',
        capability: 'obs.switch_scene',
        enabled: true,
        simulated: true,
        requiresApproval: true,
      },
    ];
    const action: AutopilotAction = {
      id: '4',
      type: 'switch_scene',
      label: 'Trocar cena',
      capability: 'obs.switch_scene',
      payload: { scene: 'Gameplay' },
      simulated: true,
      status: 'queued',
      source: 'ai',
      createdAt: new Date().toISOString(),
    };

    const result = await executeAction(action, decision, {
      tools: approvalTools,
      voiceEnabled: true,
    });

    expect(result.status).toBe('approval_required');
  });

  it('should dispatch to n8n successfully', async () => {
    const action: AutopilotAction = {
      id: '5',
      type: 'chat_reply',
      label: 'Responder',
      capability: 'chat.reply',
      payload: { message: 'Olá' },
      simulated: false,
      status: 'queued',
      source: 'ai',
      createdAt: new Date().toISOString(),
    };

    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, executed: true, simulated: false, message: 'Done' }),
    });

    const result = await executeAction(action, decision, { tools, voiceEnabled: true });

    expect(result.status).toBe('done');
    expect(result.result).toBe('Done');
  });

  it('should handle n8n dispatch error', async () => {
    const action: AutopilotAction = {
      id: '6',
      type: 'chat_reply',
      label: 'Responder',
      capability: 'chat.reply',
      payload: { message: 'Olá' },
      simulated: true,
      status: 'queued',
      source: 'ai',
      createdAt: new Date().toISOString(),
    };

    (fetch as any).mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ detail: 'N8N error' }),
    });

    const result = await executeAction(action, decision, { tools, voiceEnabled: true });

    expect(result.status).toBe('simulated');
    expect(result.result).toContain('n8n nao recebeu (N8N error)');
  });

  it('should validate OBS scene whitelist', async () => {
    const action: AutopilotAction = {
      id: '7',
      type: 'switch_scene',
      label: 'Trocar cena',
      capability: 'obs.switch_scene',
      payload: { scene: 'UnknownScene' },
      simulated: true,
      status: 'queued',
      source: 'ai',
      createdAt: new Date().toISOString(),
    };

    // Mock whitelist fetch
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true, scenes: ['Gameplay', 'Chat'] }),
    });
    // Mock n8n failure (to fall back to simulated)
    (fetch as any).mockResolvedValueOnce({ ok: false, status: 500 });

    const result = await executeAction(action, decision, { tools, voiceEnabled: true });

    expect(result.status).toBe('blocked');
    expect(result.result).toContain('Cena bloqueada pela whitelist OBS');
  });
});
