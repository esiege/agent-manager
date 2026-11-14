// One performance session: what it ran on, its numbers, and how they moved over the run.

import '@mantine/charts/styles.css';

import { LineChart, type LineChartSeries } from '@mantine/charts';
import { LIMITS, PERF_SAMPLE_DAYS, perfSessionLive, perfStats, type PerfSessionDetailResponse } from '@agent-manager-deluxe/shared';
import { Alert, Anchor, Badge, Group, SimpleGrid, Stack, Table, Text } from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { JsonBlock } from '../components/JsonBlock';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, LoadError, TableSkeleton } from '../components/States';
import { RelativeTime, UpdatedAgo } from '../components/Time';
import { api } from '../lib/api';
import {
  BOUND_LABEL,
  byScene,
  chartPoints,
  formatClock,
  formatDuration,
  formatFps,
  formatMb,
  formatMs,
  formatRate,
  hardwareLine,
  metricNames,
  type ChartPoint,
} from '../lib/perf';
import { formatAbsolute } from '../lib/time';
import { usePolling } from '../lib/usePolling';
import { Section, Stat } from './PerformancePage';

const NUMERIC = { fontVariantNumeric: 'tabular-nums' } as const;
const FIRST = 'var(--am-series-1)';
const SECOND = 'var(--am-series-2)';
const THIRD = 'var(--am-series-3)';

/** One measure over the run. Each chart has its own scale: FPS, milliseconds and megabytes don't share an axis. */
function Trend({
  title,
  description,
  points,
  series,
  format,
}: {
  title: string;
  description?: string;
  points: ChartPoint[];
  series: LineChartSeries[];
  format: (v: number) => string;
}) {
  const present = series.filter((s) => points.some((p) => p[s.name] !== undefined));
  if (present.length === 0) return null;
  return (
    <Section title={title} description={description}>
      <LineChart
        h={220}
        data={points}
        dataKey="time"
        series={present}
        curveType="linear"
        withDots={false}
        strokeWidth={2}
        connectNulls={false}
        withLegend={present.length > 1}
        legendProps={{ verticalAlign: 'top', height: 32 }}
        valueFormatter={format}
        gridAxis="x"
        strokeDasharray="0"
        tooltipAnimationDuration={120}
        xAxisProps={{ minTickGap: 48 }}
        yAxisProps={{ width: 64, domain: [0, 'auto'] }}
      />
    </Section>
  );
}

const plain = (v: number) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : String(Math.round(v * 100) / 100));

export function PerfSessionPage() {
  const [params] = useSearchParams();
  const id = params.get('id') ?? '';
  const { data, error, updatedAt, refresh } = usePolling<PerfSessionDetailResponse>(`perf-session:${id}`, (signal) => api.perfSession(id, signal), {
    intervalMs: 15_000,
    quietStatuses: [400, 404],
  });
  const charts = useMemo(
    () =>
      data
        ? {
            points: chartPoints(data.samples),
            scenes: byScene(data.samples),
            metrics: metricNames(data.samples),
          }
        : null,
    [data],
  );

  if (!data || !charts) {
    return (
      <>
        <PageHeader title="Performance session" />
        {error ? <LoadError message={error.message} onRetry={error.status === 404 ? undefined : refresh} /> : <TableSkeleton rows={8} />}
      </>
    );
  }

  const { session, samples } = data;
  const stats = perfStats(session.totals);
  const live = perfSessionLive(session, Date.parse(data.now));
  const hardware = hardwareLine(session);
  const { points, scenes, metrics } = charts;
  // Where the average frame's time went: "the GPU (21.0 ms of the average frame; game thread 9.0 ms, render thread 10.0 ms)".
  const threads = [
    { name: 'cpu', label: 'CPU', ms: stats.cpuMs },
    { name: 'game', label: 'game thread', ms: stats.gameMs },
    { name: 'render', label: 'render thread', ms: stats.renderMs },
    { name: 'gpu', label: 'GPU', ms: stats.gpuMs },
  ].filter((p) => p.ms !== null);
  const boundMs = threads.find((p) => p.name === stats.bound)?.ms;
  const others = threads.filter((p) => p.name !== stats.bound).map((p) => `${p.label} ${formatMs(p.ms)}`);
  const hitches = session.worstHitches ?? [];
  // A thread-split engine's lines replace the single CPU line, so each color means one thing.
  const split = stats.gameMs !== null || stats.renderMs !== null;

  return (
    <>
      <PageHeader title={`${session.game}${session.build ? ` ${session.build}` : ''} on ${session.machine}`}>
        <UpdatedAgo updatedAt={updatedAt} error={error} />
        <Anchor component={Link} to="/performance" size="sm">
          All sessions
        </Anchor>
      </PageHeader>

      <Group gap="xs" mb="md" wrap="wrap">
        {live ? (
          <Badge color="teal" variant="light" radius="sm" tt="none">
            Running
          </Badge>
        ) : (
          <Badge color="gray" variant="light" radius="sm" tt="none">
            {session.endedAt ? 'Ended' : 'Stopped sending'}
          </Badge>
        )}
        <Text size="sm" c="dimmed">
          Started {formatAbsolute(session.startedAt)} · last heard from <RelativeTime iso={session.lastSeen} c="dimmed" /> · key {session.keyName}
        </Text>
        {hardware && (
          <Text size="sm" w="100%">
            {hardware}
          </Text>
        )}
        {(stats.bound || session.loadSeconds != null) && (
          <Text size="sm" w="100%">
            {stats.bound && (
              <>
                Limited by <b>{BOUND_LABEL[stats.bound]}</b>: {formatMs(boundMs)} of the average frame ({others.join(', ')}).
              </>
            )}
            {session.loadSeconds != null && ` Took ${formatDuration(session.loadSeconds)} to load.`}
          </Text>
        )}
      </Group>

      <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }} spacing="sm" mb="md">
        <Stat label="Average FPS" value={formatFps(stats.avgFps)} note={stats.frameMsAvg !== null ? `${formatMs(stats.frameMsAvg)} a frame` : undefined} />
        <Stat label="95th percentile frame" value={formatMs(stats.frameMsP95)} />
        <Stat label="99th percentile frame" value={formatMs(stats.frameMsP99)} />
        <Stat label="Slowest frame" value={formatMs(stats.frameMsMax)} />
        <Stat label="Hitches a minute" value={formatRate(stats.hitchesPerMinute)} note={`${stats.hitches.toLocaleString()} in all`} />
        <Stat
          label="Peak memory"
          value={formatMb(stats.memoryMbMax)}
          note={stats.vramMbMax !== null ? `${formatMb(stats.vramMbMax)} video memory` : undefined}
        />
      </SimpleGrid>

      {stats.samples === 0 ? (
        <EmptyState title="No samples yet">The session has started but hasn&apos;t sent any measurements.</EmptyState>
      ) : samples.length === 0 ? (
        <Alert variant="light" color="blue" icon={<IconInfoCircle size={18} />}>
          The charts for this session are gone: samples are kept {PERF_SAMPLE_DAYS} days. The numbers above, from {formatDuration(stats.seconds)} of
          measurements, stay.
        </Alert>
      ) : (
        <Stack gap="md">
          {data.truncated && (
            <Alert variant="light" color="blue" icon={<IconInfoCircle size={18} />}>
              This session has more samples than one page holds: the charts show the latest {samples.length.toLocaleString()}. The numbers above cover all of
              it.
            </Alert>
          )}
          <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
            <Trend
              title="Frames per second"
              description="Higher is better. The bottom axis is time into the session."
              points={points}
              series={[{ name: 'fps', label: 'FPS', color: FIRST }]}
              format={(v) => `${formatFps(v)} FPS`}
            />
            <Trend
              title="Frame time"
              description="Lower is better. The 99th percentile is where stutter shows before the average moves."
              points={points}
              series={[
                { name: 'frameMsP50', label: 'Median', color: FIRST },
                { name: 'frameMsP99', label: '99th percentile', color: SECOND },
              ]}
              format={formatMs}
            />
            <Trend
              title={split ? 'Game thread, render thread and GPU time' : 'CPU and GPU time'}
              description="Average per frame. The largest one is what holds the frame rate back."
              points={points}
              series={[
                ...(split ? [] : [{ name: 'cpuMs', label: 'CPU', color: FIRST }]),
                { name: 'gameMs', label: 'Game thread', color: FIRST },
                { name: 'renderMs', label: 'Render thread', color: THIRD },
                { name: 'gpuMs', label: 'GPU', color: SECOND },
              ]}
              format={formatMs}
            />
            <Trend
              title="Memory"
              description="A line that only climbs is a leak."
              points={points}
              series={[
                { name: 'memoryMb', label: 'Memory', color: FIRST },
                { name: 'vramMb', label: 'Video memory', color: SECOND },
              ]}
              format={formatMb}
            />
            <Trend title="Ping" points={points} series={[{ name: 'pingMs', label: 'Ping', color: FIRST }]} format={formatMs} />
            <Trend title="Draw calls" points={points} series={[{ name: 'drawCalls', label: 'Draw calls', color: FIRST }]} format={plain} />
            {metrics.map((name) => (
              <Trend
                key={name}
                title={name}
                description="A custom metric the game sends."
                points={points}
                series={[{ name: `m:${name}`, label: name, color: FIRST }]}
                format={plain}
              />
            ))}
          </SimpleGrid>

          {(scenes.length > 1 || scenes[0]?.scene !== '(no scene)') && (
            <Section title="Scenes" description="How each level, scene or menu ran, slowest first.">
              <Table.ScrollContainer minWidth={640} type="native">
                <Table fz="sm" verticalSpacing={4} aria-label="Performance by scene">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Scene</Table.Th>
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
                    {scenes.map((r) => (
                      <Table.Tr key={r.scene}>
                        <Table.Td>{r.scene}</Table.Td>
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
          )}
        </Stack>
      )}

      {hitches.length > 0 && (
        <Stack mt="md">
          <Section
            title="Worst hitches"
            description={`The slowest single frames the game reported, worst first${hitches.length >= LIMITS.perfHitchesKept ? ` (the worst ${LIMITS.perfHitchesKept})` : ''}. The thread with the most time in the frame is the one to look at.`}
          >
            <Table.ScrollContainer minWidth={560} type="native">
              <Table fz="sm" verticalSpacing={4} aria-label="Worst hitches">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>At</Table.Th>
                    <Table.Th>Scene</Table.Th>
                    <Table.Th ta="right">Frame</Table.Th>
                    <Table.Th ta="right">Game thread</Table.Th>
                    <Table.Th ta="right">Render thread</Table.Th>
                    <Table.Th ta="right">GPU</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody style={NUMERIC}>
                  {hitches.map((h) => (
                    <Table.Tr key={h.t}>
                      <Table.Td>{formatClock(h.t)}</Table.Td>
                      <Table.Td>{h.scene ?? '–'}</Table.Td>
                      <Table.Td ta="right">{formatMs(h.frameMs)}</Table.Td>
                      <Table.Td ta="right">{formatMs(h.gameMs)}</Table.Td>
                      <Table.Td ta="right">{formatMs(h.renderMs)}</Table.Td>
                      <Table.Td ta="right">{formatMs(h.gpuMs)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Section>
        </Stack>
      )}

      {Object.keys(session.details).length > 0 && (
        <Stack mt="md">
          <Section title="Details" description="Everything else the game sent about this run.">
            <JsonBlock value={session.details} />
          </Section>
        </Stack>
      )}
    </>
  );
}
