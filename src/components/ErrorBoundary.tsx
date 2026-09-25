import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { reportError } from '../lib/observability';
import { Button } from './ui';

/**
 * ErrorBoundary — um erro de render não vira página branca.
 *
 * `scope="app"` cobre a tela inteira (último recurso); `scope="panel"` isola
 * uma página do shell: as outras páginas e a live continuam funcionando.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; scope?: 'app' | 'panel'; label?: string },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportError(error, { scope: this.props.scope ?? 'app', label: this.props.label, componentStack: info.componentStack });
  }

  private retry = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const isApp = (this.props.scope ?? 'app') === 'app';
    return (
      <div
        role="alert"
        className={
          isApp
            ? 'anim-fade-in flex min-h-screen items-center justify-center bg-[var(--bg1)] p-6'
            : 'anim-fade-in flex h-full min-h-[320px] items-center justify-center p-6'
        }
      >
        <div className="flex max-w-md flex-col items-center gap-3 text-center">
          <span className="grid h-11 w-11 place-items-center rounded-2xl border border-amber-400/25 bg-amber-500/10 text-amber-300">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <h2 className="text-base font-semibold text-[var(--t1)]">
            {isApp ? 'O Odessa encontrou um erro' : `Não foi possível exibir ${this.props.label ?? 'esta página'}`}
          </h2>
          <p className="text-sm text-[var(--t2)]">
            {isApp
              ? 'Nada foi perdido do que já estava salvo. Tente de novo ou recarregue a página.'
              : 'O restante do estúdio continua funcionando. Tente abrir de novo.'}
          </p>
          <div className="mt-1 flex gap-2">
            <Button size="sm" variant="primary" onClick={this.retry}>
              <RotateCcw className="h-3.5 w-3.5" />
              Tentar de novo
            </Button>
            {isApp && (
              <Button size="sm" variant="secondary" onClick={() => window.location.reload()}>
                Recarregar
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }
}
