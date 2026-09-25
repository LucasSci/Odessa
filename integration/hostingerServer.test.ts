// @vitest-environment node
// Teste de integração do servidor de produção (hostinger-server.mjs): sobe o
// processo de verdade numa porta livre e verifica o rate limit na borda da API.
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let server: ChildProcess;
let baseUrl = '';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

async function waitForHealth(url: string, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${url}/healthz`)).ok) return;
    } catch {
      /* ainda subindo */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('hostinger-server.mjs não respondeu /healthz a tempo');
}

function login(ip: string) {
  return fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify({ email: 'x@y.z', password: 'errada' }),
  });
}

beforeAll(async () => {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [path.resolve(__dirname, '..', 'hostinger-server.mjs')], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      ODESSA_SESSION_SECRET: 'segredo-so-para-teste',
      ODESSA_RATE_LIMIT_LOGIN_PER_MIN: '3',
      ODESSA_RATE_LIMIT_API_PER_MIN: '5',
    },
    stdio: 'ignore',
  });
  await waitForHealth(baseUrl);
}, 20_000);

afterAll(() => {
  server?.kill();
});

describe('hostinger-server.mjs — rate limit', () => {
  it('bloqueia força bruta no login com 429 e Retry-After', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) statuses.push((await login('203.0.113.10')).status);
    expect(statuses.slice(0, 3)).not.toContain(429);
    expect(statuses[3]).toBe(429);

    const blocked = await login('203.0.113.10');
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('conta cada IP separadamente (último hop do X-Forwarded-For)', async () => {
    expect((await login('203.0.113.99')).status).not.toBe(429);
    // Cliente tentando se passar por outro IP: o proxy acrescenta o IP real ao final.
    expect((await login('198.51.100.1, 203.0.113.10')).status).toBe(429);
  });

  it('responde (não fica pendurado) em rotas da API', async () => {
    const response = await fetch(`${baseUrl}/api/health`, { headers: { 'X-Forwarded-For': '203.0.113.30' } });
    expect(response.status).toBeLessThan(600);
  });

  it('limita o restante da API e não afeta /healthz', async () => {
    const ip = '203.0.113.20';
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      statuses.push((await fetch(`${baseUrl}/api/health`, { headers: { 'X-Forwarded-For': ip } })).status);
    }
    expect(statuses[5]).toBe(429);
    expect((await fetch(`${baseUrl}/healthz`)).status).toBe(200);
  });
});
