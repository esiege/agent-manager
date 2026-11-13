// What agents call, with a machine key: report, heartbeat, logs (R-01 to R-05).

import { randomUUID } from 'node:crypto';
import {
  DEFAULT_LOST_AFTER_SECONDS,
  LIMITS,
  maskDeep,
  maskSecrets,
  validateHeartbeat,
  validateLogs,
  validateReport,
  type Agent,
  type AgentEvent,
  type AgentTurn,
  type ReportInput,
  type WorkResult,
  type HeartbeatResponse,
  type LogEntry,
  type LogsResponse,
  type ReportResponse,
} from '@agent-manager/shared';
import { notify, sweepLost } from '../alerts';
import { requireKey } from '../auth';
import { fail, ok, publicOrigin, readJson, type Handler } from '../http';

// A heartbeat doesn't rewrite an agent that reported this recently; it's already fresh.
const FRESH_MS = 20_000;

/** The agent's turn after this report, and the turn it ended if it ended one. */
export function nextTurn(
  current: AgentTurn | null,
  input: Pick<ReportInput, 'turn' | 'state' | 'activity'>,
  prompt: string | null | undefined,
  at: string,
): { turn: AgentTurn | null; ended: AgentTurn | null } {
  const end = (outcome: AgentTurn['outcome'], reason: string | null): AgentTurn => ({ ...current!, outcome, reason, endedAt: at });
  const running = current?.outcome === 'running';
  if (input.turn === 'start') {
    const ended = running ? end('interrupted', 'A new prompt came before it finished') : null;
    return { turn: { prompt: prompt ?? null, startedAt: at, endedAt: null, outcome: 'running', reason: null }, ended };
  }
  if (!running) return { turn: current, ended: null };
  let ended: AgentTurn | null = null;
  if (input.turn === 'end') ended = end('finished', null);
  else if (input.state === 'failed') ended = end('failed', input.activity || 'Failed');
  else if (input.state === 'stopped') ended = end('interrupted', `${input.activity || 'Stopped'} mid-request`);
  // Idle without an end: the person pressed Esc, or the session restarted, before it finished.
  else if (input.state === 'idle') ended = end('interrupted', 'Stopped before it finished');
  return { turn: ended ?? current, ended };
}

export const report: Handler = async (req, ctx) => {
  const key = await requireKey(req, ctx);
  const result = validateReport(readJson(req, LIMITS.reportBytes));
  if (!result.ok) return fail(400, result.error);
  const input = result.value;

  const now = ctx.now().toISOString();
  const at = input.at ?? now;
  const existing = await ctx.store.getAgent(input.agentId);
  // Reports can arrive out of order (agents send them in the background). An older report
  // still goes in the timeline, but doesn't overwrite newer state or activity.
  const newer = !existing || at >= existing.lastReportAt;
  const pick = <T>(incoming: T | undefined, current: T): T => (newer && incoming !== undefined ? incoming : current);

  const state = pick(input.state, existing?.state ?? 'working');
  // Story, task and prompt can quote what the person typed: mask anything that looks like a secret.
  const masked = (v: string | null | undefined) => (typeof v === 'string' ? maskSecrets(v) : v);
  const story = masked(input.story);
  const task = masked(input.task);
  const prompt = masked(input.prompt);
  const { turn, ended } = newer ? nextTurn(existing?.turn ?? null, input, prompt, at) : { turn: existing?.turn ?? null, ended: null };
  const workResult: WorkResult | null = input.result
    ? {
        title: maskSecrets(input.result.title),
        summary: maskSecrets(input.result.summary),
        checks: (input.result.checks ?? []).map(maskSecrets),
        prompt: masked(input.result.prompt) ?? turn?.prompt ?? existing?.prompt ?? null,
        commit: input.result.commit ?? null,
        commitUrl: input.result.commitUrl ?? null,
        branch: input.result.branch ?? null,
        pushed: input.result.pushed ?? null,
        at,
      }
    : null;
  const agent: Agent = {
    id: input.agentId,
    kind: input.kind,
    name: input.name ?? existing?.name ?? input.agentId,
    machine: input.machine,
    project: input.project !== undefined ? input.project : (existing?.project ?? null),
    parentId: input.parentId !== undefined ? input.parentId : (existing?.parentId ?? null),
    state,
    activity: pick(input.activity, existing?.activity ?? null),
    story: pick(story, existing?.story ?? null),
    task: pick(task, existing?.task ?? null),
    prompt: pick(prompt, existing?.prompt ?? null),
    promptAt: pick(prompt === undefined ? undefined : prompt ? at : null, existing?.promptAt ?? null),
    turn,
    result: pick(workResult ?? undefined, existing?.result ?? null),
    workType: pick(input.workType, existing?.workType ?? null),
    // Which request a "connection lost" alert went out for (alerts.ts), so it isn't sent twice.
    lostAlertFor: existing?.lostAlertFor ?? null,
    hiddenAt: existing?.hiddenAt ?? null,
    link: pick(input.link, existing?.link ?? null),
    details: { ...existing?.details, ...input.details },
    lostAfterSeconds: input.lostAfterSeconds ?? existing?.lostAfterSeconds ?? DEFAULT_LOST_AFTER_SECONDS,
    instructionsVersion: input.instructionsVersion ?? existing?.instructionsVersion ?? null,
    firstSeen: existing?.firstSeen ?? now,
    lastSeen: now,
    lastReportAt: newer ? at : existing!.lastReportAt,
    endedAt: state === 'stopped' ? (existing?.endedAt ?? now) : null,
    keyName: key.name,
  };

  const event: AgentEvent = {
    id: randomUUID(),
    agentId: agent.id,
    type: workResult ? 'result' : input.link ? 'action' : input.state && input.state !== existing?.state ? 'state' : 'report',
    at,
    receivedAt: now,
    state: input.state ?? null,
    activity: input.activity ?? null,
    story: story ?? null,
    task: task ?? null,
    prompt: prompt ?? null,
    result: workResult,
    ...(input.workType !== undefined ? { workType: input.workType } : {}),
    ...(input.usage ? { usage: input.usage } : {}),
    link: input.link ?? null,
    details: input.details && Object.keys(input.details).length ? input.details : null,
  };
  const events = [event];
  if (ended) events.push(turnEvent(agent, ended, at, now));

  if (!input.test) {
    await ctx.store.putAgent(agent);
    await ctx.store.addEvents(events);
    await notify(ctx, existing, agent, publicOrigin(req, ctx.env));
  }
  const body: ReportResponse = {
    ok: true,
    test: Boolean(input.test),
    stored: agent,
    warnings: result.warnings,
    agentUrl: `${publicOrigin(req, ctx.env)}/agents/detail?id=${encodeURIComponent(agent.id)}`,
  };
  return ok(body);
};

/** A turn that ended, with the story and work type it ended on (for the Reporting tab). */
function turnEvent(agent: Agent, turn: AgentTurn, at: string, receivedAt: string): AgentEvent {
  const what = { finished: 'Finished the request', failed: 'Request failed', interrupted: 'Request cut off', running: 'Request started' }[turn.outcome];
  return {
    id: randomUUID(),
    agentId: agent.id,
    type: 'turn',
    at,
    receivedAt,
    state: null,
    activity: turn.reason ? `${what}: ${turn.reason}` : what,
    story: agent.story,
    workType: agent.workType ?? null,
    turn,
    link: null,
    details: null,
  };
}

export const heartbeat: Handler = async (req, ctx) => {
  await requireKey(req, ctx);
  const result = validateHeartbeat(readJson(req, LIMITS.reportBytes));
  if (!result.ok) return fail(400, result.error);
  const input = result.value;

  const nowDate = ctx.now();
  const now = nowDate.toISOString();
  const alive = new Set(input.agentIds);
  const known = await ctx.store.listAgentsOn(input.machine, input.kind);
  const knownIds = new Set(known.map((a) => a.id));

  const writes: Agent[] = [];
  const events: AgentEvent[] = [];
  const stopped: string[] = [];
  for (const agent of known) {
    if (alive.has(agent.id)) {
      // Refresh agents that are still going. A stopped agent stays stopped.
      if (agent.state !== 'stopped' && nowDate.getTime() - Date.parse(agent.lastSeen) > FRESH_MS) {
        writes.push({ ...agent, lastSeen: now });
      }
    } else if (agent.state !== 'stopped') {
      stopped.push(agent.id);
      const activity = `No longer running on ${input.machine}`;
      const { turn, ended } = nextTurn(agent.turn ?? null, { state: 'stopped', activity: 'Closed' }, undefined, now);
      if (ended) events.push(turnEvent(agent, ended, now, now));
      // lastReportAt moves too, so a late report from before the stop can't revive it.
      writes.push({ ...agent, state: 'stopped', activity, turn, endedAt: now, lastSeen: now, lastReportAt: now });
      events.push({
        id: randomUUID(),
        agentId: agent.id,
        type: 'state',
        at: now,
        receivedAt: now,
        state: 'stopped',
        activity,
        link: null,
        details: null,
      });
    }
  }
  // Listed ids the manager has never seen: the agent should send a full report for each.
  const unknown = input.agentIds.filter((id) => !knownIds.has(id));

  if (!input.test) {
    const before = new Map(known.map((a) => [a.id, a]));
    for (const a of writes) await ctx.store.putAgent(a);
    if (events.length) await ctx.store.addEvents(events);
    for (const a of writes) if (a.state === 'stopped') await notify(ctx, before.get(a.id) ?? null, a, publicOrigin(req, ctx.env));
    await sweepLost(ctx, publicOrigin(req, ctx.env));
  }
  const body: HeartbeatResponse = {
    ok: true,
    test: Boolean(input.test),
    stored: { alive: input.agentIds.length - unknown.length, stopped, unknown },
    warnings: result.warnings,
  };
  return ok(body);
};

export const postLogs: Handler = async (req, ctx) => {
  const key = await requireKey(req, ctx);
  const result = validateLogs(readJson(req, LIMITS.logsBytes));
  if (!result.ok) return fail(400, result.error);

  const now = ctx.now().toISOString();
  const logs: LogEntry[] = result.value.entries.map((e) => ({
    id: randomUUID(),
    level: e.level,
    source: e.source,
    message: maskSecrets(e.message),
    at: e.at ?? now,
    receivedAt: now,
    agentId: e.agentId ?? null,
    correlationId: e.correlationId ?? null,
    context: e.context ? maskDeep(e.context) : null,
    keyName: key.name,
  }));

  if (!result.value.test) await ctx.store.addLogs(logs);
  const body: LogsResponse = {
    ok: true,
    test: Boolean(result.value.test),
    stored: { count: logs.length },
    warnings: result.warnings,
  };
  return ok(body);
};
