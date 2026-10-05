// node --test desktop/shell  (roda também pela suíte Python: server/tests/test_desktop_shell.py)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { rotate, isOdessaUp, isPortInUse, nextRestart } = require('./backend-utils');

test('rotação de log guarda cinco cópias e a mais nova vira .1', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odessa-log-'));
  const log = path.join(dir, 'odessa.log');
  for (let i = 1; i <= 7; i++) {
    fs.writeFileSync(log, `rodada-${i}` + 'x'.repeat(200));
    rotate(log, 100, 5);
  }
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['odessa.log.1', 'odessa.log.2', 'odessa.log.3', 'odessa.log.4', 'odessa.log.5']);
  assert.match(fs.readFileSync(`${log}.1`, 'utf8'), /^rodada-7/);
});

test('log pequeno não é rotacionado', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odessa-log-'));
  const log = path.join(dir, 'odessa.log');
  fs.writeFileSync(log, 'curto');
  rotate(log, 1000, 5);
  assert.deepStrictEqual(fs.readdirSync(dir), ['odessa.log']);
});

test('porta ocupada e porta livre', async () => {
  const server = net.createServer().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const { port } = server.address();
  assert.strictEqual(await isPortInUse(port), true);
  await new Promise((r) => server.close(r));
  assert.strictEqual(await isPortInUse(port), false);
});

for (const [body, expected] of [
  ['{"status":"ok","service":"odessa-api"}', true],
  ['{"status":"ok","service":"outro-programa"}', false],
  ['<html>OK</html>', false],
]) {
  test(`assinatura do servidor: ${body} → ${expected}`, async () => {
    const server = http.createServer((_req, res) => res.end(body)).listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    try {
      assert.strictEqual(await isOdessaUp(`http://127.0.0.1:${server.address().port}/health`), expected);
    } finally {
      server.close();
    }
  });
}

test('supervisor: espera crescente e desiste na 5ª queda em 2 minutos', () => {
  const crashes = [];
  const t0 = 1_000_000;
  assert.deepStrictEqual(nextRestart(crashes, t0), { restart: true, delayMs: 2000 });
  assert.deepStrictEqual(nextRestart(crashes, t0 + 1000), { restart: true, delayMs: 4000 });
  nextRestart(crashes, t0 + 2000);
  nextRestart(crashes, t0 + 3000);
  assert.strictEqual(nextRestart(crashes, t0 + 4000).restart, false);
  // Quedas antigas (mais de 2 min) não contam.
  const spaced = [];
  for (let i = 0; i < 6; i++) assert.strictEqual(nextRestart(spaced, t0 + i * 200_000).restart, true);
});
