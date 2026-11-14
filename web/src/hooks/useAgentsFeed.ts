import { RECENT_DAYS, type AgentsResponse, type AgentView } from '@agent-manager-deluxe/shared';
import { useMemo } from 'react';
import { api } from '../lib/api';
import { syncServerClock } from '../lib/time';
import { usePolling } from '../lib/usePolling';
import { useStateFlash } from './useStateFlash';

export const AGENTS_POLL_MS = 5000;

async function loadAgents(signal: AbortSignal): Promise<AgentsResponse> {
  const res = await api.agents(RECENT_DAYS, signal);
  syncServerClock(res.now);
  return res;
}

/** Leaves out hidden agents, and the sub-agents of hidden agents. */
export function withoutHidden(agents: AgentView[]): AgentView[] {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const hidden = (a: AgentView, seen = new Set<string>()): boolean => {
    if (a.hiddenAt) return true;
    const parent = a.parentId ? byId.get(a.parentId) : undefined;
    if (!parent || seen.has(parent.id)) return false;
    seen.add(a.id);
    return hidden(parent, seen);
  };
  return agents.filter((a) => !hidden(a));
}

/** Every agent seen in the last week except hidden ones, reloaded every 5 s while the tab is visible. */
export function useAgentsFeed() {
  const polled = usePolling('agents', loadAgents, { intervalMs: AGENTS_POLL_MS });
  const data = useMemo(() => polled.data && { ...polled.data, agents: withoutHidden(polled.data.agents) }, [polled.data]);
  const flashing = useStateFlash(data?.agents);
  return { ...polled, data, flashing };
}
