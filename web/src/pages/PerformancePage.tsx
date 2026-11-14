// The Performance tab: how the games we build ran, on every machine that sent data.
// Sessions compared by machine, build or GPU, then every session; a row opens its charts.

import '@mantine/charts/styles.css';

import { BarChart } from '@mantine/charts';
import {
  PERF_SAMPLE_DAYS,
  mergePerfTotals,
  perfSessionLive,
  perfStats,
  type PerfSession,
  type PerfSessionsResponse,
  type PerfStats,
} from '@agent-manager-delux/shared';
import { Alert, Anchor, Badge, Group, Paper, SegmentedControl, Select, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';
import { createColumnHelper, getCoreRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table';
import { useMemo, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { DataTable } from '../components/DataTable';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, LoadError, TableSkeleton } from '../components/States';
import { RelativeTime, UpdatedAgo } from '../components/Time';
import { api } from '../lib/api';
import {
  BOUND_SHORT,
  GROUP_BY,
  GROUP_LABEL,
  distinct,
  filterSessions,
  formatDuration,
  formatFps,
  formatMb,
  formatMs,
  formatRate,
  groupSessions,
  type GroupBy,
  type GroupRow,
} from '../lib/perf';
import { useSortParam, useUrlState } from '../lib/urlState';
import { usePolling } from '../lib/usePolling';

const WINDOWS = [
  { value: '1', label: '24 hours' },
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '365', label: '1 year' },
];

const NUMERIC = { fontVariantNumeric: 'tabular-nums' } as const;

export function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap={4} mb="sm">
        <Title order={2} size="h5">
          {title}
        </Title>
        {description && (
          <Text size="xs" c="dimmed">
            {description}
          </Text>
        )}
      </Stack>
      {children}
    </Paper>
  );
}

export function Stat({ label, value, note }: { label: string; value: string; note?: ReactNode }) {
  return (
    <Paper withBorder p="md" radius="md">
      <Text size="sm" c="dimmed">
        {label}
      </Text>
      <Text fz={30} fw={650} lh={1.25}>
        {value}
      </Text>
      <Text size="xs" c="dimmed" mih={18}>
        {note}
      </Text>
    </Paper>
  );
}

function Tiles({ sessions, stats }: { sessions: PerfSession[]; stats: PerfStats }) {
  const machines = new Set(sessions.map((s) => s.machine)).size;
  return (
    <SimpleGrid cols={{ base: 2, sm: 3, lg: 5 }} spacing="sm" mb="md">
      <Stat label="Sessions" value={String(sessions.length)} note={`on ${machines} machine${machines === 1 ? '' : 's'}`} />
      <Stat label="Time measured" value={formatDuration(stats.seconds)} />
      <Stat label="Average FPS" value={formatFps(stats.avgFps)} note={stats.frameMsAvg !== null ? `${formatMs(stats.frameMsAvg)} a frame` : undefined} />
      <Stat
        label="99th percentile frame"
        value={formatMs(stats.frameMsP99)}
        note={stats.frameMsMax !== null ? `slowest ${formatMs(stats.frameMsMax)}` : undefined}
      />
      <Stat label="Hitches a minute" value={formatRate(stats.hitchesPerMinute)} note={`${stats.hitches.toLocaleString()} in all`} />
    </SimpleGrid>
  );
}

const TOP_GROUPS = 12;

function Compare({ rows, by, onBy }: { rows: GroupRow[]; by: GroupBy; onBy: (by: GroupBy) => void }) {
  const charted = rows.filter((r) => r.stats.avgFps !== null).slice(0, TOP_GROUPS);
  const data = charted.map((r) => ({
    name: r.name,
    fps: Number((r.stats.avgFps ?? 0).toFixed(1)),
  }));
  return (
    <Section
      title={`By ${GROUP_LABEL[by].toLowerCase()}`}
      description={`Average FPS, slowest first${rows.length > charted.length ? ` (the chart shows ${charted.length} of ${rows.length})` : ''}. The table has the rest of the numbers.`}
    >
      <SegmentedControl
        aria-label="Compare by"
        size="xs"
        mb="sm"
        data={GROUP_BY.map((g) => ({ value: g, label: GROUP_LABEL[g] }))}
        value={by}
        onChange={(v) => onBy(v as GroupBy)}
      />
      {data.length > 0 && (
        <BarChart
          h={Math.max(120, data.length * 34 + 30)}
          data={data}
          dataKey="name"
          orientation="vertical"
          series={[{ name: 'fps', label: 'Average FPS', color: 'var(--am-series-1)' }]}
          valueFormatter={(v) => `${formatFps(v)} FPS`}
          gridAxis="x"
          yAxisProps={{ width: 170 }}
          maxBarWidth={24}
          strokeDasharray="0"
          tooltipAnimationDuration={120}
          barProps={{ radius: [0, 4, 4, 0] }}
        />
      )}
      <Table.ScrollContainer minWidth={760} type="native">
        <Table mt="sm" fz="sm" verticalSpacing={4} aria-label={`Performance by ${GROUP_LABEL[by].toLowerCase()}`}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{GROUP_LABEL[by]}</Table.Th>
              <Table.Th ta="right">Sessions</Table.Th>
              {by !== 'machine' && <Table.Th ta="right">Machines</Table.Th>}
              <Table.Th ta="right">Time</Table.Th>
              <Table.Th ta="right">Avg FPS</Table.Th>
              <Table.Th ta="right">p95 frame</Table.Th>
              <Table.Th ta="right">p99 frame</Table.Th>
              <Table.Th ta="right">Slowest frame</Table.Th>
              <Table.Th ta="right">Hitches/min</Table.Th>
              <Table.Th ta="right">Peak memory</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody style={NUMERIC}>
            {rows.map((r) => (
              <Table.Tr key={r.name}>
                <Table.Td>{r.name}</Table.Td>
                <Table.Td ta="right">{r.sessions}</Table.Td>
                {by !== 'machine' && <Table.Td ta="right">{r.machines}</Table.Td>}
                <Table.Td ta="right">{formatDuration(r.stats.seconds)}</Table.Td>
                <Table.Td ta="right">{formatFps(r.stats.avgFps)}</Table.Td>
                <Table.Td ta="right">{formatMs(r.stats.frameMsP95)}</Table.Td>
                <Table.Td ta="right">{formatMs(r.stats.frameMsP99)}</Table.Td>
                <Table.Td ta="right">{formatMs(r.stats.frameMsMax)}</Table.Td>
                <Table.Td ta="right">{formatRate(r.stats.hitchesPerMinute)}</Table.Td>
                <Table.Td ta="right">{formatMb(r.stats.memoryMbMax)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Section>
  );
}

interface Row extends PerfSession {
  stats: PerfStats;
  live: boolean;
}

const col = createColumnHelper<Row>();
const right = (text: string) => (
  <Text size="sm" ta="right" style={NUMERIC}>
    {text}
  </Text>
);
/** Sorts sessions that never measured a value after the ones that did. */
const orLast = (v: number | null) => v ?? Number.POSITIVE_INFINITY;

const columns = [
  col.accessor((r) => Date.parse(r.startedAt), {
    id: 'started',
    header: 'Started',
    cell: ({ row }) => (
      <Group gap={6} wrap="nowrap">
        <RelativeTime iso={row.original.startedAt} />
        {row.original.live && (
          <Badge color="teal" variant="light" radius="sm" tt="none" size="sm">
            Running
          </Badge>
        )}
      </Group>
    ),
  }),
  col.accessor('game', { header: 'Game', sortingFn: 'text' }),
  col.accessor((r) => r.build ?? '', {
    id: 'build',
    header: 'Build',
    sortingFn: 'text',
    cell: ({ getValue }) => getValue() || '–',
  }),
  col.accessor('machine', { header: 'Machine', sortingFn: 'text' }),
  col.accessor((r) => r.gpu ?? '', {
    id: 'gpu',
    header: 'GPU',
    sortingFn: 'text',
    cell: ({ getValue }) => (
      <Text size="sm" truncate="end" maw={200} title={getValue()}>
        {getValue() || '–'}
      </Text>
    ),
  }),
  col.accessor((r) => r.stats.seconds, {
    id: 'time',
    header: 'Time',
    cell: ({ getValue }) => right(formatDuration(getValue())),
  }),
  col.accessor((r) => orLast(r.stats.avgFps), {
    id: 'fps',
    header: 'Avg FPS',
    sortDescFirst: false,
    cell: ({ row }) => right(formatFps(row.original.stats.avgFps)),
  }),
  col.accessor((r) => r.stats.frameMsP95 ?? -1, {
    id: 'p95',
    header: 'p95 frame',
    cell: ({ row }) => right(formatMs(row.original.stats.frameMsP95)),
  }),
  col.accessor((r) => r.stats.frameMsP99 ?? -1, {
    id: 'p99',
    header: 'p99 frame',
    cell: ({ row }) => right(formatMs(row.original.stats.frameMsP99)),
  }),
  col.accessor((r) => r.stats.frameMsMax ?? -1, {
    id: 'max',
    header: 'Slowest',
    cell: ({ row }) => right(formatMs(row.original.stats.frameMsMax)),
  }),
  col.accessor((r) => r.stats.hitchesPerMinute ?? -1, {
    id: 'hitches',
    header: 'Hitches/min',
    cell: ({ row }) => right(formatRate(row.original.stats.hitchesPerMinute)),
  }),
  col.accessor((r) => (r.stats.bound ? BOUND_SHORT[r.stats.bound] : ''), {
    id: 'bound',
    header: 'Limited by',
    sortingFn: 'text',
    cell: ({ getValue }) => getValue() || '–',
  }),
  col.accessor((r) => r.stats.memoryMbMax ?? -1, {
    id: 'memory',
    header: 'Peak memory',
    cell: ({ row }) => right(formatMb(row.original.stats.memoryMbMax)),
  }),
];

function Sessions({ rows }: { rows: Row[] }) {
  const navigate = useNavigate();
  const [sorting, onSortingChange] = useSortParam('sort', [{ id: 'started', desc: true }]);
  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange,
    getRowId: (r) => r.id,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableSortingRemoval: false,
  });
  return (
    <Section title="Sessions" description={`One run of a game on one machine. Open one for its charts, which are kept ${PERF_SAMPLE_DAYS} days.`}>
      <DataTable
        table={table}
        label="Performance sessions"
        minWidth={1160}
        pageSize={50}
        onRowClick={(row) => navigate(`/performance/session?id=${encodeURIComponent(row.original.id)}`)}
      />
    </Section>
  );
}

function HowToSend() {
  return (
    <>
      Games send it with two calls, described in{' '}
      <Anchor href="/performance.md" target="_blank" rel="noopener" size="sm">
        performance.md
      </Anchor>
      . Make a game key for them on the Settings tab.
    </>
  );
}

export function PerformancePage() {
  const { params, update } = useUrlState();
  const days = WINDOWS.some((w) => w.value === params.get('days')) ? Number(params.get('days')) : 30;
  const by = (GROUP_BY as readonly string[]).includes(params.get('by') ?? '') ? (params.get('by') as GroupBy) : 'machine';
  const game = params.get('game');
  const machine = params.get('machine');
  const build = params.get('build');

  const { data, error, updatedAt, refresh } = usePolling<PerfSessionsResponse>(`perf:${days}`, (signal) => api.perfSessions(days, signal), {
    intervalMs: 30_000,
  });

  const view = useMemo(() => {
    if (!data) return null;
    const nowMs = Date.parse(data.now);
    const sessions = filterSessions(data.sessions, { game, machine, build });
    const rows: Row[] = sessions.map((s) => ({
      ...s,
      stats: perfStats(s.totals),
      live: perfSessionLive(s, nowMs),
    }));
    // Each filter lists what the other two leave, so a choice never leads to nothing.
    return {
      rows,
      groups: groupSessions(sessions, by),
      total: sessions.length ? perfStats(mergePerfTotals(sessions.map((s) => s.totals))) : null,
      games: distinct(filterSessions(data.sessions, { game: null, machine, build }), 'game'),
      machines: distinct(filterSessions(data.sessions, { game, machine: null, build }), 'machine'),
      builds: distinct(filterSessions(data.sessions, { game, machine, build: null }), 'build'),
    };
  }, [data, game, machine, build, by]);

  const filter = (label: string, key: 'game' | 'machine' | 'build', options: string[], value: string | null) => (
    <Select
      aria-label={label}
      placeholder={`All ${label.toLowerCase()}s`}
      data={value && !options.includes(value) ? [value, ...options] : options}
      value={value}
      onChange={(v) => update({ [key]: v })}
      clearable
      searchable
      w={170}
    />
  );

  return (
    <>
      <PageHeader title="Performance">
        <UpdatedAgo updatedAt={updatedAt} error={error} />
        {filter('Game', 'game', view?.games ?? [], game)}
        {filter('Machine', 'machine', view?.machines ?? [], machine)}
        {filter('Build', 'build', view?.builds ?? [], build)}
        <SegmentedControl aria-label="Time window" data={WINDOWS} value={String(days)} onChange={(value) => update({ days: value === '30' ? null : value })} />
      </PageHeader>
      {!data || !view ? (
        error ? (
          <LoadError message={error.message} onRetry={refresh} />
        ) : (
          <TableSkeleton rows={8} />
        )
      ) : data.sessions.length === 0 ? (
        <EmptyState title="No performance data yet">
          Nothing arrived in the last {days === 1 ? '24 hours' : `${days} days`}. <HowToSend />
        </EmptyState>
      ) : view.rows.length === 0 || !view.total ? (
        <EmptyState title="No sessions match these filters">Clear a filter above to see more.</EmptyState>
      ) : (
        <Stack gap="md">
          {data.truncated && (
            <Alert variant="light" color="blue" icon={<IconInfoCircle size={18} />}>
              There are more sessions in this window than fit on one page: these are the latest {data.sessions.length.toLocaleString()}. Pick a shorter window
              to see all of it.
            </Alert>
          )}
          <div>
            <Tiles sessions={view.rows} stats={view.total} />
            <Compare rows={view.groups} by={by} onBy={(v) => update({ by: v === 'machine' ? null : v })} />
          </div>
          <Sessions rows={view.rows} />
        </Stack>
      )}
    </>
  );
}
