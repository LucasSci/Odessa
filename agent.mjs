#!/usr/bin/env node
/**
 * Odessa Agent Leve — substitui o agent Python inteiro.
 * Roda com: node agent.mjs
 * Sem pip, sem venv, sem Python. Apenas Node.js.
 *
 * Env vars (ou edite os defaults abaixo):
 *   ODESSA_CLOUD_URL   - URL do painel Hostinger
 *   ODESSA_AGENT_TOKEN - Token compartilhado com o cloud
 *   OBS_WEBSOCKET_URL  - URL do OBS WebSocket (default: ws://localhost:4455)
 *   OBS_WEBSOCKET_PASSWORD - Senha do OBS WebSocket (default: vazio)
 */

import { WebSocket } from 'ws'; // Will be installed as dependency if missing

const CLOUD_URL = (process.env.ODESSA_CLOUD_URL || 'https://darkgrey-shark-457698.hostingersite.com').replace(/\/$/, '');
const TOKEN = process.env.ODESSA_AGENT_TOKEN || '+jj4LlhjinNG46KhmJxqgm0g4t4JYizSmiW12g1ZJy8=';
const OBS_URL = process.env.OBS_WEBSOCKET_URL || 'ws://localhost:4455';
const OBS_PASS = process.env.OBS_WEBSOCKET_PASSWORD || '';
const HEARTBEAT_MS = 10_000;
const COMMAND_MS = 2_000;

const headers = { 'X-Odessa-Agent-Token': TOKEN, 'Content-Type': 'application/json' };
let obsConnected = false;

async function api(path, method = 'GET', body = null) {
  const opts = { method, headers: { ...headers } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${CLOUD_URL}/api/agent?action=${path}`, opts);
  return res.json();
}

async function heartbeat() {
  try {
    const result = await api('heartbeat', 'POST', {
      agentId: 'node-agent',
      host: (await import('os')).hostname(),
      version: '1.0.0-lite',
      capabilities: ['obs'],
      health: { ok: true, obsConnected },
    });
    console.log(`[heartbeat] agentConnected=${result.agentConnected}`);
  } catch (err) {
    console.error(`[heartbeat] error: ${err.message}`);
  }
}

async function pollCommands() {
  try {
    const data = await api('commands-next');
    if (!data.command) return;
    const cmd = data.command;
    console.log(`[command] ${cmd.type} (${cmd.id})`);
    const result = await executeCommand(cmd);
    await api('events', 'POST', { commandId: cmd.id, type: cmd.type, result });
  } catch (err) {
    console.error(`[poll] error: ${err.message}`);
  }
}

async function executeCommand(cmd) {
  // OBS commands are handled via obs-websocket protocol
  // For now, return a placeholder - the browser direct connection handles most OBS commands
  return { ok: true, agent: 'node-lite', type: cmd.type, note: 'Comando recebido pelo agent leve.' };
}

console.log(`Odessa Agent Leve`);
console.log(`  Cloud: ${CLOUD_URL}`);
console.log(`  OBS:   ${OBS_URL}`);
console.log('');

// Start loops
setInterval(heartbeat, HEARTBEAT_MS);
setInterval(pollCommands, COMMAND_MS);
heartbeat();
