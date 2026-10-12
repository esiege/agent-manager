// Sends a message to a Claude Code session; agentctl on its PC posts it into the session's inbox
// (Docs/Agent-Messaging-Findings.md). Shows what happened to the latest ones.

import { LIMITS, isRunning, type AgentMessage, type AgentView, type MessageStatus } from '@agent-manager/shared';
import { Badge, Button, Group, Stack, Text, Textarea } from '@mantine/core';
import { IconSend } from '@tabler/icons-react';
import { useState } from 'react';
import { api } from '../lib/api';
import { notifyError } from '../lib/notify';
import { RelativeTime } from './Time';

const STATUS: Record<MessageStatus, { label: string; color: string }> = {
  pending: { label: 'Waiting for the PC', color: 'blue' },
  delivered: { label: 'Posted to the session', color: 'teal' },
  failed: { label: 'Not delivered', color: 'red' },
  expired: { label: 'Expired', color: 'gray' },
};

/** Why the session can't take a message now, or null when it can. */
function blockedReason(agent: AgentView): string | null {
  if (!isRunning(agent.effectiveState)) return 'The session isn’t running, so nothing would deliver a message.';
  if (agent.details.permissionMode === 'bypassPermissions') return 'The session skips permission prompts, so it doesn’t take messages.';
  return null;
}

/** For a top-level Claude Code session only; the page decides. */
export function SendMessage({ agent, messages, onSent }: { agent: AgentView; messages: AgentMessage[]; onSent: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
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
    <Stack gap="sm">
      <Text size="sm" c="dimmed">
        agentctl on {agent.machine} posts it into the session within a few seconds, as if from the session itself; the session&apos;s
        own permission prompts still apply. That PC needs messages turned on: <Text span ff="monospace" size="sm">agentctl install --allow-messages</Text>.
        Messages not collected within 10 minutes expire.
      </Text>
      <Textarea
        aria-label="Message to the session"
        placeholder={blocked ?? 'What should the session do? Ctrl+Enter sends.'}
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
        <Text size="xs" c="dimmed">
          {text.length > LIMITS.agentMessageLength * 0.9 ? `${text.length} / ${LIMITS.agentMessageLength}` : ''}
        </Text>
        <Button onClick={() => void send()} loading={busy} disabled={!trimmed || Boolean(blocked)} leftSection={<IconSend size={16} />}>
          Send
        </Button>
      </Group>
      {messages.length > 0 && (
        <Stack gap={6}>
          {messages.map((m) => (
            <Group key={m.id} gap="sm" wrap="nowrap" align="flex-start">
              <Badge color={STATUS[m.status].color} variant="light" radius="sm" tt="none" style={{ flexShrink: 0 }}>
                {STATUS[m.status].label}
              </Badge>
              <div style={{ minWidth: 0 }}>
                <Text size="sm" lineClamp={2} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {m.text}
                </Text>
                <Text size="xs" c="dimmed" component="div">
                  <RelativeTime iso={m.createdAt} span size="xs" /> by {m.from}
                  {m.reason ? ` · ${m.reason}` : ''}
                </Text>
              </div>
            </Group>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
