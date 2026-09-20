import { describe, expect, it } from 'vitest';
import { parseDepsReport, pickIssueToShow } from './depsHealth';

const model = {
  code: 'ollama_model_missing',
  severity: 'error',
  message: 'Modelo não baixado',
  action: { kind: 'post', label: 'Baixar qwen2.5:latest', path: '/ai/ollama/connect' },
};

describe('depsHealth', () => {
  it('interpreta o relatório do backend', () => {
    const report = parseDepsReport({ ok: false, issues: [model] });
    expect(report?.issues[0].action).toEqual({ kind: 'post', label: 'Baixar qwen2.5:latest', path: '/ai/ollama/connect' });
  });

  it('rejeita formatos inesperados', () => {
    expect(parseDepsReport(null)).toBeNull();
    expect(parseDepsReport({ ok: true })).toBeNull();
    expect(parseDepsReport({ ok: true, issues: [{ code: 1 }] })?.issues).toEqual([]);
  });

  it('descarta ações perigosas (link não-https, caminho sem barra)', () => {
    const report = parseDepsReport({
      ok: false,
      issues: [
        { code: 'a', severity: 'error', message: 'x', action: { kind: 'link', label: 'l', url: 'javascript:alert(1)' } },
        { code: 'b', severity: 'error', message: 'x', action: { kind: 'post', label: 'l', path: 'https://evil.example/x' } },
      ],
    });
    expect(report?.issues.map((issue) => issue.action)).toEqual([null, null]);
  });

  it('mostra o erro antes do aviso e respeita o que foi dispensado', () => {
    const warning = { ...model, code: 'w', severity: 'warning' };
    const report = parseDepsReport({ ok: false, issues: [warning, model] });
    expect(pickIssueToShow(report, new Set())?.code).toBe('ollama_model_missing');
    expect(pickIssueToShow(report, new Set(['ollama_model_missing']))?.code).toBe('w');
    expect(pickIssueToShow(report, new Set(['ollama_model_missing', 'w']))).toBeNull();
    expect(pickIssueToShow(null, new Set())).toBeNull();
  });
});
