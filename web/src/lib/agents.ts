// Filtering the agents list and nesting sub-agents under their parents (U-02, C-06).

import type { AgentState, AgentView } from '@agent-manager/shared';
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
    const haystack = [agent.name, agent.id, agent.machine, agent.project, agent.activity, agent.kind, kindLabel(agent.kind)]
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
