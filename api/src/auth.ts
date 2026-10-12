// Two kinds of caller: the owner, signed in through Static Web Apps, and agents, using machine keys.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { OWNER_WRITE_HEADER, type MachineKey } from '@agent-manager/shared';
import { HttpError, type Ctx, type Req } from './http';
import { inAzure } from './store';
import type { StoredKey } from './store/types';

// ---- The owner ----

export interface Owner {
  login: string;
  provider: string;
}

interface ClientPrincipal {
  identityProvider?: string;
  userDetails?: string;
}

/**
 * The signed-in owner, or a 401/403. Static Web Apps puts the signed-in user in the
 * x-ms-client-principal header; only logins listed in OWNER_LOGINS get in.
 * Off Azure, DEV_OWNER stands in for a signed-in owner so the API can run under `func start`.
 */
export function requireOwner(req: Req, ctx: Ctx): Owner {
  if (ctx.env.DEV_OWNER && !inAzure(ctx.env)) return { login: ctx.env.DEV_OWNER, provider: 'dev' };

  const header = req.headers.get('x-ms-client-principal');
  if (!header) throw new HttpError(401, 'Sign in to use Agent Manager');
  let principal: ClientPrincipal;
  try {
    principal = JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as ClientPrincipal;
  } catch {
    throw new HttpError(401, 'The sign-in header could not be read; sign in again');
  }
  const login = principal.userDetails?.trim();
  if (!login) throw new HttpError(401, 'Sign in to use Agent Manager');

  const owners = (ctx.env.OWNER_LOGINS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (owners.length === 0) throw new HttpError(403, 'OWNER_LOGINS is not set on the server, so nobody can sign in');
  if (!owners.includes(login.toLowerCase())) throw new HttpError(403, `Signed in as ${login}, which isn't the owner account`);
  return { login, provider: principal.identityProvider ?? 'unknown' };
}

/**
 * The owner, for calls that change something. These also need the OWNER_WRITE_HEADER: a page on
 * another site can make the owner's browser POST here with the sign-in cookie, but it can't add
 * a custom header without a CORS preflight, which this site never allows.
 */
export function requireOwnerWrite(req: Req, ctx: Ctx): Owner {
  const owner = requireOwner(req, ctx);
  if (req.headers.get(OWNER_WRITE_HEADER) !== '1') {
    throw new HttpError(403, `Changes must come from the Agent Manager site (the ${OWNER_WRITE_HEADER} header is missing)`);
  }
  return owner;
}

// ---- Machine keys ----

const KEY_FORMAT = /^am_([a-z0-9]{10})_([A-Za-z0-9_-]{43})$/;

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/** A new key: its id, and the full secret the owner copies once ("am_<id>_<random>"). */
export function newKeySecret(): { id: string; secret: string } {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const id = [...randomBytes(10)].map((b) => alphabet[b % alphabet.length]).join('');
  return { id, secret: `am_${id}_${randomBytes(32).toString('base64url')}` };
}

export function publicKey(k: StoredKey): MachineKey {
  return { id: k.id, name: k.name, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt, revokedAt: k.revokedAt };
}

// Verified keys are cached briefly so each report doesn't cost a database read.
// A revoked key therefore keeps working for up to this long on a warm instance.
const KEY_CACHE_MS = 60_000;
const LAST_USED_EVERY_MS = 5 * 60_000;
const keyCache = new Map<string, { key: StoredKey; until: number }>();

/**
 * The machine key, or a 401 that says what's wrong. Agents send it in X-Agent-Manager-Key:
 * Static Web Apps replaces the Authorization header before it reaches the API, so
 * "Authorization: Bearer" only works off Azure.
 */
export async function requireKey(req: Req, ctx: Ctx): Promise<StoredKey> {
  const secret =
    req.headers.get('x-agent-manager-key')?.trim() ||
    /^Bearer\s+(am_\S+)$/i.exec(req.headers.get('authorization') ?? '')?.[1]?.trim();
  if (!secret) {
    throw new HttpError(401, 'Missing machine key: send it in the X-Agent-Manager-Key header (AGENT_MANAGER_KEY)');
  }
  const match = KEY_FORMAT.exec(secret);
  if (!match) throw new HttpError(401, 'That is not an Agent Manager key; keys look like am_<id>_<secret>');
  const id = match[1]!;
  const now = ctx.now().getTime();

  const cached = keyCache.get(id);
  let key = cached && cached.until > now ? cached.key : null;
  if (!key) {
    key = await ctx.store.getKey(id);
    if (key) keyCache.set(id, { key, until: now + KEY_CACHE_MS });
  }
  const given = Buffer.from(hashSecret(secret), 'hex');
  if (!key || !timingSafeEqual(given, Buffer.from(key.hash, 'hex'))) {
    throw new HttpError(401, 'Unknown machine key; make one on the Settings tab');
  }
  if (key.revokedAt) {
    throw new HttpError(401, `This key was revoked on ${key.revokedAt.slice(0, 10)}; make a new one on the Settings tab`);
  }

  checkRate(id, now);

  if (!key.lastUsedAt || now - Date.parse(key.lastUsedAt) > LAST_USED_EVERY_MS) {
    key.lastUsedAt = new Date(now).toISOString();
    await ctx.store.putKey(key);
  }
  return key;
}

/** Forgets cached keys; called when a key is revoked on this instance. */
export function forgetKey(id: string) {
  keyCache.delete(id);
}

// ---- Rate limit (R-07): 10 calls a second per key, bursts up to 20. Per instance. ----

const RATE = 10;
const BURST = 20;
const buckets = new Map<string, { tokens: number; at: number }>();

function checkRate(keyId: string, now: number) {
  const b = buckets.get(keyId) ?? { tokens: BURST, at: now };
  b.tokens = Math.min(BURST, b.tokens + ((now - b.at) / 1000) * RATE);
  b.at = now;
  if (b.tokens < 1) {
    buckets.set(keyId, b);
    throw new HttpError(429, `Too many calls: at most ${RATE} a second per key`);
  }
  b.tokens -= 1;
  buckets.set(keyId, b);
}

/** For tests. */
export function resetAuthState() {
  keyCache.clear();
  buckets.clear();
}
