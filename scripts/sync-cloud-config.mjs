import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const cloudUrl = (process.env.ODESSA_CLOUD_URL || 'https://odessa-gules.vercel.app').replace(/\/$/, '');
const password = process.env.ODESSA_ADMIN_PASSWORD;
const configPath = process.env.ODESSA_PERSONA_CONFIG || path.join(root, 'server', 'data', 'persona_config.json');
const dryRun = process.argv.includes('--dry-run');

function requireEnv(name, value) {
  if (!value) {
    throw new Error(`${name} nao configurado. Defina a variavel antes de rodar este script.`);
  }
}

async function login() {
  requireEnv('ODESSA_ADMIN_PASSWORD', password);
  const response = await fetch(`${cloudUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Login cloud falhou (${response.status}): ${detail}`);
  }
  const data = await response.json();
  if (!data.sessionToken) throw new Error('Login cloud nao retornou sessionToken.');
  return data.sessionToken;
}

async function main() {
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const summary = {
    videos: Array.isArray(config.videos) ? config.videos.length : 0,
    triggers: Array.isArray(config.triggers) ? config.triggers.length : 0,
    flowNodes: Array.isArray(config.flowNodes) ? config.flowNodes.length : 0,
    flowConnections: Array.isArray(config.flowConnections) ? config.flowConnections.length : 0,
    hasDraftWorkflow: Boolean(config.draftWorkflow),
    hasPublishedWorkflow: Boolean(config.publishedWorkflow),
  };

  console.log('[odessa-cloud] Config local carregada:', summary);
  if (dryRun) {
    console.log('[odessa-cloud] Dry-run: nada foi enviado.');
    return;
  }

  const token = await login();
  const response = await fetch(`${cloudUrl}/api/v1/video/config`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ config }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Sync cloud falhou (${response.status}): ${JSON.stringify(result)}`);
  }
  console.log('[odessa-cloud] Config enviada para o Neon:', result);
}

main().catch((error) => {
  console.error('[odessa-cloud] Erro:', error.message);
  process.exitCode = 1;
});
