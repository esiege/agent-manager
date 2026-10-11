// Framework-neutral request and response types, so handlers can be tested without the Functions host.

import type { ApiError } from '@agent-manager/shared';
import type { Store } from './store/types';

export interface Req {
  method: string;
  url: string;
  headers: Headers;
  /** Raw body text; empty for GET. */
  body: string;
}

export interface Res {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export interface Ctx {
  store: Store;
  now: () => Date;
  env: Record<string, string | undefined>;
}

export type Handler = (req: Req, ctx: Ctx) => Promise<Res>;

/** Thrown anywhere in a handler to answer with a one-line error (R-05). */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function ok(body: unknown, status = 200): Res {
  return { status, body };
}

export function fail(status: number, error: string): Res {
  const body: ApiError = { error };
  return { status, body };
}

/** Parses a JSON body, refusing bodies over `maxBytes`. */
export function readJson(req: Req, maxBytes: number): unknown {
  const bytes = Buffer.byteLength(req.body, 'utf8');
  if (bytes > maxBytes) {
    throw new HttpError(413, `The body is ${bytes} bytes; the limit for this call is ${maxBytes}`);
  }
  if (req.body.trim() === '') throw new HttpError(400, 'The body is empty; send a JSON object');
  try {
    return JSON.parse(req.body);
  } catch (e) {
    throw new HttpError(400, `The body isn't valid JSON: ${(e as Error).message}`);
  }
}

export function query(req: Req): URLSearchParams {
  return new URL(req.url).searchParams;
}

/** The public origin of the site, for links in responses. */
export function publicOrigin(req: Req, env: Ctx['env']): string {
  if (env.PUBLIC_URL) return env.PUBLIC_URL.replace(/\/+$/, '');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  const proto = req.headers.get('x-forwarded-proto') ?? new URL(req.url).protocol.replace(':', '');
  return host ? `${proto}://${host}` : new URL(req.url).origin;
}

/** Wraps a handler so thrown HttpErrors become responses and anything else becomes a logged 500. */
export function guarded(handler: Handler, log: (msg: string) => void = console.error): Handler {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (e) {
      if (e instanceof HttpError) return fail(e.status, e.message);
      log(`Unhandled error on ${req.method} ${req.url}: ${(e as Error).stack ?? e}`);
      return fail(500, `Server error: ${(e as Error).message}`);
    }
  };
}
