// The logs table (U-04): sortable, expandable for context, ids that filter when clicked.

import { LOG_LEVELS, type LogEntry } from '@agent-manager-deluxe/shared';
import { ActionIcon, Anchor, Group, SimpleGrid, Stack, Text, Tooltip } from '@mantine/core';
import { IconChevronDown, IconChevronRight, IconExternalLink } from '@tabler/icons-react';
import {
  createColumnHelper,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ExpandedState,
  type OnChangeFn,
  type Row,
  type SortingState,
  type Table,
} from '@tanstack/react-table';
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { jsonCell, type CsvColumn } from '../lib/csv';
import { agentPath } from '../lib/labels';
import { formatAbsolute, formatPrecise } from '../lib/time';
import { LevelBadge } from './Badges';
import { CopyIcon } from './Copy';
import { JsonBlock } from './JsonBlock';

export type LogFilterField = 'source' | 'agentId' | 'correlationId';

const col = createColumnHelper<LogEntry>();

function FilterLink({ value, field, onFilter }: { value: string; field: LogFilterField; onFilter: (field: LogFilterField, value: string) => void }) {
  const what = field === 'source' ? 'source' : field === 'agentId' ? 'agent' : 'correlation id';
  return (
    <Tooltip label={`Show only this ${what}`} openDelay={400}>
      <Anchor
        component="button"
        type="button"
        size="xs"
        ff={field === 'source' ? undefined : 'monospace'}
        onClick={() => onFilter(field, value)}
        style={{ whiteSpace: 'nowrap', textAlign: 'left' }}
      >
        {value}
      </Anchor>
    </Tooltip>
  );
}

function Dash() {
  return (
    <Text span size="sm" c="dimmed">
      –
    </Text>
  );
}

function buildColumns(onFilter: (field: LogFilterField, value: string) => void) {
  return [
    col.display({
      id: 'expand',
      header: '',
      meta: { label: 'Details', width: 36 },
      cell: ({ row }) => (
        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          onClick={row.getToggleExpandedHandler()}
          aria-expanded={row.getIsExpanded()}
          aria-label={row.getIsExpanded() ? 'Hide details' : 'Show details'}
        >
          {row.getIsExpanded() ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
        </ActionIcon>
      ),
    }),
    col.accessor((l) => Date.parse(l.at), {
      id: 'time',
      header: 'Time',
      meta: { nowrap: true },
      cell: ({ row }) => (
        <Text component="time" dateTime={row.original.at} size="xs" ff="monospace" title={row.original.at}>
          {formatPrecise(row.original.at)}
        </Text>
      ),
    }),
    col.accessor((l) => LOG_LEVELS.indexOf(l.level), {
      id: 'level',
      header: 'Level',
      cell: ({ row }) => <LevelBadge level={row.original.level} />,
    }),
    col.accessor('source', {
      header: 'Source',
      sortingFn: 'text',
      cell: ({ getValue }) => <FilterLink value={getValue()} field="source" onFilter={onFilter} />,
    }),
    col.accessor('message', {
      header: 'Message',
      sortingFn: 'text',
      cell: ({ getValue }) => (
        <Text size="sm" lineClamp={2} maw={560} style={{ wordBreak: 'break-word' }}>
          {getValue()}
        </Text>
      ),
    }),
    col.accessor((l) => l.agentId ?? '', {
      id: 'agent',
      header: 'Agent',
      sortingFn: 'text',
      cell: ({ row }) => {
        const id = row.original.agentId;
        if (!id) return <Dash />;
        return (
          <Group gap={2} wrap="nowrap">
            <FilterLink value={id} field="agentId" onFilter={onFilter} />
            <Tooltip label="Open agent">
              <ActionIcon component={Link} to={agentPath(id)} variant="subtle" color="gray" size="xs" aria-label="Open agent">
                <IconExternalLink size={12} />
              </ActionIcon>
            </Tooltip>
          </Group>
        );
      },
    }),
    col.accessor((l) => l.correlationId ?? '', {
      id: 'correlation',
      header: 'Correlation id',
      sortingFn: 'text',
      cell: ({ row }) =>
        row.original.correlationId ? (
          <FilterLink value={row.original.correlationId} field="correlationId" onFilter={onFilter} />
        ) : (
          <Dash />
        ),
    }),
    col.display({
      id: 'copy',
      header: '',
      meta: { label: 'Copy as JSON', width: 40 },
      cell: ({ row }) => <CopyIcon value={JSON.stringify(row.original, null, 2)} label="Copy entry as JSON" />,
    }),
  ];
}

interface LogsTableOptions {
  logs: LogEntry[];
  sorting: SortingState;
  onSortingChange: OnChangeFn<SortingState>;
  onFilter: (field: LogFilterField, value: string) => void;
  hideAgent?: boolean;
}

export function useLogsTable({ logs, sorting, onSortingChange, onFilter, hideAgent }: LogsTableOptions): Table<LogEntry> {
  const [expanded, setExpanded] = useState<ExpandedState>({});
  const columns = useMemo(() => buildColumns(onFilter), [onFilter]);
  return useReactTable({
    data: logs,
    columns,
    state: { sorting, expanded, columnVisibility: { agent: !hideAgent } },
    onSortingChange,
    onExpandedChange: setExpanded,
    getRowId: (l) => l.id,
    getRowCanExpand: () => true,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableSortingRemoval: false,
    autoResetExpanded: false,
  });
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="sm" component="div" style={{ wordBreak: 'break-all' }}>
        {children}
      </Text>
    </div>
  );
}

export function LogDetail({ row }: { row: Row<LogEntry> }) {
  const l = row.original;
  return (
    <Stack gap="sm" py="xs">
      <Text size="sm" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {l.message}
      </Text>
      <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="sm">
        <Field label="Time">{formatAbsolute(l.at)}</Field>
        <Field label="Received">{formatAbsolute(l.receivedAt)}</Field>
        <Field label="Machine key">{l.keyName || '–'}</Field>
        <Field label="Entry id">
          <Group gap={4} wrap="nowrap">
            <Text span size="xs" ff="monospace">
              {l.id}
            </Text>
            <CopyIcon value={l.id} label="Copy entry id" size="xs" />
          </Group>
        </Field>
      </SimpleGrid>
      <div>
        <Text size="xs" c="dimmed" mb={4}>
          Context
        </Text>
        <JsonBlock value={l.context} label="Copy context" maxHeight={360} />
      </div>
    </Stack>
  );
}

export const LOG_CSV_COLUMNS: CsvColumn<LogEntry>[] = [
  { header: 'at', value: (l) => l.at },
  { header: 'level', value: (l) => l.level },
  { header: 'source', value: (l) => l.source },
  { header: 'message', value: (l) => l.message },
  { header: 'agentId', value: (l) => l.agentId },
  { header: 'correlationId', value: (l) => l.correlationId },
  { header: 'context', value: (l) => jsonCell(l.context) },
  { header: 'receivedAt', value: (l) => l.receivedAt },
  { header: 'keyName', value: (l) => l.keyName },
  { header: 'id', value: (l) => l.id },
];
