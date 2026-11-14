// Blockers: what agents can't get past without you. Each open one is a panel you can answer in
// place; answered ones from the last week are listed underneath with how the answer got there.

import {
  BLOCKER_RECENT_DAYS,
  type AgentMessage,
  type Blocker,
  type BlockersResponse,
} from '@agent-manager-deluxe/shared';
import { Anchor, Badge, Group, Paper, SimpleGrid, Stack, Text, Title, Tooltip } from '@mantine/core';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { BlockerCard } from '../components/BlockerCard';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, LoadError, TableSkeleton } from '../components/States';
import { RelativeTime, UpdatedAgo } from '../components/Time';
import { api } from '../lib/api';
import { agentPath, plural } from '../lib/labels';
import { notifyError } from '../lib/notify';
import { usePolling } from '../lib/usePolling';

const POLL_MS = 5000;

const loadBlockers = (signal: AbortSignal) => api.blockers(signal);

/** What happened to the message that carried the answer, or the server's note on why none went. */
function deliveryLine(b: Blocker, message: AgentMessage | undefined, now: string): { text: string; color: string } {
  if (!message) return { text: b.delivery ?? '', color: 'dimmed' };
  if (message.status === 'delivered') return { text: 'Posted to the session', color: 'teal' };
  if (message.status === 'failed') return { text: `Not delivered: ${message.reason ?? 'agentctl couldn’t post it'}`, color: 'red' };
  if (message.expiresAt < now) {
    return { text: `Not picked up by ${b.machine}: messages may be off there. The agent can still check the blocker.`, color: 'orange' };
  }
  return { text: `Waiting for ${b.machine} to pick it up`, color: 'blue' };
}

function AnsweredRow({ b, message, now }: { b: Blocker; message: AgentMessage | undefined; now: string }) {
  const delivery = deliveryLine(b, message, now);
  return (
    <Stack gap={2} py={6} className="am-blocker-answered">
      <Group gap="xs" wrap="nowrap" align="baseline">
        <Badge size="sm" variant="light" color={b.status === 'resolved' ? 'teal' : 'gray'} tt="none" style={{ flexShrink: 0 }}>
          {b.status === 'resolved' ? 'Resolved' : 'Dismissed'}
        </Badge>
        <Text size="sm" fw={500} style={{ overflowWrap: 'anywhere' }}>
          {b.title}
        </Text>
      </Group>
      <Text size="xs" c="dimmed" component="div">
        <Anchor component={Link} to={agentPath(b.agentId)} size="xs">
          {b.project || b.agentName}
        </Anchor>{' '}
        on {b.machine} · by {b.resolvedBy} <RelativeTime iso={b.resolvedAt} span size="xs" />
      </Text>
      {b.resolution && (
        <Text size="sm" lineClamp={3} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {b.resolution}
        </Text>
      )}
      {delivery.text && (
        <Text size="xs" c={delivery.color}>
          {delivery.text}
        </Text>
      )}
    </Stack>
  );
}

export function BlockersPage() {
  const { data, error, updatedAt, refresh } = usePolling<BlockersResponse>('blockers', loadBlockers, { intervalMs: POLL_MS });
  const [params] = useSearchParams();
  const focusId = params.get('id');
  // Answered here but not yet reloaded: hidden so the panel goes as soon as you answer.
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set());

  const open = (data?.blockers ?? []).filter((b) => b.status === 'open' && !answered.has(b.id));
  const done = (data?.blockers ?? [])
    .filter((b) => b.status !== 'open')
    .sort((a, b) => (b.resolvedAt ?? '').localeCompare(a.resolvedAt ?? ''));
  const messages = new Map((data?.messages ?? []).map((m) => [m.id, m]));

  // A link from an alert opens the page on that blocker.
  const focusFound = Boolean(focusId && open.some((b) => b.id === focusId));
  useEffect(() => {
    if (focusFound) document.getElementById(`blocker-${focusId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focusFound, focusId]);

  async function onAnswer(b: Blocker, status: 'resolved' | 'dismissed', resolution: string): Promise<boolean> {
    try {
      await api.resolveBlocker({ id: b.id, status, resolution: resolution || null });
      setAnswered((s) => new Set(s).add(b.id));
      refresh();
      return true;
    } catch (e) {
      notifyError(e, status === 'resolved' ? "Couldn't resolve the blocker" : "Couldn't dismiss the blocker");
      refresh();
      return false;
    }
  }

  return (
    <>
      <PageHeader title="Blockers">
        <UpdatedAgo updatedAt={updatedAt} error={error} />
      </PageHeader>
      {!data ? (
        error ? (
          <LoadError message={error.message} onRetry={refresh} />
        ) : (
          <TableSkeleton rows={6} />
        )
      ) : (
        <Stack gap="xl">
          {open.length === 0 ? (
            <EmptyState title="Nothing is blocked">
              When an agent hits something it can't get past without you, it shows up here to answer. Agents report one with{' '}
              <Text span ff="monospace" size="sm">
                agentctl blocker
              </Text>{' '}
              (see{' '}
              <Anchor component={Link} to="/instructions" size="sm">
                Instructions
              </Anchor>
              ).
            </EmptyState>
          ) : (
            <Stack gap="sm">
              <Text size="sm" c="dimmed">
                {plural(open.length, 'agent is', 'agents are')} waiting on you. Answer in the box and press Resolve, or Ctrl+Enter.
              </Text>
              <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }} spacing="md" verticalSpacing="md">
                {open.map((b) => (
                  <BlockerCard key={b.id} blocker={b} agent={data.agents[b.agentId]} highlighted={b.id === focusId} onAnswer={onAnswer} />
                ))}
              </SimpleGrid>
            </Stack>
          )}

          {done.length > 0 && (
            <Stack gap="xs">
              <Group gap="xs" align="baseline">
                <Title order={2} size="h4">
                  Answered
                </Title>
                <Tooltip label={`Blockers resolved or dismissed in the last ${BLOCKER_RECENT_DAYS} days`}>
                  <Text size="xs" c="dimmed">
                    last {BLOCKER_RECENT_DAYS} days
                  </Text>
                </Tooltip>
              </Group>
              <Paper withBorder px="md" py="xs" radius="md">
                {done.map((b) => (
                  <AnsweredRow key={b.id} b={b} message={b.messageId ? messages.get(b.messageId) : undefined} now={data.now} />
                ))}
              </Paper>
            </Stack>
          )}
        </Stack>
      )}
    </>
  );
}
