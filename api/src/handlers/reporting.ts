// What the Reporting tab reads, as the signed-in owner: requests, finished work and token usage
// over a window, with the agents they belong to. The UI sorts and adds them up (web/src/lib/reporting.ts).

import {
  REPORTING_MAX_DAYS,
  type Agent,
  type ReportingAgent,
  type ReportingResponse,
  type ReportingResult,
  type ReportingTurn,
  type ReportingUsage,
} from '@agent-manager-delux/shared';
import { requireOwner } from '../auth';
import { HttpError, ok, query, type Handler } from '../http';

const DEFAULT_DAYS = 30;
/** Enough of the prompt to sort the work by; the full one is on the agent's page. */
const PROMPT_CHARS = 300;

function reportingAgent(a: Agent): ReportingAgent {
  const model = a.details?.model;
  return {
    id: a.id,
    name: a.name,
    kind: a.kind,
    machine: a.machine,
    project: a.project,
    parentId: a.parentId,
    story: a.story ?? null,
    workType: a.workType ?? null,
    model: typeof model === 'string' ? model : null,
    lastSeen: a.lastSeen,
  };
}

export const reporting: Handler = async (req, ctx) => {
  requireOwner(req, ctx);
  const daysParam = query(req).get('days');
  const days = daysParam === null ? DEFAULT_DAYS : Number(daysParam);
  if (!Number.isInteger(days) || days < 1 || days > REPORTING_MAX_DAYS) {
    throw new HttpError(400, `days must be a whole number from 1 to ${REPORTING_MAX_DAYS}`);
  }

  const now = ctx.now();
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const [events, agents] = await Promise.all([ctx.store.listReportingEvents(since), ctx.store.listAgentsSeenSince(since)]);

  const turns: ReportingTurn[] = [];
  const usage: ReportingUsage[] = [];
  const results: ReportingResult[] = [];
  for (const e of events) {
    if (e.type === 'turn' && e.turn) {
      turns.push({
        agentId: e.agentId,
        startedAt: e.turn.startedAt,
        endedAt: e.turn.endedAt,
        outcome: e.turn.outcome,
        prompt: e.turn.prompt ? e.turn.prompt.slice(0, PROMPT_CHARS) : null,
        story: e.story ?? null,
        workType: e.workType ?? null,
      });
    }
    if (e.type === 'result' && e.result) {
      results.push({
        agentId: e.agentId,
        at: e.at,
        title: e.result.title,
        commitUrl: e.result.commitUrl,
        story: e.story ?? null,
        workType: e.workType ?? null,
      });
    }
    if (e.usage?.length) usage.push({ agentId: e.agentId, at: e.at, usage: e.usage, story: e.story ?? null, workType: e.workType ?? null });
  }

  // Requests still running count up to now: add them from the agents, which hold the open turn.
  const known = new Set(agents.map((a) => a.id));
  for (const a of agents) {
    if (a.turn?.outcome === 'running' && a.turn.startedAt >= since) {
      turns.push({
        agentId: a.id,
        startedAt: a.turn.startedAt,
        endedAt: null,
        outcome: 'running',
        prompt: a.turn.prompt ? a.turn.prompt.slice(0, PROMPT_CHARS) : null,
        story: a.story ?? null,
        workType: a.workType ?? null,
      });
    }
  }

  // Parents of sub-agents carry the project and story; fetch any that fell outside the window.
  const missing = [...new Set(agents.map((a) => a.parentId).filter((id): id is string => !!id && !known.has(id)))];
  const parents = (await Promise.all(missing.map((id) => ctx.store.getAgent(id)))).filter((a): a is Agent => a !== null);

  const body: ReportingResponse = {
    now: now.toISOString(),
    days,
    agents: [...agents, ...parents].map(reportingAgent),
    turns,
    usage,
    results,
  };
  return ok(body);
};
