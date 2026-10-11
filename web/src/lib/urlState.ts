// Filters and sort order live in the URL so a view can be bookmarked (U-10).

import type { OnChangeFn, SortingState } from '@tanstack/react-table';
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';

export type UrlPatch = Record<string, string | readonly string[] | null | undefined>;

/** The current query string, and a way to change several keys at once. Empty values are removed. */
export function useUrlState() {
  const [params, setParams] = useSearchParams();
  const update = useCallback(
    (patch: UrlPatch) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(patch)) {
            next.delete(key);
            if (value === null || value === undefined) continue;
            if (typeof value === 'string') {
              if (value !== '') next.set(key, value);
            } else {
              for (const v of value) if (v !== '') next.append(key, v);
            }
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  return { params, update };
}

/** "-lastSeen,name" means last seen descending, then name ascending. */
export function parseSort(value: string | null, fallback: SortingState): SortingState {
  if (value === null) return fallback;
  return value
    .split(',')
    .filter(Boolean)
    .map((part) => (part.startsWith('-') ? { id: part.slice(1), desc: true } : { id: part, desc: false }));
}

export function formatSort(sorting: SortingState): string {
  return sorting.map((s) => (s.desc ? `-${s.id}` : s.id)).join(',');
}

/** Sort state for a TanStack table, kept in the URL under `key`. */
export function useSortParam(key: string, fallback: SortingState): [SortingState, OnChangeFn<SortingState>] {
  const { params, update } = useUrlState();
  const raw = params.get(key);
  const fallbackText = formatSort(fallback);
  // Parse from the text so the array is stable between renders.
  const sorting = useMemo(() => parseSort(raw ?? fallbackText, []), [raw, fallbackText]);
  const onChange = useCallback<OnChangeFn<SortingState>>(
    (updater) => {
      const next = typeof updater === 'function' ? updater(sorting) : updater;
      const text = formatSort(next);
      update({ [key]: text === fallbackText ? null : text });
    },
    [sorting, update, key, fallbackText],
  );
  return [sorting, onChange];
}
