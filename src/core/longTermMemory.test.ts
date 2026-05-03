import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LongTermMemoryManager } from './longTermMemory';

describe('LongTermMemoryManager', () => {
  let manager: LongTermMemoryManager;

  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(),
      setItem: vi.fn(),
    });
    vi.clearAllMocks();
    manager = new LongTermMemoryManager();
  });

  it('should store and retrieve a fact', () => {
    manager.storeFact('user1', 'comida', 'gosta de pizza');
    const context = manager.retrieveContext(['user1']);
    expect(context).toContain('[user1] sobre comida: gosta de pizza');
  });

  it('should not store duplicate facts', () => {
    manager.storeFact('user1', 'comida', 'gosta de pizza');
    manager.storeFact('user1', 'comida', 'gosta de pizza');
    const context = manager.retrieveContext(['user1']);
    const lines = context.split('\n').filter(l => l.startsWith('- '));
    expect(lines.length).toBe(1);
  });

  it('should retrieve context for multiple users', () => {
    manager.storeFact('user1', 'hobby', 'dançar');
    manager.storeFact('user2', 'cidade', 'São Paulo');
    const context = manager.retrieveContext(['user1', 'user2']);
    expect(context).toContain('user1');
    expect(context).toContain('user2');
  });

  it('should return empty string if no users provided', () => {
    manager.storeFact('user1', 'hobby', 'dançar');
    const context = manager.retrieveContext([]);
    expect(context).toBe('');
  });

  it('should return empty string if no facts found for users', () => {
    manager.storeFact('user1', 'hobby', 'dançar');
    const context = manager.retrieveContext(['user2']);
    expect(context).toBe('');
  });

  it('should load from localStorage on creation', () => {
    const savedFacts = [{ userId: 'user1', topic: 'T', content: 'C', id: '1', timestamp: '2026' }];
    (localStorage.getItem as any).mockReturnValue(JSON.stringify(savedFacts));
    
    const newManager = new LongTermMemoryManager();
    const context = newManager.retrieveContext(['user1']);
    expect(context).toContain('C');
  });
});
