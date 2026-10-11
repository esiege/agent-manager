// Time formatting, plus a shared one-second clock so relative times stay current.

import { useSyncExternalStore } from 'react';

// ---- Clock ----

let clientNow = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!timer) {
    clientNow = Date.now();
    timer = setInterval(() => {
      clientNow = Date.now();
      listeners.forEach((l) => l());
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

/** The browser's time, updated every second. */
export function useClientNow(): number {
  return useSyncExternalStore(subscribe, () => clientNow);
}

// Server timestamps are compared against the server's clock, so a PC whose clock is off still shows right.
let serverOffsetMs = 0;

export function syncServerClock(serverNowIso: string): void {
  const t = Date.parse(serverNowIso);
  if (!Number.isNaN(t)) serverOffsetMs = t - Date.now();
}

/** "12s ago" for a server timestamp, re-rendering only when the text changes. */
export function useAgo(iso: string | null | undefined): string {
  return useSyncExternalStore(subscribe, () => (iso ? formatAgo(clientNow + serverOffsetMs - Date.parse(iso)) : ''));
}

// ---- Formatting ----

export function formatAgo(ms: number): string {
  if (!Number.isFinite(ms)) return '';
  if (ms < 5_000) return 'just now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const absoluteFormat = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const preciseFormat = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  fractionalSecondDigits: 3,
  hourCycle: 'h23',
});

function toDate(iso: string): Date | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "Oct 10, 2026, 06:22:05 PM" in the browser's locale. */
export function formatAbsolute(iso: string | null | undefined): string {
  const d = iso ? toDate(iso) : null;
  return d ? absoluteFormat.format(d) : '';
}

/** "Oct 10, 18:22:05.123": for logs and timelines, where order within a second matters. */
export function formatPrecise(iso: string | null | undefined): string {
  const d = iso ? toDate(iso) : null;
  return d ? preciseFormat.format(d) : '';
}

/** ISO 8601 to the value a `datetime-local` input expects, in local time. */
export function isoToLocalInput(iso: string): string {
  const d = toDate(iso);
  if (!d) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A `datetime-local` value (local time) to ISO 8601, or '' when empty or invalid. */
export function localInputToIso(value: string): string {
  if (!value) return '';
  const d = toDate(value);
  return d ? d.toISOString() : '';
}

/** A compact timestamp for file names: 2026-10-10T18-22-05. */
export function fileStamp(date = new Date()): string {
  return date.toISOString().slice(0, 19).replace(/:/g, '-');
}
