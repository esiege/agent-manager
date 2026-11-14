import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OWNER_WRITE_HEADER, type AlertsResponse, type AlertSubscription, type CreateKeyResponse } from '@agent-manager-delux/shared';
import { headerText, resetAlertState } from '../src/alerts';
import { resetAuthState } from '../src/auth';
import { deleteAlert, listAlerts, saveAlert, sweepAlerts, testAlert } from '../src/handlers/alerts';
import { createBlocker } from '../src/handlers/blockers';
import { heartbeat, report } from '../src/handlers/ingest';
import { createKey } from '../src/handlers/keys';
import { agents } from '../src/handlers/read';
import { guarded, type Ctx, type Handler, type Req } from '../src/http';
import { MemoryStore } from '../src/store/memory';

let clock: Date;
let ctx: Ctx;
let fetchMock: ReturnType<typeof vi.fn>;

const OWNER = 'owner@example.com';
const asOwner = { owner: OWNER };
const TOPIC = 'https://ntfy.sh/am-abcdefghijklmnopqrstuvwx';

function call(handler: Handler, method: string, path: string, opts: { body?: unknown; key?: string; owner?: string } = {}) {
  const headers = new Headers({ host: 'manager.test', 'x-forwarded-proto': 'https' });
  if (opts.key) headers.set('x-agent-manager-key', opts.key);
  if (opts.owner) {
    headers.set('x-ms-client-principal', Buffer.from(JSON.stringify({ identityProvider: 'github', userDetails: opts.owner })).toString('base64'));
    if (method === 'POST') headers.set(OWNER_WRITE_HEADER, '1'); // the UI adds it to owner changes
  }
  const req: Req = { method, url: `https://manager.test${path}`, headers, body: opts.body === undefined ? '' : JSON.stringify(opts.body) };
  return guarded(handler, () => {})(req, ctx);
}

function tick(seconds: number) {
  clock = new Date(clock.getTime() + seconds * 1000);
}

async function subscribe(fields: Partial<AlertSubscription> = {}) {
  const body = { name: 'My phone', channel: 'ntfy', target: TOPIC, events: ['finished', 'waiting', 'failed', 'unfinished'], ...fields };
  const res = await call(saveAlert, 'POST', '/api/v1/alerts', { ...asOwner, body });
  expect(res.status).toBe(201);
  return (res.body as { subscription: AlertSubscription }).subscription;
}

/** What was sent to ntfy: one entry per fetch call. */
function sent() {
  return (fetchMock.mock.calls as [string, RequestInit][]).map(([url, init]) => ({
    url,
    headers: init.headers as Record<string, string>,
    body: init.body as string,
  }));
}

beforeEach(() => {
  resetAuthState();
  resetAlertState();
  clock = new Date('2026-10-10T12:00:00Z');
  ctx = { store: new MemoryStore(), now: () => clock, env: { OWNER_LOGINS: OWNER } };
  fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('subscriptions', () => {
  it('are for the owner only', async () => {
    expect((await call(listAlerts, 'GET', '/api/v1/alerts')).status).toBe(401);
  });

  it('can be made, listed, changed and deleted', async () => {
    const sub = await subscribe({ projects: ['musik', ' musik '] });
    expect(sub).toMatchObject({ name: 'My phone', projects: ['musik'], enabled: true, lastSentAt: null, lastError: null });

    const changed = await call(saveAlert, 'POST', '/api/v1/alerts', {
      ...asOwner,
      body: { id: sub.id, name: 'Phone', channel: 'ntfy', target: TOPIC, events: ['waiting'], enabled: false },
    });
    expect(changed.status).toBe(200);
    const list = (await call(listAlerts, 'GET', '/api/v1/alerts', asOwner)).body as AlertsResponse;
    expect(list.subscriptions).toEqual([{ ...sub, name: 'Phone', events: ['waiting'], projects: [], enabled: false }]);

    expect((await call(deleteAlert, 'POST', '/api/v1/alerts/delete', { ...asOwner, body: { id: sub.id } })).status).toBe(200);
    expect(await ctx.store.listAlerts()).toEqual([]);
    const gone = await call(deleteAlert, 'POST', '/api/v1/alerts/delete', { ...asOwner, body: { id: sub.id } });
    expect(gone).toEqual({ status: 404, body: { error: `No alert subscription with id ${sub.id}` } });
  });

  it('refuse bad targets and events with one line', async () => {
    const save = (fields: Record<string, unknown>) =>
      call(saveAlert, 'POST', '/api/v1/alerts', { ...asOwner, body: { name: 'x', target: TOPIC, events: ['finished'], ...fields } });
    expect((await save({ target: 'http://ntfy.sh/topic' })).body).toEqual({ error: 'target must be an https URL (http only works for localhost)' });
    expect((await save({ target: 'https://ntfy.sh/' })).body).toEqual({ error: 'target must include the topic, such as https://ntfy.sh/<topic>' });
    expect((await save({ events: [] })).body).toEqual({ error: 'events must hold at least one of finished, waiting, failed, unfinished, blocker' });
    expect((await save({ events: ['done'] })).status).toBe(400);
    expect((await save({ target: 'http://localhost:8080/test' })).status).toBe(201);
  });
});

describe('alerts', () => {
  let key: string;
  beforeEach(async () => {
    const res = await call(createKey, 'POST', '/api/v1/keys', { ...asOwner, body: { name: 'pc' } });
    key = (res.body as CreateKeyResponse).secret;
  });

  const send = (body: Record<string, unknown>, agentId = 'pc/claude/s1') =>
    call(report, 'POST', '/api/v1/report', {
      key,
      body: { agentId, kind: 'claude-code', machine: 'pc', name: 'musik-4a', project: 'musik', ...body },
    });

  it('says when an agent reports a blocker, linking to the Blockers tab, only to subscriptions that want it', async () => {
    await subscribe();
    await send({ state: 'working' });
    const blocker = () => call(createBlocker, 'POST', '/api/v1/blockers', { key, body: { agentId: 'pc/claude/s1', title: 'Need the Steam login' } });
    await blocker();
    expect(fetchMock).not.toHaveBeenCalled();

    await subscribe({ events: ['blocker'] });
    const res = await blocker();
    const id = (res.body as { stored: { id: string } }).stored.id;
    expect(sent().map((s) => [s.headers.Title, s.headers.Tags, s.headers.Priority, s.headers.Click, s.body])).toEqual([
      ['musik is blocked', 'construction', 'high', `https://manager.test/blockers?id=${id}`, 'Need the Steam login\nOn pc'],
    ]);
  });

  it('says when a request finishes, with the result and the prompt', async () => {
    await subscribe();
    await send({ state: 'working', turn: 'start', prompt: 'Fix the login bug' });
    expect(fetchMock).not.toHaveBeenCalled();
    tick(30);
    await send({ state: 'idle', turn: 'end', result: { title: 'Fix login redirect loop', summary: 'Done' } });

    expect(sent()).toEqual([
      {
        url: TOPIC,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          Title: 'musik finished',
          Tags: 'white_check_mark',
          Priority: 'default',
          Click: 'https://manager.test/agents/detail?id=pc%2Fclaude%2Fs1',
        },
        body: 'Fix login redirect loop\nYou asked: Fix the login bug',
      },
    ]);
    const [stored] = await ctx.store.listAlerts();
    expect(stored).toMatchObject({ lastSentAt: '2026-10-10T12:00:30.000Z', lastError: null });
  });

  it('says when an agent needs the owner, at high priority, once in two minutes', async () => {
    await subscribe();
    await send({ state: 'waiting', activity: 'Claude needs your permission to use Bash' });
    await send({ state: 'working' });
    tick(60);
    await send({ state: 'waiting', activity: 'Claude needs your permission to use Edit' });
    expect(sent().map((s) => [s.headers.Priority, s.body])).toEqual([['high', 'Claude needs your permission to use Bash']]);

    tick(61);
    await send({ state: 'working' });
    await send({ state: 'waiting', activity: 'Claude needs your permission to use Edit' });
    expect(sent()).toHaveLength(2);
  });

  it('says when an agent fails, and masks secrets', async () => {
    await subscribe();
    await send({ state: 'working', turn: 'start', prompt: 'Deploy with token=supersecret123' });
    await send({ state: 'failed', activity: 'API error 500' });
    expect(sent().map((s) => [s.headers.Title, s.headers.Tags, s.body])).toEqual([
      ['musik failed', 'rotating_light', 'API error 500\nYou asked: Deploy with token=[masked]'],
    ]);
  });

  it('says when a session closes mid-request, but not when a new prompt replaced it', async () => {
    await subscribe();
    await send({ state: 'working', turn: 'start', prompt: 'First' });
    await send({ state: 'working', turn: 'start', prompt: 'Second' });
    expect(fetchMock).not.toHaveBeenCalled();

    await call(heartbeat, 'POST', '/api/v1/heartbeat', { key, body: { machine: 'pc', kind: 'claude-code', agentIds: [] } });
    expect(sent().map((s) => [s.headers.Title, s.body])).toEqual([['musik was cut off', 'Closed mid-request\nYou asked: Second']]);
  });

  it('follows each subscription’s events, projects and switch, and ignores sub-agents', async () => {
    await subscribe({ name: 'Only waiting', events: ['waiting'] });
    await subscribe({ name: 'Other project', projects: ['game'] });
    await subscribe({ name: 'Off', enabled: false });
    await send({ state: 'working', turn: 'start', prompt: 'Go' });
    await send({ state: 'idle', turn: 'end' });
    expect(fetchMock).not.toHaveBeenCalled();

    await send({ state: 'waiting', activity: 'Needs you', parentId: 'pc/claude/s1' }, 'pc/claude/s1/sub');
    expect(fetchMock).not.toHaveBeenCalled();
    await send({ state: 'waiting', activity: 'Needs you' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends "connection lost" once per request, from the agents list or the sweep endpoint', async () => {
    await subscribe();
    await send({ state: 'working', turn: 'start', prompt: 'Long job' });
    tick(200);
    await call(agents, 'GET', '/api/v1/agents', asOwner);
    expect(sent().map((s) => [s.headers.Title, s.headers.Priority, s.body])).toEqual([
      ['musik was cut off', 'high', 'Connection lost mid-request\nYou asked: Long job'],
    ]);

    tick(300);
    await call(agents, 'GET', '/api/v1/agents', asOwner);
    const swept = await call(sweepAlerts, 'POST', '/api/v1/alerts/sweep', { key });
    expect(swept.body).toEqual({ ok: true, sent: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A new request that goes lost too is told about again.
    await send({ state: 'working', turn: 'start', prompt: 'Another' });
    tick(200);
    expect((await call(sweepAlerts, 'POST', '/api/v1/alerts/sweep', { key })).body).toEqual({ ok: true, sent: 1 });
  });

  it('records delivery errors without the topic, and notify never throws', async () => {
    await subscribe();
    fetchMock.mockImplementation(async () => new Response('nope', { status: 429, statusText: 'Too Many Requests' }));
    const res = await send({ state: 'waiting', activity: 'Needs you' });
    expect(res.status).toBe(200);
    const [stored] = await ctx.store.listAlerts();
    expect(stored!.lastError).toBe('ntfy answered 429 Too Many Requests');

    fetchMock.mockImplementation(async () => {
      throw new TypeError('fetch failed', { cause: new Error(`getaddrinfo ENOTFOUND ${TOPIC}`) });
    });
    tick(200);
    await send({ state: 'working' });
    expect((await send({ state: 'waiting', activity: 'Again' })).status).toBe(200);
    const [after] = await ctx.store.listAlerts();
    expect(after!.lastError).toBe("Couldn't reach the server: getaddrinfo ENOTFOUND <topic>");
  });
});

describe('test messages', () => {
  it('send one and answer with the error when it fails', async () => {
    const sub = await subscribe({ enabled: false });
    const res = await call(testAlert, 'POST', '/api/v1/alerts/test', { ...asOwner, body: { id: sub.id } });
    expect(res.status).toBe(200);
    expect(sent()[0]!.headers).toMatchObject({ Title: 'Agent Manager Delux test', Click: 'https://manager.test/settings' });

    fetchMock.mockImplementation(async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    });
    const failed = await call(testAlert, 'POST', '/api/v1/alerts/test', { ...asOwner, body: { id: sub.id } });
    expect(failed).toEqual({ status: 502, body: { error: "The test didn't go through: No answer within 3 s" } });
  });

  it('encode titles that aren’t plain ASCII', () => {
    expect(headerText('musik finished')).toBe('musik finished');
    expect(headerText('müsik finished')).toBe(`=?UTF-8?B?${Buffer.from('müsik finished').toString('base64')}?=`);
  });
});
