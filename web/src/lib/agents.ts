// Filtering the agents list, grouping sessions into agents, and nesting sub-agents (U-02, C-06).

import { isRunning, unfinishedReason, type AgentState, type AgentView } from '@agent-manager-delux/shared';
import { formatAbsolute } from './time';
import type { CsvColumn } from './csv';
import { jsonCell } from './csv';
import { kindLabel, STATE_LABEL } from './labels';

export interface AgentFilters {
  q: string;
  kinds: readonly string[];
  machines: readonly string[];
  states: readonly string[];
  showStopped: boolean;
}

export function hasActiveFilters(f: AgentFilters): boolean {
  return f.q.trim() !== '' || f.kinds.length > 0 || f.machines.length > 0 || f.states.length > 0;
}

export function matchesFilters(agent: AgentView, f: AgentFilters): boolean {
  if (!f.showStopped && agent.effectiveState === 'stopped') return false;
  if (f.kinds.length && !f.kinds.includes(agent.kind)) return false;
  if (f.machines.length && !f.machines.includes(agent.machine)) return false;
  if (f.states.length && !f.states.includes(agent.effectiveState)) return false;
  const q = f.q.trim().toLowerCase();
  if (q) {
    const haystack = [
      agent.name,
      agent.id,
      agent.machine,
      agent.project,
      agent.activity,
      agent.story,
      agent.task,
      agent.prompt,
      agent.result?.title,
      agent.kind,
      kindLabel(agent.kind),
    ]
      .filter(Boolean)
      .join('\n')
      .toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  return true;
}

export interface AgentTree {
  /** Top-level rows: agents with no parent, or whose parent isn't listed. */
  roots: AgentView[];
  /** Visible children of each agent. */
  children: Map<string, AgentView[]>;
  /** Agents that match the filters themselves. */
  matched: Set<string>;
  /** Every visible agent, parents before their children. */
  flat: AgentView[];
}

/**
 * Nests agents by `parentId`. An agent is shown when it matches, or when one of its sub-agents
 * does (so a matching sub-agent keeps its parent for context).
 */
export function buildAgentTree(agents: readonly AgentView[], include: (a: AgentView) => boolean): AgentTree {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const allChildren = new Map<string, AgentView[]>();
  const tops: AgentView[] = [];
  for (const a of agents) {
    if (a.parentId && a.parentId !== a.id && byId.has(a.parentId)) {
      const list = allChildren.get(a.parentId);
      if (list) list.push(a);
      else allChildren.set(a.parentId, [a]);
    } else {
      tops.push(a);
    }
  }

  const matched = new Set<string>();
  const children = new Map<string, AgentView[]>();
  const visited = new Set<string>();

  const visit = (a: AgentView): boolean => {
    visited.add(a.id);
    const kept: AgentView[] = [];
    for (const child of allChildren.get(a.id) ?? []) {
      if (!visited.has(child.id) && visit(child)) kept.push(child);
    }
    const self = include(a);
    if (self) matched.add(a.id);
    if (kept.length) children.set(a.id, kept);
    return self || kept.length > 0;
  };

  const roots = tops.filter(visit);
  // Agents caught in a parent loop are never reached from a top-level agent: list them flat.
  for (const a of agents) {
    if (!visited.has(a.id)) {
      visited.add(a.id);
      if (include(a)) {
        matched.add(a.id);
        roots.push(a);
      }
    }
  }

  const flat: AgentView[] = [];
  const walk = (list: readonly AgentView[]) => {
    for (const a of list) {
      flat.push(a);
      walk(children.get(a.id) ?? []);
    }
  };
  walk(roots);
  return { roots, children, matched, flat };
}

// ---- One agent, many sessions ----

/**
 * An agent as the owner thinks of it: every Claude Code session in one project on one machine
 * is the same agent. Other agents, and sub-agents, stand alone.
 */
export interface AgentGroup {
  key: string;
  /** The project, or the agent's own name when it stands alone. */
  name: string;
  /** The session that says most about the agent now (see LEAD_RANK). */
  lead: AgentView;
  /** Every session, lead first. */
  instances: AgentView[];
  /** Sessions still going. */
  running: number;
}

export function agentGroupKey(a: AgentView): string {
  return a.kind === 'claude-code' && a.project && !a.parentId ? `${a.kind}|${a.machine}|${a.project}` : `id|${a.id}`;
}

/** Which session leads its agent: waiting on you, then working, then what needs a look, then the rest. */
const LEAD_RANK: Record<AgentState, number> = { waiting: 0, working: 1, failed: 2, idle: 3, lost: 4, stopped: 5 };

export function compareLead(a: AgentView, b: AgentView): number {
  return LEAD_RANK[a.effectiveState] - LEAD_RANK[b.effectiveState] || Date.parse(b.lastSeen) - Date.parse(a.lastSeen);
}

/** Groups agents (normally the top-level ones) by agentGroupKey, keeping first-seen order. */
export function groupAgents(agents: readonly AgentView[]): AgentGroup[] {
  const groups = new Map<string, AgentView[]>();
  for (const a of agents) {
    const key = agentGroupKey(a);
    const list = groups.get(key);
    if (list) list.push(a);
    else groups.set(key, [a]);
  }
  return [...groups].map(([key, list]) => {
    const instances = [...list].sort(compareLead);
    const lead = instances[0]!;
    return {
      key,
      name: list.length > 1 || key.startsWith('claude-code|') ? (lead.project ?? lead.name) : lead.name || lead.id,
      lead,
      instances,
      running: instances.filter((i) => isRunning(i.effectiveState)).length,
    };
  });
}

/** A row of the agents table: an agent, or a group of sessions shown as one agent. */
export type AgentRow = AgentView & { group?: AgentGroup };

/**
 * One row per group: the agent itself when it has one session, else a row that reads like its
 * lead session (state, story, task, prompt) and opens to show every session.
 */
export function groupRows(agents: readonly AgentView[]): AgentRow[] {
  return groupAgents(agents).map((g) => {
    if (g.instances.length === 1) return g.lead;
    const firstSeen = g.instances.reduce((m, i) => (i.firstSeen < m ? i.firstSeen : m), g.lead.firstSeen);
    const lastSeen = g.instances.reduce((m, i) => (i.lastSeen > m ? i.lastSeen : m), g.lead.lastSeen);
    return {
      ...g.lead,
      id: `group:${g.key}`,
      name: g.name,
      parentId: null,
      firstSeen,
      lastSeen,
      runningChildren: g.instances.reduce((n, i) => n + i.runningChildren, 0),
      group: g,
    };
  });
}

export function countByState(agents: readonly AgentView[]): Record<AgentState, number> {
  const counts: Record<AgentState, number> = { working: 0, waiting: 0, idle: 0, stopped: 0, failed: 0, lost: 0 };
  for (const a of agents) counts[a.effectiveState] += 1;
  return counts;
}

export const AGENT_CSV_COLUMNS: CsvColumn<AgentView>[] = [
  { header: 'id', value: (a) => a.id },
  { header: 'name', value: (a) => a.name },
  { header: 'kind', value: (a) => a.kind },
  { header: 'machine', value: (a) => a.machine },
  { header: 'project', value: (a) => a.project },
  { header: 'parentId', value: (a) => a.parentId },
  { header: 'state', value: (a) => a.effectiveState },
  { header: 'stateLabel', value: (a) => STATE_LABEL[a.effectiveState] },
  { header: 'reportedState', value: (a) => a.state },
  { header: 'activity', value: (a) => a.activity },
  { header: 'story', value: (a) => a.story },
  { header: 'task', value: (a) => a.task },
  { header: 'prompt', value: (a) => a.prompt },
  { header: 'promptAt', value: (a) => a.promptAt },
  { header: 'turn', value: (a) => a.turn?.outcome ?? null },
  { header: 'unfinished', value: (a) => unfinishedReason(a) },
  { header: 'resultTitle', value: (a) => a.result?.title ?? null },
  { header: 'resultCommitUrl', value: (a) => a.result?.commitUrl ?? null },
  { header: 'link', value: (a) => a.link },
  { header: 'runningChildren', value: (a) => a.runningChildren },
  { header: 'firstSeen', value: (a) => a.firstSeen },
  { header: 'lastSeen', value: (a) => a.lastSeen },
  { header: 'lastSeenLocal', value: (a) => formatAbsolute(a.lastSeen) },
  { header: 'endedAt', value: (a) => a.endedAt },
  { header: 'instructionsVersion', value: (a) => a.instructionsVersion },
  { header: 'keyName', value: (a) => a.keyName },
  { header: 'details', value: (a) => jsonCell(a.details) },
];
