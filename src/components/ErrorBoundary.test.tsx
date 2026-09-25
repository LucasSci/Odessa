import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

let shouldThrow = true;
function Flaky() {
  if (shouldThrow) throw new Error('boom');
  return <p>conteúdo ok</p>;
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    shouldThrow = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('isola o erro no painel e permite tentar de novo', () => {
    render(
      <ErrorBoundary scope="panel" label="Biblioteca">
        <Flaky />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert').textContent).toContain('Não foi possível exibir Biblioteca');

    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(screen.getByText('conteúdo ok')).toBeTruthy();
  });

  it('no app inteiro oferece recarregar', () => {
    render(
      <ErrorBoundary scope="app">
        <Flaky />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('button', { name: 'Recarregar' })).toBeTruthy();
  });
});
