import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = [
  '--run',
  'src/core/liveSimulation.test.ts',
  'src/core/chatAutomationApi.test.ts',
];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vitestBin = path.join(
  root,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'vitest.cmd' : 'vitest',
);

console.log('[Odessa] Simulacao E2E sem Tango/OBS/OCR real');
console.log('[Odessa] Caminho: OCR fake -> evento -> decisao -> governador -> fila -> executor -> cloud-agent');

const result = spawnSync(vitestBin, args, {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (result.error) {
  console.error('[Odessa] Falha ao iniciar Vitest:', result.error.message);
}
process.exit(result.status ?? 1);
