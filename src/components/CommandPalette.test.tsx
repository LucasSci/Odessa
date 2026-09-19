import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandPalette } from './CommandPalette';
import type { PaletteCommand } from '../core/commandPalette';

afterEach(cleanup);

function setup(overrides: Partial<{ open: boolean }> = {}) {
  const runA = vi.fn();
  const runB = vi.fn();
  const onClose = vi.fn();
  const commands: PaletteCommand[] = [
    { id: 'a', title: 'Ir para Biblioteca', group: 'Navegação', run: runA },
    { id: 'b', title: 'Ir ao ar: Sorriso leve', group: 'Clips', hint: 'clip', run: runB },
  ];
  render(<CommandPalette open={overrides.open ?? true} commands={commands} onClose={onClose} />);
  return { runA, runB, onClose };
}

describe('CommandPalette', () => {
  it('não renderiza nada fechada', () => {
    setup({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('lista os comandos agrupados e filtra ao digitar (sem acento)', () => {
    setup();
    expect(screen.getAllByRole('option')).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('Buscar comando'), { target: { value: 'sorriso' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByText('Ir ao ar: Sorriso leve')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Buscar comando'), { target: { value: 'navegacao' } });
    expect(screen.getByText('Ir para Biblioteca')).toBeTruthy();
  });

  it('setas movem a seleção e Enter executa e fecha', () => {
    const { runA, runB, onClose } = setup();
    const dialog = screen.getByRole('dialog');
    expect(screen.getAllByRole('option')[0].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(dialog, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[1].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(dialog, { key: 'Enter' });
    expect(runB).toHaveBeenCalledTimes(1);
    expect(runA).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Esc fecha sem executar e clique executa', () => {
    const { runA, onClose } = setup();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(runA).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Ir para Biblioteca'));
    expect(runA).toHaveBeenCalledTimes(1);
  });

  it('mostra mensagem quando nada casa', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Buscar comando'), { target: { value: 'zzzz' } });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText(/Nada encontrado/)).toBeTruthy();
  });
});
