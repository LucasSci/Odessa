export type DepsIssueAction =
  | { kind: 'link'; label: string; url: string }
  | { kind: 'post'; label: string; path: string };

export interface DepsIssue {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  action: DepsIssueAction | null;
}

export interface DepsReport {
  ok: boolean;
  issues: DepsIssue[];
}

/** Aceita só o formato esperado do /health/deps; qualquer outra coisa vira null. */
export function parseDepsReport(raw: unknown): DepsReport | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as { ok?: unknown; issues?: unknown };
  if (!Array.isArray(data.issues)) return null;
  const issues: DepsIssue[] = [];
  for (const item of data.issues) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    if (typeof entry.code !== 'string' || typeof entry.message !== 'string') continue;
    const severity = entry.severity === 'error' ? 'error' : 'warning';
    issues.push({ code: entry.code, severity, message: entry.message, action: parseAction(entry.action) });
  }
  return { ok: data.ok === true, issues };
}

function parseAction(raw: unknown): DepsIssueAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const action = raw as Record<string, unknown>;
  if (typeof action.label !== 'string') return null;
  if (action.kind === 'link' && typeof action.url === 'string' && /^https:\/\//.test(action.url)) {
    return { kind: 'link', label: action.label, url: action.url };
  }
  if (action.kind === 'post' && typeof action.path === 'string' && action.path.startsWith('/')) {
    return { kind: 'post', label: action.label, path: action.path };
  }
  return null;
}

/** O problema mais grave que o operador ainda não dispensou (erros antes de avisos). */
export function pickIssueToShow(report: DepsReport | null, dismissed: ReadonlySet<string>): DepsIssue | null {
  if (!report) return null;
  const visible = report.issues.filter((issue) => !dismissed.has(issue.code));
  return visible.find((issue) => issue.severity === 'error') ?? visible[0] ?? null;
}
