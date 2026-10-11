// What the UI reads, as the signed-in owner.

import {
  LOG_LEVELS,
  RECENT_DAYS,
  effectiveState,
  isRunning,
  type Agent,
  type AgentDetailResponse,
  type AgentsResponse,
  type AgentView,
  type LogLevel,
  type LogsQueryResponse,
  type MeResponse,
} from '@agent-manager/shared';
import { requireOwner } from '../auth';
import { HttpError, ok, query, type Handler } from '../http';
import type { LogFilter } from '../store/types';

const MAX_EVENTS = 500;
const DEFAULT_LOG_LIMIT = 1000;
const MAX_LOG_LIMIT = 5000;

function toViews(agents: Agent[], now: number): AgentView[] {
  const states = new Map(agents.map((a) => [a.id, effectiveState(a, now)]));
  const running = new Map<string, number>();
  for (const a of agents) {
    if (a.parentId && isRunning(states.get(a.id)!)) running.set(a.parentId, (running.get(a.parentId) ?? 0) + 1);
  }
  return agents.map((a) => ({ ...a, effectiveState: states.get(a.id)!, runningChildren: running.get(a.id) ?? 0 }));
}

export const me: Handler = async (req, ctx) => {
  const owner = requireOwner(req, ctx);
  const body: MeResponse = { login: owner.login, provider: owner.provider };
  return ok(body);
};

export const agents: Handler = async (req, ctx) => {
  requireOwner(req, ctx);
  const daysParam = query(req).get('days');
  const days = daysParam === null ? RECENT_DAYS : Number(daysParam);
  if (!Number.isInteger(days) || days < 1 || days > 30) throw new HttpError(400, 'days must be a whole number from 1 to 30');

  const now = ctx.now();
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const list = await ctx.store.listAgentsSeenSince(since);
  const body: AgentsResponse = { now: now.toISOString(), agents: toViews(list, now.getTime()) };
  return ok(body);
};

export const agent: Handler = async (req, ctx) => {
  requireOwner(req, ctx);
  const id = query(req).get('id');
  if (!id) throw new HttpError(400, 'id is required, for example /api/v1/agent?id=<agentId>');

  const found = await ctx.store.getAgent(id);
  if (!found) throw new HttpError(404, `No agent with id ${id}`);
  const [children, events] = await Promise.all([ctx.store.listChildren(id), ctx.store.listEvents(id, MAX_EVENTS)]);

  const now = ctx.now();
  const [view, ...childViews] = toViews([found, ...children], now.getTime());
  const body: AgentDetailResponse = { now: now.toISOString(), agent: view!, children: childViews, events };
  return ok(body);
};

function isoParam(params: URLSearchParams, name: string): string | undefined {
  const v = params.get(name);
  if (!v) return undefined;
  if (Number.isNaN(Date.parse(v))) throw new HttpError(400, `${name} must be an ISO 8601 time`);
  return new Date(v).toISOString();
}

export const getLogs: Handler = async (req, ctx) => {
  requireOwner(req, ctx);
  const p = query(req);

  const levels = (p.get('level') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const l of levels) {
    if (!(LOG_LEVELS as readonly string[]).includes(l)) throw new HttpError(400, `level must be one or more of ${LOG_LEVELS.join(', ')}`);
  }
  const limit = p.get('limit') === null ? DEFAULT_LOG_LIMIT : Number(p.get('limit'));
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LOG_LIMIT) {
    throw new HttpError(400, `limit must be a whole number from 1 to ${MAX_LOG_LIMIT}`);
  }

  const filter: LogFilter = { levels: levels as LogLevel[], limit };
  const text = (name: string) => p.get(name)?.trim() || undefined;
  const source = text('source');
  const agentId = text('agentId');
  const correlationId = text('correlationId');
  const q = text('q');
  const from = isoParam(p, 'from');
  const to = isoParam(p, 'to');
  if (source) filter.source = source;
  if (agentId) filter.agentId = agentId;
  if (correlationId) filter.correlationId = correlationId;
  if (q) filter.text = q;
  if (from) filter.from = from;
  if (to) filter.to = to;

  const body: LogsQueryResponse = await ctx.store.queryLogs(filter);
  return ok(body);
};
