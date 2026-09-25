import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportError } from '../lib/observability';
import { ErrorState } from './common/OperationalState';

/**
 * ErrorBoundary — um erro de render não vira página branca.
 *
 * `scope="app"` cobre a tela inteira (último recurso: recarregar); `scope="panel"`
 * isola uma página do shell — as outras páginas e a live continuam funcionando.
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

  render() {
    if (!this.state.error) return this.props.children;
    if ((this.props.scope ?? 'app') === 'app') {
      return (
        <div role="alert" className="anim-fade-in flex min-h-screen items-center justify-center bg-[var(--bg1)]">
          <ErrorState
            title="O Odessa encontrou um erro"
            message="O que já estava salvo não foi perdido. Recarregue a página para continuar."
            retryLabel="Recarregar"
            onRetry={() => window.location.reload()}
          />
        </div>
      );
    }
    return (
      <div role="alert" className="anim-fade-in flex h-full min-h-[320px] items-center justify-center">
        <ErrorState
          title={`Não foi possível exibir ${this.props.label ?? 'esta página'}`}
          message="O restante do estúdio continua funcionando."
          retryLabel="Tentar de novo"
          onRetry={() => this.setState({ error: null })}
        />
      </div>
    );
  }
}
