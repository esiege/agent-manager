// U-01: the status (phase 2), counts by state, and what needs the owner.

import { RECENT_DAYS, needsAttention, unfinishedReason, type AgentState, type AgentView } from '@agent-manager-deluxe/shared';
import { Anchor, Group, Paper, SimpleGrid, Stack, Table, Text, Title, Tooltip } from '@mantine/core';
import { Link, useNavigate } from 'react-router';
import { StateBadge } from '../components/Badges';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, LoadError, TableSkeleton } from '../components/States';
import { RelativeTime, UpdatedAgo } from '../components/Time';
import { useAgentsFeed } from '../hooks/useAgentsFeed';
import { countByState } from '../lib/agents';
import { agentPath, plural, STATE_COLOR, STATE_LABEL } from '../lib/labels';

const CARDS: { state: AgentState; label: string }[] = [
  { state: 'working', label: STATE_LABEL.working },
  { state: 'waiting', label: STATE_LABEL.waiting },
  { state: 'idle', label: STATE_LABEL.idle },
  { state: 'failed', label: STATE_LABEL.failed },
  { state: 'lost', label: STATE_LABEL.lost },
  { state: 'stopped', label: `Stopped (last ${RECENT_DAYS} days)` },
];

/** When the agent started needing the owner: when it went silent if Lost, else its last report. */
function since(agent: AgentView): string {
  return agent.effectiveState === 'lost' ? agent.lastSeen : agent.lastReportAt;
}

/** Requests cut off this long ago stop asking for attention. */
const UNFINISHED_WINDOW_MS = 24 * 3600_000;

/** Needs the owner: waiting, failed or lost, or a request that never finished in the last day. */
function needsYou(agent: AgentView, now: number): boolean {
  if (needsAttention(agent.effectiveState)) return true;
  const reason = unfinishedReason(agent);
  return reason !== null && !agent.parentId && now - Date.parse(agent.turn?.endedAt ?? agent.lastSeen) < UNFINISHED_WINDOW_MS;
}

function StatusPlaceholder() {
  return (
    <Paper withBorder p="md" radius="md" mb="md" aria-label="Status">
      <Group gap="sm">
        <Text fw={600}>Status</Text>
        <Text c="dimmed" size="sm">
          Status checks arrive in phase 2
        </Text>
      </Group>
    </Paper>
  );
}

function Summary({ agents }: { agents: AgentView[] }) {
  const counts = countByState(agents);
  const attention = counts.waiting + counts.failed + counts.lost;
  const machines = new Set(agents.filter((a) => a.effectiveState !== 'stopped').map((a) => a.machine)).size;
  const parts = [
    counts.waiting && `${counts.waiting} waiting on you`,
    counts.failed && `${counts.failed} failed`,
    counts.lost && `${counts.lost} lost`,
  ].filter(Boolean);
  const live = counts.working + counts.idle + counts.waiting;

  return (
    <Stack gap={4} mb="md">
      <Title order={2} size="h3" c={attention ? undefined : 'teal'}>
        {attention ? `${plural(attention, 'agent')} need${attention === 1 ? 's' : ''} you` : 'All clear'}
      </Title>
      <Text c="dimmed" size="sm">
        {attention ? `${parts.join(', ')}. ` : ''}
        {live ? `${counts.working} working, ${counts.idle} idle on ${plural(machines, 'machine')}.` : 'Nothing is running.'}
      </Text>
    </Stack>
  );
}

function StatCards({ agents }: { agents: AgentView[] }) {
  const counts = countByState(agents);
  return (
    <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }} spacing="sm" mb="xl">
      {CARDS.map(({ state, label }) => {
        const n = counts[state];
        const subAgents = agents.filter((a) => a.effectiveState === state && a.parentId).length;
        const alert = n > 0 && needsAttention(state);
        return (
          <Paper
            key={state}
            component={Link}
            to={`/agents?state=${state}`}
            withBorder
            p="md"
            radius="md"
            style={{
              textDecoration: 'none',
              color: 'inherit',
              borderColor: alert ? `var(--mantine-color-${STATE_COLOR[state]}-filled)` : undefined,
            }}
            aria-label={`${label}: ${n}. Show these agents.`}
          >
            <Text size="sm" c="dimmed">
              {label}
            </Text>
            <Text fz={32} fw={700} lh={1.2} c={alert ? STATE_COLOR[state] : undefined}>
              {n}
            </Text>
            <Text size="xs" c="dimmed" h={18}>
              {subAgents > 0 ? `incl. ${plural(subAgents, 'sub-agent')}` : ''}
            </Text>
          </Paper>
        );
      })}
    </SimpleGrid>
  );
}

function NeedsYou({ agents, flashing }: { agents: AgentView[]; flashing: ReadonlySet<string> }) {
  const navigate = useNavigate();
  const now = Date.now();
  const list = agents
    .filter((a) => needsYou(a, now))
    .sort((a, b) => Date.parse(since(b)) - Date.parse(since(a)));

  return (
    <section aria-labelledby="needs-you">
      <Title id="needs-you" order={2} size="h4" mb="sm">
        Needs you
      </Title>
      {list.length === 0 ? (
        <EmptyState title="Nothing needs you">No agent is waiting on you, failed, lost or cut off mid-request.</EmptyState>
      ) : (
        <Table.ScrollContainer minWidth={640} type="native">
          <Table highlightOnHover verticalSpacing={6} fz="sm" aria-label="Agents that need you">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Machine</Table.Th>
                <Table.Th>State</Table.Th>
                <Table.Th>Activity</Table.Th>
                <Table.Th>Since</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {list.map((a) => (
                <Table.Tr
                  key={a.id}
                  className={flashing.has(a.id) ? 'am-flash' : undefined}
                  style={{ cursor: 'pointer' }}
                  onClick={(e) => {
                    if (!(e.target as HTMLElement).closest('a, button')) navigate(agentPath(a.id));
                  }}
                >
                  <Table.Td>
                    <Anchor component={Link} to={agentPath(a.id)} size="sm" fw={500}>
                      {a.name || a.id}
                    </Anchor>
                  </Table.Td>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>{a.machine}</Table.Td>
                  <Table.Td>
                    <StateBadge state={a.effectiveState} />
                  </Table.Td>
                  <Table.Td>
                    {unfinishedReason(a) ? (
                      <Text size="sm" c="orange" truncate="end" maw={420}>
                        Unfinished: {unfinishedReason(a)}
                      </Text>
                    ) : a.activity ? (
                      <Tooltip label={a.activity} multiline maw={480} openDelay={400}>
                        <Text size="sm" truncate="end" maw={420}>
                          {a.activity}
                        </Text>
                      </Tooltip>
                    ) : (
                      <Text size="sm" c="dimmed">
                        –
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <RelativeTime iso={since(a)} />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </section>
  );
}

export function OverviewPage() {
  const { data, error, updatedAt, refresh, flashing } = useAgentsFeed();

  return (
    <>
      <PageHeader title="Overview">
        <UpdatedAgo updatedAt={updatedAt} error={error} />
      </PageHeader>
      <StatusPlaceholder />
      {!data ? (
        error ? (
          <LoadError message={error.message} onRetry={refresh} />
        ) : (
          <TableSkeleton rows={4} />
        )
      ) : data.agents.length === 0 ? (
        <EmptyState title="No agents yet">
          No agents have reported yet. See the{' '}
          <Anchor component={Link} to="/instructions" size="sm">
            Instructions
          </Anchor>{' '}
          tab.
        </EmptyState>
      ) : (
        <>
          <Summary agents={data.agents} />
          <StatCards agents={data.agents} />
          <NeedsYou agents={data.agents} flashing={flashing} />
        </>
      )}
    </>
  );
}
