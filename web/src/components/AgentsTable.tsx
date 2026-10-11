// The agents table (U-02): sortable on every column, sub-agents nested under their parent (C-06).

import type { AgentView } from '@agent-manager/shared';
import { ActionIcon, Anchor, Box, Group, Text, Tooltip } from '@mantine/core';
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react';
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
import { agentPath, isOldSetup, kindLabel, stateRank } from '../lib/labels';
import { OldSetupBadge, StateBadge } from './Badges';
import { CopyIcon } from './Copy';
import { RelativeTime } from './Time';

const col = createColumnHelper<AgentView>();

function Dash() {
  return (
    <Text span size="sm" c="dimmed">
      –
    </Text>
  );
}

function NameCell({ row }: { row: Row<AgentView> }) {
  const agent = row.original;
  const expanded = row.getIsExpanded();
  const name = agent.name || agent.id;
  return (
    <Group gap={6} wrap="nowrap" pl={row.depth * 22}>
      {row.getCanExpand() ? (
        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          onClick={row.getToggleExpandedHandler()}
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Hide' : 'Show'} sub-agents of ${name}`}
        >
          {expanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
        </ActionIcon>
      ) : (
        <Box w={22} style={{ flexShrink: 0 }} />
      )}
      <Anchor component={Link} to={agentPath(agent.id)} size="sm" fw={500} style={{ whiteSpace: 'nowrap' }}>
        {name}
      </Anchor>
      {row.getCanExpand() && !expanded && (
        <Text span size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
          +{row.subRows.length}
        </Text>
      )}
      {isOldSetup(agent) && <OldSetupBadge version={agent.instructionsVersion} />}
    </Group>
  );
}

function ActivityCell({ text }: { text: string | null }) {
  if (!text) return <Dash />;
  return (
    <Tooltip label={text} multiline maw={480} openDelay={400}>
      <Text size="sm" truncate="end" maw={360}>
        {text}
      </Text>
    </Tooltip>
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
    cell: ({ row }) => <StateBadge state={row.original.effectiveState} />,
  }),
  col.accessor((a) => a.activity ?? '', {
    id: 'activity',
    header: 'Activity',
    sortingFn: 'text',
    cell: ({ row }) => <ActivityCell text={row.original.activity} />,
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
    cell: ({ row }) => <CopyIcon value={row.original.id} label="Copy agent id" />,
  }),
];

interface AgentsTableOptions {
  data: AgentView[];
  /** Sub-agents of each agent, when rows nest. */
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
}: AgentsTableOptions): Table<AgentView> {
  return useReactTable({
    data,
    columns: AGENT_COLUMNS,
    state: { sorting, expanded, columnVisibility },
    onSortingChange,
    onExpandedChange,
    getRowId: (a) => a.id,
    getSubRows: childrenOf ? (a) => childrenOf.get(a.id) : undefined,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    enableSortingRemoval: false,
    // Polling replaces the data every few seconds: keep rows open.
    autoResetExpanded: false,
  });
}

