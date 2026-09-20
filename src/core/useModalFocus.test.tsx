import { fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { focusableElements, useModalFocus } from './useModalFocus';

function Modal({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useModalFocus(ref);
  return (
    <div ref={ref} role="dialog" aria-modal="true" tabIndex={-1}>
      <button>primeiro</button>
      <input aria-label="campo" />
      <button disabled>desabilitado</button>
      <button hidden>oculto</button>
      <button onClick={onClose}>ultimo</button>
    </div>
  );
}

function Host() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>abrir</button>
      <button>fora</button>
      {open && <Modal onClose={() => setOpen(false)} />}
    </>
  );
}

const tab = (shiftKey = false) => fireEvent.keyDown(document, { key: 'Tab', shiftKey });

describe('focusableElements', () => {
  it('ignora desabilitados, ocultos e tabindex -1', () => {
    const root = document.createElement('div');
    root.innerHTML = '<button>a</button><button disabled>b</button><button hidden>c</button><span tabindex="-1">d</span><a href="#x">e</a>';
    expect(focusableElements(root).map((el) => el.textContent)).toEqual(['a', 'e']);
  });
});

describe('useModalFocus', () => {
  function openModal() {
    render(<Host />);
    const opener = screen.getByText('abrir');
    opener.focus();
    fireEvent.click(opener);
    return { opener, dialog: screen.getByRole('dialog') };
  }

  it('leva o foco para dentro do diálogo ao abrir', () => {
    const { dialog } = openModal();
    expect(document.activeElement).toBe(dialog);
  });

  it('Tab no último volta ao primeiro e Shift+Tab no primeiro vai ao último', () => {
    openModal();
    screen.getByText('ultimo').focus();
    tab();
    expect(document.activeElement).toBe(screen.getByText('primeiro'));
    tab(true);
    expect(document.activeElement).toBe(screen.getByText('ultimo'));
  });

  it('Shift+Tab no próprio container também vai ao último', () => {
    const { dialog } = openModal();
    expect(document.activeElement).toBe(dialog);
    tab(true);
    expect(document.activeElement).toBe(screen.getByText('ultimo'));
  });

  it('se o foco escapou para fora, o Tab o traz de volta', () => {
    openModal();
    screen.getByText('fora').focus();
    tab();
    expect(document.activeElement).toBe(screen.getByText('primeiro'));
  });

  it('Tab no meio do diálogo não é interceptado (segue a ordem nativa)', () => {
    openModal();
    screen.getByText('primeiro').focus();
    const notPrevented = fireEvent.keyDown(document, { key: 'Tab' });
    expect(notPrevented).toBe(true);
  });

  it('initialFocus leva o foco ao campo indicado e ainda devolve a quem abriu', () => {
    function Palette() {
      const [open, setOpen] = useState(false);
      const ref = useRef<HTMLDivElement>(null);
      useModalFocus(ref, open, 'input');
      return (
        <>
          <button onClick={() => setOpen(true)}>abrir paleta</button>
          {open && (
            <div ref={ref} tabIndex={-1} role="dialog">
              <button>x</button>
              <input aria-label="busca" />
              <button onClick={() => setOpen(false)}>fechar paleta</button>
            </div>
          )}
        </>
      );
    }
    render(<Palette />);
    const opener = screen.getByText('abrir paleta');
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement).toBe(screen.getByLabelText('busca'));
    fireEvent.click(screen.getByText('fechar paleta'));
    expect(document.activeElement).toBe(opener);
  });

  it('devolve o foco a quem abriu ao fechar', () => {
    const { opener } = openModal();
    fireEvent.click(screen.getByText('ultimo'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
