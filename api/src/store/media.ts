// Where blocker screenshots and videos are kept. Azure Blob Storage in Azure (its REST API,
// signed with the account key, so the bundle needs no SDK); a folder on disk off Azure.
// Cosmos documents are capped at 2 MB, which a screenshot can pass and a video always does.

import { createHmac } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inAzure } from './index';

export interface MediaRange {
  start: number;
  /** Inclusive. */
  end: number;
}

export interface MediaFile {
  bytes: Buffer;
  /** The whole file's size, which is more than bytes.length when a range was asked for. */
  size: number;
}

export interface MediaStore {
  put(name: string, bytes: Buffer, contentType: string): Promise<void>;
  /** Null when there's no such file. */
  get(name: string, range?: MediaRange): Promise<MediaFile | null>;
  delete(name: string): Promise<void>;
}

/** Names are made by the API (`<blockerId>/<mediaId>`), never by callers. */
const NAME = /^[A-Za-z0-9-]+\/[A-Za-z0-9-]+$/;

function checkName(name: string) {
  if (!NAME.test(name)) throw new Error(`Bad media name ${name}`);
}

// ---- Off Azure: files in a folder ----

export class FolderMediaStore implements MediaStore {
  constructor(private readonly dir: string) {}

  private file(name: string) {
    checkName(name);
    return join(this.dir, ...name.split('/'));
  }

  async put(name: string, bytes: Buffer) {
    const file = this.file(name);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, bytes);
  }

  async get(name: string, range?: MediaRange) {
    const file = this.file(name);
    if (!existsSync(file)) return null;
    const all = readFileSync(file);
    return { bytes: range ? all.subarray(range.start, range.end + 1) : all, size: statSync(file).size };
  }

  async delete(name: string) {
    rmSync(this.file(name), { force: true });
  }
}

/** For tests: nothing touches the disk. */
export class MemoryMediaStore implements MediaStore {
  readonly files = new Map<string, { bytes: Buffer; contentType: string }>();

  async put(name: string, bytes: Buffer, contentType: string) {
    checkName(name);
    this.files.set(name, { bytes: Buffer.from(bytes), contentType });
  }
  async get(name: string, range?: MediaRange) {
    const f = this.files.get(name);
    if (!f) return null;
    return { bytes: range ? f.bytes.subarray(range.start, range.end + 1) : f.bytes, size: f.bytes.length };
  }
  async delete(name: string) {
    this.files.delete(name);
  }
}

// ---- Azure Blob Storage ----

const API_VERSION = '2021-08-06';
const TIMEOUT_MS = 30_000;

export class BlobMediaStore implements MediaStore {
  private readonly key: Buffer;
  private containerReady = false;

  constructor(
    private readonly account: string,
    key: string,
    private readonly container: string,
  ) {
    this.key = Buffer.from(key, 'base64');
  }

  /** A Shared Key signed request (https://learn.microsoft.com/rest/api/storageservices/authorize-with-shared-key). */
  private async request(
    method: 'GET' | 'PUT' | 'DELETE',
    path: string,
    opts: { query?: Record<string, string>; headers?: Record<string, string>; body?: Buffer } = {},
  ): Promise<Response> {
    const query = opts.query ?? {};
    const headers: Record<string, string> = { 'x-ms-date': new Date().toUTCString(), 'x-ms-version': API_VERSION, ...opts.headers };
    const length = opts.body?.length ?? 0;
    const msHeaders = Object.keys(headers)
      .filter((h) => h.startsWith('x-ms-'))
      .sort()
      .map((h) => `${h}:${headers[h]}\n`)
      .join('');
    const resource =
      `/${this.account}${path}` +
      Object.keys(query)
        .sort()
        .map((q) => `\n${q}:${query[q]}`)
        .join('');
    const toSign = [
      method,
      '', // Content-Encoding
      '', // Content-Language
      length ? String(length) : '',
      '', // Content-MD5
      headers['content-type'] ?? '',
      '', // Date: x-ms-date is used instead
      '', // If-Modified-Since
      '', // If-Match
      '', // If-None-Match
      '', // If-Unmodified-Since
      headers.range ?? '',
    ].join('\n');
    const signature = createHmac('sha256', this.key).update(`${toSign}\n${msHeaders}${resource}`, 'utf8').digest('base64');
    const qs = new URLSearchParams(query).toString();
    return fetch(`https://${this.account}.blob.core.windows.net${path}${qs ? `?${qs}` : ''}`, {
      method,
      headers: { ...headers, authorization: `SharedKey ${this.account}:${signature}` },
      body: opts.body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }

  private blobPath(name: string) {
    checkName(name);
    return `/${this.container}/${name}`;
  }

  private async fail(what: string, res: Response): Promise<never> {
    const text = await res.text().catch(() => '');
    const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1] ?? res.statusText;
    throw new Error(`Blob storage ${what} answered ${res.status} ${code}`);
  }

  private async ensureContainer() {
    if (this.containerReady) return;
    const res = await this.request('PUT', `/${this.container}`, { query: { restype: 'container' } });
    if (!res.ok && res.status !== 409) await this.fail('create container', res); // 409: it's there already
    this.containerReady = true;
  }

  async put(name: string, bytes: Buffer, contentType: string) {
    await this.ensureContainer();
    const res = await this.request('PUT', this.blobPath(name), {
      headers: { 'content-type': contentType, 'x-ms-blob-type': 'BlockBlob' },
      body: bytes,
    });
    if (!res.ok) await this.fail('upload', res);
  }

  async get(name: string, range?: MediaRange) {
    const res = await this.request('GET', this.blobPath(name), {
      headers: range ? { range: `bytes=${range.start}-${range.end}` } : {},
    });
    if (res.status === 404) return null;
    if (!res.ok) await this.fail('download', res);
    const bytes = Buffer.from(await res.arrayBuffer());
    const total = /\/(\d+)$/.exec(res.headers.get('content-range') ?? '')?.[1];
    return { bytes, size: total ? Number(total) : bytes.length };
  }

  async delete(name: string) {
    const res = await this.request('DELETE', this.blobPath(name));
    if (!res.ok && res.status !== 404) await this.fail('delete', res);
  }
}

let media: MediaStore | undefined;

/**
 * Blob Storage when BLOB_ACCOUNT and BLOB_KEY are set. Otherwise a local folder, which is only
 * allowed off Azure. Null in Azure without storage: blockers still work, without screenshots.
 */
export function getMediaStore(env: Record<string, string | undefined>): MediaStore | null {
  if (media) return media;
  if (env.BLOB_ACCOUNT && env.BLOB_KEY) {
    media = new BlobMediaStore(env.BLOB_ACCOUNT, env.BLOB_KEY, env.BLOB_CONTAINER || 'blocker-media');
  } else if (inAzure(env)) {
    return null;
  } else {
    media = new FolderMediaStore(env.LOCAL_MEDIA_PATH || '.local-media');
  }
  return media;
}
