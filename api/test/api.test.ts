import { beforeEach, describe, expect, it } from 'vitest';
import type {
  AgentDetailResponse,
  AgentsResponse,
  CreateKeyResponse,
  HeartbeatResponse,
  LogsQueryResponse,
  ReportResponse,
} from '@agent-manager/shared';
import { unfinishedReason } from '@agent-manager/shared';
import { resetAuthState } from '../src/auth';
import { heartbeat, postLogs, report } from '../src/handlers/ingest';
import { createKey, listKeys, revokeKey } from '../src/handlers/keys';
import { agent, agents, getLogs, me } from '../src/handlers/read';
import { guarded, type Ctx, type Handler, type Req } from '../src/http';
import { MemoryStore } from '../src/store/memory';

let clock: Date;
let ctx: Ctx;

function principal(login: string) {
  return Buffer.from(JSON.stringify({ identityProvider: 'aad', userDetails: login })).toString('base64');
}

function call(handler: Handler, method: string, path: string, opts: { body?: unknown; key?: string; owner?: string } = {}) {
  const headers = new Headers({ host: 'manager.test', 'x-forwarded-proto': 'https' });
  if (opts.key) headers.set('x-agent-manager-key', opts.key);
  if (opts.owner) headers.set('x-ms-client-principal', principal(opts.owner));
  const req: Req = {
    method,
    url: `https://manager.test${path}`,
    headers,
    body: opts.body === undefined ? '' : typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body),
  };
  return guarded(handler, () => {})(req, ctx);
}

const OWNER = 'owner@example.com';
const asOwner = { owner: OWNER };

async function makeKey(name = 'pc-studio') {
  const res = await call(createKey, 'POST', '/api/v1/keys', { ...asOwner, body: { name } });
  expect(res.status).toBe(201);
  return (res.body as CreateKeyResponse).secret;
}

function tick(seconds: number) {
  clock = new Date(clock.getTime() + seconds * 1000);
}

beforeEach(() => {
  resetAuthState();
  clock = new Date('2026-10-10T12:00:00Z');
  ctx = { store: new MemoryStore(), now: () => clock, env: { OWNER_LOGINS: OWNER } };
});

describe('owner sign-in', () => {
  it('needs a sign-in', async () => {
    expect(await call(me, 'GET', '/api/v1/me')).toEqual({ status: 401, body: { error: 'Sign in to use Agent Manager' } });
  });
  it('turns away other accounts', async () => {
    const res = await call(me, 'GET', '/api/v1/me', { owner: 'someone@else.com' });
    expect(res).toEqual({ status: 403, body: { error: "Signed in as someone@else.com, which isn't the owner account" } });
  });
  it('lets the owner in, ignoring case', async () => {
    const res = await call(me, 'GET', '/api/v1/me', { owner: 'Owner@Example.com' });
    expect(res).toEqual({ status: 200, body: { login: 'Owner@Example.com', provider: 'aad' } });
  });
  it('ignores DEV_OWNER in Azure', async () => {
    ctx.env = { ...ctx.env, DEV_OWNER: 'dev', WEBSITE_INSTANCE_ID: 'x' };
    expect((await call(me, 'GET', '/api/v1/me')).status).toBe(401);
  });
});

describe('machine keys', () => {
  it('rejects a missing, malformed or unknown key', async () => {
    const body = { agentId: 'a', kind: 'other', machine: 'pc' };
    expect((await call(report, 'POST', '/api/v1/report', { body })).status).toBe(401);
    expect((await call(report, 'POST', '/api/v1/report', { body, key: 'nope' })).body).toEqual({
      error: 'That is not an Agent Manager key; keys look like am_<id>_<secret>',
    });
    const fake = 'am_abcdefghij_' + 'A'.repeat(43);
    expect((await call(report, 'POST', '/api/v1/report', { body, key: fake })).body).toEqual({
      error: 'Unknown machine key; make one on the Settings tab',
    });
  });

  it('stops working once revoked', async () => {
    const key = await makeKey();
    const id = key.split('_')[1];
    await call(revokeKey, 'POST', '/api/v1/keys/revoke', { ...asOwner, body: { id } });
    const res = await call(report, 'POST', '/api/v1/report', { key, body: { agentId: 'a', kind: 'other', machine: 'pc' } });
    expect(res).toEqual({ status: 401, body: { error: 'This key was revoked on 2026-10-10; make a new one on the Settings tab' } });
  });

  it('never returns the hash, and refuses duplicate names', async () => {
    await makeKey('pc-1');
    const list = await call(listKeys, 'GET', '/api/v1/keys', asOwner);
    expect(JSON.stringify(list.body)).not.toContain('hash');
    const dup = await call(createKey, 'POST', '/api/v1/keys', { ...asOwner, body: { name: 'PC-1' } });
    expect(dup.status).toBe(409);
  });

  it('limits each key to 10 calls a second after a burst', async () => {
    const key = await makeKey();
    const body = { agentId: 'a', kind: 'other', machine: 'pc' };
    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) statuses.push((await call(report, 'POST', '/api/v1/report', { key, body })).status);
    expect(statuses.filter((s) => s === 429).length).toBe(5);
  });
});

describe('reports', () => {
  let key: string;
  beforeEach(async () => {
    key = await makeKey();
  });

  const send = (body: Record<string, unknown>) =>
    call(report, 'POST', '/api/v1/report', { key, body: { agentId: 'pc/claude/s1', kind: 'claude-code', machine: 'pc', ...body } });

  it('creates an agent and links to its page', async () => {
    const res = await send({ name: 'musik-4a', state: 'working', activity: 'Building' });
    expect(res.status).toBe(200);
    const body = res.body as ReportResponse;
    expect(body.agentUrl).toBe('https://manager.test/agents/detail?id=pc%2Fclaude%2Fs1');
    expect(body.stored).toMatchObject({ name: 'musik-4a', state: 'working', activity: 'Building', keyName: 'pc-studio' });
  });

  it('stores nothing for a test call', async () => {
    const res = await send({ test: true });
    expect((res.body as ReportResponse).test).toBe(true);
    expect(await ctx.store.getAgent('pc/claude/s1')).toBeNull();
  });

  it('keeps newer state when an older report arrives late', async () => {
    await send({ state: 'idle', activity: 'Finished', at: '2026-10-10T12:00:05Z' });
    await send({ state: 'working', activity: 'Running tests', at: '2026-10-10T12:00:01Z' });
    const stored = await ctx.store.getAgent('pc/claude/s1');
    expect(stored).toMatchObject({ state: 'idle', activity: 'Finished' });
    expect(await ctx.store.listEvents('pc/claude/s1', 10)).toHaveLength(2);
  });

  it('merges details and keeps fields a report leaves out', async () => {
    await send({ name: 'first', project: 'musik', details: { model: 'opus' } });
    await send({ details: { branch: 'main' } });
    expect(await ctx.store.getAgent('pc/claude/s1')).toMatchObject({
      name: 'first',
      project: 'musik',
      details: { model: 'opus', branch: 'main' },
    });
  });

  it('stores story, task and prompt, masking secrets', async () => {
    const res = await send({ story: 'AM-7: Export', task: 'Writing the CSV', prompt: 'use token=abcdef123456 please', turn: 'start', at: '2026-10-10T12:00:00Z' });
    expect((res.body as ReportResponse).stored).toMatchObject({
      story: 'AM-7: Export',
      task: 'Writing the CSV',
      prompt: 'use token=[masked] please',
      promptAt: '2026-10-10T12:00:00.000Z',
      turn: { outcome: 'running', prompt: 'use token=[masked] please' },
    });
    await send({ task: 'Next step' });
    expect(await ctx.store.getAgent('pc/claude/s1')).toMatchObject({ story: 'AM-7: Export', task: 'Next step' });
  });

  it('ends turns: finished, failed, cut off by a new prompt, or closed mid-request', async () => {
    await send({ state: 'working', prompt: 'one', turn: 'start' });
    await send({ state: 'idle', turn: 'end' });
    expect((await ctx.store.getAgent('pc/claude/s1'))?.turn).toMatchObject({ outcome: 'finished', prompt: 'one' });

    await send({ state: 'working', prompt: 'two', turn: 'start' });
    await send({ state: 'working', prompt: 'three', turn: 'start' });
    const events = await ctx.store.listEvents('pc/claude/s1', 20);
    expect(events.find((e) => e.type === 'turn' && e.turn?.prompt === 'two')?.turn).toMatchObject({
      outcome: 'interrupted',
      reason: 'A new prompt came before it finished',
    });

    await send({ state: 'idle', activity: 'Waiting for your next prompt' });
    expect((await ctx.store.getAgent('pc/claude/s1'))?.turn).toMatchObject({ outcome: 'interrupted', prompt: 'three', reason: 'Stopped before it finished' });

    await send({ state: 'working', prompt: 'again', turn: 'start' });
    await send({ state: 'failed', activity: 'Stopped by an API error (overloaded)' });
    expect((await ctx.store.getAgent('pc/claude/s1'))?.turn).toMatchObject({ outcome: 'failed', reason: 'Stopped by an API error (overloaded)' });

    await send({ state: 'working', prompt: 'four', turn: 'start' });
    const hb = await call(heartbeat, 'POST', '/api/v1/heartbeat', { key, body: { machine: 'pc', kind: 'claude-code', agentIds: [] } });
    expect(hb.status).toBe(200);
    expect((await ctx.store.getAgent('pc/claude/s1'))?.turn).toMatchObject({ outcome: 'interrupted', reason: 'Closed mid-request' });
  });

  it('shows a request still running on a lost agent as cut off', async () => {
    await send({ state: 'working', prompt: 'go', turn: 'start' });
    tick(181);
    const list = (await call(agents, 'GET', '/api/v1/agents', asOwner)).body as AgentsResponse;
    expect(unfinishedReason(list.agents[0]!)).toBe('Connection lost mid-request');
  });

  it('stores a report of finished work with the prompt it answers', async () => {
    await send({ state: 'working', prompt: 'Group the rows', turn: 'start' });
    const res = await send({
      state: 'idle',
      turn: 'end',
      result: { title: 'Group sessions', summary: '- One row per project', checks: ['Open Agents'], commitUrl: 'https://github.com/o/r/commit/abc', pushed: true },
    });
    expect(res.status).toBe(200);
    expect((res.body as ReportResponse).stored.result).toMatchObject({
      title: 'Group sessions',
      prompt: 'Group the rows',
      checks: ['Open Agents'],
      commit: null,
      pushed: true,
    });
    const bad = await send({ result: { title: 'x', summary: 'y', commitUrl: 'javascript:alert(1)' } });
    expect(bad.status).toBe(400);
  });

  it('answers bad bodies with one line', async () => {
    expect((await call(report, 'POST', '/api/v1/report', { key, body: '{oops' })).status).toBe(400);
    const big = await send({ activity: 'x', details: { blob: 'y'.repeat(70_000) } });
    expect(big.status).toBe(413);
  });

  it('shows agents as lost after silence, and counts running sub-agents', async () => {
    await send({ state: 'working' });
    await call(report, 'POST', '/api/v1/report', {
      key,
      body: { agentId: 'pc/claude/s1/sub', kind: 'claude-code', machine: 'pc', parentId: 'pc/claude/s1', state: 'working' },
    });
    let list = (await call(agents, 'GET', '/api/v1/agents', asOwner)).body as AgentsResponse;
    expect(list.agents.find((a) => a.id === 'pc/claude/s1')).toMatchObject({ effectiveState: 'working', runningChildren: 1 });

    tick(181);
    list = (await call(agents, 'GET', '/api/v1/agents', asOwner)).body as AgentsResponse;
    expect(list.agents.map((a) => a.effectiveState)).toEqual(['lost', 'lost']);

    const detail = (await call(agent, 'GET', '/api/v1/agent?id=pc%2Fclaude%2Fs1', asOwner)).body as AgentDetailResponse;
    expect(detail.children.map((c) => c.id)).toEqual(['pc/claude/s1/sub']);
    expect(detail.events).toHaveLength(1);
  });
});

describe('heartbeats', () => {
  it('keeps listed agents alive, stops the rest, and names unknown ids', async () => {
    const key = await makeKey();
    for (const id of ['a', 'b']) {
      await call(report, 'POST', '/api/v1/report', { key, body: { agentId: id, kind: 'claude-code', machine: 'pc', state: 'idle' } });
    }
    await call(report, 'POST', '/api/v1/report', { key, body: { agentId: 'claw', kind: 'openclaw', machine: 'pc', state: 'idle' } });

    tick(170);
    const res = await call(heartbeat, 'POST', '/api/v1/heartbeat', {
      key,
      body: { machine: 'pc', kind: 'claude-code', agentIds: ['a', 'new'] },
    });
    expect((res.body as HeartbeatResponse).stored).toEqual({ alive: 1, stopped: ['b'], unknown: ['new'] });

    tick(60);
    const list = (await call(agents, 'GET', '/api/v1/agents', asOwner)).body as AgentsResponse;
    const states = Object.fromEntries(list.agents.map((a) => [a.id, a.effectiveState]));
    // "a" was refreshed, "b" stopped, and the OpenClaw agent (another kind) was left alone.
    expect(states).toEqual({ a: 'idle', b: 'stopped', claw: 'lost' });
  });
});

describe('logs', () => {
  it('masks secrets, filters and reports truncation', async () => {
    const key = await makeKey();
    const entries = [
      { level: 'error', source: 'gma-web', message: 'Timed out', correlationId: 'req-1', at: '2026-10-10T11:00:00Z' },
      { level: 'error', source: 'gma-web', message: 'Bad token: Bearer abcdef123456', correlationId: 'req-1', at: '2026-10-10T11:00:01Z' },
      { level: 'info', source: 'gma-web', message: 'Started', at: '2026-10-10T10:00:00Z' },
    ];
    const posted = await call(postLogs, 'POST', '/api/v1/logs', { key, body: { entries } });
    expect(posted.status).toBe(200);

    const errors = (await call(getLogs, 'GET', '/api/v1/logs?level=error&correlationId=req-1&limit=1', asOwner))
      .body as LogsQueryResponse;
    expect(errors.truncated).toBe(true);
    expect(errors.logs.map((l) => l.message)).toEqual(['Bad token: Bearer [masked]']);

    const text = (await call(getLogs, 'GET', '/api/v1/logs?q=STARTED', asOwner)).body as LogsQueryResponse;
    expect(text.logs.map((l) => l.message)).toEqual(['Started']);

    const bad = await call(getLogs, 'GET', '/api/v1/logs?level=loud', asOwner);
    expect(bad).toEqual({ status: 400, body: { error: 'level must be one or more of debug, info, warn, error' } });
  });
});

describe('Cosmos agent documents', () => {
  it('store agent ids with slashes under a safe document id and give the real id back', async () => {
    const { agentDocId, toAgentDoc, fromAgentDoc } = await import('../src/store/cosmos');
    const agent = { id: 'pc-studio/claude/4b1e/sub1', parentId: 'pc-studio/claude/4b1e' } as never;
    const doc = toAgentDoc(agent);
    expect(doc.id).toMatch(/^[0-9a-f]{64}$/);
    expect(doc.id).toBe(agentDocId('pc-studio/claude/4b1e/sub1'));
    expect(doc.agentId).toBe('pc-studio/claude/4b1e/sub1');
    expect(fromAgentDoc(doc)).toEqual(agent);
  });
});
