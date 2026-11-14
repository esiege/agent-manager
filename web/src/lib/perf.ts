// The Performance tab's sums: sessions compared by machine, build or GPU, and one session's
// samples shaped for its charts. Pure, so it can be tested without a browser.

import {
  addPerfSamples,
  emptyPerfTotals,
  mergePerfTotals,
  perfStats,
  type PerfBound,
  type PerfSample,
  type PerfSession,
  type PerfStats,
} from '@agent-manager-delux/shared';

export const GROUP_BY = ['machine', 'build', 'gpu', 'game'] as const;
export type GroupBy = (typeof GROUP_BY)[number];

export const GROUP_LABEL: Record<GroupBy, string> = {
  machine: 'Machine',
  build: 'Build',
  gpu: 'GPU',
  game: 'Game',
};
const UNKNOWN: Record<GroupBy, string> = {
  machine: '(no machine)',
  build: '(no build)',
  gpu: '(GPU not sent)',
  game: '(no game)',
};

export interface SessionFilters {
  game: string | null;
  machine: string | null;
  build: string | null;
}

export function filterSessions(sessions: PerfSession[], f: SessionFilters): PerfSession[] {
  return sessions.filter((s) => (!f.game || s.game === f.game) && (!f.machine || s.machine === f.machine) && (!f.build || s.build === f.build));
}

/** The values a filter can take, most recently seen first (sessions arrive newest first). */
export function distinct(sessions: PerfSession[], field: 'game' | 'machine' | 'build'): string[] {
  return [...new Set(sessions.map((s) => s[field]).filter((v): v is string => !!v))];
}

export interface GroupRow {
  name: string;
  sessions: number;
  /** How many different machines the sessions ran on. */
  machines: number;
  stats: PerfStats;
}

/** Sessions added together by machine, build, GPU or game; the slowest (lowest FPS) first. */
export function groupSessions(sessions: PerfSession[], by: GroupBy): GroupRow[] {
  const groups = new Map<string, PerfSession[]>();
  for (const s of sessions) {
    const name = s[by] || UNKNOWN[by];
    groups.set(name, [...(groups.get(name) ?? []), s]);
  }
  return [...groups.entries()]
    .map(([name, list]) => ({
      name,
      sessions: list.length,
      machines: new Set(list.map((s) => s.machine)).size,
      stats: perfStats(mergePerfTotals(list.map((s) => s.totals))),
    }))
    .sort((a, b) => (a.stats.avgFps ?? Infinity) - (b.stats.avgFps ?? Infinity) || a.name.localeCompare(b.name));
}

// ---- One session's charts ----

export interface ChartPoint {
  /** Time into the session, as m:ss or h:mm:ss. */
  time: string;
  t: number;
  fps: number;
  frameMsP50?: number;
  frameMsP95?: number;
  frameMsP99?: number;
  frameMsMax?: number;
  cpuMs?: number;
  gameMs?: number;
  renderMs?: number;
  gpuMs?: number;
  memoryMb?: number;
  vramMb?: number;
  pingMs?: number;
  drawCalls?: number;
  [metric: string]: number | string | undefined;
}

/** Spikes are what you're looking for, so merged points keep the worst of these, and the mean of the rest. */
const KEEP_WORST = new Set(['frameMsP95', 'frameMsP99', 'frameMsMax', 'memoryMb', 'vramMb']);
const BUILT_IN = [
  'frameMsP50',
  'frameMsP95',
  'frameMsP99',
  'frameMsMax',
  'cpuMs',
  'gameMs',
  'renderMs',
  'gpuMs',
  'memoryMb',
  'vramMb',
  'pingMs',
  'drawCalls',
] as const;

const round = (n: number) => Math.round(n * 100) / 100;

/** Samples as chart points, merged down to at most `maxPoints` so a long session still draws fast. */
export function chartPoints(samples: PerfSample[], maxPoints = 600): ChartPoint[] {
  const per = Math.max(1, Math.ceil(samples.length / maxPoints));
  const points: ChartPoint[] = [];
  for (let i = 0; i < samples.length; i += per) {
    const chunk = samples.slice(i, i + per);
    const last = chunk[chunk.length - 1]!;
    const frames = chunk.reduce((n, s) => n + s.frames, 0);
    const seconds = chunk.reduce((n, s) => n + s.seconds, 0);
    const point: ChartPoint = {
      time: formatClock(last.t),
      t: last.t,
      fps: round(seconds > 0 ? frames / seconds : 0),
    };
    const values = new Map<string, number[]>();
    for (const s of chunk) {
      for (const field of BUILT_IN) if (s[field] !== undefined) values.set(field, [...(values.get(field) ?? []), s[field]]);
      for (const [name, v] of Object.entries(s.metrics ?? {})) values.set(`m:${name}`, [...(values.get(`m:${name}`) ?? []), v]);
    }
    for (const [field, list] of values) {
      point[field] = round(KEEP_WORST.has(field) ? Math.max(...list) : list.reduce((a, b) => a + b, 0) / list.length);
    }
    points.push(point);
  }
  return points;
}

/** The custom metrics the samples carry, by name. On a chart point they are under `m:<name>`. */
export function metricNames(samples: PerfSample[]): string[] {
  const names = new Set<string>();
  for (const s of samples) for (const name of Object.keys(s.metrics ?? {})) names.add(name);
  return [...names].sort();
}

export interface SceneRow {
  scene: string;
  stats: PerfStats;
}

/** Where the time went, and how each scene ran; the slowest first. */
export function byScene(samples: PerfSample[]): SceneRow[] {
  const scenes = new Map<string, PerfSample[]>();
  for (const s of samples) {
    const scene = s.scene ?? '(no scene)';
    scenes.set(scene, [...(scenes.get(scene) ?? []), s]);
  }
  return [...scenes.entries()]
    .map(([scene, list]) => ({
      scene,
      stats: perfStats(addPerfSamples(emptyPerfTotals(), list)),
    }))
    .sort((a, b) => (a.stats.avgFps ?? Infinity) - (b.stats.avgFps ?? Infinity));
}

// ---- Formatting ----

/** What took longest in the average frame, as it reads after "limited by". */
export const BOUND_LABEL: Record<PerfBound, string> = { cpu: 'the CPU', game: 'the game thread', render: 'the render thread', gpu: 'the GPU' };
/** The same, short enough for a table cell. */
export const BOUND_SHORT: Record<PerfBound, string> = { cpu: 'CPU', game: 'Game thread', render: 'Render thread', gpu: 'GPU' };

const DASH = '–';

export function formatFps(fps: number | null): string {
  if (fps === null) return DASH;
  return fps === 0 ? '0' : fps < 10 ? fps.toFixed(1) : String(Math.round(fps));
}

export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return DASH;
  if (ms === 0) return '0 ms';
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
  return `${ms < 100 ? ms.toFixed(1) : Math.round(ms)} ms`;
}

export function formatMb(mb: number | null | undefined): string {
  if (mb === null || mb === undefined) return DASH;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

export function formatRate(perMinute: number | null): string {
  if (perMinute === null) return DASH;
  return perMinute === 0 ? '0' : perMinute < 10 ? perMinute.toFixed(1) : String(Math.round(perMinute));
}

/** "42 s", "12 min", "3.5 h": how long something ran. */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
}

/** Time into a session: 4:05, or 1:04:05 past the hour. */
export function formatClock(t: number): string {
  const s = Math.floor(t);
  const pad = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/** "RTX 4070 · Ryzen 7 7800X3D (8 cores) · 32 GB · 2560x1440 @ 144 Hz · Windows 11" */
export function hardwareLine(s: PerfSession): string {
  const parts = [
    s.gpu && (s.vramMb ? `${s.gpu} (${formatMb(s.vramMb)})` : s.gpu),
    s.cpu && (s.cpuCores ? `${s.cpu} (${s.cpuCores} cores)` : s.cpu),
    s.ramMb ? `${formatMb(s.ramMb)} RAM` : null,
    s.resolution && (s.refreshHz ? `${s.resolution} @ ${s.refreshHz} Hz` : s.resolution),
    s.os ?? s.platform,
  ];
  return parts.filter(Boolean).join(' · ');
}
