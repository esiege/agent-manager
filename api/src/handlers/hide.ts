// Hiding agents, as the owner. A hidden session stays out of every list for good; a new
// session in the same project is a new agent, so it shows up as usual.

import { LIMITS, type HideAgentsResponse } from '@agent-manager-delux/shared';
import { requireOwnerWrite } from '../auth';
import { HttpError, ok, readJson, type Handler } from '../http';

const MAX_BODY = 64 * 1024;
const MAX_IDS = 200;

/** POST /api/v1/agents/hide: { agentIds, hidden }. Unknown ids are skipped. */
export const hideAgents: Handler = async (req, ctx) => {
  requireOwnerWrite(req, ctx);
  const body = readJson(req, MAX_BODY) as Record<string, unknown> | null;
  const ids = body?.agentIds;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS) {
    throw new HttpError(400, `agentIds must be a list of 1 to ${MAX_IDS} agent ids`);
  }
  if (!ids.every((id) => typeof id === 'string' && id !== '' && id.length <= LIMITS.idLength)) {
    throw new HttpError(400, 'agentIds must all be agent ids');
  }
  if (typeof body?.hidden !== 'boolean') throw new HttpError(400, 'hidden must be true or false');

  const hiddenAt = body.hidden ? ctx.now().toISOString() : null;
  const changed: string[] = [];
  for (const id of new Set(ids as string[])) {
    const agent = await ctx.store.getAgent(id);
    if (!agent) continue;
    await ctx.store.putAgent({ ...agent, hiddenAt });
    changed.push(id);
  }
  const res: HideAgentsResponse = { agentIds: changed };
  return ok(res);
};
