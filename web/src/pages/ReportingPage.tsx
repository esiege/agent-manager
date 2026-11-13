// The Reporting tab: where the agents' time and tokens go, split into technical and
// non-technical work, by kind of work, project, day, model and story.

import '@mantine/charts/styles.css';

import { BarChart, DonutChart } from '@mantine/charts';
import {
  WORK_GROUP_LABEL,
  WORK_TYPE_INFO,
  type ReportingResponse,
  type WorkGroup,
  type WorkType,
} from '@agent-manager/shared';
import {
  Alert,
  Anchor,
  Badge,
  Group,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';
import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, LoadError, TableSkeleton } from '../components/States';
import { UpdatedAgo } from '../components/Time';
import { api } from '../lib/api';
import { buildReport, formatCost, formatCount, formatHours, type GroupHours, type Report, type TypeRow } from '../lib/reporting';
import { useUrlState } from '../lib/urlState';
import { usePolling } from '../lib/usePolling';

const WINDOWS = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '1 year' },
];

/** Colors by the job they do: the group a kind of work belongs to (styles.css, light and dark). */
const GROUP_COLOR: Record<WorkGroup, string> = {
  technical: 'var(--am-series-technical)',
  'non-technical': 'var(--am-series-nontechnical)',
  other: 'var(--am-series-other)',
};
const GROUPS: WorkGroup[] = ['technical', 'non-technical', 'other'];
const GROUP_SERIES = GROUPS.map((g) => ({ name: g, label: WORK_GROUP_LABEL[g], color: GROUP_COLOR[g] }));

/** Shared look: thin bars, a 2px surface gap between stacked segments, solid hairline grid. */
const BAR_LOOK = {
  maxBarWidth: 24,
  strokeDasharray: '0',
  tooltipAnimationDuration: 120,
  barProps: { stroke: 'var(--mantine-color-body)', strokeWidth: 1 },
} as const;

/** Only the groups that have any hours, so the legend lists what's on the chart. */
function seriesWith(totals: GroupHours) {
  return GROUP_SERIES.filter((s) => totals[s.name as WorkGroup] > 0);
}

function shortDay(iso: string, bucket: Report['bucket']): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const text = new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return bucket === 'week' ? `Wk of ${text}` : text;
}

function Section({ title, description, className, children }: { title: string; description?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <Paper withBorder p="md" radius="md" className={className}>
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

function Stat({ label, value, note }: { label: string; value: string; note?: ReactNode }) {
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

function GroupDot({ group }: { group: WorkGroup }) {
  return <span aria-hidden style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: GROUP_COLOR[group], flexShrink: 0 }} />;
}

function TypeLabel({ type, guessed }: { type: WorkType; guessed?: boolean }) {
  const info = WORK_TYPE_INFO[type];
  return (
    <Group gap={6} wrap="nowrap">
      <GroupDot group={info.group} />
      <Text size="sm" span>
        {info.label}
      </Text>
      {guessed && (
        <Tooltip label="Nothing said what kind of work this was, so it's sorted by the kind of agent">
          <Badge size="xs" variant="light" color="gray">
            guessed
          </Badge>
        </Tooltip>
      )}
    </Group>
  );
}

function Tiles({ report }: { report: Report }) {
  const t = report.totals;
  const tech = report.byGroup.technical;
  const nonTech = report.byGroup['non-technical'];
  const finishRate = t.ended ? Math.round((t.finished / t.ended) * 100) : null;
  return (
    <SimpleGrid cols={{ base: 2, sm: 3, lg: 5 }} spacing="sm" mb="md">
      <Stat
        label="Agent time"
        value={formatHours(t.hours)}
        note={t.hours ? `${Math.round((tech / t.hours) * 100)}% technical, ${Math.round((nonTech / t.hours) * 100)}% non-technical` : undefined}
      />
      <Stat label="Requests" value={formatCount(t.requests)} note={finishRate !== null ? `${finishRate}% finished` : undefined} />
      <Stat label="Finished work" value={formatCount(t.results)} note="reports of finished work" />
      <Stat label="Tokens" value={formatCount(t.tokens)} note={t.tokens ? 'incl. cache reads and writes' : 'none counted yet'} />
      <Stat
        label="API cost"
        value={formatCost(t.cost)}
        note={
          <Tooltip label="What these tokens would cost at Anthropic's API list prices. On a Claude subscription they aren't billed per token." multiline maw={300}>
            <span style={{ textDecoration: 'underline dotted', cursor: 'help' }}>at API list prices</span>
          </Tooltip>
        }
      />
    </SimpleGrid>
  );
}

function TimeByType({ report }: { report: Report }) {
  const rows = report.byType.filter((r) => r.hours > 0);
  const data = rows.map((r) => ({ label: r.label, technical: 0, 'non-technical': 0, other: 0, [r.group]: Number(r.hours.toFixed(2)) }));
  const donut = GROUPS.filter((g) => report.byGroup[g] > 0).map((g) => ({
    name: WORK_GROUP_LABEL[g],
    value: Number(report.byGroup[g].toFixed(2)),
    color: GROUP_COLOR[g],
  }));
  return (
    <SimpleGrid cols={{ base: 1, md: 3 }} spacing="md" mb="md">
      <Section title="Technical or not" description="Hours of requests, by the kind of work they were.">
        <Stack align="center" gap="xs">
          <DonutChart
            data={donut}
            size={180}
            thickness={26}
            paddingAngle={2}
            strokeWidth={0}
            chartLabel={formatHours(report.totals.hours)}
            valueFormatter={formatHours}
            tooltipDataSource="segment"
            tooltipAnimationDuration={120}
          />
          <Stack gap={4} w="100%">
            {GROUPS.filter((g) => report.byGroup[g] > 0).map((g) => (
              <Group key={g} justify="space-between" wrap="nowrap">
                <Group gap={6} wrap="nowrap">
                  <GroupDot group={g} />
                  <Text size="sm">{WORK_GROUP_LABEL[g]}</Text>
                </Group>
                <Text size="sm" c="dimmed" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatHours(report.byGroup[g])} · {Math.round((report.byGroup[g] / report.totals.hours) * 100)}%
                </Text>
              </Group>
            ))}
          </Stack>
        </Stack>
      </Section>
      <Section
        title="Hours by kind of work"
        className="am-span-2"
        description={
          <>
            Agents say what they're doing with <code>agentctl story --type</code>; the rest is sorted by the words of their story and prompt.
          </>
        }
      >
        <BarChart
          h={Math.max(160, data.length * 34 + 40)}
          data={data}
          dataKey="label"
          type="stacked"
          orientation="vertical"
          series={seriesWith(report.byGroup)}
          withLegend
          legendProps={{ verticalAlign: 'top', height: 32 }}
          valueFormatter={formatHours}
          gridAxis="x"
          yAxisProps={{ width: 160 }}
          {...BAR_LOOK}
        />
      </Section>
    </SimpleGrid>
  );
}

function TimeOverTime({ report }: { report: Report }) {
  const data = report.byDay.map((d) => ({
    day: shortDay(d.day, report.bucket),
    technical: Number(d.technical.toFixed(2)),
    'non-technical': Number(d['non-technical'].toFixed(2)),
    other: Number(d.other.toFixed(2)),
    cost: Number(d.cost.toFixed(2)),
  }));
  return (
    <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md" mb="md">
      <Section title={`Hours per ${report.bucket}`} description="When the requests started.">
        <BarChart
          h={240}
          data={data}
          dataKey="day"
          type="stacked"
          series={seriesWith(report.byGroup)}
          withLegend
          legendProps={{ verticalAlign: 'top', height: 32 }}
          valueFormatter={formatHours}
          gridAxis="y"
          {...BAR_LOOK}
        />
      </Section>
      <Section title={`API cost per ${report.bucket}`} description="Tokens at API list prices, when they were reported.">
        {report.noUsage ? (
          <NoUsageYet />
        ) : (
          <BarChart
            h={240}
            data={data}
            dataKey="day"
            series={[{ name: 'cost', label: 'API cost', color: 'var(--am-series-technical)' }]}
            valueFormatter={formatCost}
            gridAxis="y"
            {...BAR_LOOK}
            barProps={{ radius: [4, 4, 0, 0] }}
          />
        )}
      </Section>
    </SimpleGrid>
  );
}

const TOP_PROJECTS = 10;

function Projects({ report }: { report: Report }) {
  const rows = report.byProject.slice(0, TOP_PROJECTS);
  const data = rows.map((p) => ({
    project: p.project,
    technical: Number(p.technical.toFixed(2)),
    'non-technical': Number(p['non-technical'].toFixed(2)),
    other: Number(p.other.toFixed(2)),
  }));
  const more = report.byProject.length - rows.length;
  return (
    <Section title="Projects" description={`Hours per project${more > 0 ? `, top ${TOP_PROJECTS} of ${report.byProject.length}` : ''}.`}>
      <BarChart
        h={Math.max(140, data.length * 34 + 40)}
        data={data}
        dataKey="project"
        type="stacked"
        orientation="vertical"
        series={seriesWith(report.byGroup)}
        withLegend
        legendProps={{ verticalAlign: 'top', height: 32 }}
        valueFormatter={formatHours}
        gridAxis="x"
        yAxisProps={{ width: 150 }}
        {...BAR_LOOK}
      />
      <Table mt="sm" fz="sm" verticalSpacing={4} aria-label="Hours and cost per project">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Project</Table.Th>
            <Table.Th ta="right">Hours</Table.Th>
            <Table.Th ta="right">API cost</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody style={{ fontVariantNumeric: 'tabular-nums' }}>
          {report.byProject.map((p) => (
            <Table.Tr key={p.project}>
              <Table.Td>{p.project}</Table.Td>
              <Table.Td ta="right">{formatHours(p.hours)}</Table.Td>
              <Table.Td ta="right">{report.noUsage ? '–' : formatCost(p.cost)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Section>
  );
}

function Models({ report }: { report: Report }) {
  if (report.noUsage) {
    return (
      <Section title="Models" description="Tokens and cost per model.">
        <NoUsageYet />
      </Section>
    );
  }
  const data = report.byModel.map((m) => ({ model: m.model, cost: Number((m.cost ?? 0).toFixed(2)) }));
  return (
    <Section title="Models" description="API cost per model, with all its tokens.">
      <BarChart
        h={Math.max(120, data.length * 34 + 30)}
        data={data}
        dataKey="model"
        orientation="vertical"
        series={[{ name: 'cost', label: 'API cost', color: 'var(--am-series-technical)' }]}
        valueFormatter={formatCost}
        gridAxis="x"
        yAxisProps={{ width: 150 }}
        {...BAR_LOOK}
        barProps={{ radius: [0, 4, 4, 0] }}
      />
      <Table mt="sm" fz="sm" verticalSpacing={4} aria-label="Tokens and cost per model">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Model</Table.Th>
            <Table.Th ta="right">Tokens</Table.Th>
            <Table.Th ta="right">API cost</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody style={{ fontVariantNumeric: 'tabular-nums' }}>
          {report.byModel.map((m) => (
            <Table.Tr key={m.model}>
              <Table.Td>{m.model}</Table.Td>
              <Table.Td ta="right">{formatCount(m.tokens)}</Table.Td>
              <Table.Td ta="right">{m.cost === null ? 'no price known' : formatCost(m.cost)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Section>
  );
}

function Breakdown({ report }: { report: Report }) {
  const total = report.totals.hours;
  const rows: TypeRow[] = report.byType;
  return (
    <Section title="Breakdown by kind of work" description="Everything above, as a table.">
      <Table.ScrollContainer minWidth={720} type="native">
        <Table fz="sm" verticalSpacing={6} highlightOnHover aria-label="Breakdown by kind of work">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Kind of work</Table.Th>
              <Table.Th>Group</Table.Th>
              <Table.Th ta="right">Hours</Table.Th>
              <Table.Th ta="right">Share</Table.Th>
              <Table.Th ta="right">Requests</Table.Th>
              <Table.Th ta="right">Finished</Table.Th>
              <Table.Th ta="right">Finished work</Table.Th>
              <Table.Th ta="right">Tokens</Table.Th>
              <Table.Th ta="right">API cost</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody style={{ fontVariantNumeric: 'tabular-nums' }}>
            {rows.map((r) => (
              <Table.Tr key={r.type}>
                <Table.Td>
                  <TypeLabel type={r.type} />
                </Table.Td>
                <Table.Td c="dimmed">{WORK_GROUP_LABEL[r.group]}</Table.Td>
                <Table.Td ta="right">{formatHours(r.hours)}</Table.Td>
                <Table.Td ta="right">{total ? `${Math.round((r.hours / total) * 100)}%` : '–'}</Table.Td>
                <Table.Td ta="right">{r.requests}</Table.Td>
                <Table.Td ta="right">{r.ended ? `${Math.round((r.finished / r.ended) * 100)}%` : '–'}</Table.Td>
                <Table.Td ta="right">{r.results}</Table.Td>
                <Table.Td ta="right">{r.tokens ? formatCount(r.tokens) : '–'}</Table.Td>
                <Table.Td ta="right">{r.tokens ? formatCost(r.cost) : '–'}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Section>
  );
}

const TOP_STORIES = 20;

function Stories({ report }: { report: Report }) {
  const rows = report.stories.slice(0, TOP_STORIES);
  return (
    <Section title="Stories" description={`Where the most time went${report.stories.length > TOP_STORIES ? `: top ${TOP_STORIES} of ${report.stories.length}` : ''}.`}>
      <Table.ScrollContainer minWidth={720} type="native">
        <Table fz="sm" verticalSpacing={6} highlightOnHover aria-label="Stories by time spent">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Story</Table.Th>
              <Table.Th>Project</Table.Th>
              <Table.Th>Kind of work</Table.Th>
              <Table.Th ta="right">Hours</Table.Th>
              <Table.Th ta="right">Requests</Table.Th>
              <Table.Th ta="right">API cost</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody style={{ fontVariantNumeric: 'tabular-nums' }}>
            {rows.map((s) => (
              <Table.Tr key={`${s.project}/${s.story}`}>
                <Table.Td maw={420}>
                  <Text size="sm" truncate="end" title={s.story}>
                    {s.story}
                  </Text>
                </Table.Td>
                <Table.Td style={{ whiteSpace: 'nowrap' }}>{s.project}</Table.Td>
                <Table.Td>
                  <TypeLabel type={s.type} guessed={s.source === 'kind'} />
                </Table.Td>
                <Table.Td ta="right">{formatHours(s.hours)}</Table.Td>
                <Table.Td ta="right">{s.requests}</Table.Td>
                <Table.Td ta="right">{s.cost ? formatCost(s.cost) : '–'}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Section>
  );
}

function NoUsageYet() {
  return (
    <Text size="sm" c="dimmed" py="lg" ta="center">
      No token counts yet. They arrive once a PC runs agentctl version 3 (see the{' '}
      <Anchor component={Link} to="/instructions" size="sm">
        Instructions
      </Anchor>{' '}
      tab).
    </Text>
  );
}

function Notes({ report }: { report: Report }) {
  const guessed = report.totals.hours ? report.totals.guessedHours / report.totals.hours : 0;
  const notes: ReactNode[] = [];
  if (report.noUsage) {
    notes.push(
      <>
        <b>No token counts yet.</b> Each PC starts sending them once it's on agentctl version 3: ask an agent on each PC to follow{' '}
        <code>update.md</code> (the Instructions tab has the link). Costs then fill in from that point on.
      </>,
    );
  }
  if (guessed > 0.25) {
    notes.push(
      <>
        <b>{Math.round(guessed * 100)}% of the hours were sorted by guesswork:</b> nothing said what kind of work they were, so Claude Code
        sessions count as feature development. Agents on version 3 name it with <code>agentctl story --type</code>.
      </>,
    );
  }
  if (report.totals.unpricedTokens > 0) {
    notes.push(<>{formatCount(report.totals.unpricedTokens)} tokens are from models with no known price and are left out of the cost.</>);
  }
  if (notes.length === 0) return null;
  return (
    <Alert variant="light" color="blue" icon={<IconInfoCircle size={18} />} mb="md">
      <Stack gap={6}>
        {notes.map((n, i) => (
          <Text key={i} size="sm">
            {n}
          </Text>
        ))}
      </Stack>
    </Alert>
  );
}

export function ReportingPage() {
  const { params, update } = useUrlState();
  const days = WINDOWS.some((w) => w.value === params.get('days')) ? Number(params.get('days')) : 30;
  const project = params.get('project');

  const { data, error, updatedAt, refresh } = usePolling<ReportingResponse>(`reporting:${days}`, (signal) => api.reporting(days, signal), {
    intervalMs: 5 * 60_000,
  });
  const report = useMemo(() => (data ? buildReport(data, { project }) : null), [data, project]);
  const allProjects = useMemo(() => (data ? buildReport(data, { project: null }).projects : []), [data]);

  return (
    <>
      <PageHeader title="Reporting">
        <UpdatedAgo updatedAt={updatedAt} error={error} />
        <Select
          aria-label="Project"
          placeholder="All projects"
          data={allProjects}
          value={project}
          onChange={(value) => update({ project: value })}
          clearable
          searchable
          w={200}
        />
        <SegmentedControl
          aria-label="Time window"
          data={WINDOWS}
          value={String(days)}
          onChange={(value) => update({ days: value === '30' ? null : value })}
        />
      </PageHeader>
      {!report ? (
        error ? (
          <LoadError message={error.message} onRetry={refresh} />
        ) : (
          <TableSkeleton rows={8} />
        )
      ) : report.totals.requests === 0 && report.totals.tokens === 0 ? (
        <EmptyState title="Nothing to report yet">
          No requests in the last {days} days{project ? ` on ${project}` : ''}. Requests are counted from when they start until they finish.
        </EmptyState>
      ) : (
        <>
          <Notes report={report} />
          <Tiles report={report} />
          <TimeByType report={report} />
          <TimeOverTime report={report} />
          <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md" mb="md">
            <Projects report={report} />
            <Models report={report} />
          </SimpleGrid>
          <Stack gap="md">
            <Breakdown report={report} />
            <Stories report={report} />
          </Stack>
        </>
      )}
    </>
  );
}
