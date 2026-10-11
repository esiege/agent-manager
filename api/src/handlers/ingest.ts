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
  type HeartbeatResponse,
  type LogEntry,
  type LogsResponse,
  type ReportResponse,
} from '@agent-manager/shared';
import { requireKey } from '../auth';
import { fail, ok, publicOrigin, readJson, type Handler } from '../http';

// A heartbeat doesn't rewrite an agent that reported this recently; it's already fresh.
const FRESH_MS = 20_000;

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
  const agent: Agent = {
    id: input.agentId,
    kind: input.kind,
    name: input.name ?? existing?.name ?? input.agentId,
    machine: input.machine,
    project: input.project !== undefined ? input.project : (existing?.project ?? null),
    parentId: input.parentId !== undefined ? input.parentId : (existing?.parentId ?? null),
    state,
    activity: pick(input.activity, existing?.activity ?? null),
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
    type: input.link ? 'action' : input.state && input.state !== existing?.state ? 'state' : 'report',
    at,
    receivedAt: now,
    state: input.state ?? null,
    activity: input.activity ?? null,
    link: input.link ?? null,
    details: input.details && Object.keys(input.details).length ? input.details : null,
  };

  if (!input.test) {
    await ctx.store.putAgent(agent);
    await ctx.store.addEvents([event]);
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
      // lastReportAt moves too, so a late report from before the stop can't revive it.
      writes.push({ ...agent, state: 'stopped', activity, endedAt: now, lastSeen: now, lastReportAt: now });
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
    for (const a of writes) await ctx.store.putAgent(a);
    if (events.length) await ctx.store.addEvents(events);
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
