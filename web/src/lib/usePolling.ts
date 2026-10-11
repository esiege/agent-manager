// Loads data, then reloads it every `intervalMs` while the browser tab is visible (U-09).

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiRequestError, toRequestError } from './api';
import { notifyError } from './notify';

export interface Polled<T> {
  data: T | undefined;
  error: ApiRequestError | null;
  /** True while a request is in flight. */
  loading: boolean;
  /** When data last arrived (browser clock, ms). */
  updatedAt: number | null;
  /** Reloads now. */
  refresh: () => void;
}

export interface PollOptions {
  /** null loads once (and on refresh) without polling. */
  intervalMs: number | null;
  /** Statuses shown in the page rather than as a notification, for example 404. */
  quietStatuses?: readonly number[];
}

interface Snapshot<T> {
  key: string;
  data: T | undefined;
  error: ApiRequestError | null;
  updatedAt: number | null;
}

/**
 * `key` identifies what is loaded: when it changes, the data is dropped and loaded again.
 * Errors show as a notification once, not on every poll, until a load succeeds again.
 * A 401 shows nothing here: the sign-in gate takes over.
 */
export function usePolling<T>(key: string, load: (signal: AbortSignal) => Promise<T>, options: PollOptions): Polled<T> {
  const { intervalMs } = options;
  const loadRef = useRef(load);
  const quietRef = useRef(options.quietStatuses);
  useEffect(() => {
    loadRef.current = load;
    quietRef.current = options.quietStatuses;
  });

  const [snapshot, setSnapshot] = useState<Snapshot<T>>({ key, data: undefined, error: null, updatedAt: null });
  const [loading, setLoading] = useState(true);
  const runRef = useRef<() => void>(() => {});
  const lastErrorRef = useRef<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;

    const schedule = () => {
      clearTimeout(timer);
      if (intervalMs !== null && document.visibilityState === 'visible') timer = setTimeout(run, intervalMs);
    };

    async function run() {
      clearTimeout(timer);
      controller?.abort();
      const current = new AbortController();
      controller = current;
      setLoading(true);
      try {
        const data = await loadRef.current(current.signal);
        if (current.signal.aborted) return;
        lastErrorRef.current = null;
        setSnapshot({ key, data, error: null, updatedAt: Date.now() });
      } catch (e) {
        if (current.signal.aborted) return;
        const error = toRequestError(e);
        setSnapshot((s) => (s.key === key ? { ...s, error } : { key, data: undefined, error, updatedAt: null }));
        const quiet = error.status === 401 || (quietRef.current?.includes(error.status) ?? false);
        if (!quiet && error.message !== lastErrorRef.current) notifyError(error);
        lastErrorRef.current = error.message;
      } finally {
        if (!current.signal.aborted) {
          setLoading(false);
          schedule();
        }
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') clearTimeout(timer);
      else if (intervalMs !== null) void run();
    };

    runRef.current = () => void run();
    void run();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [key, intervalMs]);

  const refresh = useCallback(() => runRef.current(), []);
  const current = snapshot.key === key ? snapshot : { data: undefined, error: null, updatedAt: null };
  return { data: current.data, error: current.error, loading, updatedAt: current.updatedAt, refresh };
}
