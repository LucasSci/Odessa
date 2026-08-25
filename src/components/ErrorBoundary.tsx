import { Component, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { hasError: boolean; error: Error | null };

/**
 * ErrorBoundary — captura erros de runtime do React e mostra uma mensagem
 * visível em vez de uma tela branca/blank. Ajuda a diagnosticar problemas.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#0a0a0f',
            color: '#f87171',
            fontFamily: 'system-ui, sans-serif',
            padding: 32,
            gap: 12,
          }}
        >
          <h2 style={{ fontSize: 18, margin: 0 }}>Algo deu errado ao renderizar</h2>
          <pre
            style={{
              fontSize: 12,
              maxWidth: 600,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              color: '#fca5a5',
            }}
          >
            {this.state.error?.message || 'Erro desconhecido'}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 12,
              padding: '8px 20px',
              borderRadius: 8,
              border: '1px solid #f87171',
              background: 'rgba(248,113,113,0.1)',
              color: '#fca5a5',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            Recarregar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
