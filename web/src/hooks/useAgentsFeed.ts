import { RECENT_DAYS, type AgentsResponse } from '@agent-manager/shared';
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

/** Every agent seen in the last week, reloaded every 5 s while the tab is visible. */
export function useAgentsFeed() {
  const polled = usePolling('agents', loadAgents, { intervalMs: AGENTS_POLL_MS });
  const flashing = useStateFlash(polled.data?.agents);
  return { ...polled, flashing };
}
