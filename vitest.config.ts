import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [],
    // integration/: sobe processos reais (ex.: hostinger-server.mjs).
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'integration/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json', 'html', 'lcov'],
      include: ['src/core/**/*.ts', 'src/lib/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
      // Catraca: piso = cobertura medida em 2026-09 (~40%). Só sobe — nunca
      // baixe estes números. A meta para código novo (70%) é cobrada pelo
      // Codecov no diff do PR (codecov.yml → coverage.status.patch).
      thresholds: {
        lines: 40,
        functions: 38,
        branches: 36,
        statements: 38,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
