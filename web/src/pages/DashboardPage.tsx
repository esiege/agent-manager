// The Dashboard: one panel per agent, sized so they all fit on one screen (phone or desktop).

import { unfinishedReason, type AgentView } from '@agent-manager/shared';
import { Anchor, Group, Text } from '@mantine/core';
import { useElementSize } from '@mantine/hooks';
import { Link } from 'react-router';
import { AgentTile } from '../components/AgentTile';
import { EmptyState, LoadError, TableSkeleton } from '../components/States';
import { UpdatedAgo } from '../components/Time';
import { useAgentsFeed } from '../hooks/useAgentsFeed';
import { groupAgents, type AgentGroup } from '../lib/agents';
import { fitGrid } from '../lib/fitGrid';

/** Stopped agents stay on the Dashboard this long after their last report of finished work. */
const RECENT_RESULT_MS = 12 * 60 * 60 * 1000;
/** Below this the grid scrolls. Phones go smaller, so a dozen agents still fit without scrolling. */
const MIN_TILE = 150;
const MIN_TILE_PHONE = 104;

type Bucket = 'waiting' | 'unfinished' | 'working' | 'idle' | 'lost' | 'done';
const BUCKET_ORDER: Bucket[] = ['waiting', 'unfinished', 'working', 'idle', 'lost', 'done'];

function bucket(lead: AgentView): Bucket {
  const state = lead.effectiveState;
  if (state === 'waiting') return 'waiting';
  if (state === 'failed' || unfinishedReason(lead)) return 'unfinished';
  if (state === 'working' || state === 'idle' || state === 'lost') return state;
  return 'done';
}

/** Live agents, plus stopped ones whose work was cut off or finished recently. */
function isShown(g: AgentGroup, now: number): boolean {
  const lead = g.lead;
  if (lead.effectiveState !== 'stopped') return true;
  if (unfinishedReason(lead)) return true;
  return lead.result !== null && now - Date.parse(lead.result.at) < RECENT_RESULT_MS;
}

function dashboardGroups(agents: AgentView[], now: number): AgentGroup[] {
  const ids = new Set(agents.map((a) => a.id));
  const tops = agents.filter((a) => !a.parentId || !ids.has(a.parentId));
  return groupAgents(tops)
    .filter((g) => isShown(g, now))
    .sort(
      (a, b) =>
        BUCKET_ORDER.indexOf(bucket(a.lead)) - BUCKET_ORDER.indexOf(bucket(b.lead)) ||
        Date.parse(b.lead.lastSeen) - Date.parse(a.lead.lastSeen),
    );
}

function countsLine(groups: AgentGroup[]): string {
  const n: Record<Bucket, number> = { waiting: 0, unfinished: 0, working: 0, idle: 0, lost: 0, done: 0 };
  for (const g of groups) n[bucket(g.lead)] += 1;
  const parts = [
    `${n.working} working`,
    n.waiting ? `${n.waiting} need${n.waiting === 1 ? 's' : ''} you` : '',
    n.unfinished ? `${n.unfinished} unfinished` : '',
    n.idle ? `${n.idle} idle` : '',
    n.lost ? `${n.lost} lost` : '',
    n.done ? `${n.done} done` : '',
  ];
  return parts.filter(Boolean).join(' · ');
}

function TileGrid({ groups, flashing }: { groups: AgentGroup[]; flashing: ReadonlySet<string> }) {
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const gap = width < 600 ? 8 : 12;
  const fit = fitGrid(groups.length, width, height, gap, width < 600 ? MIN_TILE_PHONE : MIN_TILE);

  return (
    <div ref={ref} className="am-dash-area">
      {width > 0 && (
        <div
          className="am-dash-grid"
          data-scroll={fit.scroll || undefined}
          style={{
            gap,
            gridTemplateColumns: `repeat(${fit.cols}, minmax(0, 1fr))`,
            // Fitting: rows share the height. Scrolling: fixed-height rows.
            gridTemplateRows: fit.scroll ? undefined : `repeat(${fit.rows}, minmax(0, 1fr))`,
            gridAutoRows: fit.scroll ? `${fit.tileH}px` : undefined,
          }}
        >
          {groups.map((g) => (
            <AgentTile key={g.key} group={g} flashing={g.instances.some((i) => flashing.has(i.id))} />
          ))}
        </div>
      )}
    </div>
  );
}

export function DashboardPage() {
  const { data, error, updatedAt, refresh, flashing } = useAgentsFeed();
  const groups = data ? dashboardGroups(data.agents, Date.parse(data.now)) : [];

  return (
    <div className="am-dash">
      <title>Dashboard · Agent Manager</title>
      <Group className="am-dash-bar" justify="space-between" wrap="nowrap" gap="sm">
        <Text size="sm" fw={500} truncate="end" miw={0}>
          {data ? (groups.length ? countsLine(groups) : 'Nothing running') : 'Loading…'}
        </Text>
        <UpdatedAgo updatedAt={updatedAt} error={error} />
      </Group>
      {!data ? (
        error ? (
          <LoadError message={error.message} onRetry={refresh} />
        ) : (
          <TableSkeleton rows={4} />
        )
      ) : groups.length === 0 ? (
        <EmptyState title="Nothing to show">
          No agent is running, and none finished work in the last 12 hours. See{' '}
          <Anchor component={Link} to="/agents" size="sm">
            Agents
          </Anchor>{' '}
          for everything.
        </EmptyState>
      ) : (
        <TileGrid groups={groups} flashing={flashing} />
      )}
    </div>
  );
}
