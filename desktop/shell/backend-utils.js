/**
 * Peças do programa que não dependem do Electron (testadas em
 * backend-utils.test.js): rotação de log, porta ocupada, assinatura do
 * servidor e a regra do supervisor de quedas.
 */
const fs = require('fs');
const http = require('http');
const net = require('net');

/** Log acima de `maxBytes` vira .1 (o .1 vira .2 …), guardando `keep` cópias. */
function rotate(file, maxBytes = 5 * 1024 * 1024, keep = 5) {
  try {
    if (!fs.existsSync(file) || fs.statSync(file).size < maxBytes) return;
    if (fs.existsSync(`${file}.${keep}`)) fs.unlinkSync(`${file}.${keep}`);
    for (let i = keep - 1; i >= 1; i--) {
      if (fs.existsSync(`${file}.${i}`)) fs.renameSync(`${file}.${i}`, `${file}.${i + 1}`);
    }
    fs.renameSync(file, `${file}.1`);
  } catch { /* log não pode derrubar o programa */ }
}

function getJson(url, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try { resolve(res.statusCode === 200 ? JSON.parse(body) : null); } catch { resolve(null); }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

function postJson(url, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const req = http.request(url, { method: 'POST', timeout: timeoutMs, headers: { 'Content-Length': 0 } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode === 200));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
    req.end();
  });
}

/** /health com {"service":"odessa-api"} é a assinatura do nosso servidor (outro programa na porta não conta). */
async function isOdessaUp(healthUrl) {
  const body = await getJson(healthUrl);
  return Boolean(body && body.service === 'odessa-api');
}

function isPortInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.setTimeout(800);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => resolve(false));
  });
}

/**
 * Supervisor: registra a queda em `crashes` (lista de timestamps, mutada) e
 * diz se reinicia e após quanto tempo. 5 quedas em 2 min = desiste.
 */
function nextRestart(crashes, now) {
  crashes.push(now);
  while (crashes.length && now - crashes[0] > 120_000) crashes.shift();
  if (crashes.length >= 5) return { restart: false, delayMs: 0 };
  return { restart: true, delayMs: Math.min(30_000, 2 ** crashes.length * 1000) };
}

module.exports = { rotate, getJson, postJson, isOdessaUp, isPortInUse, nextRestart };
