import type { ApiError } from '@agent-manager/shared';
import type { Config } from './config';

export class SendError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** POSTs JSON to the Agent Manager API and returns the parsed answer, or throws a SendError with the server's reason. */
export async function post<T>(config: Config, path: string, body: unknown, timeoutMs = 5000): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${config.url}/api/v1${path}`, {
      method: 'POST',
      // Not Authorization: Static Web Apps replaces that header before the API sees it.
      headers: { 'content-type': 'application/json', 'x-agent-manager-key': config.key },
      body: JSON.stringify(body),
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
