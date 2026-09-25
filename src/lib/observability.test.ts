import { afterEach, describe, expect, it, vi } from 'vitest';
import { initObservability, reportError, resetObservabilityForTests } from './observability';

function fakeSentry() {
  return {
    init: vi.fn(),
    captureException: vi.fn(),
    browserTracingIntegration: vi.fn(() => ({ name: 'BrowserTracing' })),
  };
}

afterEach(() => {
  resetObservabilityForTests();
  vi.restoreAllMocks();
});

describe('initObservability', () => {
  it('sem DSN não carrega o SDK', async () => {
    const load = vi.fn();
    await expect(initObservability({}, load)).resolves.toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it('com DSN inicializa sem PII e sem tracing por padrão', async () => {
    const sdk = fakeSentry();
    await initObservability({ VITE_SENTRY_DSN: ' https://k@o1.ingest.sentry.io/1 ' }, async () => sdk as never);
    expect(sdk.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://k@o1.ingest.sentry.io/1',
        environment: 'production',
        dataCollection: expect.objectContaining({ userInfo: false, cookies: false, httpBodies: [] }),
        tracesSampleRate: 0,
        integrations: [],
      }),
    );
  });

  it('liga o tracing só com taxa válida entre 0 e 1', async () => {
    const sdk = fakeSentry();
    await initObservability(
      { VITE_SENTRY_DSN: 'https://k@o1.ingest.sentry.io/1', VITE_SENTRY_TRACES_SAMPLE_RATE: '0.2', VITE_SENTRY_ENVIRONMENT: 'staging' },
      async () => sdk as never,
    );
    expect(sdk.init).toHaveBeenCalledWith(expect.objectContaining({ tracesSampleRate: 0.2, environment: 'staging' }));
    expect(sdk.browserTracingIntegration).toHaveBeenCalled();

    resetObservabilityForTests();
    const other = fakeSentry();
    await initObservability({ VITE_SENTRY_DSN: 'https://k@o1.ingest.sentry.io/1', VITE_SENTRY_TRACES_SAMPLE_RATE: '5' }, async () => other as never);
    expect(other.init).toHaveBeenCalledWith(expect.objectContaining({ tracesSampleRate: 0 }));
  });

  it('é idempotente', async () => {
    const load = vi.fn(async () => fakeSentry() as never);
    const env = { VITE_SENTRY_DSN: 'https://k@o1.ingest.sentry.io/1' };
    await Promise.all([initObservability(env, load), initObservability(env, load)]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('falha ao baixar o SDK não derruba o app', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(
      initObservability({ VITE_SENTRY_DSN: 'https://k@o1.ingest.sentry.io/1' }, () => Promise.reject(new Error('blocked'))),
    ).resolves.toBeNull();
  });
});

describe('reportError', () => {
  it('envia ao Sentry quando ativo', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const sdk = fakeSentry();
    await initObservability({ VITE_SENTRY_DSN: 'https://k@o1.ingest.sentry.io/1' }, async () => sdk as never);
    const error = new Error('boom');
    reportError(error, { page: 'live' });
    expect(sdk.captureException).toHaveBeenCalledWith(error, { extra: { page: 'live' } });
  });

  it('sem Sentry só loga', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    reportError(new Error('boom'));
    expect(log).toHaveBeenCalled();
  });
});
