// Verifica o orçamento de performance do build (performance-budget.json).
// Uso: pnpm build && pnpm budget
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const root = path.resolve(import.meta.dirname, '..');
const assetsDir = path.join(root, 'dist', 'assets');
const { rules } = JSON.parse(fs.readFileSync(path.join(root, 'performance-budget.json'), 'utf8'));

if (!fs.existsSync(assetsDir)) {
  console.error('dist/assets não existe — rode `pnpm build` antes.');
  process.exit(1);
}

const files = fs
  .readdirSync(assetsDir)
  .filter((name) => /\.(js|css)$/.test(name))
  .map((name) => ({ name, kb: zlib.gzipSync(fs.readFileSync(path.join(assetsDir, name))).length / 1024 }));

let failed = false;
for (const rule of rules) {
  const match = new RegExp(rule.match);
  const exclude = rule.exclude ? new RegExp(rule.exclude) : null;
  const hits = files.filter((f) => match.test(f.name) && !(exclude && exclude.test(f.name)));
  const checks = rule.aggregate
    ? [{ label: `${hits.length} arquivo(s)`, kb: hits.reduce((sum, f) => sum + f.kb, 0) }]
    : hits.map((f) => ({ label: f.name, kb: f.kb }));
  for (const check of checks) {
    const ok = check.kb <= rule.maxKbGzip;
    if (!ok) failed = true;
    console.log(`${ok ? '✓' : '✗'} ${rule.name}: ${check.label} = ${check.kb.toFixed(1)} KB / ${rule.maxKbGzip} KB`);
  }
}

if (failed) {
  console.error('\nOrçamento de performance estourado. Use lazy loading, remova dependências ou justifique o novo limite no PR.');
  process.exit(1);
}
