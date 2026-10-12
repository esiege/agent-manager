// The data contract shared by the API, the web UI and the reporter.
// Spec: Docs/Spec-v2.md, "Reporting API".

export const API_BASE = '/api/v1';

/** Bump when Docs/instructions.md changes in a way agents must act on (I-05). */
export const INSTRUCTIONS_VERSION = 2;
/** When the instructions and agentctl last changed. web/public/update.md shows the same date. */
export const INSTRUCTIONS_UPDATED = '2026-10-11';

export const AGENT_KINDS = ['claude-code', 'openclaw', 'service', 'other'] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];

/** States an agent can report. "lost" is never reported: the manager derives it from silence. */
export const REPORTED_STATES = ['working', 'waiting', 'idle', 'stopped', 'failed'] as const;
export type ReportedState = (typeof REPORTED_STATES)[number];
export type AgentState = ReportedState | 'lost';

/**
 * A turn is one request: it starts with a prompt and ends when the agent finishes, fails, or is
 * cut off. "interrupted" means it never finished: a new prompt came first, or the session closed.
 * A turn still "running" on an agent that went Lost was cut off too; see unfinishedReason().
 */
export const TURN_OUTCOMES = ['running', 'finished', 'failed', 'interrupted'] as const;
export type TurnOutcome = (typeof TURN_OUTCOMES)[number];

/** What an alert subscription can be told about. "unfinished": interrupted, or lost mid-request. */
export const ALERT_EVENTS = ['finished', 'waiting', 'failed', 'unfinished'] as const;
export type AlertEvent = (typeof ALERT_EVENTS)[number];

/** Where alerts go. ntfy (https://ntfy.sh) is free: the phone app shows them like texts. */
export const ALERT_CHANNELS = ['ntfy'] as const;
export type AlertChannel = (typeof ALERT_CHANNELS)[number];

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
  storyLength: 300,
  taskLength: 300,
  promptLength: 2000,
  resultTitleLength: 200,
  resultSummaryLength: 8000,
  resultChecks: 12,
  resultCheckLength: 300,
  messageLength: 8000,
  /** A message the owner sends to an agent from the UI. */
  agentMessageLength: 4000,
  linkLength: 2000,
} as const;

/** Owner calls that change something must carry this header, which another site can't add (CSRF). */
export const OWNER_WRITE_HEADER = 'x-agent-manager-owner';

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
  /** The story or goal the agent is on: a ticket and its title when there is one, else a summary. */
  story?: string | null;
  /** The technical step it is on now. */
  task?: string | null;
  /** The person's latest prompt to it. */
  prompt?: string | null;
  /** "start" when a prompt starts a new request, "end" when the agent finishes it. */
  turn?: 'start' | 'end';
  /** The report of finished work (see WorkResult). */
  result?: WorkResultInput;
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

/** The report an agent gives when it finishes a piece of work. */
export interface WorkResultInput {
  /** A short name for the work: the commit's subject when it committed. */
  title: string;
  /** What was done, in Markdown. */
  summary: string;
  /** Acceptance steps: what the person should see now, one short line each. */
  checks?: string[];
  /** The prompt it answers. Defaults to the agent's current prompt. */
  prompt?: string | null;
  commit?: string | null;
  /** A web link to the commit, such as https://github.com/<owner>/<repo>/commit/<sha>. */
  commitUrl?: string | null;
  branch?: string | null;
  /** Whether the commit is on the remote yet; the link only works once it is. */
  pushed?: boolean | null;
}

// ---- What the manager stores and returns ----

export interface WorkResult {
  title: string;
  summary: string;
  checks: string[];
  prompt: string | null;
  commit: string | null;
  commitUrl: string | null;
  branch: string | null;
  pushed: boolean | null;
  at: string;
}

export interface AgentTurn {
  prompt: string | null;
  startedAt: string;
  endedAt: string | null;
  outcome: TurnOutcome;
  /** Why it didn't finish, in a few words. */
  reason: string | null;
}

export interface Agent {
  id: string;
  kind: AgentKind;
  name: string;
  machine: string;
  project: string | null;
  parentId: string | null;
  state: ReportedState;
  activity: string | null;
  story: string | null;
  task: string | null;
  prompt: string | null;
  /** When the current prompt was sent. */
  promptAt: string | null;
  /** The latest request and how it ended. */
  turn: AgentTurn | null;
  /** The latest report of finished work. */
  result: WorkResult | null;
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
  /** The request (its turn.startedAt) a "connection lost" alert went out for, so it goes once. */
  lostAlertFor?: string | null;
}

/** An agent as the UI sees it: with its derived state. */
export interface AgentView extends Agent {
  effectiveState: AgentState;
  runningChildren: number;
}

export type AgentEventType = 'report' | 'state' | 'action' | 'result' | 'turn' | 'message';

export interface AgentEvent {
  id: string;
  agentId: string;
  type: AgentEventType;
  at: string;
  receivedAt: string;
  state: ReportedState | null;
  activity: string | null;
  story?: string | null;
  task?: string | null;
  prompt?: string | null;
  result?: WorkResult | null;
  /** On "turn" events: how the turn ended. */
  turn?: AgentTurn | null;
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

export interface AlertSubscription {
  id: string;
  /** Who or what it's for, such as "My phone". */
  name: string;
  channel: AlertChannel;
  /** For ntfy: the topic's full URL, such as https://ntfy.sh/<a long random topic>. */
  target: string;
  events: AlertEvent[];
  /** Only these projects; empty means all. */
  projects: string[];
  enabled: boolean;
  createdAt: string;
  lastSentAt: string | null;
  /** The last delivery error, cleared by the next success. */
  lastError: string | null;
}

/** POST /api/v1/alerts: create (no id) or update a subscription. */
export interface AlertSubscriptionInput {
  id?: string;
  name: string;
  channel: AlertChannel;
  target: string;
  events: AlertEvent[];
  projects?: string[];
  enabled?: boolean;
}

export interface AlertsResponse {
  subscriptions: AlertSubscription[];
}

export interface MachineKey {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

// ---- Messages to agents (Docs/Agent-Messaging-Findings.md) ----

/** How long a message waits for its PC to collect it. A late prompt is worse than none. */
export const MESSAGE_TTL_SECONDS = 600;

/** "expired" is never stored: a pending message past its expiresAt is shown as expired. */
export const MESSAGE_STATUSES = ['pending', 'delivered', 'failed', 'expired'] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

/**
 * Text the owner sends to a Claude Code session from the UI. agentctl on the session's PC
 * collects it and posts it into the session's inbox.
 */
export interface AgentMessage {
  id: string;
  agentId: string;
  machine: string;
  /** The machine key that reports the agent. Only that key can collect the message. */
  keyName: string;
  text: string;
  /** The owner's login. */
  from: string;
  createdAt: string;
  expiresAt: string;
  status: MessageStatus;
  /** When it was delivered or failed. */
  doneAt: string | null;
  /** Why it failed. */
  reason: string | null;
}

/** POST /api/v1/messages, as the owner. */
export interface SendMessageInput {
  agentId: string;
  text: string;
}

export interface SendMessageResponse {
  message: AgentMessage;
}

/** POST /api/v1/inbox, with a machine key: the messages waiting for agents on one machine. */
export interface InboxInput {
  machine: string;
}

export interface InboxResponse {
  /** Oldest first. */
  messages: AgentMessage[];
}

/** POST /api/v1/inbox/ack, with a machine key: what happened to one message. */
export interface MessageAckInput {
  id: string;
  machine: string;
  status: 'delivered' | 'failed';
  reason?: string;
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
  /** Messages sent to it from the UI, newest first. Only Claude Code sessions take them. */
  messages: AgentMessage[];
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
