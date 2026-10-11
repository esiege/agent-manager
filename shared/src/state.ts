import { DEFAULT_LOST_AFTER_SECONDS, type Agent, type AgentState } from './contract';

/** An agent's state as shown: what it last reported, or Lost once it has been silent too long. */
export function effectiveState(agent: Pick<Agent, 'state' | 'lastSeen' | 'lostAfterSeconds'>, now: number): AgentState {
  if (agent.state === 'stopped' || agent.state === 'failed') return agent.state;
  const silentMs = now - Date.parse(agent.lastSeen);
  const limitMs = (agent.lostAfterSeconds || DEFAULT_LOST_AFTER_SECONDS) * 1000;
  return silentMs > limitMs ? 'lost' : agent.state;
}

/** States that mean the agent is still going. */
export function isRunning(state: AgentState): boolean {
  return state === 'working' || state === 'waiting' || state === 'idle';
}

/** States that need the owner's attention (U-01). */
export function needsAttention(state: AgentState): boolean {
  return state === 'waiting' || state === 'failed' || state === 'lost';
}
