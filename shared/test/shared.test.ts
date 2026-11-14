import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  mergeUsage,
  costOf,
  effectiveState,
  INSTRUCTIONS_UPDATED,
  INSTRUCTIONS_VERSION,
  maskDeep,
  maskSecrets,
  validateHeartbeat,
  validateReport,
  workType,
} from '../src';

describe('validateReport', () => {
  const base = { agentId: 'pc/claude/1', kind: 'claude-code', machine: 'pc' };

  it('accepts the smallest report', () => {
    const r = validateReport(base);
    expect(r).toEqual({ ok: true, value: { ...base, details: {} }, warnings: [] });
  });

  it('keeps unknown fields in details, with a warning', () => {
    const r = validateReport({ ...base, model: 'opus', details: { branch: 'main' } });
    expect(r.ok && r.value.details).toEqual({ branch: 'main', model: 'opus' });
    expect(r.ok && r.warnings).toEqual(['Unknown field(s) model were kept in details']);
  });

  it.each([
    [{ ...base, agentId: '' }, 'agentId is required and must be a non-empty string'],
    [{ ...base, kind: 'robot' }, 'kind must be one of claude-code, openclaw, service, other'],
    [{ ...base, state: 'lost' }, 'state must be one of working, waiting, idle, stopped, failed (the manager works out "lost" itself)'],
    [{ ...base, link: 'ftp://x' }, 'link must be an http or https URL'],
    [{ ...base, at: 'yesterday' }, 'at must be an ISO 8601 time, such as 2026-10-10T18:22:05Z'],
    [{ ...base, parentId: 'pc/claude/1' }, 'parentId must not be the agent itself'],
    [[], 'The body must be a JSON object (a report)'],
  ])('refuses %j with a reason', (body, error) => {
    expect(validateReport(body)).toEqual({ ok: false, error });
  });

  it('cuts an over-long activity and says so', () => {
    const r = validateReport({ ...base, activity: 'x'.repeat(600) });
    expect(r.ok && r.value.activity?.length).toBe(500);
    expect(r.ok && r.warnings).toEqual(['activity was cut to 500 characters']);
  });
});

describe('validateHeartbeat', () => {
  it('dedupes ids', () => {
    const r = validateHeartbeat({ machine: 'pc', kind: 'claude-code', agentIds: ['a', 'a', 'b'] });
    expect(r.ok && r.value.agentIds).toEqual(['a', 'b']);
  });
  it('needs agentIds', () => {
    expect(validateHeartbeat({ machine: 'pc', kind: 'claude-code' })).toEqual({
      ok: false,
      error: 'agentIds is required and must be an array',
    });
  });
});

describe('effectiveState', () => {
  const now = Date.parse('2026-10-10T12:00:00Z');
  const agent = (state: 'working' | 'stopped', secondsAgo: number) => ({
    state,
    lastSeen: new Date(now - secondsAgo * 1000).toISOString(),
    lostAfterSeconds: 180,
  });
  it('is the reported state while fresh', () => expect(effectiveState(agent('working', 179), now)).toBe('working'));
  it('is lost after silence', () => expect(effectiveState(agent('working', 181), now)).toBe('lost'));
  it('keeps stopped agents stopped', () => expect(effectiveState(agent('stopped', 9999), now)).toBe('stopped'));
});

describe('maskSecrets', () => {
  it.each([
    ['key am_abcdefghij_0123456789abcdefghijABCDEFGHIJ0123456789abc leaked', 'key [masked] leaked'],
    ['Authorization: Bearer abc.def.ghi123', 'Authorization: Bearer [masked]'],
    ['password=hunter22 user=bob', 'password=[masked] user=bob'],
    ['sk-ant-api03-AAAAAAAAAAAAAAAAAAAA', '[masked]'],
    ['nothing secret here', 'nothing secret here'],
  ])('masks %s', (input, out) => expect(maskSecrets(input)).toBe(out));

  it('masks nested strings', () => {
    expect(maskDeep({ a: ['token: abcdef123'], n: 1 })).toEqual({ a: ['token: [masked]'], n: 1 });
  });
});

describe('instructions pages', () => {
  // The update page tells agents which version and date are current; it must match agentctl's.
  it('show the same version and date as the code', () => {
    const page = (name: string) => readFileSync(new URL(`../../web/public/${name}`, import.meta.url), 'utf8');
    for (const name of ['instructions.md', 'update.md']) {
      expect(page(name)).toContain(`Instructions version: **${INSTRUCTIONS_VERSION}**`);
      expect(page(name)).toContain(`Updated: **${INSTRUCTIONS_UPDATED}**`);
    }
    expect(page('update.md')).toContain(`instructions version ${INSTRUCTIONS_VERSION} (${INSTRUCTIONS_UPDATED})`);
  });
});

describe('workType', () => {
  const sort = (texts: string[], kind: 'claude-code' | 'openclaw' | 'service' = 'claude-code') => workType({ declared: null, kind, texts });

  it('takes what the agent said over the words', () => {
    expect(workType({ declared: 'level-design', kind: 'claude-code', texts: ['Fix the tests'] })).toEqual({ type: 'level-design', source: 'agent' });
  });

  it('sorts by the words of the story, prompt and finished work', () => {
    expect(sort(['Level design pass on the arena']).type).toBe('level-design');
    expect(sort(['Add vitest tests for the parser']).type).toBe('testing');
    expect(sort(['Fix the crash when saving']).type).toBe('bugfix');
    expect(sort(['Deploy to Azure with bicep']).type).toBe('infra');
    expect(sort(['Write the patch notes for 1.4']).type).toBe('community');
  });

  it("doesn't take a product's features for non-technical work", () => {
    expect(sort(['Quest chain: SuggestQuests', 'Novel outline beats: SuggestNovelOutlineBeat'])).toEqual({ type: 'feature', source: 'kind' });
  });

  it('falls back to the kind of agent', () => {
    expect(sort([], 'openclaw').type).toBe('community');
    expect(sort([], 'service').type).toBe('other');
  });
});

describe('costOf', () => {
  const usage = { input: 1_000_000, output: 1_000_000, cacheWrite: 1_000_000, cacheWrite1h: 0, cacheRead: 1_000_000 };

  it('prices tokens at the model’s list price', () => {
    // $4 in + $20 out + $5 for 5-minute cache writes + $0.20 cache reads.
    expect(costOf({ model: 'claude-opus-5-5', ...usage })).toBeCloseTo(29.2);
    expect(costOf({ model: 'claude-opus-5-5[1m]', ...usage, cacheWrite1h: 1_000_000 })).toBeCloseTo(32.2);
    expect(costOf({ model: 'claude-sonnet-4-6', ...usage })).toBeCloseTo(3 + 15 + 3.75 + 0.3);
  });

  it('has no price for a model it doesn’t know', () => {
    expect(costOf({ model: 'gpt-9', ...usage })).toBeNull();
  });
});

describe('mergeUsage', () => {
  const u = (model: string, output: number) => ({ model, input: 1, output, cacheWrite: 2, cacheWrite1h: 1, cacheRead: 3 });
  it('adds per model, biggest first, without changing its inputs', () => {
    const totals = [u('a', 1)];
    expect(mergeUsage(totals, [u('a', 1), u('b', 100)])).toEqual([u('b', 100), { model: 'a', input: 2, output: 2, cacheWrite: 4, cacheWrite1h: 2, cacheRead: 6 }]);
    expect(totals).toEqual([u('a', 1)]);
  });
});
