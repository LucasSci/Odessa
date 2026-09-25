import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // .claude/worktrees: cópias completas do repo (incluindo o próprio
    // tsconfig.json) usadas por sessões do Claude Code — sem isso, o
    // typescript-eslint encontra dois tsconfig.json candidatos (o daqui e o
    // de dentro do worktree) e recusa rodar as regras type-aware em TODO
    // arquivo com "No tsconfigRootDir was set, and multiple candidate
    // TSConfigRootDirs are present", mascarando os erros reais do lint.
    // desktop/build: runtime Python embutido + stage do instalador —
    // inclui o driver do Playwright (bundle Node de terceiros com seus
    // próprios .d.ts), nunca deveria ser varrido pelo lint do projeto.
    ignores: ['dist', 'dist-electron', 'venv', '.claude/worktrees/**', 'desktop/build/**', 'coverage', 'reports', 'playwright-report', 'test-results', '.stryker-tmp'],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Funções serverless da Hostinger: só são invocadas se forem arquivos
    // autocontidos em api/ (ver CLAUDE.md → "API routing gotcha"). Importar
    // código do app (src/) ou do backend Python/Node (server/) quebra em
    // produção sem nenhum erro no build — por isso a regra é de lint.
    files: ['api/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: globals.node },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/src/**', '**/server/**', '@/*'],
              message: 'api/ precisa ser autocontido: copie a lógica para o handler em vez de importar do app.',
            },
          ],
        },
      ],
    },
  },
);
