// Adds up what GET /api/v1/reporting returns for the Reporting tab: hours of requests, finished
// work and token cost, by kind of work, project, day, model and story. Pure, so it's testable.

import {
  costOf,
  totalTokens,
  WORK_TYPE_INFO,
  workType,
  type ReportingAgent,
  type ReportingResponse,
  type TokenUsage,
  type WorkGroup,
  type WorkType,
  type WorkTypeSource,
} from '@agent-manager-deluxe/shared';

export const NO_PROJECT = '(no project)';

/** A request that runs longer than this is counted as this long: it was stuck, not working. */
const MAX_TURN_MS = 24 * 3600_000;

export interface Filters {
  /** null for every project. */
  project: string | null;
}

export interface Totals {
  hours: number;
  requests: number;
  finished: number;
  /** Requests that ended (finished, failed or cut off), the denominator for the finish rate. */
  ended: number;
  results: number;
  tokens: number;
  cost: number;
  /** Tokens of models with no known price, left out of cost. */
  unpricedTokens: number;
  /** Hours whose kind of work was decided by the agent's kind alone: nothing said what it was. */
  guessedHours: number;
}

export interface TypeRow extends Totals {
  type: WorkType;
  label: string;
  group: WorkGroup;
}

export interface GroupHours {
  technical: number;
  'non-technical': number;
  other: number;
}

export interface DayRow extends GroupHours {
  /** ISO date of the bucket's first day (local time). */
  day: string;
  cost: number;
}

export interface ProjectRow extends GroupHours {
  project: string;
  hours: number;
  cost: number;
}

export interface ModelRow {
  model: string;
  tokens: number;
  cost: number | null;
}

export interface StoryRow {
  story: string;
  project: string;
  type: WorkType;
  source: WorkTypeSource;
  hours: number;
  requests: number;
  cost: number;
}

export interface Report {
  totals: Totals;
  byType: TypeRow[];
  byGroup: GroupHours;
  costByGroup: GroupHours;
  byDay: DayRow[];
  /** "day" or "week": long windows are bucketed by week so the bars stay readable. */
  bucket: 'day' | 'week';
  byProject: ProjectRow[];
  byModel: ModelRow[];
  stories: StoryRow[];
  projects: string[];
  /** True when no usage arrived at all: the PCs haven't updated agentctl yet. */
  noUsage: boolean;
}

const emptyTotals = (): Totals => ({
  hours: 0,
  requests: 0,
  finished: 0,
  ended: 0,
  results: 0,
  tokens: 0,
  cost: 0,
  unpricedTokens: 0,
  guessedHours: 0,
});
const emptyGroups = (): GroupHours => ({ technical: 0, 'non-technical': 0, other: 0 });

function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The bucket a time falls in: its day, or the Monday of its week. */
function bucketOf(ms: number, bucket: 'day' | 'week'): string {
  if (bucket === 'day') return localDay(ms);
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return localDay(d.getTime());
}

function buckets(nowMs: number, days: number, bucket: 'day' | 'week'): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = bucketOf(nowMs - i * 86_400_000, bucket);
    if (out[out.length - 1] !== key) out.push(key);
  }
  return out;
}

function usageCost(list: TokenUsage[]): { tokens: number; cost: number; unpriced: number } {
  let tokens = 0;
  let cost = 0;
  let unpriced = 0;
  for (const u of list) {
    const t = totalTokens(u);
    tokens += t;
    const c = costOf(u);
    if (c === null) unpriced += t;
    else cost += c;
  }
  return { tokens, cost, unpriced };
}

export function buildReport(data: ReportingResponse, filters: Filters): Report {
  const nowMs = Date.parse(data.now);
  const bucket: Report['bucket'] = data.days > 60 ? 'week' : 'day';
  const agents = new Map(data.agents.map((a) => [a.id, a]));
  /** The session a sub-agent belongs to carries its project and story. */
  const root = (id: string): ReportingAgent | undefined => {
    const a = agents.get(id);
    return a?.parentId ? (agents.get(a.parentId) ?? a) : a;
  };
  const projectOf = (id: string) => agents.get(id)?.project ?? root(id)?.project ?? NO_PROJECT;
  const sort = (agentId: string, declared: WorkType | null, texts: (string | null | undefined)[]) => {
    const r = root(agentId);
    return workType({ declared: declared ?? r?.workType ?? null, kind: r?.kind ?? 'other', texts: [...texts, r?.story] });
  };
  const keep = (agentId: string) => filters.project === null || projectOf(agentId) === filters.project;

  const totals = emptyTotals();
  const types = new Map<WorkType, TypeRow>();
  const typeRow = (type: WorkType) => {
    let row = types.get(type);
    if (!row) types.set(type, (row = { ...emptyTotals(), type, ...WORK_TYPE_INFO[type] }));
    return row;
  };
  const byGroup = emptyGroups();
  const costByGroup = emptyGroups();
  const days = new Map<string, DayRow>(buckets(nowMs, data.days, bucket).map((day) => [day, { day, ...emptyGroups(), cost: 0 }]));
  const projects = new Map<string, ProjectRow>();
  const projectRow = (project: string) => {
    let row = projects.get(project);
    if (!row) projects.set(project, (row = { project, ...emptyGroups(), hours: 0, cost: 0 }));
    return row;
  };
  const models = new Map<string, ModelRow>();
  const stories = new Map<string, StoryRow>();
  const storyRow = (agentId: string, story: string | null, type: WorkType, source: WorkTypeSource) => {
    const r = root(agentId);
    const name = story ?? r?.story ?? r?.name ?? agentId;
    const project = projectOf(agentId);
    const key = `${project}\u0000${name}`;
    let row = stories.get(key);
    if (!row) stories.set(key, (row = { story: name, project, type, source, hours: 0, requests: 0, cost: 0 }));
    return row;
  };

  for (const t of data.turns) {
    if (!keep(t.agentId)) continue;
    const start = Date.parse(t.startedAt);
    const agent = agents.get(t.agentId);
    const end = t.endedAt ? Date.parse(t.endedAt) : Math.min(nowMs, agent ? Date.parse(agent.lastSeen) : nowMs);
    const hours = Math.min(Math.max(0, end - start), MAX_TURN_MS) / 3600_000;
    const { type, source } = sort(t.agentId, t.workType, [t.story, t.prompt]);
    const { group } = WORK_TYPE_INFO[type];
    for (const row of [totals, typeRow(type)]) {
      row.hours += hours;
      row.requests += 1;
      if (t.outcome === 'finished') row.finished += 1;
      if (t.outcome !== 'running') row.ended += 1;
      if (source === 'kind') row.guessedHours += hours;
    }
    byGroup[group] += hours;
    const day = days.get(bucketOf(start, bucket));
    if (day) day[group] += hours;
    const p = projectRow(projectOf(t.agentId));
    p[group] += hours;
    p.hours += hours;
    const s = storyRow(t.agentId, t.story, type, source);
    s.hours += hours;
    s.requests += 1;
  }

  for (const u of data.usage) {
    if (!keep(u.agentId)) continue;
    const { tokens, cost, unpriced } = usageCost(u.usage);
    const { type, source } = sort(u.agentId, u.workType, [u.story]);
    const { group } = WORK_TYPE_INFO[type];
    for (const row of [totals, typeRow(type)]) {
      row.tokens += tokens;
      row.cost += cost;
      row.unpricedTokens += unpriced;
    }
    costByGroup[group] += cost;
    const day = days.get(bucketOf(Date.parse(u.at), bucket));
    if (day) day.cost += cost;
    projectRow(projectOf(u.agentId)).cost += cost;
    storyRow(u.agentId, u.story, type, source).cost += cost;
    for (const m of u.usage) {
      const row = models.get(m.model) ?? { model: m.model, tokens: 0, cost: 0 };
      row.tokens += totalTokens(m);
      const c = costOf(m);
      row.cost = c === null || row.cost === null ? null : row.cost + c;
      models.set(m.model, row);
    }
  }

  for (const r of data.results) {
    if (!keep(r.agentId)) continue;
    const { type } = sort(r.agentId, r.workType, [r.title, r.story]);
    totals.results += 1;
    typeRow(type).results += 1;
  }

  return {
    totals,
    byType: [...types.values()].sort((a, b) => b.hours - a.hours || b.cost - a.cost),
    byGroup,
    costByGroup,
    byDay: [...days.values()],
    bucket,
    byProject: [...projects.values()].sort((a, b) => b.hours - a.hours || b.cost - a.cost),
    byModel: [...models.values()].sort((a, b) => b.tokens - a.tokens),
    stories: [...stories.values()].sort((a, b) => b.hours - a.hours || b.cost - a.cost),
    projects: [...new Set(data.agents.map((a) => projectOf(a.id)))].sort((a, b) => a.localeCompare(b)),
    noUsage: data.usage.length === 0,
  };
}

// ---- Formatting ----

export function formatHours(h: number): string {
  if (h === 0) return '0 h';
  if (h < 1) return `${Math.round(h * 60)} min`;
  return `${h < 10 ? h.toFixed(1) : Math.round(h).toLocaleString()} h`;
}

export function formatCost(dollars: number): string {
  if (dollars === 0) return '$0';
  if (dollars < 10) return `$${dollars.toFixed(2)}`;
  if (dollars < 10_000) return `$${Math.round(dollars).toLocaleString()}`;
  return `$${(dollars / 1000).toFixed(1)}K`;
}

export function formatCount(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`;
  return `${(n / 1_000_000_000).toFixed(1)}B`;
}
