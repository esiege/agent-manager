import type { Agent, AgentEvent, AgentKind, LogEntry, LogLevel, MachineKey } from '@agent-manager/shared';

/** A machine key as stored: the key's metadata plus a SHA-256 hash of the secret. */
export interface StoredKey extends MachineKey {
  hash: string;
}

export interface LogFilter {
  levels: LogLevel[];
  source?: string;
  agentId?: string;
  correlationId?: string;
  /** Case-insensitive text to find in the message. */
  text?: string;
  from?: string;
  to?: string;
  limit: number;
}

/** Events and logs older than this are dropped (Non-functional: Retention). */
export const RETENTION_DAYS = 30;

export interface Store {
  getKey(id: string): Promise<StoredKey | null>;
  listKeys(): Promise<StoredKey[]>;
  putKey(key: StoredKey): Promise<void>;

  getAgent(id: string): Promise<Agent | null>;
  putAgent(agent: Agent): Promise<void>;
  /** Agents whose lastSeen is at or after `since` (ISO time). */
  listAgentsSeenSince(since: string): Promise<Agent[]>;
  listAgentsOn(machine: string, kind: AgentKind): Promise<Agent[]>;
  listChildren(parentId: string): Promise<Agent[]>;

  addEvents(events: AgentEvent[]): Promise<void>;
  /** Newest first. */
  listEvents(agentId: string, limit: number): Promise<AgentEvent[]>;

  addLogs(logs: LogEntry[]): Promise<void>;
  /** Newest first; `truncated` when more than `limit` matched. */
  queryLogs(filter: LogFilter): Promise<{ logs: LogEntry[]; truncated: boolean }>;
}
