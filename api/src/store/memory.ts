// In-memory store for local development and tests. With a file path it survives restarts.
// Never used in Azure: see store/index.ts.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { Agent, AgentEvent, AgentKind, LogEntry } from '@agent-manager/shared';
import { RETENTION_DAYS, type LogFilter, type Store, type StoredKey } from './types';

interface Snapshot {
  keys: StoredKey[];
  agents: Agent[];
  events: AgentEvent[];
  logs: LogEntry[];
}

export class MemoryStore implements Store {
  private keys = new Map<string, StoredKey>();
  private agents = new Map<string, Agent>();
  private events: AgentEvent[] = [];
  private logs: LogEntry[] = [];

  constructor(
    private readonly file?: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (file && existsSync(file)) {
      const snap = JSON.parse(readFileSync(file, 'utf8')) as Snapshot;
      for (const k of snap.keys) this.keys.set(k.id, k);
      for (const a of snap.agents) this.agents.set(a.id, a);
      this.events = snap.events;
      this.logs = snap.logs;
      this.prune();
    }
  }

      for (const s of snap.alerts ?? []) this.alerts.set(s.id, s);
  private prune() {
    const cutoff = new Date(this.now().getTime() - RETENTION_DAYS * 86_400_000).toISOString();
    this.events = this.events.filter((e) => e.receivedAt >= cutoff);
    this.logs = this.logs.filter((l) => l.receivedAt >= cutoff);
  }

  private save() {
    if (!this.file) return;
    const snap: Snapshot = {
      keys: [...this.keys.values()],
      agents: [...this.agents.values()],
      events: this.events,
      logs: this.logs,
    };
    writeFileSync(this.file, JSON.stringify(snap));
  }

  async getKey(id: string) {
    return structuredClone(this.keys.get(id) ?? null);
  }
  async listKeys() {
    return structuredClone([...this.keys.values()]);
  }
  async putKey(key: StoredKey) {
    this.keys.set(key.id, structuredClone(key));
    this.save();
  }

  async getAgent(id: string) {
    return structuredClone(this.agents.get(id) ?? null);
  }
  async putAgent(agent: Agent) {
    this.agents.set(agent.id, structuredClone(agent));
    this.save();
  }
  async listAgentsSeenSince(since: string) {
    return structuredClone([...this.agents.values()].filter((a) => a.lastSeen >= since));
  }
  async listAgentsOn(machine: string, kind: AgentKind) {
    return structuredClone([...this.agents.values()].filter((a) => a.machine === machine && a.kind === kind));
  }
  async listChildren(parentId: string) {
    return structuredClone([...this.agents.values()].filter((a) => a.parentId === parentId));
  }

  async addEvents(events: AgentEvent[]) {
    this.events.push(...structuredClone(events));
    this.prune();
    this.save();
  }
  async listEvents(agentId: string, limit: number) {
    return structuredClone(
      this.events
        .filter((e) => e.agentId === agentId)
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, limit),
    );
  }

  async addLogs(logs: LogEntry[]) {
    this.logs.push(...structuredClone(logs));
    this.prune();
    this.save();
  }
  async queryLogs(f: LogFilter) {
    const text = f.text?.toLowerCase();
    const matched = this.logs
      .filter(
        (l) =>
          (f.levels.length === 0 || f.levels.includes(l.level)) &&
          (!f.source || l.source === f.source) &&
          (!f.agentId || l.agentId === f.agentId) &&
          (!f.correlationId || l.correlationId === f.correlationId) &&
          (!text || l.message.toLowerCase().includes(text)) &&
          (!f.from || l.at >= f.from) &&
          (!f.to || l.at <= f.to),
      )
      .sort((a, b) => b.at.localeCompare(a.at));
    return { logs: structuredClone(matched.slice(0, f.limit)), truncated: matched.length > f.limit };
  }
}
