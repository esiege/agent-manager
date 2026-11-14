// What the UI reads, as the signed-in owner.

import {
  RECENT_DAYS,
  effectiveState,
  isRunning,
  messageStatus,
  type Agent,
  type AgentDetailResponse,
  type AgentsResponse,
  type AgentView,
  type MeResponse,
} from '@agent-manager-delux/shared';
import { requireOwner } from '../auth';
import { sweepLost } from '../alerts';
import { HttpError, ok, publicOrigin, query, type Handler } from '../http';

const MAX_EVENTS = 500;
const MAX_MESSAGES = 20;

function toViews(agents: Agent[], now: number): AgentView[] {
  const states = new Map(agents.map((a) => [a.id, effectiveState(a, now)]));
  const running = new Map<string, number>();
  for (const a of agents) {
    if (a.parentId && isRunning(states.get(a.id)!)) running.set(a.parentId, (running.get(a.parentId) ?? 0) + 1);
  }
  return agents.map((a) => ({
    ...a,
    // Agents stored before story, task and prompt existed.
    story: a.story ?? null,
    task: a.task ?? null,
    prompt: a.prompt ?? null,
    promptAt: a.promptAt ?? null,
    turn: a.turn ?? null,
    result: a.result ?? null,
    hiddenAt: a.hiddenAt ?? null,
    effectiveState: states.get(a.id)!,
    runningChildren: running.get(a.id) ?? 0,
  }));
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
  await sweepLost(ctx, publicOrigin(req, ctx.env), { agents: list });
  const body: AgentsResponse = { now: now.toISOString(), agents: toViews(list, now.getTime()) };
  return ok(body);
};

export const agent: Handler = async (req, ctx) => {
  requireOwner(req, ctx);
  const id = query(req).get('id');
  if (!id) throw new HttpError(400, 'id is required, for example /api/v1/agent?id=<agentId>');

  const found = await ctx.store.getAgent(id);
  if (!found) throw new HttpError(404, `No agent with id ${id}`);
  // Only Claude Code sessions take messages, so only they need the extra read.
  const takesMessages = found.kind === 'claude-code' && !found.parentId;
  const [children, events, messages] = await Promise.all([
    ctx.store.listChildren(id),
    ctx.store.listEvents(id, MAX_EVENTS),
    takesMessages ? ctx.store.listMessages(found.machine, { agentId: id, limit: MAX_MESSAGES }) : Promise.resolve([]),
  ]);

  const now = ctx.now();
  const [view, ...childViews] = toViews([found, ...children], now.getTime());
  const body: AgentDetailResponse = {
    now: now.toISOString(),
    agent: view!,
    children: childViews,
    events,
    messages: messages.map((m) => ({ ...m, status: messageStatus(m, now.getTime()) })),
  };
  return ok(body);
};
