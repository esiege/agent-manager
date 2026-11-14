import { beforeEach, describe, expect, it } from 'vitest';
import {
  OWNER_WRITE_HEADER,
  perfStats,
  type CreateKeyResponse,
  type KeysResponse,
  type PerfSamplesResponse,
  type PerfSessionDetailResponse,
  type PerfSessionResponse,
  type PerfSessionsResponse,
} from '@agent-manager-delux/shared';
import { resetAuthState } from '../src/auth';
import { report } from '../src/handlers/ingest';
import { createKey, listKeys } from '../src/handlers/keys';
import { perfSamples, perfSession, perfSessionDetail, perfSessions } from '../src/handlers/perf';
import { guarded, type Ctx, type Handler, type Req } from '../src/http';
import { MemoryStore } from '../src/store/memory';

let clock: Date;
let ctx: Ctx;
const OWNER = 'owner@example.com';

function call(handler: Handler, method: string, path: string, opts: { body?: unknown; key?: string; owner?: boolean } = {}) {
  const headers = new Headers({
    host: 'manager.test',
    'x-forwarded-proto': 'https',
  });
  if (opts.key) headers.set('x-agent-manager-key', opts.key);
  if (opts.owner) {
    headers.set('x-ms-client-principal', Buffer.from(JSON.stringify({ identityProvider: 'github', userDetails: OWNER })).toString('base64'));
    if (method === 'POST') headers.set(OWNER_WRITE_HEADER, '1');
  }
  const req: Req = {
    method,
    url: `https://manager.test${path}`,
    headers,
    body: opts.body === undefined ? '' : JSON.stringify(opts.body),
  };
  return guarded(handler, () => {})(req, ctx);
}

async function makeKey(name: string, scope?: string) {
  const res = await call(createKey, 'POST', '/api/v1/keys', {
    owner: true,
    body: { name, scope },
  });
  expect(res.status).toBe(201);
  return (res.body as CreateKeyResponse).secret;
}

const SESSION = '0b9c1c1e-6f0a-4c56-9a53-2f8f4d1f7a10';
const start = (key: string, body: Record<string, unknown> = {}) =>
  call(perfSession, 'POST', '/api/v1/perf/session', {
    key,
    body: { sessionId: SESSION, game: 'musik', machine: 'pc-studio', ...body },
  });
const send = (key: string, samples: unknown[], extra: Record<string, unknown> = {}) =>
  call(perfSamples, 'POST', '/api/v1/perf/samples', {
    key,
    body: { sessionId: SESSION, samples, ...extra },
  });

let key: string;
beforeEach(async () => {
  resetAuthState();
  clock = new Date('2026-11-13T12:00:00Z');
  ctx = {
    store: new MemoryStore(undefined, () => clock),
    now: () => clock,
    env: { OWNER_LOGINS: OWNER },
  };
  key = await makeKey('musik-builds', 'perf');
});

describe('game keys', () => {
  it('send performance data and nothing else', async () => {
    expect((await start(key)).status).toBe(200);
    const res = await call(report, 'POST', '/api/v1/report', {
      key,
      body: { agentId: 'a', kind: 'other', machine: 'pc' },
    });
    expect(res.status).toBe(403);
    expect((res.body as { error: string }).error).toContain('game key');
  });

  it('are listed with their scope, and a machine key can send performance data too', async () => {
    const machineKey = await makeKey('pc-studio');
    expect((await start(machineKey)).status).toBe(200);
    const keys = ((await call(listKeys, 'GET', '/api/v1/keys', { owner: true })).body as KeysResponse).keys;
    expect(Object.fromEntries(keys.map((k) => [k.name, k.scope]))).toEqual({
      'musik-builds': 'perf',
      'pc-studio': 'all',
    });
  });

  it('refuses a scope it does not know', async () => {
    const res = await call(createKey, 'POST', '/api/v1/keys', {
      owner: true,
      body: { name: 'x', scope: 'admin' },
    });
    expect(res).toEqual({
      status: 400,
      body: { error: 'scope must be one of all, perf' },
    });
  });
});

describe('performance sessions', () => {
  it('starts a session and links to its page', async () => {
    const res = await start(key, {
      build: '0.4.2',
      gpu: 'RTX 4070',
      ramMb: 32768,
      quality: 'high',
    });
    const body = res.body as PerfSessionResponse;
    expect(body.sessionUrl).toBe(`https://manager.test/performance/session?id=${SESSION}`);
    expect(body.stored).toMatchObject({
      game: 'musik',
      machine: 'pc-studio',
      build: '0.4.2',
      gpu: 'RTX 4070',
      ramMb: 32768,
      endedAt: null,
    });
    // A field the manager doesn't know is kept, and said so.
    expect(body.stored.details).toEqual({ quality: 'high' });
    expect(body.warnings).toEqual(['Unknown field(s) quality were kept in details']);
  });

  it('keeps what it knew when a later call leaves fields out, and ends', async () => {
    await start(key, { build: '0.4.2', gpu: 'RTX 4070' });
    clock = new Date(clock.getTime() + 60_000);
    const res = await start(key, { ended: true });
    expect((res.body as PerfSessionResponse).stored).toMatchObject({
      build: '0.4.2',
      gpu: 'RTX 4070',
      startedAt: '2026-11-13T12:00:00.000Z',
      endedAt: '2026-11-13T12:01:00.000Z',
    });
  });

  it('says what is wrong with a bad session', async () => {
    expect((await start(key, { sessionId: 'a/b' })).body).toEqual({
      error: 'sessionId is required: 8 to 64 letters, digits, dots, dashes or underscores (a UUID works)',
    });
    expect((await start(key, { game: '' })).status).toBe(400);
  });

  it('stores nothing on a test call', async () => {
    expect((await start(key, { test: true })).status).toBe(200);
    expect((await send(key, [{ t: 10, seconds: 10, frames: 600 }])).status).toBe(404);
  });
});

describe('performance samples', () => {
  beforeEach(async () => {
    await start(key);
  });

  it('adds samples up into the session', async () => {
    const res = await send(key, [
      {
        t: 10,
        seconds: 10,
        frames: 600,
        frameMsP95: 20,
        frameMsP99: 30,
        frameMsMax: 48,
        hitches: 0,
        memoryMb: 900,
        scene: 'menu',
      },
      {
        t: 20,
        seconds: 10,
        frames: 300,
        frameMsP95: 50,
        frameMsP99: 90,
        frameMsMax: 210,
        hitches: 4,
        memoryMb: 1400,
        scene: 'level-1',
      },
    ]);
    expect((res.body as PerfSamplesResponse).stored).toEqual({
      count: 2,
      duplicates: 0,
      hitchEvents: 0,
    });

    const detail = (await call(perfSessionDetail, 'GET', `/api/v1/perf/session?id=${SESSION}`, { owner: true })).body as PerfSessionDetailResponse;
    expect(detail.samples.map((s) => s.t)).toEqual([10, 20]);
    const stats = perfStats(detail.session.totals);
    expect(stats).toMatchObject({
      samples: 2,
      seconds: 20,
      frames: 900,
      avgFps: 45,
      frameMsMax: 210,
      hitches: 4,
      hitchesPerMinute: 12,
      memoryMbMax: 1400,
    });
    // Weighted by frames: (20 * 600 + 50 * 300) / 900.
    expect(stats.frameMsP95).toBe(30);
    expect(stats.frameMsP50).toBeNull();
  });

  it('counts a batch sent twice once', async () => {
    const batch = [{ t: 10, seconds: 10, frames: 600 }];
    await send(key, batch);
    const again = await send(key, [...batch, { t: 20, seconds: 10, frames: 500 }]);
    expect((again.body as PerfSamplesResponse).stored).toEqual({
      count: 1,
      duplicates: 1,
      hitchEvents: 0,
    });
    const list = (await call(perfSessions, 'GET', '/api/v1/perf/sessions', { owner: true })).body as PerfSessionsResponse;
    expect(list.sessions).toHaveLength(1);
    expect(list.sessions[0]!.totals).toMatchObject({
      samples: 2,
      frames: 1100,
    });
  });

  it('keeps unknown numbers as custom metrics', async () => {
    const res = await send(key, [
      {
        t: 10,
        seconds: 10,
        frames: 600,
        entities: 412,
        metrics: { particles: 9000 },
        note: 'x',
      },
    ]);
    expect((res.body as PerfSamplesResponse).warnings).toEqual(['Unknown field(s) note on samples were ignored (only numbers are kept, as metrics)']);
    const detail = (await call(perfSessionDetail, 'GET', `/api/v1/perf/session?id=${SESSION}`, { owner: true })).body as PerfSessionDetailResponse;
    expect(detail.samples[0]!.metrics).toEqual({
      particles: 9000,
      entities: 412,
    });
  });

  it('says which thread the average frame waited on', async () => {
    await send(key, [
      { t: 10, seconds: 10, frames: 600, gameMs: 9, renderMs: 10, gpuMs: 12 },
      { t: 20, seconds: 10, frames: 600, gameMs: 9, renderMs: 10, gpuMs: 14 },
    ]);
    const detail = (await call(perfSessionDetail, 'GET', `/api/v1/perf/session?id=${SESSION}`, { owner: true })).body as PerfSessionDetailResponse;
    expect(perfStats(detail.session.totals)).toMatchObject({ gameMs: 9, renderMs: 10, gpuMs: 13, cpuMs: null, bound: 'gpu' });
  });

  it('keeps the worst hitches, worst first, each frame once', async () => {
    await start(key, { loadSeconds: 11.8 });
    await send(key, [{ t: 10, seconds: 10, frames: 600 }], { hitchEvents: [{ t: 4.2, frameMs: 60, scene: 'fire' }] });
    // Hitches can come without samples, and a frame sent again replaces itself.
    const res = await send(key, undefined as unknown as unknown[], {
      hitchEvents: [
        { t: 41.2, frameMs: 140.2, gameMs: 30, renderMs: 120, gpuMs: 20, scene: 'fire' },
        { t: 4.2, frameMs: 60, scene: 'fire' },
      ],
    });
    expect((res.body as PerfSamplesResponse).stored).toEqual({ count: 0, duplicates: 0, hitchEvents: 2 });
    const { session } = (await call(perfSessionDetail, 'GET', `/api/v1/perf/session?id=${SESSION}`, { owner: true })).body as PerfSessionDetailResponse;
    expect(session.loadSeconds).toBe(11.8);
    expect(session.worstHitches).toEqual([
      { t: 41.2, frameMs: 140.2, gameMs: 30, renderMs: 120, gpuMs: 20, scene: 'fire' },
      { t: 4.2, frameMs: 60, scene: 'fire' },
    ]);
    expect((await send(key, [], { hitchEvents: [{ t: 1 }] })).body).toEqual({ error: 'hitchEvents[0] needs t and frameMs, both numbers' });
  });

  it('refuses samples it cannot use', async () => {
    expect((await send(key, [{ t: 10, frames: 600 }])).body).toEqual({
      error: 'samples[0].seconds is required and must be a number',
    });
    expect((await send(key, [{ t: 10, seconds: 0, frames: 600 }])).body).toEqual({ error: 'samples[0].seconds must be more than 0' });
    expect((await send(key, [])).status).toBe(400);
    const unknown = await call(perfSamples, 'POST', '/api/v1/perf/samples', {
      key,
      body: {
        sessionId: 'never-started-1',
        samples: [{ t: 1, seconds: 1, frames: 60 }],
      },
    });
    expect(unknown).toEqual({
      status: 404,
      body: {
        error: 'No performance session never-started-1; start it with POST /api/v1/perf/session first',
      },
    });
  });
});

describe('reading performance data', () => {
  it('needs the owner or a machine key; a game key cannot read', async () => {
    await start(key);
    expect((await call(perfSessions, 'GET', '/api/v1/perf/sessions')).status).toBe(401);
    expect((await call(perfSessions, 'GET', '/api/v1/perf/sessions', { key })).status).toBe(403);
    expect((await call(perfSessionDetail, 'GET', `/api/v1/perf/session?id=${SESSION}`, { key })).status).toBe(403);

    const machineKey = await makeKey('pc-studio');
    const list = await call(perfSessions, 'GET', '/api/v1/perf/sessions', { key: machineKey });
    expect((list.body as PerfSessionsResponse).sessions.map((s) => s.id)).toEqual([SESSION]);
    expect((await call(perfSessionDetail, 'GET', `/api/v1/perf/session?id=${SESSION}`, { key: machineKey })).status).toBe(200);
  });

  it('narrows the list to one game and a number of sessions', async () => {
    await start(key);
    clock = new Date(clock.getTime() + 1000);
    await start(key, { sessionId: 'other-game-1', game: 'Vanworld' });
    clock = new Date(clock.getTime() + 1000);
    await start(key, { sessionId: 'other-game-2', game: 'Vanworld' });
    const list = async (qs: string) => (await call(perfSessions, 'GET', `/api/v1/perf/sessions?${qs}`, { owner: true })).body as PerfSessionsResponse;
    expect((await list('game=vanworld')).sessions.map((s) => s.id)).toEqual(['other-game-2', 'other-game-1']);
    expect(await list('game=vanworld&limit=1')).toMatchObject({ sessions: [{ id: 'other-game-2' }], truncated: true });
    expect((await call(perfSessions, 'GET', '/api/v1/perf/sessions?limit=0', { owner: true })).status).toBe(400);
  });

  it('lists the sessions of the window, newest first', async () => {
    await start(key);
    clock = new Date('2026-11-20T12:00:00Z');
    await start(key, { sessionId: 'second-session', machine: 'laptop' });
    const list = async (days: number) =>
      ((await call(perfSessions, 'GET', `/api/v1/perf/sessions?days=${days}`, { owner: true })).body as PerfSessionsResponse).sessions.map((s) => s.machine);
    expect(await list(30)).toEqual(['laptop', 'pc-studio']);
    expect(await list(1)).toEqual(['laptop']);
    expect(
      (
        await call(perfSessions, 'GET', '/api/v1/perf/sessions?days=0', {
          owner: true,
        })
      ).status,
    ).toBe(400);
  });

  it('answers 404 for a session it does not have', async () => {
    expect((await call(perfSessionDetail, 'GET', '/api/v1/perf/session?id=not-a-session', { owner: true })).status).toBe(404);
  });
});
