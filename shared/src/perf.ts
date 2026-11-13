// A performance session's numbers, added up from its samples.

import {
  LIMITS,
  PERF_LIVE_SECONDS,
  type PerfHitch,
  type PerfSample,
  type PerfSampleInput,
  type PerfSession,
  type PerfTotals,
  type PerfWeighted,
} from './contract';

export function emptyPerfTotals(): PerfTotals {
  const none = (): PerfWeighted => ({ sum: 0, frames: 0 });
  return {
    samples: 0,
    frames: 0,
    seconds: 0,
    hitches: 0,
    frameMsMax: null,
    memoryMbMax: null,
    vramMbMax: null,
    frameMsP50: none(),
    frameMsP95: none(),
    frameMsP99: none(),
    cpuMs: none(),
    gameMs: none(),
    renderMs: none(),
    gpuMs: none(),
  };
}

const WEIGHTED = ['frameMsP50', 'frameMsP95', 'frameMsP99', 'cpuMs', 'gameMs', 'renderMs', 'gpuMs'] as const;

function max(a: number | null, b: number | undefined): number | null {
  return b === undefined ? a : a === null ? b : Math.max(a, b);
}

/** The totals with these samples added. */
export function addPerfSamples(totals: PerfTotals, samples: PerfSampleInput[]): PerfTotals {
  const out: PerfTotals = { ...totals };
  for (const field of WEIGHTED) out[field] = { ...totals[field] };
  for (const s of samples) {
    out.samples += 1;
    out.frames += s.frames;
    out.seconds += s.seconds;
    out.hitches += s.hitches ?? 0;
    out.frameMsMax = max(out.frameMsMax, s.frameMsMax);
    out.memoryMbMax = max(out.memoryMbMax, s.memoryMb);
    out.vramMbMax = max(out.vramMbMax, s.vramMb);
    for (const field of WEIGHTED) {
      const v = s[field];
      if (v === undefined || s.frames === 0) continue;
      out[field].sum += v * s.frames;
      out[field].frames += s.frames;
    }
  }
  return out;
}

/** The numbers shown for a session, or for several added together. Null: nothing measured it. */
export interface PerfStats {
  samples: number;
  seconds: number;
  frames: number;
  avgFps: number | null;
  /** Average frame time: the time measured over the frames drawn. */
  frameMsAvg: number | null;
  /**
   * The windows' percentiles averaged by their frames. Close to the percentile over the whole
   * run, not equal to it: percentiles of separate windows can't be combined exactly.
   */
  frameMsP50: number | null;
  frameMsP95: number | null;
  frameMsP99: number | null;
  /** The single slowest frame. */
  frameMsMax: number | null;
  hitches: number;
  hitchesPerMinute: number | null;
  cpuMs: number | null;
  gameMs: number | null;
  renderMs: number | null;
  gpuMs: number | null;
  /** What took longest in the average frame, so what to work on first. Null: fewer than two were measured. */
  bound: PerfBound | null;
  memoryMbMax: number | null;
  vramMbMax: number | null;
}

export const PERF_BOUNDS = ['cpu', 'game', 'render', 'gpu'] as const;
export type PerfBound = (typeof PERF_BOUNDS)[number];

export function perfStats(t: PerfTotals): PerfStats {
  const mean = (w: PerfWeighted | undefined) => (w && w.frames > 0 ? w.sum / w.frames : null);
  const parts = PERF_BOUNDS.map((name) => ({ name, ms: mean(t[`${name}Ms`]) })).filter((p): p is { name: PerfBound; ms: number } => p.ms !== null);
  const bound = parts.length >= 2 ? parts.reduce((a, b) => (b.ms > a.ms ? b : a)).name : null;
  return {
    samples: t.samples,
    seconds: t.seconds,
    frames: t.frames,
    avgFps: t.seconds > 0 ? t.frames / t.seconds : null,
    frameMsAvg: t.frames > 0 ? (t.seconds * 1000) / t.frames : null,
    frameMsP50: mean(t.frameMsP50),
    frameMsP95: mean(t.frameMsP95),
    frameMsP99: mean(t.frameMsP99),
    frameMsMax: t.frameMsMax,
    hitches: t.hitches,
    hitchesPerMinute: t.seconds > 0 ? (t.hitches / t.seconds) * 60 : null,
    cpuMs: mean(t.cpuMs),
    gameMs: mean(t.gameMs),
    renderMs: mean(t.renderMs),
    gpuMs: mean(t.gpuMs),
    bound,
    memoryMbMax: t.memoryMbMax,
    vramMbMax: t.vramMbMax,
  };
}

/** Several sessions' totals as one, for comparing machines or builds. */
export function mergePerfTotals(all: PerfTotals[]): PerfTotals {
  const out = emptyPerfTotals();
  for (const t of all) {
    out.samples += t.samples;
    out.frames += t.frames;
    out.seconds += t.seconds;
    out.hitches += t.hitches;
    out.frameMsMax = max(out.frameMsMax, t.frameMsMax ?? undefined);
    out.memoryMbMax = max(out.memoryMbMax, t.memoryMbMax ?? undefined);
    out.vramMbMax = max(out.vramMbMax, t.vramMbMax ?? undefined);
    for (const field of WEIGHTED) {
      out[field].sum += t[field].sum;
      out[field].frames += t[field].frames;
    }
  }
  return out;
}

/** The worst hitches of both lists, worst first. One frame reported twice (same `t`) is kept once. */
export function worstPerfHitches(kept: PerfHitch[], more: PerfHitch[]): PerfHitch[] {
  const byTime = new Map<number, PerfHitch>();
  for (const h of [...kept, ...more]) byTime.set(Math.round(h.t * 1000), h);
  return [...byTime.values()].sort((a, b) => b.frameMs - a.frameMs || a.t - b.t).slice(0, LIMITS.perfHitchesKept);
}

export function perfSampleId(sessionId: string, t: number): string {
  return `${sessionId}:${Math.round(t * 1000)}`;
}

/** Still running: not ended, and heard from lately. */
export function perfSessionLive(s: Pick<PerfSession, 'endedAt' | 'lastSeen'>, nowMs: number): boolean {
  return !s.endedAt && nowMs - Date.parse(s.lastSeen) <= PERF_LIVE_SECONDS * 1000;
}

/** Frames per second over one sample's window. */
export function sampleFps(s: Pick<PerfSample, 'frames' | 'seconds'>): number {
  return s.seconds > 0 ? s.frames / s.seconds : 0;
}
