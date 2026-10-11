// The data contract shared by the API, the web UI and the reporter.
// Spec: Docs/Spec-v2.md, "Reporting API".

export const API_BASE = '/api/v1';

/** Bump when Docs/instructions.md changes in a way agents must act on (I-05). */
export const INSTRUCTIONS_VERSION = 1;

export const AGENT_KINDS = ['claude-code', 'openclaw', 'service', 'other'] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];

/** States an agent can report. "lost" is never reported: the manager derives it from silence. */
export const REPORTED_STATES = ['working', 'waiting', 'idle', 'stopped', 'failed'] as const;
export type ReportedState = (typeof REPORTED_STATES)[number];
export type AgentState = ReportedState | 'lost';

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const LIMITS = {
  reportBytes: 64 * 1024,
  logsBytes: 1024 * 1024,
  logsPerCall: 500,
  heartbeatAgents: 500,
  idLength: 200,
  nameLength: 120,
  activityLength: 500,
  messageLength: 8000,
  linkLength: 2000,
} as const;

/** An agent with no report or heartbeat for this long is Lost (R-02). */
export const DEFAULT_LOST_AFTER_SECONDS = 180;
/** Stopped agents stay listed this long (Goal 1). */
export const RECENT_DAYS = 7;

// ---- What agents send ----

/** POST /api/v1/report */
export interface ReportInput {
  agentId: string;
  kind: AgentKind;
  machine: string;
  name?: string;
  project?: string | null;
  parentId?: string | null;
  state?: ReportedState;
  activity?: string | null;
  link?: string | null;
  details?: Record<string, unknown>;
  /** How long silence means Lost. Agents that heartbeat rarely raise it. */
  lostAfterSeconds?: number;
  instructionsVersion?: number;
  /** When it happened, ISO 8601. Defaults to when the manager received it. */
  at?: string;
  /** Validate without storing (R-04). */
  test?: boolean;
}

/** POST /api/v1/heartbeat: the agents of one kind still alive on one machine. */
export interface HeartbeatInput {
  machine: string;
  kind: AgentKind;
  agentIds: string[];
  at?: string;
  test?: boolean;
}

export interface LogEntryInput {
  level: LogLevel;
  source: string;
  message: string;
  at?: string;
  agentId?: string | null;
  correlationId?: string | null;
  context?: Record<string, unknown>;
}

/** POST /api/v1/logs */
export interface LogsInput {
  entries: LogEntryInput[];
  test?: boolean;
}

// ---- What the manager stores and returns ----

export interface Agent {
  id: string;
  kind: AgentKind;
  name: string;
  machine: string;
  project: string | null;
  parentId: string | null;
  state: ReportedState;
  activity: string | null;
  link: string | null;
  details: Record<string, unknown>;
  lostAfterSeconds: number;
  instructionsVersion: number | null;
  firstSeen: string;
  lastSeen: string;
  lastReportAt: string;
  endedAt: string | null;
  /** Name of the machine key that last wrote this agent. */
  keyName: string;
}

/** An agent as the UI sees it: with its derived state. */
export interface AgentView extends Agent {
  effectiveState: AgentState;
  runningChildren: number;
}

export type AgentEventType = 'report' | 'state' | 'action';

export interface AgentEvent {
  id: string;
  agentId: string;
  type: AgentEventType;
  at: string;
  receivedAt: string;
  state: ReportedState | null;
  activity: string | null;
  link: string | null;
  details: Record<string, unknown> | null;
}

export interface LogEntry {
  id: string;
  level: LogLevel;
  source: string;
  message: string;
  at: string;
  receivedAt: string;
  agentId: string | null;
  correlationId: string | null;
  context: Record<string, unknown> | null;
  keyName: string;
}

export interface MachineKey {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

// ---- Responses ----

export interface ApiError {
  error: string;
}

export interface WriteResponse<T> {
  ok: true;
  test: boolean;
  /** What was (or, with test: true, would be) stored. */
  stored: T;
  warnings: string[];
}

export interface ReportResponse extends WriteResponse<Agent> {
  agentUrl: string;
}

export interface HeartbeatResponse extends WriteResponse<{ alive: number; stopped: string[]; unknown: string[] }> {}

export interface LogsResponse extends WriteResponse<{ count: number }> {}

export interface AgentsResponse {
  now: string;
  agents: AgentView[];
}

export interface AgentDetailResponse {
  now: string;
  agent: AgentView;
  children: AgentView[];
  events: AgentEvent[];
}

export interface LogsQuery {
  level?: LogLevel[];
  source?: string;
  agentId?: string;
  correlationId?: string;
  q?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export interface LogsQueryResponse {
  logs: LogEntry[];
  /** True when more logs matched than `limit`. */
  truncated: boolean;
}

export interface KeysResponse {
  keys: MachineKey[];
}

export interface CreateKeyResponse {
  key: MachineKey;
  /** The secret, shown once. */
  secret: string;
}

export interface MeResponse {
  login: string;
  provider: string;
}
