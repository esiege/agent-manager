// Blockers: something an agent can't get past without the owner (a login, a decision, a key, a
// broken machine). The agent reports one with a machine key, adds screenshots or a video, and it
// shows as a panel on the Blockers tab. The owner answers it there; the answer goes to the session
// as a message when it can take one, and the agent can always read it back from GET /blocker.

import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import {
  BLOCKER_MEDIA_TYPES,
  BLOCKER_RECENT_DAYS,
  LIMITS,
  effectiveState,
  maskSecrets,
  type AgentEvent,
  type AgentMessage,
  type Blocker,
  type BlockerAgentStatus,
  type BlockerDetailResponse,
  type BlockerMedia,
  type BlockerMediaType,
  type BlockerResponse,
  type BlockersResponse,
} from '@agent-manager-deluxe/shared';
import { blockersPage, notifyBlocker } from '../alerts';
import { requireKey, requireOwner, requireOwnerWrite } from '../auth';
import { HttpError, ok, publicOrigin, query, readJson, type Ctx, type Handler, type Req } from '../http';
import type { MediaRange, MediaStore } from '../store/media';
import { preview, queueMessage, whyNoMessages } from './messages';

const MAX_BODY = 32 * 1024;
const FILE_NAME_LENGTH = 120;
/** Blocker ids are UUIDs made here. */
const BLOCKER_ID = /^[0-9a-f-]{36}$/;

function field(body: unknown, name: string): unknown {
  return (body as Record<string, unknown> | null)?.[name];
}

function requiredText(body: unknown, name: string, max: number): string {
  const v = field(body, name);
  if (typeof v !== 'string' || v.trim() === '') throw new HttpError(400, `${name} is required`);
  if (v.length > max) throw new HttpError(400, `${name} is longer than ${max} characters`);
  return v.trim();
}

function optionalText(body: unknown, name: string, max: number): string | null {
  const v = field(body, name);
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw new HttpError(400, `${name} must be a string`);
  if (v.length > max) throw new HttpError(400, `${name} is longer than ${max} characters`);
  return v.trim() || null;
}

function blockerId(value: string | null): string {
  if (!value || !BLOCKER_ID.test(value)) throw new HttpError(400, 'id must be a blocker id, as POST /api/v1/blockers returned it');
  return value;
}

function blockerEvent(agentId: string, activity: string, at: string): AgentEvent {
  return { id: randomUUID(), agentId, type: 'blocker', at, receivedAt: at, state: null, activity, link: null, details: null };
}

function media(ctx: Ctx): MediaStore {
  if (!ctx.media) {
    throw new HttpError(503, "Screenshots and videos aren't set up on this Agent Manager Deluxe (no BLOB_ACCOUNT); the blocker was kept without it");
  }
  return ctx.media;
}

// ---- Agents ----

/** POST /api/v1/blockers: an agent reports what it can't get past. */
export const createBlocker: Handler = async (req, ctx) => {
  const key = await requireKey(req, ctx);
  const body = readJson(req, MAX_BODY);
  const agentId = requiredText(body, 'agentId', LIMITS.idLength);
  const title = requiredText(body, 'title', LIMITS.blockerTitleLength);
  const details = optionalText(body, 'details', LIMITS.blockerDetailsLength);
  const test = field(body, 'test') === true;

  const agent = await ctx.store.getAgent(agentId);
  if (!agent) throw new HttpError(404, `No agent with id ${agentId}: report it first (POST /api/v1/report), then the blocker`);

  const at = ctx.now().toISOString();
  const blocker: Blocker = {
    id: randomUUID(),
    agentId,
    agentName: agent.name,
    kind: agent.kind,
    project: agent.project,
    machine: agent.machine,
    title: maskSecrets(title),
    details: details === null ? null : maskSecrets(details),
    media: [],
    status: 'open',
    createdAt: at,
    resolvedAt: null,
    resolvedBy: null,
    resolution: null,
    delivery: null,
    messageId: null,
    keyName: key.name,
  };
  const origin = publicOrigin(req, ctx.env);
  const warnings = ctx.media ? [] : ["Screenshots and videos aren't set up on this Agent Manager Deluxe, so only text can be added"];
  const res: BlockerResponse = { ok: true, test, stored: blocker, warnings, blockerUrl: blockersPage(origin, blocker.id) };
  if (test) return ok(res);

  await ctx.store.putBlocker(blocker);
  await ctx.store.addEvents([blockerEvent(agentId, `Blocked: ${preview(blocker.title)}`, at)]);
  await notifyBlocker(ctx, blocker, origin);
  return ok(res, 201);
};

/** The first bytes of each type, so a file can't claim to be something it isn't. */
function looksLike(type: BlockerMediaType, b: Buffer): boolean {
  const ascii = (start: number, end: number) => b.subarray(start, end).toString('latin1');
  switch (type) {
    case 'image/png':
      return b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/jpeg':
      return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case 'image/gif':
      return ascii(0, 4) === 'GIF8';
    case 'image/webp':
      return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
    case 'video/mp4':
      return ascii(4, 8) === 'ftyp';
    case 'video/webm':
      return b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  }
}

function fileName(value: string | null): string | null {
  if (!value) return null;
  // eslint-disable-next-line no-control-regex
  const name = basename(value.replace(/\\/g, '/')).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return name ? name.slice(0, FILE_NAME_LENGTH) : null;
}

/**
 * POST /api/v1/blockers/media?id=<blocker>&name=<file name>: adds one screenshot or video.
 * The body is the file itself, with its Content-Type (PNG, JPEG, WebP, GIF, MP4 or WebM).
 */
export const addBlockerMedia: Handler = async (req, ctx) => {
  const key = await requireKey(req, ctx);
  const params = query(req);
  const id = blockerId(params.get('id'));
  const contentType = (req.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (!(contentType in BLOCKER_MEDIA_TYPES)) {
    throw new HttpError(415, `Content-Type must be one of ${Object.keys(BLOCKER_MEDIA_TYPES).join(', ')}`);
  }
  const type = contentType as BlockerMediaType;
  const kind = BLOCKER_MEDIA_TYPES[type];
  const bytes = req.raw ?? Buffer.from(req.body, 'utf8');
  const max = kind === 'image' ? LIMITS.blockerImageBytes : LIMITS.blockerVideoBytes;
  if (bytes.length === 0) throw new HttpError(400, 'The body is empty; send the file itself');
  if (bytes.length > max) {
    throw new HttpError(413, `The ${kind} is ${bytes.length} bytes; the limit is ${max} (${max / 1024 / 1024} MB). Shrink or trim it.`);
  }
  if (!looksLike(type, bytes)) throw new HttpError(415, `The file doesn't look like ${type}`);

  const found = await ctx.store.getBlocker(id);
  // Only the key that reported it can add to it.
  if (!found || found.keyName !== key.name) throw new HttpError(404, `No blocker with id ${id} for this machine key`);
  if (found.status !== 'open') throw new HttpError(409, `The blocker is ${found.status} already`);
  if (found.media.length >= LIMITS.blockerMedia) throw new HttpError(409, `A blocker holds at most ${LIMITS.blockerMedia} screenshots and videos`);

  const item: BlockerMedia = {
    id: randomUUID(),
    contentType: type,
    kind,
    bytes: bytes.length,
    name: fileName(params.get('name')),
    at: ctx.now().toISOString(),
  };
  await media(ctx).put(`${id}/${item.id}`, bytes, type);
  // Read again: two files sent at once must both be kept.
  const latest = (await ctx.store.getBlocker(id)) ?? found;
  await ctx.store.putBlocker({ ...latest, media: [...latest.media, item] });
  return ok({ ok: true, test: false, stored: item, warnings: [] }, 201);
};

/** GET /api/v1/blocker?id=: one blocker, for the owner or for the key that reported it. */
export const blocker: Handler = async (req, ctx) => {
  const id = blockerId(query(req).get('id'));
  const key = req.headers.get('x-agent-manager-key') ? await requireKey(req, ctx) : null;
  if (!key) requireOwner(req, ctx);
  const found = await ctx.store.getBlocker(id);
  if (!found || (key && found.keyName !== key.name)) throw new HttpError(404, `No blocker with id ${id}`);
  const res: BlockerDetailResponse = { now: ctx.now().toISOString(), blocker: found };
  return ok(res);
};

// ---- The owner ----

/** GET /api/v1/blockers: open blockers, then recently answered ones, with the messages that carried answers. */
export const blockers: Handler = async (req, ctx) => {
  requireOwner(req, ctx);
  const now = ctx.now();
  const since = new Date(now.getTime() - BLOCKER_RECENT_DAYS * 86_400_000).toISOString();
  const list = await ctx.store.listBlockers(since);
  const messages = (
    await Promise.all(list.filter((b) => b.messageId).map((b) => ctx.store.getMessage(b.machine, b.messageId!).catch(() => null)))
  ).filter((m): m is AgentMessage => m !== null);
  const agents: Record<string, BlockerAgentStatus> = {};
  const openAgentIds = [...new Set(list.filter((b) => b.status === 'open').map((b) => b.agentId))];
  for (const a of await Promise.all(openAgentIds.map((id) => ctx.store.getAgent(id)))) {
    if (a) agents[a.id] = { state: effectiveState(a, now.getTime()), noMessages: whyNoMessages(a, now) };
  }
  const res: BlockersResponse = { now: now.toISOString(), blockers: list, messages, agents };
  return ok(res);
};

function parseRange(header: string | null, size: number): MediaRange | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? '');
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start: number;
  let end: number;
  if (m[1] === '') {
    // The last N bytes.
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start > end || start >= size) throw new HttpError(416, `The range ${header} is outside the file (${size} bytes)`);
  return { start, end };
}

/** GET /api/v1/blockers/media?id=<blocker>&media=<id>: the file, with Range support so videos can seek. */
export const blockerMedia: Handler = async (req: Req, ctx) => {
  requireOwner(req, ctx);
  const params = query(req);
  const id = blockerId(params.get('id'));
  const mediaId = params.get('media') ?? '';
  const found = await ctx.store.getBlocker(id);
  const item = found?.media.find((m) => m.id === mediaId);
  if (!found || !item) throw new HttpError(404, 'No such screenshot or video');

  const range = parseRange(req.headers.get('range'), item.bytes);
  const file = await media(ctx).get(`${id}/${item.id}`, range ?? undefined);
  if (!file) throw new HttpError(404, 'The file is gone: it may have aged out');
  const headers: Record<string, string> = {
    'content-type': item.contentType,
    'accept-ranges': 'bytes',
    // The bytes behind an id never change.
    'cache-control': 'private, max-age=86400, immutable',
    // Agents send these files: never let one run as a page.
    'content-security-policy': "default-src 'none'; sandbox",
    'content-disposition': 'inline',
  };
  if (range) headers['content-range'] = `bytes ${range.start}-${range.start + file.bytes.length - 1}/${file.size}`;
  return { status: range ? 206 : 200, body: null, bytes: file.bytes, headers };
};

/** What the session is told when the owner answers. */
function answerText(b: Blocker, status: 'resolved' | 'dismissed', resolution: string | null, login: string): string {
  const head =
    status === 'resolved'
      ? `${login} resolved your blocker "${b.title}" (agentctl blocker ${b.id}).`
      : `${login} dismissed your blocker "${b.title}" (agentctl blocker ${b.id}): they won't act on it, so carry on without it or stop and say why.`;
  return resolution ? `${head}\n\n${resolution}` : head;
}

/** POST /api/v1/blockers/resolve: the owner answers a blocker, or dismisses it. */
export const resolveBlocker: Handler = async (req, ctx) => {
  const owner = requireOwnerWrite(req, ctx);
  const body = readJson(req, MAX_BODY);
  const id = blockerId(typeof field(body, 'id') === 'string' ? (field(body, 'id') as string) : null);
  const status = field(body, 'status');
  if (status !== 'resolved' && status !== 'dismissed') throw new HttpError(400, 'status must be resolved or dismissed');
  const resolution = optionalText(body, 'resolution', LIMITS.blockerResolutionLength);

  const found = await ctx.store.getBlocker(id);
  if (!found) throw new HttpError(404, `No blocker with id ${id}`);
  if (found.status !== 'open') {
    throw new HttpError(409, `The blocker was ${found.status} already${found.resolvedBy ? ` by ${found.resolvedBy}` : ''}`);
  }

  const now = ctx.now();
  const at = now.toISOString();
  const agent = await ctx.store.getAgent(found.agentId);
  const refused = agent ? whyNoMessages(agent, now) : 'The agent is gone';
  let delivery: string;
  let messageId: string | null = null;
  if (agent && !refused) {
    const text = answerText(found, status, resolution, owner.login);
    const verb = status === 'resolved' ? 'Answer to blocker' : 'Blocker dismissed';
    const message = await queueMessage(ctx, agent, text, owner.login, `${verb} sent by ${owner.login}: ${preview(resolution ?? found.title)}`);
    messageId = message.id;
    delivery = `Sent to the session as a message. It arrives if messages are on for ${found.machine}.`;
  } else {
    const why = refused!.charAt(0).toLowerCase() + refused!.slice(1);
    delivery = `Not sent as a message: ${why}. The agent sees the answer when it checks the blocker.`;
  }

  const done: Blocker = { ...found, status, resolvedAt: at, resolvedBy: owner.login, resolution, delivery, messageId };
  await ctx.store.putBlocker(done);
  const verb = status === 'resolved' ? 'resolved' : 'dismissed';
  await ctx.store.addEvents([blockerEvent(found.agentId, `Blocker ${verb} by ${owner.login}${resolution ? `: ${preview(resolution)}` : ''}`, at)]);
  return ok({ blocker: done });
};
