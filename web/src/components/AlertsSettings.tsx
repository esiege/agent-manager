// Settings > Alerts: phone alerts, through ntfy, when an agent finishes, needs the owner, fails or is cut off.

import { ALERT_EVENTS, LIMITS, type AlertEvent, type AlertSubscription } from '@agent-manager-delux/shared';
import {
  Badge,
  Button,
  Checkbox,
  Group,
  Modal,
  MultiSelect,
  Paper,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconBell, IconPlus, IconRefresh, IconSend } from '@tabler/icons-react';
import { useMemo, useState, type FormEvent } from 'react';
import { useAgentsFeed } from '../hooks/useAgentsFeed';
import { api } from '../lib/api';
import { notifyError, notifySuccess } from '../lib/notify';
import { usePolling } from '../lib/usePolling';
import { CopyIcon } from './Copy';
import { EmptyState, LoadError, TableSkeleton } from './States';
import { RelativeTime } from './Time';

const loadAlerts = (signal: AbortSignal) => api.alerts(signal);
const NO_SUBSCRIPTIONS: AlertSubscription[] = [];

const EVENT_LABELS: Record<AlertEvent, string> = {
  finished: 'Finished a request',
  waiting: 'Needs you (permission, question)',
  failed: 'Failed',
  unfinished: 'Cut off mid-request',
  blocker: 'Reported a blocker',
};
const EVENT_BADGES: Record<AlertEvent, { label: string; color: string }> = {
  finished: { label: 'Finished', color: 'teal' },
  waiting: { label: 'Needs you', color: 'yellow' },
  failed: { label: 'Failed', color: 'red' },
  unfinished: { label: 'Cut off', color: 'orange' },
  blocker: { label: 'Blocker', color: 'red' },
};

/** A topic nobody can guess: anyone who knows a ntfy.sh topic can read it. */
function randomTopic(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return `https://ntfy.sh/am-${Array.from(bytes, (b) => alphabet[b % 32]).join('')}`;
}

/** The topic's name, which is what the ntfy app asks for. */
function topicName(target: string): string {
  try {
    return new URL(target).pathname.replace(/^\/+|\/+$/g, '') || target;
  } catch {
    return target;
  }
}

interface Draft {
  id?: string;
  name: string;
  target: string;
  events: AlertEvent[];
  projects: string[];
  enabled: boolean;
}

const newDraft = (): Draft => ({ name: 'My phone', target: randomTopic(), events: [...ALERT_EVENTS], projects: [], enabled: true });
const toDraft = (s: AlertSubscription): Draft => ({ id: s.id, name: s.name, target: s.target, events: s.events, projects: s.projects, enabled: s.enabled });
const save = (d: Draft) => api.saveAlert({ ...d, channel: 'ntfy' });

/** Mounted only while open, so the agents feed (for project names) only polls then. */
function AlertForm({ draft, onClose, onSaved }: { draft: Draft; onClose: () => void; onSaved: () => void }) {
  const mobile = useMediaQuery('(max-width: 36em)');
  const { data } = useAgentsFeed();
  const [form, setForm] = useState<Draft>(draft);
  const [busy, setBusy] = useState(false);

  const projectOptions = useMemo(() => {
    const names = new Set((data?.agents ?? []).map((a) => a.project).filter((p): p is string => Boolean(p)));
    for (const p of form.projects) names.add(p);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [data, form.projects]);

  const set = (patch: Partial<Draft>) => setForm({ ...form, ...patch });
  const valid = form.name.trim() !== '' && form.target.trim() !== '' && form.events.length > 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    try {
      await save({ ...form, name: form.name.trim(), target: form.target.trim() });
      notifySuccess(form.id ? `Saved ${form.name.trim()}` : `Added ${form.name.trim()}. Send a test to check it reaches your phone.`);
      onSaved();
      onClose();
    } catch (err) {
      notifyError(err, "Couldn't save the alert");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      opened
      onClose={onClose}
      title={<Text fw={600}>{draft.id ? `Edit ${draft.name}` : 'New alert'}</Text>}
      size="lg"
      fullScreen={mobile}
    >
      <Stack gap="md" component="form" onSubmit={submit}>
        <TextInput
          label="Name"
          placeholder="My phone"
          value={form.name}
          onChange={(e) => set({ name: e.currentTarget.value })}
          maxLength={LIMITS.nameLength}
          required
        />
        <div>
          <TextInput
            label="ntfy topic URL"
            description="Long and random, because anyone who knows the topic can read its alerts."
            value={form.target}
            onChange={(e) => set({ target: e.currentTarget.value })}
            maxLength={LIMITS.linkLength}
            required
            rightSection={<CopyIcon value={form.target} label="Copy topic URL" />}
            styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)' } }}
          />
          <Group gap="xs" mt={6} wrap="wrap">
            <Button variant="subtle" size="compact-sm" leftSection={<IconRefresh size={14} />} onClick={() => set({ target: randomTopic() })}>
              New random topic
            </Button>
            <Text size="xs" c="dimmed" style={{ overflowWrap: 'anywhere' }}>
              In the ntfy app, subscribe to <b>{topicName(form.target)}</b>
            </Text>
          </Group>
        </div>
        <Checkbox.Group
          label="Tell me when an agent"
          value={form.events}
          onChange={(v) => set({ events: v as AlertEvent[] })}
          error={form.events.length === 0 ? 'Pick at least one' : undefined}
        >
          <Stack gap={6} mt={6}>
            {ALERT_EVENTS.map((e) => (
              <Checkbox key={e} value={e} label={EVENT_LABELS[e]} />
            ))}
          </Stack>
        </Checkbox.Group>
        <MultiSelect
          label="Projects"
          description="Leave empty for all projects."
          placeholder={form.projects.length ? undefined : 'All projects'}
          data={projectOptions}
          value={form.projects}
          onChange={(projects) => set({ projects })}
          searchable
          clearable
        />
        <Switch label="On" checked={form.enabled} onChange={(e) => set({ enabled: e.currentTarget.checked })} />
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={!valid}>
            Save
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function DeleteModal({ target, onClose, onDeleted }: { target: AlertSubscription | null; onClose: () => void; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await api.deleteAlert(target.id);
      notifySuccess(`Deleted ${target.name}`);
      onDeleted();
      onClose();
    } catch (err) {
      notifyError(err, "Couldn't delete the alert");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal opened={target !== null} onClose={onClose} title={<Text fw={600}>Delete {target?.name}?</Text>}>
      <Stack gap="md">
        <Text size="sm">Alerts stop going to this topic. The ntfy app keeps the topic until you remove it there.</Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button color="red" onClick={remove} loading={busy} data-autofocus>
            Delete
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

interface CardProps {
  sub: AlertSubscription;
  onEdit: () => void;
  onDelete: () => void;
  onChanged: () => void;
}

function SubscriptionCard({ sub, onEdit, onDelete, onChanged }: CardProps) {
  const [testing, setTesting] = useState(false);
  const [toggling, setToggling] = useState(false);

  const sendTest = async () => {
    setTesting(true);
    try {
      await api.testAlert(sub.id);
      notifySuccess(`Sent a test to ${sub.name}`);
    } catch (err) {
      notifyError(err, "The test didn't go through");
    } finally {
      setTesting(false);
      onChanged();
    }
  };

  const toggle = async (enabled: boolean) => {
    setToggling(true);
    try {
      await save({ ...toDraft(sub), enabled });
      onChanged();
    } catch (err) {
      notifyError(err, "Couldn't change the alert");
    } finally {
      setToggling(false);
    }
  };

  const topic = topicName(sub.target);
  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="xs">
        <Group justify="space-between" wrap="nowrap" align="flex-start" gap="sm">
          <Text fw={600} style={{ overflowWrap: 'anywhere' }}>
            {sub.name}
          </Text>
          <Switch
            label={sub.enabled ? 'On' : 'Off'}
            checked={sub.enabled}
            disabled={toggling}
            onChange={(e) => toggle(e.currentTarget.checked)}
            aria-label={`Alerts for ${sub.name}`}
          />
        </Group>
        <Group gap={6} wrap="wrap">
          {ALERT_EVENTS.filter((e) => sub.events.includes(e)).map((e) => (
            <Badge key={e} color={EVENT_BADGES[e].color} variant="light" radius="sm" tt="none">
              {EVENT_BADGES[e].label}
            </Badge>
          ))}
        </Group>
        <Text size="sm" c="dimmed" style={{ overflowWrap: 'anywhere' }}>
          {sub.projects.length ? `Projects: ${sub.projects.join(', ')}` : 'All projects'}
        </Text>
        <Group gap={4} wrap="nowrap" miw={0}>
          <Text size="sm" c="dimmed" ff="monospace" style={{ overflowWrap: 'anywhere', minWidth: 0 }}>
            {topic}
          </Text>
          <CopyIcon value={topic} label="Copy topic" />
        </Group>
        <Text size="sm" c="dimmed" component="div">
          {sub.lastSentAt ? (
            <>
              Last sent <RelativeTime iso={sub.lastSentAt} c="dimmed" />
            </>
          ) : (
            'Nothing sent yet'
          )}
        </Text>
        {sub.lastError && (
          <Text size="sm" c="red" style={{ overflowWrap: 'anywhere' }}>
            Last error: {sub.lastError}
          </Text>
        )}
        <Group gap="xs" wrap="wrap">
          <Button variant="light" size="compact-sm" leftSection={<IconSend size={14} />} loading={testing} onClick={sendTest}>
            Send test
          </Button>
          <Button variant="subtle" size="compact-sm" onClick={onEdit}>
            Edit
          </Button>
          <Button variant="subtle" color="red" size="compact-sm" onClick={onDelete}>
            Delete
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}

export function AlertsSettings() {
  const { data, error, refresh } = usePolling('alerts', loadAlerts, { intervalMs: null });
  const [editing, setEditing] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<AlertSubscription | null>(null);
  const subs = data?.subscriptions ?? NO_SUBSCRIPTIONS;

  return (
    <Stack gap="sm" mt="xl" component="section" aria-labelledby="alerts-title">
      <Group justify="space-between" align="center" gap="sm" wrap="wrap">
        <Title order={2} size="h4" id="alerts-title">
          Alerts
        </Title>
        <Button size="sm" leftSection={<IconPlus size={16} />} onClick={() => setEditing(newDraft())}>
          Add alert
        </Button>
      </Group>
      <Text size="sm" c="dimmed">
        Alerts go to your phone through ntfy, which is free: install the ntfy app (Android/iOS), then subscribe to the topic
        below. They arrive like texts when an agent finishes a request, needs you, fails, or is cut off mid-request. Anyone
        who knows a topic can read it, so topics here are long and random; keep them to yourself.
      </Text>

      {!data ? (
        error ? (
          <LoadError message={error.message} onRetry={refresh} />
        ) : (
          <TableSkeleton rows={2} />
        )
      ) : subs.length === 0 ? (
        <EmptyState title="No alerts yet">
          <IconBell size={16} style={{ verticalAlign: 'text-bottom' }} /> Add one to get a message on your phone when an agent needs
          you.
        </EmptyState>
      ) : (
        subs.map((s) => (
          <SubscriptionCard key={s.id} sub={s} onEdit={() => setEditing(toDraft(s))} onDelete={() => setDeleting(s)} onChanged={refresh} />
        ))
      )}

      {editing && <AlertForm draft={editing} onClose={() => setEditing(null)} onSaved={refresh} />}
      <DeleteModal target={deleting} onClose={() => setDeleting(null)} onDeleted={refresh} />
    </Stack>
  );
}
