import { addPerfSamples, emptyPerfTotals, type PerfSample, type PerfSampleInput, type PerfSession } from '@agent-manager-delux/shared';
import { describe, expect, it } from 'vitest';
import { byScene, chartPoints, distinct, filterSessions, formatClock, formatDuration, formatMb, formatMs, groupSessions, hardwareLine, metricNames } from '../src/lib/perf';

const session = (id: string, extra: Partial<PerfSession>, samples: PerfSampleInput[]): PerfSession => ({
  id,
  game: 'musik',
  machine: 'pc-studio',
  build: '0.4.2',
  platform: 'windows',
  cpu: null,
  gpu: null,
  cpuCores: null,
  ramMb: null,
  vramMb: null,
  os: null,
  resolution: null,
  refreshHz: null,
  loadSeconds: null,
  worstHitches: [],
  details: {},
  startedAt: '2026-11-13T12:00:00.000Z',
  lastSeen: '2026-11-13T12:10:00.000Z',
  endedAt: null,
  totals: addPerfSamples(emptyPerfTotals(), samples),
  keyName: 'musik',
  ...extra,
});

const sample = (t: number, extra: Partial<PerfSample> = {}): PerfSample => ({
  id: `s:${t * 1000}`,
  sessionId: 's',
  receivedAt: '2026-11-13T12:00:00.000Z',
  t,
  seconds: 10,
  frames: 600,
  ...extra,
});

const sessions = [
  session('a', { gpu: 'RTX 4070' }, [{ t: 10, seconds: 100, frames: 12_000, frameMsP99: 12, hitches: 0 }]),
  session('b', { gpu: 'RTX 4070', build: '0.4.3' }, [{ t: 10, seconds: 100, frames: 10_000, frameMsP99: 20, hitches: 5 }]),
  session('c', { machine: 'laptop', gpu: 'Iris Xe' }, [{ t: 10, seconds: 200, frames: 6000, frameMsP99: 80, frameMsMax: 400, hitches: 40 }]),
  session('d', { machine: 'deck', game: 'other-game', build: null }, []),
];

describe('comparing sessions', () => {
  it('adds sessions up by machine, slowest first', () => {
    const rows = groupSessions(filterSessions(sessions, { game: 'musik', machine: null, build: null }), 'machine');
    expect(rows.map((r) => [r.name, r.sessions, r.stats.avgFps])).toEqual([
      ['laptop', 1, 30],
      ['pc-studio', 2, 110],
    ]);
    // 99th percentiles combine by frames: (12 * 12000 + 20 * 10000) / 22000.
    expect(rows[1]!.stats.frameMsP99).toBeCloseTo(15.64, 2);
    expect(rows[0]!.stats).toMatchObject({ frameMsMax: 400, hitchesPerMinute: 12 });
  });

  it('groups by build and GPU, naming what was not sent, with unmeasured sessions last', () => {
    expect(groupSessions(sessions, 'build').map((r) => [r.name, r.machines])).toEqual([
      ['0.4.2', 2],
      ['0.4.3', 1],
      ['(no build)', 1],
    ]);
    expect(groupSessions(sessions, 'gpu').map((r) => r.name)).toEqual(['Iris Xe', 'RTX 4070', '(GPU not sent)']);
  });

  it('filters, and lists what a filter can take', () => {
    expect(filterSessions(sessions, { game: 'musik', machine: 'pc-studio', build: '0.4.3' }).map((s) => s.id)).toEqual(['b']);
    expect(distinct(sessions, 'machine')).toEqual(['pc-studio', 'laptop', 'deck']);
    expect(distinct(sessions, 'build')).toEqual(['0.4.2', '0.4.3']);
  });
});

describe('one session', () => {
  const samples = [
    sample(10, { frameMsP99: 20, memoryMb: 900, scene: 'menu', metrics: { entities: 10 } }),
    sample(20, { frameMsP99: 90, memoryMb: 1000, scene: 'level-1', metrics: { entities: 30 } }),
    sample(30, { frames: 300, frameMsP99: 40, scene: 'level-1' }),
    sample(3700, { scene: 'level-1' }),
  ];

  it('turns samples into chart points', () => {
    expect(chartPoints(samples)[1]).toEqual({ time: '0:20', t: 20, fps: 60, frameMsP99: 90, memoryMb: 1000, 'm:entities': 30 });
    expect(chartPoints(samples).map((p) => p.time)).toEqual(['0:10', '0:20', '0:30', '1:01:40']);
    expect(metricNames(samples)).toEqual(['entities']);
  });

  it('merges points on a long session, keeping the spikes', () => {
    const points = chartPoints(samples, 2);
    expect(points).toHaveLength(2);
    // The worst 99th percentile and the peak memory survive; the custom metric is averaged.
    expect(points[0]).toEqual({ time: '0:20', t: 20, fps: 60, frameMsP99: 90, memoryMb: 1000, 'm:entities': 20 });
    expect(points[1]!.fps).toBe(45);
  });

  it('adds up scenes, slowest first', () => {
    expect(byScene(samples).map((r) => [r.scene, r.stats.seconds, r.stats.avgFps])).toEqual([
      ['level-1', 30, 50],
      ['menu', 10, 60],
    ]);
  });
});

describe('formatting', () => {
  it('reads like a person wrote it', () => {
    expect([formatMs(8.333), formatMs(250), formatMs(1500), formatMs(null)]).toEqual(['8.3 ms', '250 ms', '1.50 s', '–']);
    expect([formatMb(512), formatMb(4096)]).toEqual(['512 MB', '4.0 GB']);
    expect([formatDuration(42), formatDuration(600), formatDuration(5400)]).toEqual(['42 s', '10 min', '1.5 h']);
    expect([formatClock(65), formatClock(3665)]).toEqual(['1:05', '1:01:05']);
    expect(hardwareLine(session('x', { gpu: 'RTX 4070', vramMb: 12288, cpu: 'Ryzen 7', cpuCores: 8, ramMb: 32768, resolution: '2560x1440', refreshHz: 144, os: 'Windows 11' }, []))).toBe(
      'RTX 4070 (12.0 GB) · Ryzen 7 (8 cores) · 32.0 GB RAM · 2560x1440 @ 144 Hz · Windows 11',
    );
  });
});
