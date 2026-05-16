import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  loadToolRegistry,
  saveToolRegistry,
  updateToolRegistry,
  findTool,
  capabilityForAction,
  DEFAULT_TOOLS,
} from './toolRegistry';
import type { PersonaTool } from '../types';

/**
 * LEGADO — testes do registro de ferramentas (TTS, OBS, etc).
 * Esse recurso foi removido do escopo atual do Odessa.
 * O produto agora foca em: OCR → evento → gift → vídeo.
 */
describe.skip('toolRegistry [LEGADO — fora do escopo atual]', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    });
    vi.clearAllMocks();
  });

  it('should return default tools when localStorage is empty', () => {
    (localStorage.getItem as any).mockReturnValue(null);
    const tools = loadToolRegistry();
    expect(tools).toEqual(DEFAULT_TOOLS);
  });

  it('should load tools from localStorage and merge with defaults', () => {
    const savedTools = [{ capability: 'tts.speak', enabled: false }];
    (localStorage.getItem as any).mockReturnValue(JSON.stringify(savedTools));

    const tools = loadToolRegistry();
    const ttsTool = tools.find((t) => t.capability === 'tts.speak');
    expect(ttsTool?.enabled).toBe(false);
  });

  it('should save tools to localStorage', () => {
    const toolsToSave: PersonaTool[] = [
      { id: '1', label: 'T', capability: 'tts.speak', enabled: true, simulated: false, requiresApproval: false },
    ];
    saveToolRegistry(toolsToSave);
    expect(localStorage.setItem).toHaveBeenCalledWith(
      expect.any(String),
      JSON.stringify(toolsToSave),
    );
  });

  it('should update a tool in the registry', () => {
    const initialTools = [...DEFAULT_TOOLS];
    const nextTools = updateToolRegistry(initialTools, 'tts.speak', { enabled: false });
    const ttsTool = nextTools.find((t) => t.capability === 'tts.speak');
    expect(ttsTool?.enabled).toBe(false);
    expect(localStorage.setItem).toHaveBeenCalled();
  });

  it('should find a tool by capability', () => {
    const tool = findTool(DEFAULT_TOOLS, 'tts.speak');
    expect(tool?.capability).toBe('tts.speak');
  });

  it('should return correct capability for action type', () => {
    expect(capabilityForAction({ type: 'speak' })).toBe('tts.speak');
    expect(capabilityForAction({ type: 'switch_scene' })).toBe('obs.switch_scene');
    expect(capabilityForAction({ type: 'unknown' as any })).toBe('log.event');
  });
});
