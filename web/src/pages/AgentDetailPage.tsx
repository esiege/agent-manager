// U-03: one agent: header, resume commands (C-07), sub-agents, timeline, details and logs.

import { isRunning, type AgentDetailResponse, type AgentEvent, type AgentView, type LogEntry } from '@agent-manager/shared';
import { Anchor, Box, Button, Group, Paper, SimpleGrid, Stack, Text, Title, Tooltip } from '@mantine/core';
import { IconArrowLeft, IconExternalLink } from '@tabler/icons-react';
import {
  createColumnHelper,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { useCallback, useMemo, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useAgentsTable } from '../components/AgentsTable';
import { OldSetupBadge, StateBadge } from '../components/Badges';
import { CopyField, CopyIcon } from '../components/Copy';
import { DataTable, sortedRows } from '../components/DataTable';
import { ExportMenu } from '../components/ExportMenu';
import { JsonBlock } from '../components/JsonBlock';
import { useLogsTable, LogDetail, LOG_CSV_COLUMNS, type LogFilterField } from '../components/LogsTable';
import { EmptyState, LoadError, TableSkeleton } from '../components/States';
import { RelativeTime, UpdatedAgo } from '../components/Time';
import { AGENTS_POLL_MS } from '../hooks/useAgentsFeed';
import { useStateFlash } from '../hooks/useStateFlash';
import { api } from '../lib/api';
import { AGENT_CSV_COLUMNS } from '../lib/agents';
import { jsonCell, type CsvColumn } from '../lib/csv';
import { agentPath, isOldSetup, kindLabel, plural, safeHref, stateRank } from '../lib/labels';
import { formatAbsolute, formatPrecise, syncServerClock } from '../lib/time';
import { usePolling } from '../lib/usePolling';
import { useSortParam } from '../lib/urlState';

const AGENT_LOGS_LIMIT = 200;
const AGENT_LOGS_POLL_MS = 10_000;

// ---- Header ----

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="sm" component="div" style={{ overflowWrap: 'anywhere' }}>
        {children}
      </Text>
    </div>
  );
}

function ResumeCommands({ agent }: { agent: AgentView }) {
  const sessionId = agent.details.sessionId;
  if (agent.kind !== 'claude-code' || typeof sessionId !== 'string' || !sessionId) return null;
  const resume = `claude --resume ${sessionId}`;
  const vscode = `vscode://anthropic.claude-code/open?session=${encodeURIComponent(sessionId)}`;
  return (
    <Stack gap={6}>
      <Text size="sm" fw={600}>
        Open this session
      </Text>
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
        <div>
          <Text size="xs" c="dimmed" mb={2}>
            In a terminal, in the project&apos;s folder
          </Text>
          <CopyField value={resume} label="Copy resume command" />
        </div>
        <div>
          <Group gap={6} mb={2}>
            <Text size="xs" c="dimmed">
              VS Code link
            </Text>
            <Anchor href={vscode} size="xs">
              Open
            </Anchor>
          </Group>
          <CopyField value={vscode} label="Copy VS Code link" />
        </div>
      </SimpleGrid>
      <Text size="xs" c="dimmed">
        These only work on {agent.machine}, where the session runs.
      </Text>
    </Stack>
  );
}

function AgentHeader({ agent, flash }: { agent: AgentView; flash: boolean }) {
  const link = safeHref(agent.link);
  return (
    <Paper withBorder p="md" radius="md" mb="lg" className={flash ? 'am-flash' : undefined}>
      <Stack gap="md">
        <Group gap="sm" wrap="wrap">
          <Title order={1} size="h2" style={{ overflowWrap: 'anywhere' }}>
            {agent.name || agent.id}
          </Title>
          <StateBadge state={agent.effectiveState} />
          {isOldSetup(agent) && <OldSetupBadge version={agent.instructionsVersion} />}
        </Group>

        <Group gap={4} wrap="nowrap" miw={0}>
          <Text size="sm" ff="monospace" c="dimmed" style={{ overflowWrap: 'anywhere' }}>
            {agent.id}
          </Text>
          <CopyIcon value={agent.id} label="Copy agent id" />
        </Group>

        <div>
          <Text size="xs" c="dimmed">
            Activity
          </Text>
          <Text style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }} c={agent.activity ? undefined : 'dimmed'}>
            {agent.activity || 'No activity reported'}
          </Text>
          {agent.link && (
            <Group gap={4} mt={4} wrap="nowrap" miw={0}>
              {link ? (
                <Anchor href={link} target="_blank" rel="noopener noreferrer" size="sm" style={{ overflowWrap: 'anywhere' }}>
                  {agent.link} <IconExternalLink size={12} style={{ verticalAlign: 'middle' }} />
                </Anchor>
              ) : (
                <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
                  {agent.link}
                </Text>
              )}
              <CopyIcon value={agent.link} label="Copy link" />
            </Group>
          )}
        </div>

        <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }} spacing="sm">
          <Meta label="Kind">{kindLabel(agent.kind)}</Meta>
          <Meta label="Machine">{agent.machine}</Meta>
          <Meta label="Project">{agent.project || '–'}</Meta>
          <Meta label="First seen">
            <RelativeTime iso={agent.firstSeen} /> <Text span size="xs" c="dimmed">({formatAbsolute(agent.firstSeen)})</Text>
          </Meta>
          <Meta label="Last seen">
            <RelativeTime iso={agent.lastSeen} /> <Text span size="xs" c="dimmed">({formatAbsolute(agent.lastSeen)})</Text>
          </Meta>
          <Meta label="Machine key">{agent.keyName || '–'}</Meta>
          {agent.parentId && (
            <Meta label="Parent">
              <Anchor component={Link} to={agentPath(agent.parentId)} size="sm" ff="monospace">
                {agent.parentId}
              </Anchor>
            </Meta>
          )}
          {agent.endedAt && (
            <Meta label="Ended">
              <RelativeTime iso={agent.endedAt} />
            </Meta>
          )}
          {agent.effectiveState !== agent.state && (
            <Meta label="Last reported state">
              <StateBadge state={agent.state} />
            </Meta>
          )}
        </SimpleGrid>

        <ResumeCommands agent={agent} />
      </Stack>
    </Paper>
  );
}

// ---- Timeline ----

const ev = createColumnHelper<AgentEvent>();

const EVENT_COLUMNS = [
  ev.accessor((e) => Date.parse(e.at), {
    id: 'time',
    header: 'Time',
    meta: { nowrap: true },
    cell: ({ row }) => (
      <Tooltip label={formatAbsolute(row.original.at)}>
        <Text component="time" dateTime={row.original.at} size="xs" ff="monospace">
          {formatPrecise(row.original.at)}
        </Text>
      </Tooltip>
    ),
  }),
  ev.accessor('type', { header: 'Type', sortingFn: 'text' }),
  ev.accessor((e) => (e.state ? stateRank(e.state) : 99), {
    id: 'state',
    header: 'State',
    sortDescFirst: false,
    cell: ({ row }) => (row.original.state ? <StateBadge state={row.original.state} /> : null),
  }),
  ev.accessor((e) => e.activity ?? '', {
    id: 'activity',
    header: 'Activity',
    sortingFn: 'text',
    cell: ({ getValue }) => (
      <Text size="sm" style={{ overflowWrap: 'anywhere' }} lineClamp={3}>
        {getValue()}
      </Text>
    ),
  }),
  ev.accessor((e) => e.link ?? '', {
    id: 'link',
    header: 'Link',
    sortingFn: 'text',
    cell: ({ row }) => {
      const raw = row.original.link;
      if (!raw) return null;
      const href = safeHref(raw);
      return (
        <Group gap={2} wrap="nowrap">
          {href ? (
            <Anchor href={href} target="_blank" rel="noopener noreferrer" size="sm" truncate="end" maw={260}>
              {raw}
            </Anchor>
          ) : (
            <Text size="sm" truncate="end" maw={260}>
              {raw}
            </Text>
          )}
          <CopyIcon value={raw} label="Copy link" size="xs" />
        </Group>
      );
    },
  }),
];

const EVENT_CSV_COLUMNS: CsvColumn<AgentEvent>[] = [
  { header: 'at', value: (e) => e.at },
  { header: 'type', value: (e) => e.type },
  { header: 'state', value: (e) => e.state },
  { header: 'activity', value: (e) => e.activity },
  { header: 'link', value: (e) => e.link },
  { header: 'details', value: (e) => jsonCell(e.details) },
  { header: 'receivedAt', value: (e) => e.receivedAt },
  { header: 'agentId', value: (e) => e.agentId },
  { header: 'id', value: (e) => e.id },
];

function Timeline({ agentId, events }: { agentId: string; events: AgentEvent[] }) {
  const [sorting, onSortingChange] = useSortParam('eventSort', [{ id: 'time', desc: true }]);
  const table = useReactTable({
    data: events,
    columns: EVENT_COLUMNS,
    state: { sorting },
    onSortingChange,
    getRowId: (e) => e.id,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableSortingRemoval: false,
  });
  return (
    <Section
      title="Timeline"
      actions={
        <ExportMenu
          baseName={`events-${fileSafe(agentId)}`}
          rows={() => sortedRows(table)}
          columns={EVENT_CSV_COLUMNS}
          count={events.length}
        />
      }
    >
      {events.length === 0 ? (
        <EmptyState title="No events yet" />
      ) : (
        <DataTable table={table} label="Timeline" minWidth={760} pageSize={50} />
      )}
    </Section>
  );
}

// ---- Sub-agents ----

function SubAgents({ items, flashing }: { items: AgentView[]; flashing: ReadonlySet<string> }) {
  const navigate = useNavigate();
  const [sorting, onSortingChange] = useSortParam('subSort', [{ id: 'lastSeen', desc: true }]);
  const table = useAgentsTable({
    data: items,
    sorting,
    onSortingChange,
    columnVisibility: { kind: false, machine: false, project: false },
  });
  const running = items.filter((a) => isRunning(a.effectiveState)).length;
  return (
    <Section
      title="Sub-agents"
      note={`${plural(items.length, 'sub-agent')}, ${running} running`}
      actions={<ExportMenu baseName="sub-agents" rows={() => sortedRows(table)} columns={AGENT_CSV_COLUMNS} count={items.length} />}
    >
      <DataTable
        table={table}
        label="Sub-agents"
        minWidth={760}
        onRowClick={(row) => navigate(agentPath(row.original.id))}
        rowClassName={(row) => (flashing.has(row.original.id) ? 'am-flash' : undefined)}
      />
    </Section>
  );
}

// ---- Logs ----

function AgentLogs({ agentId }: { agentId: string }) {
  const navigate = useNavigate();
  const load = useCallback(
    (signal: AbortSignal) => api.logs({ agentId, limit: AGENT_LOGS_LIMIT }, signal),
    [agentId],
  );
  const { data, error, refresh } = usePolling(`logs:${agentId}`, load, { intervalMs: AGENT_LOGS_POLL_MS });
  const [sorting, onSortingChange] = useSortParam('logSort', [{ id: 'time', desc: true }]);
  const onFilter = useCallback(
    (field: LogFilterField, value: string) => {
      const params = new URLSearchParams({ agentId });
      params.set(field, value);
      navigate(`/logs?${params.toString()}`);
    },
    [agentId, navigate],
  );
  const logs = data?.logs ?? NO_LOGS;
  const table = useLogsTable({ logs, sorting, onSortingChange, onFilter, hideAgent: true });
  const logsLink = `/logs?${new URLSearchParams({ agentId }).toString()}`;

  return (
    <Section
      title="Logs"
      note={data?.truncated ? `Newest ${AGENT_LOGS_LIMIT} shown` : undefined}
      actions={
        <>
          <Button component={Link} to={logsLink} variant="default" size="xs">
            Open in Logs
          </Button>
          <ExportMenu baseName={`logs-${fileSafe(agentId)}`} rows={() => sortedRows(table)} columns={LOG_CSV_COLUMNS} count={logs.length} />
        </>
      }
    >
      {!data ? (
        error ? (
          <LoadError message={error.message} onRetry={refresh} />
        ) : (
          <TableSkeleton rows={3} />
        )
      ) : logs.length === 0 ? (
        <EmptyState title="No logs from this agent" />
      ) : (
        <DataTable table={table} label="Logs from this agent" minWidth={900} pageSize={50} renderDetail={(row) => <LogDetail row={row} />} />
      )}
    </Section>
  );
}

const NO_LOGS: LogEntry[] = [];

// ---- Page ----

function Section({ title, note, actions, children }: { title: string; note?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <Box component="section" mb="xl">
      <Group justify="space-between" mb="xs" gap="xs">
        <Group gap="sm" align="baseline">
          <Title order={2} size="h4">
            {title}
          </Title>
          {note && (
            <Text size="sm" c="dimmed">
              {note}
            </Text>
          )}
        </Group>
        {actions && <Group gap="xs">{actions}</Group>}
      </Group>
      {children}
    </Box>
  );
}

function fileSafe(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80);
}

async function loadDetail(id: string, signal: AbortSignal): Promise<AgentDetailResponse> {
  const res = await api.agent(id, signal);
  syncServerClock(res.now);
  return res;
}

export function AgentDetailPage() {
  const [params] = useSearchParams();
  const id = params.get('id') ?? '';
  const load = useCallback((signal: AbortSignal) => loadDetail(id, signal), [id]);
  const { data, error, updatedAt, refresh } = usePolling(`agent:${id}`, load, {
    intervalMs: id ? AGENTS_POLL_MS : null,
    quietStatuses: [404],
  });
  const watched = useMemo(() => (data ? [data.agent, ...data.children] : undefined), [data]);
  const flashing = useStateFlash(watched);

  const back = (
    <Anchor component={Link} to="/agents" size="sm">
      <Group gap={4} wrap="nowrap">
        <IconArrowLeft size={14} /> Agents
      </Group>
    </Anchor>
  );

  if (!id) {
    return (
      <>
        <title>Agent · Agent Manager</title>
        <Box mb="md">{back}</Box>
        <EmptyState title="No agent chosen">Pick an agent on the Agents tab.</EmptyState>
      </>
    );
  }

  return (
    <>
      <title>{`${data?.agent.name || 'Agent'} · Agent Manager`}</title>
      <Group justify="space-between" mb="md">
        {back}
        <UpdatedAgo updatedAt={updatedAt} error={data ? error : null} />
      </Group>
      {!data ? (
        error?.status === 404 ? (
          <EmptyState title="Agent not found">
            Nothing is known about <Text span ff="monospace">{id}</Text>. Agents that stopped over a week ago are no longer listed.
          </EmptyState>
        ) : error ? (
          <LoadError message={error.message} onRetry={refresh} />
        ) : (
          <TableSkeleton rows={8} />
        )
      ) : (
        <>
          <AgentHeader agent={data.agent} flash={flashing.has(data.agent.id)} />
          {data.children.length > 0 && <SubAgents items={data.children} flashing={flashing} />}
          <Timeline agentId={data.agent.id} events={data.events} />
          <Section title="Details">
            <JsonBlock value={data.agent.details} label="Copy details" />
          </Section>
          <AgentLogs agentId={data.agent.id} />
        </>
      )}
    </>
  );
}
