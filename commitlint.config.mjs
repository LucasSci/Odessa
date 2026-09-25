// Conventional Commits, com descrição livre em português.
//   feat:     Nova função          fix:  Correção
//   refactor/perf/style/docs/test/build/ci/chore: Melhoria
// Exemplo: "fix(live): cancelar resposta pendente ao encerrar a live (#123)"
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Descrições em português costumam começar com maiúscula ou nome próprio.
    'subject-case': [0],
    'header-max-length': [2, 'always', 100],
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
  },
};
