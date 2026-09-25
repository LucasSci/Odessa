/**
 * observability — erros de runtime do navegador enviados ao Sentry (issue #243).
 *
 * Opt-in: sem `VITE_SENTRY_DSN` na build nada é carregado nem enviado. Com
 * DSN, o SDK é baixado sob demanda (chunk próprio) para não pesar no bundle
 * de entrada. Sem dados pessoais: usuário, cookies, cabeçalhos, corpos HTTP,
 * query strings e entradas/saídas de IA (mensagens do chat) não são enviados.
 */

type SentryModule = typeof import('./sentryClient');

interface ObservabilityEnv {
  VITE_SENTRY_DSN?: string;
  VITE_SENTRY_ENVIRONMENT?: string;
  VITE_SENTRY_TRACES_SAMPLE_RATE?: string;
}

let sentry: SentryModule | null = null;
let loading: Promise<SentryModule | null> | null = null;

function sampleRate(raw: string | undefined): number {
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0;
}

export function initObservability(
  env: ObservabilityEnv = import.meta.env,
  load: () => Promise<SentryModule> = () => import('./sentryClient'),
): Promise<SentryModule | null> {
  if (loading) return loading;
  const dsn = env.VITE_SENTRY_DSN?.trim();
  if (!dsn) {
    loading = Promise.resolve(null);
    return loading;
  }
  loading = load()
    .then((module) => {
      const tracesSampleRate = sampleRate(env.VITE_SENTRY_TRACES_SAMPLE_RATE);
      module.init({
        dsn,
        environment: env.VITE_SENTRY_ENVIRONMENT || 'production',
        dataCollection: {
          userInfo: false,
          cookies: false,
          httpHeaders: false,
          httpBodies: [],
          urlQueryParams: false,
          genAI: { inputs: false, outputs: false },
        },
        integrations: tracesSampleRate > 0 ? [module.browserTracingIntegration()] : [],
        tracesSampleRate,
      });
      sentry = module;
      return module;
    })
    .catch((error: unknown) => {
      // Observabilidade nunca pode derrubar o app (ex.: bloqueador de anúncios).
      console.warn('[Odessa] Sentry indisponível:', error);
      return null;
    });
  return loading;
}

/** Reporta um erro já tratado (ex.: ErrorBoundary). Sem Sentry, só loga. */
export function reportError(error: unknown, context?: Record<string, unknown>): void {
  console.error('[Odessa]', error, context ?? '');
  sentry?.captureException(error, context ? { extra: context } : undefined);
}

/** Só para testes: volta ao estado inicial. */
export function resetObservabilityForTests(): void {
  sentry = null;
  loading = null;
}
