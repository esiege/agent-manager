import type { ReportingAgent, ReportingResponse } from '@agent-manager-deluxe/shared';
import { describe, expect, it } from 'vitest';
import { allowancePerDay, convertPeriod, planTokens } from '../src/lib/plans';
import { buildReport, formatCost, formatHours } from '../src/lib/reporting';

const agent = (id: string, extra: Partial<ReportingAgent> = {}): ReportingAgent => ({
  id,
  name: id,
  kind: 'claude-code',
  machine: 'pc',
  project: 'game',
  parentId: null,
  story: null,
  workType: null,
  model: null,
  lastSeen: '2026-10-26T12:00:00.000Z',
  ...extra,
});
const tokens = (output: number) => [{ model: 'claude-opus-5-5', input: 0, output, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0 }];

const data: ReportingResponse = {
  now: '2026-10-26T12:00:00.000Z',
  days: 7,
  agents: [
    agent('s1', { story: 'Level 3', workType: 'level-design' }),
    agent('s1/sub', { parentId: 's1', project: null }),
    agent('s2', { project: 'site', lastSeen: '2026-10-26T09:30:00.000Z' }),
  ],
  turns: [
    // Two hours of level design the agent named.
    { agentId: 's1', startedAt: '2026-10-25T10:00:00.000Z', endedAt: '2026-10-25T12:00:00.000Z', outcome: 'finished', prompt: 'Block it out', story: 'Level 3', workType: 'level-design' },
    // Still "running" on an agent that went silent at 09:30: counts to 09:30, not to now.
    { agentId: 's2', startedAt: '2026-10-26T09:00:00.000Z', endedAt: null, outcome: 'running', prompt: 'Add tests for the form', story: null, workType: null },
  ],
  usage: [
    { agentId: 's1', at: '2026-10-25T12:00:00.000Z', usage: tokens(1_000_000), story: 'Level 3', workType: 'level-design' },
    // A sub-agent's tokens go by its parent: the parent's project and work type.
    { agentId: 's1/sub', at: '2026-10-25T11:00:00.000Z', usage: tokens(500_000), story: null, workType: null },
  ],
  results: [{ agentId: 's1', at: '2026-10-25T12:00:00.000Z', title: 'Level 3 blockout', commitUrl: null, story: 'Level 3', workType: 'level-design' }],
};

describe('buildReport', () => {
  it('adds up hours and cost by kind of work, group and project', () => {
    const r = buildReport(data, { project: null });
    expect(r.totals).toMatchObject({ hours: 2.5, requests: 2, finished: 1, ended: 1, results: 1, tokens: 1_500_000 });
    expect(r.totals.cost).toBeCloseTo(30); // 1.5M output tokens at $20 per million
    expect(r.byType.map((t) => [t.type, t.hours])).toEqual([
      ['level-design', 2],
      ['testing', 0.5],
    ]);
    expect(r.byGroup).toEqual({ technical: 0.5, 'non-technical': 2, other: 0 });
    expect(r.costByGroup['non-technical']).toBeCloseTo(30);
    expect(r.byProject.map((p) => [p.project, p.hours])).toEqual([
      ['game', 2],
      ['site', 0.5],
    ]);
    expect(r.byDay).toHaveLength(7);
    expect(r.projects).toEqual(['game', 'site']);
  });

  it('keeps one project', () => {
    const r = buildReport(data, { project: 'site' });
    expect(r.totals).toMatchObject({ hours: 0.5, tokens: 0, results: 0 });
  });

  it('buckets long windows by week', () => {
    expect(buildReport({ ...data, days: 365 }, { project: null }).bucket).toBe('week');
  });
});

describe('formatting', () => {
  it('reads well at every size', () => {
    expect([0.25, 2.5, 140].map(formatHours)).toEqual(['15 min', '2.5 h', '140 h']);
    expect([0, 4.2, 1234, 25_000].map(formatCost)).toEqual(['$0', '$4.20', '$1,234', '$25.0K']);
  });
});

describe('plans', () => {
  it('fills in a plan per week or month, and spreads it over a window', () => {
    expect(planTokens('pro', 'week')).toBe(50);
    expect(planTokens('pro', 'month')).toBe(210);
    expect(planTokens('custom', 'week')).toBeNull();
    expect(convertPeriod(210, 'month', 'week')).toBe(49);
    expect(allowancePerDay({ plan: 'pro', tokens: 70, period: 'week' })).toBe(10_000_000);
  });
});
