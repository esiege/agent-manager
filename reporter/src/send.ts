import type { ApiError } from '@agent-manager-deluxe/shared';
import type { Config } from './config';

export class SendError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** POSTs JSON to the Agent Manager Deluxe API and returns the parsed answer, or throws a SendError with the server's reason. */
export function post<T>(config: Config, path: string, body: unknown, timeoutMs = 5000): Promise<T> {
  return call<T>(config, 'POST', path, body, timeoutMs);
}

/** GETs from the Agent Manager Deluxe API with the machine key. */
export function get<T>(config: Config, path: string, timeoutMs = 15_000): Promise<T> {
  return call<T>(config, 'GET', path, undefined, timeoutMs);
}

/** POSTs a file (its bytes, with its Content-Type) to the Agent Manager Deluxe API. */
export function postFile<T>(config: Config, path: string, bytes: Buffer, contentType: string, timeoutMs = 120_000): Promise<T> {
  return call<T>(config, 'POST', path, { bytes, contentType }, timeoutMs);
}

interface FileBody {
  bytes: Buffer;
  contentType: string;
}

function isFile(body: unknown): body is FileBody {
  return typeof body === 'object' && body !== null && Buffer.isBuffer((body as FileBody).bytes);
}

async function call<T>(config: Config, method: 'GET' | 'POST', path: string, body: unknown, timeoutMs: number): Promise<T> {
  let res: Response;
  const file = isFile(body) ? body : null;
  try {
    res = await fetch(`${config.url}/api/v1${path}`, {
      method,
      // Not Authorization: Static Web Apps replaces that header before the API sees it.
      headers: { 'content-type': file ? file.contentType : 'application/json', 'x-agent-manager-key': config.key },
      body: file ? new Uint8Array(file.bytes) : body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const cause = (e as Error).name === 'TimeoutError' ? `no answer within ${timeoutMs} ms` : (e as Error).message;
    throw new SendError(`Could not reach ${config.url}: ${cause}`);
  }
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SendError(`${config.url} answered ${res.status} with something that isn't JSON; is the URL right?`, res.status);
  }
  if (!res.ok) throw new SendError((parsed as ApiError).error ?? `HTTP ${res.status}`, res.status);
  return parsed as T;
}
