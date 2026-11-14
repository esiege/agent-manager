import {
  PERF_MAX_DAYS,
  PERF_SAMPLE_DAYS,
  REPORTING_MAX_DAYS,
  type Agent,
  type AgentEvent,
  type AgentKind,
  type AgentMessage,
  type AlertSubscription,
  type Blocker,
  type KeyScope,
  type MachineKey,
  type MessageStatus,
  type PerfSample,
  type PerfSession,
} from '@agent-manager-delux/shared';

/** A machine key as stored: the key's metadata plus a SHA-256 hash of the secret. */
export interface StoredKey extends Omit<MachineKey, 'scope'> {
  /** Missing on keys made before scopes existed: those do everything. */
  scope?: KeyScope;
  hash: string;
}

export interface MessageFilter {
  agentId?: string;
  status?: MessageStatus;
  limit: number;
}

/** Events older than this are dropped (Non-functional: Retention). */
export const RETENTION_DAYS = 30;

/**
 * What the Reporting tab reads is kept longer: turns, finished work and token usage are small,
 * and a year of them is what makes the report worth having.
 */
export const REPORTING_RETENTION_DAYS = REPORTING_MAX_DAYS;

/** Events the Reporting tab reads. */
export function isReportingEvent(e: AgentEvent): boolean {
  return e.type === 'turn' || e.type === 'result' || Boolean(e.usage?.length);
}

/** Messages to agents are kept a day: long enough to see what happened to them, no longer. */
export const MESSAGE_RETENTION_SECONDS = 86_400;

/**
 * Blockers are kept this long after their last change, open or not. Their screenshots and videos
 * are deleted on the same schedule (infra/main.bicep sets a lifecycle rule on the blob container).
 */
export const BLOCKER_RETENTION_DAYS = 90;
export const BLOCKER_RETENTION_SECONDS = BLOCKER_RETENTION_DAYS * 86_400;

/** Performance sessions are small and carry their totals; samples are the bulk. Counted from the last write. */
export const PERF_SESSION_RETENTION_SECONDS = PERF_MAX_DAYS * 86_400;
export const PERF_SAMPLE_RETENTION_SECONDS = PERF_SAMPLE_DAYS * 86_400;

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
  /** Every agent's reporting events (isReportingEvent) at or after `since`, in no order. */
  listReportingEvents(since: string): Promise<AgentEvent[]>;

  getAlert(id: string): Promise<AlertSubscription | null>;
  listAlerts(): Promise<AlertSubscription[]>;
  putAlert(subscription: AlertSubscription): Promise<void>;
  deleteAlert(id: string): Promise<void>;

  getMessage(machine: string, id: string): Promise<AgentMessage | null>;
  putMessage(message: AgentMessage): Promise<void>;
  /** The messages for agents on one machine, newest first. */
  listMessages(machine: string, filter: MessageFilter): Promise<AgentMessage[]>;

  getBlocker(id: string): Promise<Blocker | null>;
  putBlocker(blocker: Blocker): Promise<void>;
  /** Open blockers, and those resolved or dismissed at or after `since`, newest first. */
  listBlockers(since: string): Promise<Blocker[]>;

  getPerfSession(id: string): Promise<PerfSession | null>;
  putPerfSession(session: PerfSession): Promise<void>;
  /** Sessions whose lastSeen is at or after `since`, newest first. */
  listPerfSessions(since: string, limit: number): Promise<PerfSession[]>;
  /** Stores the samples that aren't stored yet (by id) and returns those. */
  addPerfSamples(samples: PerfSample[]): Promise<PerfSample[]>;
  /** The session's latest `limit` samples, oldest first. */
  listPerfSamples(sessionId: string, limit: number): Promise<PerfSample[]>;
}
