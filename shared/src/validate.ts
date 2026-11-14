// Validation for what agents send. Errors are one line an agent can act on (R-05).
// Small mistakes that lose nothing important (too long, unknown fields) are warnings.

import {
  AGENT_KINDS,
  ALERT_CHANNELS,
  ALERT_EVENTS,
  LIMITS,
  PERF_SESSION_ID,
  REPORTED_STATES,
  WORK_TYPES,
  type AgentKind,
  type AlertChannel,
  type AlertEvent,
  type AlertSubscriptionInput,
  type HeartbeatInput,
  type PerfHitch,
  type PerfSampleInput,
  type PerfSamplesInput,
  type PerfSessionInput,
  type ReportedState,
  type ReportInput,
  type TokenUsage,
  type WorkResultInput,
  type WorkType,
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

  get(key: string): unknown {
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

  /** Null counts as absent. */
  optionalNumber(key: string, min: number, max: number): number | undefined {
    const v = this.get(key);
    if (v === undefined || v === null) return undefined;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
      throw new Invalid(`${this.label(key)} must be a number from ${min} to ${max}`);
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

const TOKEN_FIELDS = ['input', 'output', 'cacheWrite', 'cacheWrite1h', 'cacheRead'] as const;

function readUsage(raw: unknown): TokenUsage[] {
  if (!Array.isArray(raw)) throw new Invalid('usage must be an array of {model, input, output, cacheWrite, cacheWrite1h, cacheRead}');
  if (raw.length > LIMITS.usageModels) throw new Invalid(`usage has more than ${LIMITS.usageModels} entries`);
  return raw.map((entry, i) => {
    if (!isObject(entry)) throw new Invalid(`usage[${i}] must be a JSON object`);
    const r = new Reader(entry, `usage[${i}]`);
    const value: TokenUsage = { model: r.requiredString('model', LIMITS.nameLength), input: 0, output: 0, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0 };
    for (const field of TOKEN_FIELDS) value[field] = r.optionalInt(field, 0, 1_000_000_000_000) ?? 0;
    return value;
  });
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
    const workType = r.get('workType') === null ? null : r.oneOf<WorkType>('workType', WORK_TYPES, false);
    const rawUsage = r.get('usage');
    const usage = rawUsage === undefined || rawUsage === null ? undefined : readUsage(rawUsage);
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
    if (workType !== undefined) value.workType = workType;
    if (usage?.length) value.usage = usage;
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

// ---- Performance data, sent by games ----

const SESSION_ID_HINT = 'sessionId is required: 8 to 64 letters, digits, dots, dashes or underscores (a UUID works)';

function readSessionId(r: Reader): string {
  const v = r.get('sessionId');
  if (typeof v !== 'string' || !PERF_SESSION_ID.test(v)) throw new Invalid(SESSION_ID_HINT);
  return v;
}

const SESSION_TEXT = ['build', 'platform', 'cpu', 'gpu', 'os', 'resolution'] as const;

export function validatePerfSession(body: unknown): Result<PerfSessionInput> {
  return run(body, 'a performance session', (r) => {
    const value: PerfSessionInput = {
      sessionId: readSessionId(r),
      game: r.requiredString('game', LIMITS.nameLength),
      machine: r.requiredString('machine', LIMITS.nameLength),
    };
    for (const field of SESSION_TEXT) {
      const v = r.optionalString(field, LIMITS.nameLength, { truncate: true });
      if (v !== undefined) value[field] = v?.trim() || null;
    }
    const whole = (field: 'cpuCores' | 'ramMb' | 'vramMb' | 'refreshHz', max: number) => {
      const v = r.optionalNumber(field, 0, max);
      if (v !== undefined) value[field] = Math.round(v);
    };
    whole('cpuCores', 4096);
    whole('ramMb', 100_000_000);
    whole('vramMb', 100_000_000);
    whole('refreshHz', 10_000);
    const loadSeconds = r.optionalNumber('loadSeconds', 0, 86_400);
    if (loadSeconds !== undefined) value.loadSeconds = loadSeconds;
    const details = { ...(r.optionalObject('details') ?? {}) };
    const ended = r.optionalBool('ended');
    const test = r.optionalBool('test');

    const extra = r.unknownKeys();
    for (const k of extra) details[k] = (body as Record<string, unknown>)[k];
    if (extra.length) r.warnings.push(`Unknown field(s) ${extra.join(', ')} were kept in details`);
    if (Object.keys(details).length) value.details = details;
    if (ended !== undefined) value.ended = ended;
    if (test !== undefined) value.test = test;
    return value;
  });
}

const SAMPLE_MS = ['frameMsP50', 'frameMsP95', 'frameMsP99', 'frameMsMax', 'cpuMs', 'gameMs', 'renderMs', 'gpuMs', 'pingMs'] as const;
/** Ten minutes: longer than any frame or ping worth charting. */
const MAX_MS = 600_000;
/** A session can run this long (30 days). */
const MAX_T = 30 * 86_400;

function readPerfSample(raw: unknown, i: number, warnings: string[]): PerfSampleInput {
  const path = `samples[${i}]`;
  if (!isObject(raw)) throw new Invalid(`${path} must be a JSON object`);
  const r = new Reader(raw, path);
  const required = (key: 't' | 'seconds' | 'frames', min: number, max: number) => {
    const v = r.optionalNumber(key, min, max);
    if (v === undefined) throw new Invalid(`${path}.${key} is required and must be a number`);
    return v;
  };
  const sample: PerfSampleInput = { t: required('t', 0, MAX_T), seconds: required('seconds', 0, 3600), frames: Math.round(required('frames', 0, 100_000_000)) };
  if (sample.seconds === 0) throw new Invalid(`${path}.seconds must be more than 0`);

  for (const field of SAMPLE_MS) {
    const v = r.optionalNumber(field, 0, MAX_MS);
    if (v !== undefined) sample[field] = v;
  }
  const hitches = r.optionalNumber('hitches', 0, 100_000_000);
  if (hitches !== undefined) sample.hitches = Math.round(hitches);
  for (const field of ['memoryMb', 'vramMb', 'drawCalls'] as const) {
    const v = r.optionalNumber(field, 0, 1_000_000_000);
    if (v !== undefined) sample[field] = v;
  }
  const scene = r.optionalString('scene', LIMITS.nameLength, { truncate: true });
  if (scene?.trim()) sample.scene = scene.trim();

  const metrics: Record<string, number> = {};
  const add = (name: string, v: unknown, from: string) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Invalid(`${from} must be a number`);
    if (name.length > LIMITS.perfMetricNameLength) throw new Invalid(`${from}: the name is longer than ${LIMITS.perfMetricNameLength} characters`);
    metrics[name] = v;
  };
  for (const [name, v] of Object.entries(r.optionalObject('metrics') ?? {})) add(name, v, `${path}.metrics.${name}`);
  // A number under a name we don't know is a custom metric; anything else is dropped.
  const dropped: string[] = [];
  for (const k of r.unknownKeys()) {
    if (typeof raw[k] === 'number' && Number.isFinite(raw[k])) add(k, raw[k], `${path}.${k}`);
    else dropped.push(k);
  }
  if (dropped.length && i === 0) warnings.push(`Unknown field(s) ${dropped.join(', ')} on samples were ignored (only numbers are kept, as metrics)`);
  const names = Object.keys(metrics);
  if (names.length > LIMITS.perfMetrics) throw new Invalid(`${path} has ${names.length} custom metrics; the limit is ${LIMITS.perfMetrics}`);
  if (names.length) sample.metrics = metrics;
  warnings.push(...r.warnings);
  return sample;
}

function readPerfHitch(raw: unknown, i: number, warnings: string[]): PerfHitch {
  const path = `hitchEvents[${i}]`;
  if (!isObject(raw)) throw new Invalid(`${path} must be a JSON object`);
  const r = new Reader(raw, path);
  const t = r.optionalNumber('t', 0, MAX_T);
  const frameMs = r.optionalNumber('frameMs', 0, MAX_MS);
  if (t === undefined || frameMs === undefined) throw new Invalid(`${path} needs t and frameMs, both numbers`);
  const hitch: PerfHitch = { t, frameMs };
  for (const field of ['gameMs', 'renderMs', 'gpuMs'] as const) {
    const v = r.optionalNumber(field, 0, MAX_MS);
    if (v !== undefined) hitch[field] = v;
  }
  const scene = r.optionalString('scene', LIMITS.nameLength, { truncate: true });
  if (scene?.trim()) hitch.scene = scene.trim();
  const extra = r.unknownKeys();
  if (extra.length && i === 0) warnings.push(`Unknown field(s) ${extra.join(', ')} on hitchEvents were ignored`);
  return hitch;
}

export function validatePerfSamples(body: unknown): Result<PerfSamplesInput> {
  return run(body, 'performance samples', (r) => {
    const sessionId = readSessionId(r);
    const rawHitches = r.get('hitchEvents');
    if (rawHitches !== undefined && rawHitches !== null && !Array.isArray(rawHitches)) throw new Invalid('hitchEvents must be an array');
    const hitchEvents = ((rawHitches as unknown[] | null | undefined) ?? []).map((h, i) => readPerfHitch(h, i, r.warnings));
    if (hitchEvents.length > LIMITS.perfHitchesPerCall) {
      throw new Invalid(`hitchEvents has ${hitchEvents.length} items; send at most ${LIMITS.perfHitchesPerCall} per call`);
    }
    const raw = r.get('samples') === undefined && hitchEvents.length ? [] : r.array('samples');
    if (raw.length === 0 && hitchEvents.length === 0) throw new Invalid('samples must hold at least one sample');
    if (raw.length > LIMITS.perfSamplesPerCall) {
      throw new Invalid(`samples has ${raw.length} items; send at most ${LIMITS.perfSamplesPerCall} per call`);
    }
    const samples = raw.map((s, i) => readPerfSample(s, i, r.warnings));
    const test = r.optionalBool('test');
    const extra = r.unknownKeys();
    if (extra.length) r.warnings.push(`Unknown field(s) ${extra.join(', ')} were ignored`);
    const value: PerfSamplesInput = { sessionId, samples };
    if (hitchEvents.length) value.hitchEvents = hitchEvents;
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
