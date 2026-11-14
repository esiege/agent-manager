import { describe, expect, it } from 'vitest';
import type { Agent, AgentEvent } from '@agent-manager-delux/shared';
import type { Snapshot } from '../src/store/memory';
import { toCloud, toLocal } from '../src/tools/move-data';

const NOW = new Date('2026-11-14T00:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

function event(id: string, type: AgentEvent['type'], receivedAt: string): AgentEvent {
  return { id, agentId: 'pc/claude/1', type, at: receivedAt, receivedAt, state: null, activity: null, link: null, details: null };
}

const agent = { id: 'pc/claude/1', machine: 'pc', kind: 'claude', lastSeen: daysAgo(1) } as unknown as Agent;

function snapshot(): Snapshot {
  return {
    keys: [{ id: 'k1', name: 'pc', hash: 'abc', createdAt: daysAgo(100) } as unknown as Snapshot['keys'][number]],
    agents: [agent],
    events: [event('fresh', 'state', daysAgo(20)), event('old', 'state', daysAgo(40)), event('turn', 'turn', daysAgo(40))],
    messages: [{ id: 'm1' } as never],
  };
}

describe('toCloud', () => {
  it('gives each item what is left of its retention, and leaves out what has run out', () => {
    const plan = toCloud(snapshot(), NOW);
    const ids = plan.docs.events.map((e) => e.id);
    expect(ids).toEqual(['fresh', 'turn']); // a 40-day-old turn is a reporting event, kept a year
    expect(plan.docs.events[0]?.ttl).toBe(10 * 86_400);
    expect(plan.expired).toBe(1);
  });

  it('stores agents under a hashed id, and keeps keys so PCs can go on using them', () => {
    const plan = toCloud(snapshot(), NOW);
    expect(plan.docs.agents[0]?.agentId).toBe('pc/claude/1');
    expect(plan.docs.agents[0]?.id).not.toContain('/');
    expect(plan.docs.keys[0]).toMatchObject({ id: 'k1', hash: 'abc' });
    expect(plan.docs.keys[0]?.ttl).toBeUndefined();
  });
});

describe('toLocal', () => {
  it('turns Cosmos documents back into a snapshot, without system fields or TTLs', () => {
    const plan = toCloud(snapshot(), NOW);
    const fromCosmos = Object.fromEntries(
      Object.entries(plan.docs).map(([name, docs]) => [name, docs.map((d) => ({ ...d, _rid: 'x', _ts: 1 }))]),
    ) as unknown as typeof plan.docs;
    const snap = toLocal(fromCosmos);
    expect(snap.agents).toEqual([agent]);
    expect(snap.events.map((e) => e.id)).toEqual(['fresh', 'turn']);
    expect(snap.events[0]).not.toHaveProperty('ttl');
    expect(snap.events[0]).not.toHaveProperty('_rid');
    expect(snap.keys[0]).toMatchObject({ id: 'k1', hash: 'abc' });
    expect(snap.messages).toEqual([]);
  });
});
