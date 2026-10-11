import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  effectiveState,
  INSTRUCTIONS_UPDATED,
  INSTRUCTIONS_VERSION,
  maskDeep,
  maskSecrets,
  validateHeartbeat,
  validateLogs,
  validateReport,
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

describe('validateLogs', () => {
  it('maps level aliases and keeps extra fields in context', () => {
    const r = validateLogs({ entries: [{ level: 'Warning', source: 'gma', message: 'slow', route: '/x' }] });
    expect(r.ok && r.value.entries[0]).toEqual({ level: 'warn', source: 'gma', message: 'slow', context: { route: '/x' } });
    expect(r.ok && r.warnings).toEqual(['entries[0].level "Warning" was stored as "warn"']);
  });
  it('names the bad entry', () => {
    expect(validateLogs({ entries: [{ level: 'info', source: 's', message: 'ok' }, { level: 'info', source: 's' }] })).toEqual({
      ok: false,
      error: 'entries[1].message is required and must be a non-empty string',
    });
  });
  it('refuses more than 500 entries', () => {
    const entries = Array.from({ length: 501 }, () => ({ level: 'info', source: 's', message: 'm' }));
    expect(validateLogs({ entries })).toEqual({ ok: false, error: 'entries has 501 items; send at most 500 per call' });
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
