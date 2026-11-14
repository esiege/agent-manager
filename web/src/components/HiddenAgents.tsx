// Settings: the agents hidden from the Dashboard, with a way to show each one again.

import { RECENT_DAYS, type AgentsResponse } from '@agent-manager-delux/shared';
import { Button, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { useState } from 'react';
import { api } from '../lib/api';
import { groupAgents, type AgentGroup } from '../lib/agents';
import { plural } from '../lib/labels';
import { notifyError, notifySuccess } from '../lib/notify';
import { usePolling } from '../lib/usePolling';
import { LoadError, TableSkeleton } from './States';
import { RelativeTime } from './Time';

function loadAgents(signal: AbortSignal): Promise<AgentsResponse> {
  return api.agents(RECENT_DAYS, signal);
}

/** When the group was hidden: its latest hide. */
function hiddenAt(g: AgentGroup): string {
  return g.instances.reduce((m, i) => (i.hiddenAt && i.hiddenAt > m ? i.hiddenAt : m), '');
}

export function HiddenAgents() {
  const { data, error, refresh } = usePolling('hidden-agents', loadAgents, { intervalMs: null });
  const [busy, setBusy] = useState<string | null>(null);
  // Hidden top-level sessions; their sub-agents come back with them.
  const groups = data
    ? groupAgents(data.agents.filter((a) => a.hiddenAt && !a.parentId)).sort((a, b) => hiddenAt(b).localeCompare(hiddenAt(a)))
    : [];

  const unhide = async (g: AgentGroup) => {
    setBusy(g.key);
    try {
      await api.hideAgents(g.instances.map((i) => i.id), false);
      notifySuccess(`${g.name} is back on the Dashboard`);
      refresh();
    } catch (e) {
      notifyError(e, `Couldn't show ${g.name}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Title order={2} size="h4" mt="xl" mb={4}>
        Hidden agents
      </Title>
      <Text size="sm" c="dimmed" mb="sm">
        Agents hidden from the Dashboard in the last {RECENT_DAYS} days. Show one again if it was hidden by mistake.
      </Text>
      {!data ? (
        error ? (
          <LoadError message={error.message} onRetry={refresh} />
        ) : (
          <TableSkeleton rows={2} />
        )
      ) : groups.length === 0 ? (
        <Text size="sm" c="dimmed">
          Nothing is hidden.
        </Text>
      ) : (
        <Stack gap="xs">
          {groups.map((g) => (
            <Paper key={g.key} withBorder p="sm" radius="md">
              <Group justify="space-between" wrap="nowrap" gap="sm">
                <div style={{ minWidth: 0 }}>
                  <Text fw={500} size="sm" truncate="end">
                    {g.name}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {g.lead.machine}
                    {g.instances.length > 1 && ` · ${plural(g.instances.length, 'session')}`} · hidden{' '}
                    <RelativeTime iso={hiddenAt(g)} size="xs" c="dimmed" />
                  </Text>
                </div>
                <Button variant="default" size="compact-sm" loading={busy === g.key} onClick={() => unhide(g)}>
                  Show again
                </Button>
              </Group>
            </Paper>
          ))}
        </Stack>
      )}
    </>
  );
}
