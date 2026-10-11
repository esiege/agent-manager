// Validation for what agents send. Errors are one line an agent can act on (R-05).
// Small mistakes that lose nothing important (too long, unknown fields) are warnings.

import {
  AGENT_KINDS,
  ALERT_CHANNELS,
  ALERT_EVENTS,
  LIMITS,
  LOG_LEVELS,
  REPORTED_STATES,
  type AgentKind,
  type AlertChannel,
  type AlertEvent,
  type AlertSubscriptionInput,
  type HeartbeatInput,
  type LogEntryInput,
  type LogLevel,
  type LogsInput,
  type ReportedState,
  type ReportInput,
  type WorkResultInput,
} from './contract';

export type Result<T> = { ok: true; value: T; warnings: string[] } | { ok: false; error: string };

class Invalid extends Error {}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

class Reader {
  readonly warnings: string[] = [];
  private readonly seen = new Set<string>();

  constructor(
    private readonly obj: Record<string, unknown>,
    private readonly path = '',
  ) {}

  private label(key: string) {
    return this.path ? `${this.path}.${key}` : key;
  }

  private get(key: string): unknown {
    this.seen.add(key);
    return this.obj[key];
  }

  requiredString(key: string, max: number): string {
    const v = this.get(key);
    if (typeof v !== 'string' || v.trim() === '') throw new Invalid(`${this.label(key)} is required and must be a non-empty string`);
    if (v.length > max) throw new Invalid(`${this.label(key)} is longer than ${max} characters`);
    return v.trim();
  }

  optionalString(key: string, max: number, opts: { truncate?: boolean } = {}): string | null | undefined {
    const v = this.get(key);
    if (v === undefined) return undefined;
    if (v === null) return null;
    if (typeof v !== 'string') throw new Invalid(`${this.label(key)} must be a string`);
    if (v.length > max) {
      if (!opts.truncate) throw new Invalid(`${this.label(key)} is longer than ${max} characters`);
      this.warnings.push(`${this.label(key)} was cut to ${max} characters`);
      return v.slice(0, max);
    }
    return v;
  }

  oneOf<T extends string>(key: string, allowed: readonly T[], required: boolean, hint?: string): T | undefined {
    const v = this.get(key);
    if (v === undefined && !required) return undefined;
    if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
      throw new Invalid(hint ?? `${this.label(key)} must be one of ${allowed.join(', ')}`);
    }
    return v as T;
  }

  optionalInt(key: string, min: number, max: number): number | undefined {
    const v = this.get(key);
    if (v === undefined) return undefined;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
      throw new Invalid(`${this.label(key)} must be a whole number from ${min} to ${max}`);
    }
    return v;
  }

  optionalBool(key: string): boolean | undefined {
    const v = this.get(key);
    if (v === undefined) return undefined;
    if (typeof v !== 'boolean') throw new Invalid(`${this.label(key)} must be true or false`);
    return v;
  }

  optionalObject(key: string): Record<string, unknown> | undefined {
    const v = this.get(key);
    if (v === undefined || v === null) return undefined;
    if (!isObject(v)) throw new Invalid(`${this.label(key)} must be a JSON object`);
    return v;
  }

  optionalTime(key: string): string | undefined {
    const v = this.get(key);
    if (v === undefined || v === null) return undefined;
    if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) {
      throw new Invalid(`${this.label(key)} must be an ISO 8601 time, such as 2026-10-10T18:22:05Z`);
    }
    return new Date(v).toISOString();
  }

  optionalLink(key: string): string | null | undefined {
    const v = this.optionalString(key, LIMITS.linkLength);
    if (v == null) return v;
    if (!/^https?:\/\//i.test(v)) throw new Invalid(`${this.label(key)} must be an http or https URL`);
    return v;
  }

  array(key: string): unknown[] {
    const v = this.get(key);
    if (!Array.isArray(v)) throw new Invalid(`${this.label(key)} is required and must be an array`);
    return v;
  }

  /** Fields the reader never asked for. */
  unknownKeys(): string[] {
    return Object.keys(this.obj).filter((k) => !this.seen.has(k));
  }
}

function run<T>(body: unknown, what: string, fn: (r: Reader) => T): Result<T> {
  if (!isObject(body)) return { ok: false, error: `The body must be a JSON object (${what})` };
  const reader = new Reader(body);
  try {
    const value = fn(reader);
    return { ok: true, value, warnings: reader.warnings };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: e.message };
    throw e;
  }
}

function readResult(raw: Record<string, unknown>, warnings: string[]): WorkResultInput {
  const r = new Reader(raw, 'result');
  const title = r.requiredString('title', 10_000).slice(0, LIMITS.resultTitleLength);
  const summary = r.optionalString('summary', LIMITS.resultSummaryLength, { truncate: true });
  if (summary == null || summary.trim() === '') throw new Invalid('result.summary is required and must be a non-empty string');
  const value: WorkResultInput = { title, summary: summary.trim() };

  const checks = (raw as { checks?: unknown }).checks;
  if (checks !== undefined && checks !== null) {
    if (!Array.isArray(checks) || checks.some((c) => typeof c !== 'string')) throw new Invalid('result.checks must be an array of strings');
    const kept = (checks as string[]).map((c) => c.trim()).filter(Boolean);
    if (kept.length > LIMITS.resultChecks) warnings.push(`result.checks was cut to ${LIMITS.resultChecks} items`);
    value.checks = kept.slice(0, LIMITS.resultChecks).map((c) => c.slice(0, LIMITS.resultCheckLength));
  }
  const prompt = r.optionalString('prompt', LIMITS.promptLength, { truncate: true });
  const commit = r.optionalString('commit', 64);
  const commitUrl = r.optionalLink('commitUrl');
  const branch = r.optionalString('branch', LIMITS.nameLength, { truncate: true });
  const pushed = r.optionalBool('pushed');
  if (prompt !== undefined) value.prompt = prompt;
  if (commit !== undefined) value.commit = commit;
  if (commitUrl !== undefined) value.commitUrl = commitUrl;
  if (branch !== undefined) value.branch = branch;
  if (pushed !== undefined) value.pushed = pushed;
  const extra = r.unknownKeys().filter((k) => k !== 'checks');
  if (extra.length) warnings.push(`Unknown field(s) result.${extra.join(', result.')} were ignored`);
  warnings.push(...r.warnings);
  return value;
}

const KIND_HINT = `kind must be one of ${AGENT_KINDS.join(', ')}`;

export function validateReport(body: unknown): Result<ReportInput> {
  return run(body, 'a report', (r) => {
    const agentId = r.requiredString('agentId', LIMITS.idLength);
    const kind = r.oneOf<AgentKind>('kind', AGENT_KINDS, true, KIND_HINT)!;
    const machine = r.requiredString('machine', LIMITS.nameLength);
    const name = r.optionalString('name', LIMITS.nameLength, { truncate: true }) ?? undefined;
    const project = r.optionalString('project', LIMITS.idLength, { truncate: true });
    const parentId = r.optionalString('parentId', LIMITS.idLength);
    if (parentId === agentId) throw new Invalid('parentId must not be the agent itself');
    const state = r.oneOf<ReportedState>(
      'state',
      REPORTED_STATES,
      false,
      `state must be one of ${REPORTED_STATES.join(', ')} (the manager works out "lost" itself)`,
    );
    const activity = r.optionalString('activity', LIMITS.activityLength, { truncate: true });
    const story = r.optionalString('story', LIMITS.storyLength, { truncate: true });
    const task = r.optionalString('task', LIMITS.taskLength, { truncate: true });
    const prompt = r.optionalString('prompt', LIMITS.promptLength, { truncate: true });
    const turn = r.oneOf<'start' | 'end'>('turn', ['start', 'end'], false);
    const rawResult = r.optionalObject('result');
    const result = rawResult ? readResult(rawResult, r.warnings) : undefined;
    const link = r.optionalLink('link');
    const details = { ...(r.optionalObject('details') ?? {}) };
    const lostAfterSeconds = r.optionalInt('lostAfterSeconds', 30, 7 * 24 * 3600);
    const instructionsVersion = r.optionalInt('instructionsVersion', 1, 10_000);
    const at = r.optionalTime('at');
    const test = r.optionalBool('test');

    const extra = r.unknownKeys();
    for (const k of extra) details[k] = (body as Record<string, unknown>)[k];
    if (extra.length) r.warnings.push(`Unknown field(s) ${extra.join(', ')} were kept in details`);

    const value: ReportInput = { agentId, kind, machine, details };
    if (name !== undefined) value.name = name;
    if (project !== undefined) value.project = project;
    if (parentId !== undefined) value.parentId = parentId;
    if (state !== undefined) value.state = state;
    if (activity !== undefined) value.activity = activity;
    if (story !== undefined) value.story = story;
    if (task !== undefined) value.task = task;
    if (prompt !== undefined) value.prompt = prompt;
    if (turn !== undefined) value.turn = turn;
    if (result !== undefined) value.result = result;
    if (link !== undefined) value.link = link;
    if (lostAfterSeconds !== undefined) value.lostAfterSeconds = lostAfterSeconds;
    if (instructionsVersion !== undefined) value.instructionsVersion = instructionsVersion;
    if (at !== undefined) value.at = at;
    if (test !== undefined) value.test = test;
    return value;
  });
}

export function validateHeartbeat(body: unknown): Result<HeartbeatInput> {
  return run(body, 'a heartbeat', (r) => {
    const machine = r.requiredString('machine', LIMITS.nameLength);
    const kind = r.oneOf<AgentKind>('kind', AGENT_KINDS, true, KIND_HINT)!;
    const ids = r.array('agentIds');
    if (ids.length > LIMITS.heartbeatAgents) throw new Invalid(`agentIds has more than ${LIMITS.heartbeatAgents} entries`);
    const agentIds = ids.map((id, i) => {
      if (typeof id !== 'string' || id === '' || id.length > LIMITS.idLength) {
        throw new Invalid(`agentIds[${i}] must be a non-empty string of at most ${LIMITS.idLength} characters`);
      }
      return id;
    });
    const at = r.optionalTime('at');
    const test = r.optionalBool('test');
    const extra = r.unknownKeys();
    if (extra.length) r.warnings.push(`Unknown field(s) ${extra.join(', ')} were ignored`);
    const value: HeartbeatInput = { machine, kind, agentIds: [...new Set(agentIds)] };
    if (at !== undefined) value.at = at;
    if (test !== undefined) value.test = test;
    return value;
  });
}

// Levels clients commonly send, mapped onto ours.
const LEVEL_ALIASES: Record<string, LogLevel> = {
  trace: 'debug',
  verbose: 'debug',
  debug: 'debug',
  info: 'info',
  information: 'info',
  notice: 'info',
  warn: 'warn',
  warning: 'warn',
  error: 'error',
  err: 'error',
  fatal: 'error',
  critical: 'error',
};

function readLogEntry(raw: unknown, i: number, warnings: string[]): LogEntryInput {
  const path = `entries[${i}]`;
  if (!isObject(raw)) throw new Invalid(`${path} must be a JSON object`);
  const r = new Reader(raw, path);

  const rawLevel = r.requiredString('level', 20);
  const level = LEVEL_ALIASES[rawLevel.toLowerCase()];
  if (!level) throw new Invalid(`${path}.level must be one of ${LOG_LEVELS.join(', ')}`);
  if (level !== rawLevel) warnings.push(`${path}.level "${rawLevel}" was stored as "${level}"`);

  const source = r.requiredString('source', LIMITS.nameLength);
  const message = r.optionalString('message', LIMITS.messageLength, { truncate: true });
  if (message == null || message.trim() === '') throw new Invalid(`${path}.message is required and must be a non-empty string`);
  const at = r.optionalTime('at');
  const agentId = r.optionalString('agentId', LIMITS.idLength);
  const correlationId = r.optionalString('correlationId', LIMITS.idLength);
  const context = { ...(r.optionalObject('context') ?? {}) };
  const extra = r.unknownKeys();
  for (const k of extra) context[k] = raw[k];
  warnings.push(...r.warnings);

  const entry: LogEntryInput = { level, source, message };
  if (at !== undefined) entry.at = at;
  if (agentId != null) entry.agentId = agentId;
  if (correlationId != null) entry.correlationId = correlationId;
  if (Object.keys(context).length) entry.context = context;
  return entry;
}

export function validateLogs(body: unknown): Result<LogsInput> {
  return run(body, 'logs', (r) => {
    const raw = r.array('entries');
    if (raw.length === 0) throw new Invalid('entries must hold at least one log entry');
    if (raw.length > LIMITS.logsPerCall) throw new Invalid(`entries has ${raw.length} items; send at most ${LIMITS.logsPerCall} per call`);
    const entries = raw.map((e, i) => readLogEntry(e, i, r.warnings));
    const test = r.optionalBool('test');
    const extra = r.unknownKeys();
    if (extra.length) r.warnings.push(`Unknown field(s) ${extra.join(', ')} were ignored`);
    const value: LogsInput = { entries };
    if (test !== undefined) value.test = test;
    return value;
  });
}

// ---- Alert subscriptions (Settings > Alerts), sent by the owner ----

const MAX_ALERT_PROJECTS = 50;

/** https, or http for a server on this PC (a local ntfy while testing). */
function readAlertTarget(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Invalid("target must be the topic's full URL, such as https://ntfy.sh/<topic>");
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Invalid('target must be an https URL (http only works for localhost)');
  }
  if (url.pathname.replace(/\/+$/, '') === '') throw new Invalid('target must include the topic, such as https://ntfy.sh/<topic>');
  return url.toString();
}

function readStrings(raw: unknown, field: string): string[] {
  if (!Array.isArray(raw) || raw.some((v) => typeof v !== 'string')) throw new Invalid(`${field} must be an array of strings`);
  return [...new Set((raw as string[]).map((v) => v.trim()).filter(Boolean))];
}

export function validateAlertSubscription(body: unknown): Result<AlertSubscriptionInput> {
  return run(body, 'an alert subscription', (r) => {
    const id = r.optionalString('id', LIMITS.idLength);
    const name = r.requiredString('name', LIMITS.nameLength);
    const channel = r.oneOf<AlertChannel>('channel', ALERT_CHANNELS, false) ?? 'ntfy';
    const target = readAlertTarget(r.requiredString('target', LIMITS.linkLength));

    const events = readStrings(r.array('events'), 'events');
    if (events.length === 0) throw new Invalid(`events must hold at least one of ${ALERT_EVENTS.join(', ')}`);
    const unknown = events.filter((e) => !(ALERT_EVENTS as readonly string[]).includes(e));
    if (unknown.length) throw new Invalid(`events must be some of ${ALERT_EVENTS.join(', ')}; ${unknown[0]} isn't one`);

    const rawProjects = (body as { projects?: unknown }).projects;
    const projects = rawProjects == null ? [] : readStrings(rawProjects, 'projects');
    if (projects.length > MAX_ALERT_PROJECTS) throw new Invalid(`projects has more than ${MAX_ALERT_PROJECTS} entries`);
    if (projects.some((p) => p.length > LIMITS.idLength)) throw new Invalid(`each project must be at most ${LIMITS.idLength} characters`);
    const enabled = r.optionalBool('enabled');

    const extra = r.unknownKeys().filter((k) => k !== 'projects');
    if (extra.length) r.warnings.push(`Unknown field(s) ${extra.join(', ')} were ignored`);
    const value: AlertSubscriptionInput = { name, channel, target, events: events as AlertEvent[], projects, enabled: enabled ?? true };
    if (id) value.id = id;
    return value;
  });
}
