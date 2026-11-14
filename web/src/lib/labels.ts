// How states, kinds and levels are named and colored.

import {
  AGENT_KINDS,
  INSTRUCTIONS_VERSION,
  LOG_LEVELS,
  type AgentKind,
  type AgentState,
  type AgentView,
  type LogLevel,
} from '@agent-manager-delux/shared';
import type { MantineColor } from '@mantine/core';

/** The order states are listed in filters and on the Overview. */
export const AGENT_STATES: readonly AgentState[] = ['working', 'waiting', 'idle', 'stopped', 'failed', 'lost'];

/** Sort rank: what needs the owner first, then live, then ended. */
const STATE_RANK: Record<AgentState, number> = { waiting: 0, failed: 1, lost: 2, working: 3, idle: 4, stopped: 5 };

export const STATE_LABEL: Record<AgentState, string> = {
  working: 'Working',
  waiting: 'Waiting on you',
  idle: 'Idle',
  stopped: 'Stopped',
  failed: 'Failed',
  lost: 'Lost',
};

export const STATE_COLOR: Record<AgentState, MantineColor> = {
  working: 'blue',
  waiting: 'orange',
  idle: 'teal',
  stopped: 'gray',
  failed: 'red',
  lost: 'grape',
};

export function stateRank(state: AgentState): number {
  return STATE_RANK[state];
}

export function isAgentState(value: string): value is AgentState {
  return (AGENT_STATES as readonly string[]).includes(value);
}

export const KIND_LABEL: Record<AgentKind, string> = {
  'claude-code': 'Claude Code',
  openclaw: 'OpenClaw',
  service: 'Service',
  other: 'Other',
};

export function kindLabel(kind: string): string {
  return (AGENT_KINDS as readonly string[]).includes(kind) ? KIND_LABEL[kind as AgentKind] : kind;
}

export const LEVEL_COLOR: Record<LogLevel, MantineColor> = {
  debug: 'gray',
  info: 'blue',
  warn: 'yellow',
  error: 'red',
};

export function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}

/** Set up from an older version of the instructions page (I-05). */
export function isOldSetup(agent: Pick<AgentView, 'instructionsVersion'>): boolean {
  return agent.instructionsVersion !== null && agent.instructionsVersion < INSTRUCTIONS_VERSION;
}

/** Only web links become clickable: links come from agents and could be anything. */
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

export function agentPath(id: string): string {
  return `/agents/detail?${new URLSearchParams({ id }).toString()}`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

const MODEL_FAMILIES = ['opus', 'sonnet', 'haiku', 'fable', 'mythos'];

/**
 * A model id as people say it: "claude-opus-5-5" is "Opus 5.5", "claude-sonnet-4-5-20250929" is
 * "Sonnet 4.5", "claude-opus-5-5[1m]" is "Opus 5.5 (1M)". An id it can't read is shown as it is.
 */
export function modelLabel(model: string): string {
  const long = /\[1m\]$/i.test(model);
  const parts = model
    .replace(/\[[^\]]*\]$/, '')
    .toLowerCase()
    .split('-')
    .filter((p) => p !== 'claude' && !/^\d{8}$/.test(p));
  const family = parts.find((p) => MODEL_FAMILIES.includes(p));
  const version = parts.filter((p) => /^\d{1,2}$/.test(p));
  if (!family || parts.length !== version.length + 1) return model;
  const name = family[0]!.toUpperCase() + family.slice(1);
  return `${name}${version.length ? ` ${version.join('.')}` : ''}${long ? ' (1M)' : ''}`;
}

/** The model an agent uses now, from what its reports said, or null. */
export function agentModel(agent: Pick<AgentView, 'details'>): string | null {
  const m = agent.details?.model;
  return typeof m === 'string' && m ? m : null;
}
