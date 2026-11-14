import { beforeEach, describe, expect, it } from 'vitest';
import {
  OWNER_WRITE_HEADER,
  type BlockerDetailResponse,
  type BlockerMedia,
  type BlockerResponse,
  type BlockersResponse,
  type CreateKeyResponse,
  type InboxResponse,
} from '@agent-manager-deluxe/shared';
import { resetAuthState } from '../src/auth';
import { addBlockerMedia, blocker, blockerMedia, blockers, createBlocker, resolveBlocker } from '../src/handlers/blockers';
import { report } from '../src/handlers/ingest';
import { createKey } from '../src/handlers/keys';
import { inbox } from '../src/handlers/messages';
import { agent } from '../src/handlers/read';
import { guarded, type Ctx, type Handler, type Req } from '../src/http';
import { MemoryMediaStore } from '../src/store/media';
import { MemoryStore } from '../src/store/memory';

const OWNER = 'owner@example.com';
const SESSION = 'pc/claude/s1';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 7)]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(1000, 3)]);

let clock: Date;
let ctx: Ctx;
let mediaStore: MemoryMediaStore;
let key: string;

function call(
  handler: Handler,
  method: string,
  path: string,
  opts: { body?: unknown; raw?: Buffer; key?: string; owner?: boolean; headers?: Record<string, string> } = {},
) {
  const headers = new Headers({ host: 'manager.test', 'x-forwarded-proto': 'https', ...opts.headers });
  if (opts.key) headers.set('x-agent-manager-key', opts.key);
  if (opts.owner) {
    headers.set('x-ms-client-principal', Buffer.from(JSON.stringify({ identityProvider: 'github', userDetails: OWNER })).toString('base64'));
    if (method === 'POST') headers.set(OWNER_WRITE_HEADER, '1');
  }
  const req: Req = {
    method,
    url: `https://manager.test${path}`,
    headers,
    body: opts.raw ? opts.raw.toString('utf8') : opts.body === undefined ? '' : JSON.stringify(opts.body),
    raw: opts.raw,
  };
  return guarded(handler, () => {})(req, ctx);
}

async function makeKey(name: string) {
  const res = await call(createKey, 'POST', '/api/v1/keys', { owner: true, body: { name } });
  return (res.body as CreateKeyResponse).secret;
}

async function reportSession(details: Record<string, unknown> = { permissionMode: 'default' }, state = 'idle') {
  await call(report, 'POST', '/api/v1/report', {
    key,
    body: { agentId: SESSION, kind: 'claude-code', machine: 'pc', name: 'Fix login', project: 'webapp', state, details },
  });
}

async function open(body: Record<string, unknown> = {}) {
  const res = await call(createBlocker, 'POST', '/api/v1/blockers', {
    key,
    body: { agentId: SESSION, title: 'Need the Stripe test key', details: 'Tried **.env.example**; it is blank.', ...body },
  });
  return res;
}

const list = async () => (await call(blockers, 'GET', '/api/v1/blockers', { owner: true })).body as BlockersResponse;

const upload = (id: string, bytes: Buffer, type: string, withKey = key, name = 'C:\\shots\\login.png') =>
  call(addBlockerMedia, 'POST', `/api/v1/blockers/media?${new URLSearchParams({ id, name })}`, {
    key: withKey,
    raw: bytes,
    headers: { 'content-type': type },
  });

const resolve = (id: string, body: Record<string, unknown> = {}) =>
  call(resolveBlocker, 'POST', '/api/v1/blockers/resolve', { owner: true, body: { id, status: 'resolved', ...body } });

beforeEach(async () => {
  resetAuthState();
  clock = new Date('2026-11-13T12:00:00Z');
  mediaStore = new MemoryMediaStore();
  ctx = { store: new MemoryStore(undefined, () => clock), now: () => clock, env: { OWNER_LOGINS: OWNER }, media: mediaStore };
  key = await makeKey('pc-studio');
  await reportSession();
});

describe('reporting a blocker', () => {
  it('takes the agent, machine and project from the agent, and lists it as open', async () => {
    const res = await open();
    expect(res.status).toBe(201);
    const body = res.body as BlockerResponse;
    expect(body.stored).toMatchObject({
      agentId: SESSION,
      agentName: 'Fix login',
      project: 'webapp',
      machine: 'pc',
      kind: 'claude-code',
      title: 'Need the Stripe test key',
      status: 'open',
      createdAt: '2026-11-13T12:00:00.000Z',
      keyName: 'pc-studio',
    });
    expect(body.blockerUrl).toBe(`https://manager.test/blockers?id=${body.stored.id}`);
    expect((await list()).blockers.map((b) => b.id)).toEqual([body.stored.id]);
    expect((await list()).agents).toEqual({ [SESSION]: { state: 'idle', noMessages: null } });
    const detail = (await call(agent, 'GET', `/api/v1/agent?id=${encodeURIComponent(SESSION)}`, { owner: true })).body as {
      events: { type: string; activity: string }[];
    };
    expect(detail.events).toContainEqual(expect.objectContaining({ type: 'blocker', activity: 'Blocked: Need the Stripe test key' }));
  });

  it('stores nothing for a test call, and refuses unknown agents and missing titles', async () => {
    expect((await open({ test: true })).status).toBe(200);
    expect((await list()).blockers).toEqual([]);
    expect((await open({ agentId: 'nobody' })).status).toBe(404);
    expect((await open({ title: ' ' })).body).toEqual({ error: 'title is required' });
  });

  it('masks secrets in what the agent wrote', async () => {
    const res = await open({ details: 'The key ghp_abcdefghijklmnopqrstuvwxyz0123456789 was refused' });
    expect((res.body as BlockerResponse).stored.details).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
  });

  it('needs a machine key', async () => {
    const res = await call(createBlocker, 'POST', '/api/v1/blockers', { body: { agentId: SESSION, title: 'x' } });
    expect(res.status).toBe(401);
  });
});

describe('screenshots and videos', () => {
  let id: string;
  beforeEach(async () => {
    id = ((await open()).body as BlockerResponse).stored.id;
  });

  it('keeps a screenshot and serves it to the owner, with ranges for seeking', async () => {
    const res = await upload(id, PNG, 'image/png');
    expect(res.status).toBe(201);
    const item = (res.body as { stored: BlockerMedia }).stored;
    expect(item).toMatchObject({ kind: 'image', contentType: 'image/png', bytes: PNG.length, name: 'login.png' });
    expect((await list()).blockers[0]!.media).toEqual([item]);

    const path = `/api/v1/blockers/media?${new URLSearchParams({ id, media: item.id })}`;
    const whole = await call(blockerMedia, 'GET', path, { owner: true });
    expect(whole.status).toBe(200);
    expect(whole.bytes!.equals(PNG)).toBe(true);
    expect(whole.headers).toMatchObject({ 'content-type': 'image/png', 'content-security-policy': "default-src 'none'; sandbox" });

    const part = await call(blockerMedia, 'GET', path, { owner: true, headers: { range: 'bytes=0-7' } });
    expect(part.status).toBe(206);
    expect(part.bytes!.length).toBe(8);
    expect(part.headers!['content-range']).toBe(`bytes 0-7/${PNG.length}`);
    expect((await call(blockerMedia, 'GET', path, {})).status).toBe(401);
  });

  it('takes a video', async () => {
    const res = await upload(id, MP4, 'video/mp4');
    expect((res.body as { stored: BlockerMedia }).stored.kind).toBe('video');
  });

  it('refuses other types, files that lie about their type, and files that are too big', async () => {
    expect((await upload(id, Buffer.from('<html>'), 'text/html')).status).toBe(415);
    expect((await upload(id, Buffer.from('<html><script>alert(1)</script>'), 'image/png')).status).toBe(415);
    const huge = Buffer.concat([PNG, Buffer.alloc(8 * 1024 * 1024)]);
    expect((await upload(id, huge, 'image/png')).status).toBe(413);
    expect(mediaStore.files.size).toBe(0);
  });

  it('only lets the key that reported it add to it', async () => {
    const other = await makeKey('pc-laptop');
    expect((await upload(id, PNG, 'image/png', other)).status).toBe(404);
  });

  it('says so when media storage is not set up', async () => {
    ctx.media = null;
    const res = await upload(id, PNG, 'image/png');
    expect(res.status).toBe(503);
  });
});

describe('resolving', () => {
  let id: string;
  beforeEach(async () => {
    id = ((await open()).body as BlockerResponse).stored.id;
  });

  it('sends the answer to a running session as a message, and the agent can read it back', async () => {
    const res = await resolve(id, { resolution: 'Added STRIPE_TEST_KEY to your user env; restart the shell.' });
    expect(res.status).toBe(200);
    const { blocker: done } = res.body as BlockerDetailResponse;
    expect(done).toMatchObject({ status: 'resolved', resolvedBy: OWNER, resolvedAt: '2026-11-13T12:00:00.000Z' });
    expect(done.delivery).toMatch(/^Sent to the session as a message/);

    const { messages } = (await call(inbox, 'POST', '/api/v1/inbox', { key, body: { machine: 'pc' } })).body as InboxResponse;
    expect(messages).toHaveLength(1);
    expect(messages[0]!.text).toContain('resolved your blocker "Need the Stripe test key"');
    expect(messages[0]!.text).toContain('Added STRIPE_TEST_KEY');
    expect((await list()).messages.map((m) => m.id)).toEqual([done.messageId]);

    const read = await call(blocker, 'GET', `/api/v1/blocker?id=${id}`, { key });
    expect((read.body as BlockerDetailResponse).blocker.resolution).toBe('Added STRIPE_TEST_KEY to your user env; restart the shell.');
    const other = await makeKey('pc-laptop');
    expect((await call(blocker, 'GET', `/api/v1/blocker?id=${id}`, { key: other })).status).toBe(404);
  });

  it('keeps the answer for the agent to check when the session cannot take messages', async () => {
    await reportSession({ permissionMode: 'bypassPermissions' });
    const { blocker: done } = (await resolve(id, { resolution: 'Done' })).body as BlockerDetailResponse;
    expect(done.messageId).toBeNull();
    expect(done.delivery).toMatch(/^Not sent as a message: the session skips permission prompts/);
  });

  it('dismisses without an answer, once', async () => {
    const res = await resolve(id, { status: 'dismissed' });
    expect((res.body as BlockerDetailResponse).blocker).toMatchObject({ status: 'dismissed', resolution: null });
    expect((await resolve(id)).status).toBe(409);
    expect((await upload(id, PNG, 'image/png')).status).toBe(409);
  });

  it('needs the owner and the site header', async () => {
    const res = await call(resolveBlocker, 'POST', '/api/v1/blockers/resolve', { key, body: { id, status: 'resolved' } });
    expect(res.status).toBe(401);
  });

  it('lists answered blockers for a week', async () => {
    await resolve(id);
    expect((await list()).blockers).toHaveLength(1);
    clock = new Date(clock.getTime() + 8 * 86_400_000);
    expect((await list()).blockers).toHaveLength(0);
  });
});
