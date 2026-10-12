// Sends a message to a Claude Code session; agentctl on its PC posts it into the session's inbox
// (Docs/Agent-Messaging-Findings.md). A status bar on top says whether that's working, from the
// latest message; the list below shows what happened to each one.

import { LIMITS, isRunning, type AgentMessage, type AgentView, type MessageStatus } from '@agent-manager/shared';
import { Alert, Anchor, Button, Collapse, Group, Loader, Paper, Stack, Text, Textarea, ThemeIcon } from '@mantine/core';
import { IconAlertCircle, IconChevronDown, IconCircleCheck, IconClockX, IconMessageCircle, IconPlugConnectedX, IconSend } from '@tabler/icons-react';
import { useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { notifyError } from '../lib/notify';
import { RelativeTime } from './Time';

const STATUS: Record<MessageStatus, { label: string; color: string; icon: ReactNode }> = {
  pending: { label: 'Waiting for the PC', color: 'blue', icon: <Loader size={12} color="white" /> },
  delivered: { label: 'Posted to the session', color: 'teal', icon: <IconCircleCheck size={14} /> },
  failed: { label: 'Not delivered', color: 'red', icon: <IconAlertCircle size={14} /> },
  expired: { label: 'Expired', color: 'orange', icon: <IconClockX size={14} /> },
};

/** Why the session can't take a message now, or null when it can. */
function blockedReason(agent: AgentView): string | null {
  if (!isRunning(agent.effectiveState)) return 'The session isn’t running, so nothing would deliver a message.';
  if (agent.details.permissionMode === 'bypassPermissions') return 'The session skips permission prompts, so it doesn’t take messages.';
  return null;
}

/** The status bar: can it send, and did the latest message get through? */
function StatusBar({ agent, latest, blocked }: { agent: AgentView; latest: AgentMessage | undefined; blocked: string | null }) {
  if (blocked) {
    return (
      <Alert color="gray" variant="light" icon={<IconPlugConnectedX size={18} />} title="Can’t send now">
        {blocked}
      </Alert>
    );
  }
  if (!latest) {
    return (
      <Alert color="gray" variant="light" icon={<IconMessageCircle size={18} />} title="No messages yet">
        Send one to check that {agent.machine} picks it up.
      </Alert>
    );
  }
  const when = <RelativeTime iso={latest.doneAt ?? latest.createdAt} span size="sm" />;
  switch (latest.status) {
    case 'delivered':
      return (
        <Alert color="teal" variant="light" icon={<IconCircleCheck size={18} />} title="Working">
          The last message was posted to the session {when}.
        </Alert>
      );
    case 'pending':
      return (
        <Alert color="blue" variant="light" icon={<Loader size={16} />} title="Sending…">
          Waiting for agentctl on {agent.machine} to pick it up. That usually takes about 5 seconds.
        </Alert>
      );
    case 'failed':
      return (
        <Alert color="red" variant="light" icon={<IconAlertCircle size={18} />} title="Last message not delivered">
          {latest.reason ?? 'agentctl couldn’t post it.'}
        </Alert>
      );
    case 'expired':
      return (
        <Alert color="orange" variant="light" icon={<IconClockX size={18} />} title="Last message expired">
          Nothing on {agent.machine} picked it up within 10 minutes. Check that messages are turned on there (more details below).
        </Alert>
      );
  }
}

function MessageRow({ m }: { m: AgentMessage }) {
  const s = STATUS[m.status];
  return (
    <Group gap="sm" wrap="nowrap" align="flex-start">
      <ThemeIcon color={s.color} size="sm" radius="xl" mt={2} aria-label={s.label}>
        {s.icon}
      </ThemeIcon>
      <div style={{ minWidth: 0 }}>
        <Text size="sm" lineClamp={2} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {m.text}
        </Text>
        <Text size="xs" c="dimmed" component="div">
          <Text span size="xs" c={s.color} fw={600}>
            {s.label}
          </Text>
          {' · '}
          <RelativeTime iso={m.createdAt} span size="xs" /> by {m.from}
          {m.reason ? ` · ${m.reason}` : ''}
        </Text>
      </div>
    </Group>
  );
}

/** For a top-level Claude Code session only; the page decides. */
export function SendMessage({ agent, messages, onSent }: { agent: AgentView; messages: AgentMessage[]; onSent: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [details, setDetails] = useState(false);
  const blocked = blockedReason(agent);
  const trimmed = text.trim();

  async function send() {
    if (!trimmed || blocked || busy) return;
    setBusy(true);
    try {
      await api.sendMessage({ agentId: agent.id, text: trimmed });
      setText('');
      onSent();
    } catch (err) {
      notifyError(err, "Couldn't send the message");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <StatusBar agent={agent} latest={messages[0]} blocked={blocked} />
        <Textarea
          aria-label="Message to the session"
          placeholder={blocked ? undefined : 'What should the session do? Ctrl+Enter sends.'}
          autosize
          minRows={2}
          maxRows={10}
          maxLength={LIMITS.agentMessageLength}
          value={text}
          disabled={Boolean(blocked)}
          onChange={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <Group justify="space-between">
          <Anchor component="button" type="button" size="xs" c="dimmed" onClick={() => setDetails((d) => !d)} aria-expanded={details}>
            <Group gap={2} wrap="nowrap">
              More details
              <IconChevronDown size={12} style={{ transform: details ? 'rotate(180deg)' : undefined, transition: 'transform 150ms' }} />
            </Group>
          </Anchor>
          <Group gap="sm">
            {text.length > LIMITS.agentMessageLength * 0.9 && (
              <Text size="xs" c="dimmed">
                {text.length} / {LIMITS.agentMessageLength}
              </Text>
            )}
            <Button onClick={() => void send()} loading={busy} disabled={!trimmed || Boolean(blocked)} leftSection={<IconSend size={16} />}>
              Send
            </Button>
          </Group>
        </Group>
        <Collapse in={details}>
          <Text size="sm" c="dimmed">
            agentctl on {agent.machine} posts the message into the session within a few seconds. The session sees it as a message from
            another session, signed with your login, so its own permission prompts still apply. That PC needs messages turned on:{' '}
            <Text span ff="monospace" size="sm">
              agentctl install --allow-messages
            </Text>
            . Messages not collected within 10 minutes expire.
          </Text>
        </Collapse>
        {messages.length > 0 && (
          <Stack gap={8} pt={4}>
            {messages.map((m) => (
              <MessageRow key={m.id} m={m} />
            ))}
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}
