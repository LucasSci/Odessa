// Só o que o Odessa usa do Sentry. Importar por nome (e não o namespace
// inteiro via import()) deixa o bundler descartar replay, feedback etc. —
// este módulo é carregado sob demanda por observability.ts.
export { browserTracingIntegration, captureException, init } from '@sentry/react';
