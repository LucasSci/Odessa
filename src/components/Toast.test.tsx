import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast } from './Toast';

function Trigger({ onUndo }: { onUndo: () => void }) {
  const toast = useToast();
  return (
    <button type="button" onClick={() => toast.toast('Arquivado: clipe', { kind: 'success', action: { label: 'Desfazer', onClick: onUndo } })}>
      arquivar
    </button>
  );
}

describe('Toast com ação', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('mostra o botão, executa a ação e fecha o aviso', () => {
    const onUndo = vi.fn();
    render(
      <ToastProvider>
        <Trigger onUndo={onUndo} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('arquivar'));
    fireEvent.click(screen.getByRole('button', { name: 'Desfazer' }));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Arquivado: clipe')).toBeNull();
  });

  it('aviso com ação dura pelo menos 7 s (tempo de clicar em Desfazer)', () => {
    render(
      <ToastProvider>
        <Trigger onUndo={() => undefined} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('arquivar'));
    act(() => vi.advanceTimersByTime(6000));
    expect(screen.getByText('Arquivado: clipe')).toBeTruthy();
    act(() => vi.advanceTimersByTime(1500));
    expect(screen.queryByText('Arquivado: clipe')).toBeNull();
  });
});
