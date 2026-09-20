import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const generate = vi.fn();

vi.mock('../core/personaManager', () => ({
  listPersonas: vi.fn().mockResolvedValue({
    activePersonaId: 'barbara',
    personas: [
      { id: 'barbara', name: 'Barbara', description: 'Persona', personality: 'Seja gentil.' },
      { id: 'julia', name: 'Julia', description: 'Outra', personality: '' },
    ],
  }),
}));
vi.mock('../core/tangoAiChatService', () => ({ generateTangoChatReply: (...args: unknown[]) => generate(...args) }));
vi.mock('../core/chatToTriggerBridge', () => ({ routeChatToTriggers: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../core/sessionHistory', () => ({ recordSessionEvent: vi.fn() }));
vi.mock('../core/personaSelfConfig', () => ({
  applySelfConfig: vi.fn(),
  buildSelfConfigPrompt: () => '',
  fetchFaces: vi.fn().mockResolvedValue([]),
  parseAutoConfig: (text: string) => ({ cleanText: text, changes: null }),
  reflectOnConversation: vi.fn().mockResolvedValue(null),
  requestSelfGeneratedPhoto: vi.fn(),
  summarizeSelfConfigChanges: () => '',
}));

import { PersonaChatLab } from './PersonaChatLab';

async function ready() {
  render(<PersonaChatLab />);
  await screen.findByRole('button', { name: /Barbara/ });
  await waitFor(() => expect((screen.getByLabelText('Mensagem para a persona') as HTMLTextAreaElement).disabled).toBe(false));
}

function type(text: string) {
  fireEvent.change(screen.getByLabelText('Mensagem para a persona'), { target: { value: text } });
}

beforeEach(() => {
  window.localStorage.clear();
  generate.mockReset();
});
afterEach(() => cleanup());

describe('PersonaChatLab', () => {
  it('envia com Enter, mostra a resposta e guarda a conversa', async () => {
    generate.mockResolvedValue({ ok: true, reply: 'Oi, tudo bem!', confidence: 1 });
    await ready();
    type('oi');
    fireEvent.keyDown(screen.getByLabelText('Mensagem para a persona'), { key: 'Enter' });

    expect(await screen.findByText('Oi, tudo bem!')).toBeTruthy();
    const stored = JSON.parse(window.localStorage.getItem('odessa.conversationLab.barbara') || '[]');
    expect(stored.map((m: { text: string }) => m.text)).toEqual(['oi', 'Oi, tudo bem!']);
  });

  it('Shift+Enter não envia', async () => {
    await ready();
    type('linha');
    fireEvent.keyDown(screen.getByLabelText('Mensagem para a persona'), { key: 'Enter', shiftKey: true });
    expect(generate).not.toHaveBeenCalled();
  });

  it('recarrega a conversa guardada ao voltar para a aba', async () => {
    generate.mockResolvedValue({ ok: true, reply: 'Resposta guardada', confidence: 1 });
    await ready();
    type('mensagem antiga');
    fireEvent.click(screen.getByRole('button', { name: /Enviar/ }));
    await screen.findByText('Resposta guardada');

    cleanup();
    await ready();
    expect(await screen.findByText('mensagem antiga')).toBeTruthy();
    expect(screen.getByText('Resposta guardada')).toBeTruthy();
  });

  it('falha da IA vira aviso (não fala da persona) e "Tentar de novo" não duplica a mensagem', async () => {
    generate.mockResolvedValueOnce({ ok: false, reply: '', reason: 'IA indisponível — Ollama: connection refused', confidence: 0 });
    await ready();
    type('oi');
    fireEvent.click(screen.getByRole('button', { name: /Enviar/ }));

    expect(await screen.findByText(/Ollama: connection refused/)).toBeTruthy();
    expect(screen.queryByText('Barbara está pensando...')).toBeNull();

    generate.mockResolvedValueOnce({ ok: true, reply: 'Agora foi!', confidence: 1 });
    fireEvent.click(screen.getByRole('button', { name: /Tentar de novo/ }));

    expect(await screen.findByText('Agora foi!')).toBeTruthy();
    expect(screen.getAllByText('oi')).toHaveLength(1);
    expect(screen.queryByText(/connection refused/)).toBeNull();
  });

  it('não manda avisos de sistema nem falhas como contexto para a IA', async () => {
    generate.mockResolvedValueOnce({ ok: false, reply: '', reason: 'falhou', confidence: 0 });
    await ready();
    type('primeira');
    fireEvent.click(screen.getByRole('button', { name: /Enviar/ }));
    await screen.findByText('falhou');

    generate.mockResolvedValueOnce({ ok: true, reply: 'certo', confidence: 1 });
    type('segunda');
    fireEvent.click(screen.getByRole('button', { name: /Enviar/ }));
    await screen.findByText('certo');

    const history = generate.mock.calls[1][1] as Array<{ role: string; text: string }>;
    expect(history.map((m) => m.text)).toEqual(['primeira']);
  });

  it('Limpar conversa pede confirmação e apaga do armazenamento', async () => {
    generate.mockResolvedValue({ ok: true, reply: 'ok', confidence: 1 });
    await ready();
    type('oi');
    fireEvent.click(screen.getByRole('button', { name: /Enviar/ }));
    await screen.findByText('ok');

    fireEvent.click(screen.getByRole('button', { name: 'Limpar conversa' }));
    expect(window.localStorage.getItem('odessa.conversationLab.barbara')).not.toBeNull(); // ainda não apagou
    fireEvent.click(screen.getByRole('button', { name: /Confirmar: apagar conversa/ }));

    await waitFor(() => expect(window.localStorage.getItem('odessa.conversationLab.barbara')).toBeNull());
    expect(screen.getByText(/Envie uma mensagem para iniciar/)).toBeTruthy();
  });
});
