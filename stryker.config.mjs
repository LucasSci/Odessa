// Testes de mutação (Stryker) no núcleo de regras — ver issue #242.
// Lento demais para todo PR: roda semanalmente e sob demanda
// (.github/workflows/mutation.yml). Uso local: pnpm test:mutation
export default {
  testRunner: 'vitest',
  plugins: ['@stryker-mutator/vitest-runner'],
  vitest: { configFile: 'vitest.config.ts' },
  mutate: ['src/core/**/*.ts', '!src/core/**/*.test.ts', '!src/core/__fixtures__/**'],
  reporters: ['clear-text', 'progress', 'html'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  coverageAnalysis: 'perTest',
  incremental: true,
  incrementalFile: 'reports/mutation/stryker-incremental.json',
  // Sem `break` por enquanto: a primeira medição define o piso (próximo passo da #242).
  thresholds: { high: 80, low: 60, break: null },
  tempDirName: '.stryker-tmp',
};
