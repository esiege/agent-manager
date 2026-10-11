// The agents table (U-02): one row per agent, its other sessions and sub-agents nested under it
// (C-06), sortable on every column. Story, task and prompt say what each agent is on.

import { unfinishedReason, type AgentView } from '@agent-manager/shared';
import { ActionIcon, Anchor, Badge, Box, Group, Stack, Text, Tooltip } from '@mantine/core';
import { IconAlertTriangle, IconChevronDown, IconChevronRight, IconCircleCheck } from '@tabler/icons-react';
import {
  createColumnHelper,
  getCoreRowModel,
  getExpandedRowModel,
  getSortedRowModel,
  useReactTable,
  type ExpandedState,
  type OnChangeFn,
  type Row,
  type SortingState,
  type Table,
  type VisibilityState,
} from '@tanstack/react-table';
import { Link } from 'react-router';
import type { AgentRow } from '../lib/agents';
import { agentPath, isOldSetup, kindLabel, plural, stateRank } from '../lib/labels';
import { OldSetupBadge, StateBadge } from './Badges';
import { CopyIcon } from './Copy';
import { RelativeTime } from './Time';

const col = createColumnHelper<AgentRow>();

function Dash() {
  return (
    <Text span size="sm" c="dimmed">
      –
    </Text>
  );
}

/** Where a row leads: a grouped agent opens its lead session. */
export function rowAgentId(agent: AgentRow): string {
  return agent.group ? agent.group.lead.id : agent.id;
}

function NameCell({ row }: { row: Row<AgentRow> }) {
  const agent = row.original;
  const expanded = row.getIsExpanded();
  const name = agent.name || agent.id;
  const sessions = agent.group?.instances.length ?? 0;
  return (
    <Group gap={6} wrap="nowrap" pl={row.depth * 22}>
      {row.getCanExpand() ? (
        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          onClick={row.getToggleExpandedHandler()}
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Hide' : 'Show'} ${sessions ? 'sessions' : 'sub-agents'} of ${name}`}
        >
          {expanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
        </ActionIcon>
      ) : (
        <Box w={22} style={{ flexShrink: 0 }} />
      )}
      <Anchor component={Link} to={agentPath(rowAgentId(agent))} size="sm" fw={500} style={{ whiteSpace: 'nowrap' }}>
        {name}
      </Anchor>
      {sessions > 0 ? (
        <Tooltip label={`${plural(agent.group!.running, 'session')} running. Open the row to see each one.`}>
          <Badge variant="default" size="sm" radius="sm" tt="none" style={{ flexShrink: 0 }}>
            {plural(sessions, 'session')}
          </Badge>
        </Tooltip>
      ) : (
        row.getCanExpand() &&
        !expanded && (
          <Text span size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
            +{row.subRows.length}
          </Text>
        )
      )}
      {isOldSetup(agent) && <OldSetupBadge version={agent.instructionsVersion} />}
    </Group>
  );
}

/** Up to two lines of text, all of it in a tooltip. */
function Clamp({ text, dimmed, prefix }: { text: string; dimmed?: boolean; prefix?: string }) {
  return (
    <Tooltip label={text} multiline maw={480} openDelay={400} style={{ whiteSpace: 'pre-wrap' }}>
      <Text size="sm" lineClamp={2} maw={300} c={dimmed ? 'dimmed' : undefined} style={{ overflowWrap: 'anywhere' }}>
        {prefix}
        {text}
      </Text>
    </Tooltip>
  );
}

function StateCell({ agent }: { agent: AgentView }) {
  const unfinished = unfinishedReason(agent);
  return (
    <Group gap={4} wrap="nowrap">
      <StateBadge state={agent.effectiveState} />
      {unfinished && (
        <Tooltip label={`Unfinished: ${unfinished}`}>
          <IconAlertTriangle size={16} color="var(--mantine-color-orange-filled)" aria-label={`Unfinished: ${unfinished}`} />
        </Tooltip>
      )}
    </Group>
  );
}

/** The story, and under it the latest finished work when there is some. */
function StoryCell({ agent }: { agent: AgentView }) {
  const result = agent.result;
  if (!agent.story && !result) return <Dash />;
  return (
    <Stack gap={2}>
      {agent.story && <Clamp text={agent.story} />}
      {result && (
        <Group gap={4} wrap="nowrap" miw={0}>
          <IconCircleCheck size={14} color="var(--mantine-color-teal-filled)" style={{ flexShrink: 0 }} aria-label="Finished" />
          <Text size="xs" c="dimmed" truncate="end" maw={280}>
            {result.title}
          </Text>
        </Group>
      )}
    </Stack>
  );
}

/** The task, with the low-level activity under it (or in its place). */
function TaskCell({ agent }: { agent: AgentView }) {
  if (!agent.task && !agent.activity) return <Dash />;
  if (!agent.task) return <Clamp text={agent.activity!} dimmed />;
  return (
    <Stack gap={2}>
      <Clamp text={agent.task} />
      {agent.activity && agent.activity !== agent.task && (
        <Text size="xs" c="dimmed" truncate="end" maw={300}>
          {agent.activity}
        </Text>
      )}
    </Stack>
  );
}

export const AGENT_COLUMNS = [
  col.accessor((a) => a.name || a.id, {
    id: 'name',
    header: 'Name',
    sortingFn: 'text',
    cell: ({ row }) => <NameCell row={row} />,
  }),
  col.accessor((a) => kindLabel(a.kind), { id: 'kind', header: 'Kind', sortingFn: 'text', meta: { nowrap: true } }),
  col.accessor('machine', { header: 'Machine', sortingFn: 'text', meta: { nowrap: true } }),
  col.accessor((a) => a.project ?? '', {
    id: 'project',
    header: 'Project',
    sortingFn: 'text',
    cell: ({ getValue }) => getValue() || <Dash />,
  }),
  col.accessor((a) => stateRank(a.effectiveState), {
    id: 'state',
    header: 'State',
    sortDescFirst: false,
    cell: ({ row }) => <StateCell agent={row.original} />,
  }),
  col.accessor((a) => a.story ?? '', {
    id: 'story',
    header: 'Story',
    sortingFn: 'text',
    cell: ({ row }) => <StoryCell agent={row.original} />,
  }),
  col.accessor((a) => a.task ?? a.activity ?? '', {
    id: 'task',
    header: 'Task',
    sortingFn: 'text',
    cell: ({ row }) => <TaskCell agent={row.original} />,
  }),
  col.accessor((a) => a.prompt ?? '', {
    id: 'prompt',
    header: 'Prompt',
    sortingFn: 'text',
    cell: ({ row }) => (row.original.prompt ? <Clamp text={row.original.prompt} /> : <Dash />),
  }),
  col.accessor('runningChildren', {
    id: 'threads',
    header: 'Threads',
    cell: ({ getValue }) => (getValue() > 0 ? getValue() : <Dash />),
  }),
  col.accessor((a) => Date.parse(a.firstSeen), {
    id: 'started',
    header: 'Started',
    cell: ({ row }) => <RelativeTime iso={row.original.firstSeen} />,
  }),
  col.accessor((a) => Date.parse(a.lastSeen), {
    id: 'lastSeen',
    header: 'Last seen',
    cell: ({ row }) => <RelativeTime iso={row.original.lastSeen} />,
  }),
  col.display({
    id: 'copy',
    header: '',
    meta: { label: 'Copy id', width: 40 },
    cell: ({ row }) => <CopyIcon value={rowAgentId(row.original)} label="Copy agent id" />,
  }),
];

interface AgentsTableOptions {
  data: AgentRow[];
  /** Sub-agents of each agent, when rows nest. A grouped row nests its sessions. */
  childrenOf?: ReadonlyMap<string, AgentView[]>;
  sorting: SortingState;
  onSortingChange: OnChangeFn<SortingState>;
  expanded?: ExpandedState;
  onExpandedChange?: OnChangeFn<ExpandedState>;
  columnVisibility?: VisibilityState;
}

export function useAgentsTable({
  data,
  childrenOf,
  sorting,
  onSortingChange,
  expanded = {},
  onExpandedChange,
  columnVisibility = {},
}: AgentsTableOptions): Table<AgentRow> {
  return useReactTable({
    data,
    columns: AGENT_COLUMNS,
    state: { sorting, expanded, columnVisibility },
    onSortingChange,
    onExpandedChange,
    getRowId: (a) => a.id,
    getSubRows: (a) => a.group?.instances ?? childrenOf?.get(a.id),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    enableSortingRemoval: false,
    // Polling replaces the data every few seconds: keep rows open.
    autoResetExpanded: false,
  });
}

