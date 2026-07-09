import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chatVisualTarget } from './__fixtures__/liveSimulationFixtures';

const adminPassword = 'test-admin-password';
const agentToken = 'test-agent-token';

type ApiResponse = {
  statusCode: number;
  headers: Record<string, string | string[]>;
  body: Record<string, unknown>;
};

let handler: (req: EventEmitter & Record<string, any>, res: Record<string, any>) => Promise<void>;
let sessionToken = '';

function cloudStore() {
  return globalThis as typeof globalThis & {
    __ODESSA_CLOUD_STORE: {
      agentStatus: unknown;
      commandQueue: unknown[];
      commandRecords: Record<string, unknown>;
      events: unknown[];
      pendingTriggerQueue: unknown[];
    };
  };
}

function makeReq(path: string, method: string, body?: unknown, headers: Record<string, string> = {}) {
  const req = new EventEmitter() as EventEmitter & Record<string, any>;
  req.method = method;
  req.query = { path: path.split('/').filter(Boolean) };
  req.headers = headers;
  req.destroy = () => undefined;
  process.nextTick(() => {
    if (body !== undefined) req.emit('data', JSON.stringify(body));
    req.emit('end');
  });
  return req;
}

async function callApi(
  path: string,
  method: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<ApiResponse> {
  const responseHeaders: Record<string, string | string[]> = {};
  const chunks: string[] = [];
  const res = {
    statusCode: 200,
    setHeader(key: string, value: string | string[]) {
      responseHeaders[key] = value;
    },
    end(value: string) {
      chunks.push(value);
    },
  };
  await handler(makeReq(path, method, body, headers), res);
  return {
    statusCode: res.statusCode,
    headers: responseHeaders,
    body: JSON.parse(chunks.join('') || '{}'),
  };
}

async function authed(
  path: string,
  method: string,
  body?: unknown,
): Promise<ApiResponse> {
  return callApi(path, method, body, { authorization: `Bearer ${sessionToken}` });
}

describe('chat automation cloud API simulation', () => {
  beforeAll(async () => {
    process.env.ODESSA_ADMIN_PASSWORD_HASH = crypto
      .createHash('sha256')
      .update(adminPassword)
      .digest('hex');
    process.env.ODESSA_AGENT_TOKEN = agentToken;
    process.env.ODESSA_COOKIE_SECURE = 'false';
    cloudStore().__ODESSA_CLOUD_STORE = {
      agentStatus: null,
      commandQueue: [],
      commandRecords: {},
      events: [],
      pendingTriggerQueue: [],
    };
    handler = (await import('../../api/[...path].js')).default;
  });

  beforeEach(async () => {
    cloudStore().__ODESSA_CLOUD_STORE.agentStatus = null;
    cloudStore().__ODESSA_CLOUD_STORE.commandQueue = [];
    cloudStore().__ODESSA_CLOUD_STORE.commandRecords = {};
    cloudStore().__ODESSA_CLOUD_STORE.events = [];
    const login = await callApi('/auth/login', 'POST', {
      email: 'lucasbatista.c.l@gmail.com',
      password: adminPassword,
    });
    expect(login.statusCode).toBe(200);
    sessionToken = String(login.body.sessionToken);
    await authed('/chat-automation/config', 'POST', {
      allowlist: [
        {
          id: 'visual-test',
          label: 'Chat visual fake',
          mode: 'visual',
          domain: 'visual:tango-live',
          inputPoint: chatVisualTarget.inputPoint,
          sendPoint: chatVisualTarget.sendPoint,
          viewport: chatVisualTarget.viewport,
          enabled: true,
        },
      ],
    });
  });

  it('validates and logs dry-run visual chat without Tango', async () => {
    const response = await authed('/chat-automation/send', 'POST', {
      mode: 'visual',
      url: chatVisualTarget.url,
      text: 'Oi chat fake!',
      inputPoint: chatVisualTarget.inputPoint,
      sendPoint: chatVisualTarget.sendPoint,
      viewport: chatVisualTarget.viewport,
      dryRun: true,
      submit: true,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      status: 'dry_run',
      allowed: true,
      wouldClick: true,
      wouldType: true,
      wouldSend: false,
    });
    expect(response.body.plannedInputPixel).toEqual({ x: 230, y: 950 });

    const config = await authed('/chat-automation/config', 'GET');
    expect(config.body.logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: 'Oi chat fake!',
          result: expect.objectContaining({ status: 'dry_run' }),
        }),
      ]),
    );
  });

  it('queues real visual chat for the local agent and exposes chat.send_visual', async () => {
    const response = await authed('/chat-automation/send', 'POST', {
      mode: 'visual',
      url: chatVisualTarget.url,
      text: 'Mensagem real local fake',
      inputPoint: chatVisualTarget.inputPoint,
      sendPoint: chatVisualTarget.sendPoint,
      viewport: chatVisualTarget.viewport,
      dryRun: false,
      submit: true,
    });

    expect(response.body).toMatchObject({
      status: 'queued',
      allowed: true,
      queued: true,
      executionMode: 'cloud-agent',
      reason: 'queued_for_local_agent',
    });
    const commandId = String(response.body.commandId);

    const next = await callApi('/agent/commands/next', 'GET', undefined, {
      'x-odessa-agent-token': agentToken,
    });
    expect(next.statusCode).toBe(200);
    expect(next.body.command).toMatchObject({
      id: commandId,
      type: 'chat.send_visual',
      payload: expect.objectContaining({
        text: 'Mensagem real local fake',
        plannedInputPixel: { x: 230, y: 950 },
        plannedSendPixel: { x: 1805, y: 950 },
      }),
    });

    const event = await callApi(
      '/agent/events',
      'POST',
      {
        type: 'command.completed',
        commandId,
        command: { id: commandId, type: 'chat.send_visual' },
        result: {
          ok: true,
          status: 'executed',
          result: { executed: true },
        },
      },
      { 'x-odessa-agent-token': agentToken },
    );
    expect(event.statusCode).toBe(202);

    const config = await authed('/chat-automation/config', 'GET');
    expect(JSON.stringify(config.body.logs)).toContain('executed');
  });

  it('blocks non-allowlisted visual coordinates', async () => {
    const response = await authed('/chat-automation/send', 'POST', {
      mode: 'visual',
      url: chatVisualTarget.url,
      text: 'Sem alvo valido',
      inputPoint: { x: 1.5, y: 0.5 },
      viewport: chatVisualTarget.viewport,
      dryRun: true,
    });

    expect(response.body).toMatchObject({
      status: 'blocked',
      allowed: false,
      reason: 'not_allowlisted',
    });
  });
});
