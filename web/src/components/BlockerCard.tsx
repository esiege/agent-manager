// One open blocker: who is stuck, where, since when, what's in the way (with its screenshots or
// video), and a box to answer it right there. Loaded on demand: it brings Markdown.

import { LIMITS, type Blocker, type BlockerAgentStatus, type BlockerMedia } from '@agent-manager-deluxe/shared';
import { Anchor, Badge, Button, Group, Image, Modal, Paper, Stack, Text, Textarea, Title, Tooltip, Typography, UnstyledButton } from '@mantine/core';
import { IconCheck, IconDeviceDesktop, IconHash, IconMessageCircle, IconMessageCircleOff, IconX } from '@tabler/icons-react';
import { useState } from 'react';
import Markdown from 'react-markdown';
import { Link } from 'react-router';
import remarkGfm from 'remark-gfm';
import { blockerMediaUrl } from '../lib/api';
import { agentPath, STATE_COLOR, STATE_LABEL } from '../lib/labels';
import { formatAbsolute } from '../lib/time';
import { RelativeTime } from './Time';

/** Details longer than this start folded. */
const FOLD_CHARS = 400;
const FOLD_LINES = 6;

/** The last part of an agent id, which tells sessions of the same agent apart. */
function instanceId(agentId: string): string {
  const last = agentId.split('/').pop() ?? agentId;
  return last.length > 8 ? last.slice(0, 8) : last;
}

function MediaStrip({ blocker }: { blocker: Blocker }) {
  const [open, setOpen] = useState<BlockerMedia | null>(null);
  const images = blocker.media.filter((m) => m.kind === 'image');
  const videos = blocker.media.filter((m) => m.kind === 'video');
  if (blocker.media.length === 0) return null;
  // One picture shows large; several show as a row of thumbnails.
  const single = images.length === 1;
  return (
    <Stack gap="xs">
      {videos.map((v) => (
        <video
          key={v.id}
          className="am-blocker-video"
          src={blockerMediaUrl(blocker.id, v.id)}
          controls
          preload="metadata"
          playsInline
          aria-label={v.name ?? 'Video of the blocker'}
        />
      ))}
      {images.length > 0 && (
        <Group gap="xs" wrap="wrap">
          {images.map((m) => (
            <UnstyledButton
              key={m.id}
              onClick={() => setOpen(m)}
              className="am-blocker-thumb"
              data-single={single || undefined}
              aria-label={`Open ${m.name ?? 'screenshot'} full size`}
            >
              <Image src={blockerMediaUrl(blocker.id, m.id)} alt={m.name ?? 'Screenshot of the blocker'} loading="lazy" fit="contain" h="100%" />
            </UnstyledButton>
          ))}
        </Group>
      )}
      <Modal opened={open !== null} onClose={() => setOpen(null)} size="auto" title={open?.name ?? 'Screenshot'} centered>
        {open && (
          <Stack gap="xs" align="center">
            <img className="am-blocker-full" src={blockerMediaUrl(blocker.id, open.id)} alt={open.name ?? 'Screenshot of the blocker'} />
            <Anchor href={blockerMediaUrl(blocker.id, open.id)} target="_blank" rel="noopener noreferrer" size="sm">
              Open in a new tab
            </Anchor>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}

function Details({ text }: { text: string }) {
  const long = text.length > FOLD_CHARS || text.split('\n').length > FOLD_LINES;
  const [expanded, setExpanded] = useState(false);
  return (
    <div>
      <Typography className="am-markdown am-blocker-details" data-folded={long && !expanded ? true : undefined} fz="sm">
        <Markdown remarkPlugins={[remarkGfm]} skipHtml>
          {text}
        </Markdown>
      </Typography>
      {long && (
        <Anchor component="button" type="button" size="xs" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
          {expanded ? 'Show less' : 'Show more'}
        </Anchor>
      )}
    </div>
  );
}

/** Whether the answer will reach the session now, in one line under the box. */
function DeliveryHint({ status }: { status: BlockerAgentStatus | undefined }) {
  if (status && status.noMessages === null) {
    return (
      <Group gap={4} wrap="nowrap">
        <IconMessageCircle size={14} color="var(--mantine-color-teal-text)" aria-hidden />
        <Text size="xs" c="dimmed">
          Your answer goes to the session as a message.
        </Text>
      </Group>
    );
  }
  const why = status?.noMessages ?? 'The agent is gone';
  return (
    <Tooltip label={why} multiline maw={320}>
      <Group gap={4} wrap="nowrap">
        <IconMessageCircleOff size={14} color="var(--mantine-color-dimmed)" aria-hidden />
        <Text size="xs" c="dimmed">
          The agent reads your answer when it checks the blocker.
        </Text>
      </Group>
    </Tooltip>
  );
}

interface BlockerCardProps {
  blocker: Blocker;
  agent: BlockerAgentStatus | undefined;
  highlighted: boolean;
  onAnswer: (blocker: Blocker, status: 'resolved' | 'dismissed', resolution: string) => Promise<boolean>;
}

export function BlockerCard({ blocker, agent, highlighted, onAnswer }: BlockerCardProps) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<'resolved' | 'dismissed' | null>(null);
  const who = blocker.project || blocker.agentName;

  async function answer(status: 'resolved' | 'dismissed') {
    if (busy) return;
    setBusy(status);
    const done = await onAnswer(blocker, status, text.trim());
    if (!done) setBusy(null);
  }

  return (
    <Paper
      withBorder
      p="md"
      radius="md"
      id={`blocker-${blocker.id}`}
      className="am-blocker"
      data-highlighted={highlighted || undefined}
      component="article"
      aria-label={`Blocker: ${blocker.title}`}
    >
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
          <Stack gap={2} miw={0}>
            <Group gap="xs" wrap="nowrap" miw={0}>
              <Anchor component={Link} to={agentPath(blocker.agentId)} fw={600} truncate="end">
                {who}
              </Anchor>
              {agent && (
                <Badge size="sm" variant="light" color={STATE_COLOR[agent.state]} tt="none" style={{ flexShrink: 0 }}>
                  {STATE_LABEL[agent.state]}
                </Badge>
              )}
            </Group>
            <Group gap="sm" wrap="wrap">
              <Tooltip label={blocker.agentId}>
                <Group gap={4} wrap="nowrap" miw={0}>
                  <IconHash size={13} color="var(--mantine-color-dimmed)" aria-hidden />
                  <Text size="xs" c="dimmed" truncate="end" maw={260}>
                    {blocker.agentName !== who ? `${blocker.agentName} · ` : ''}
                    {instanceId(blocker.agentId)}
                  </Text>
                </Group>
              </Tooltip>
              <Group gap={4} wrap="nowrap">
                <IconDeviceDesktop size={13} color="var(--mantine-color-dimmed)" aria-hidden />
                <Text size="xs" c="dimmed">
                  {blocker.machine}
                </Text>
              </Group>
            </Group>
          </Stack>
          <Stack gap={0} align="flex-end" style={{ flexShrink: 0 }}>
            <RelativeTime iso={blocker.createdAt} size="xs" fw={500} />
            <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
              {formatAbsolute(blocker.createdAt)}
            </Text>
          </Stack>
        </Group>

        <Title order={2} size="h4" style={{ overflowWrap: 'anywhere' }}>
          {blocker.title}
        </Title>

        <MediaStrip blocker={blocker} />
        {blocker.details && <Details text={blocker.details} />}

        <Stack gap={6}>
          <Textarea
            aria-label={`Your answer to: ${blocker.title}`}
            placeholder="Your answer: what you did, or what the agent should do. Ctrl+Enter resolves."
            autosize
            minRows={2}
            maxRows={10}
            maxLength={LIMITS.blockerResolutionLength}
            value={text}
            disabled={busy !== null}
            onChange={(e) => setText(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void answer('resolved');
              }
            }}
          />
          <Group justify="space-between" wrap="wrap" gap="xs">
            <DeliveryHint status={agent} />
            <Group gap="xs" wrap="nowrap" ml="auto">
              <Tooltip label="You won't act on it: the agent carries on without it">
                <Button
                  variant="default"
                  size="xs"
                  leftSection={<IconX size={14} />}
                  loading={busy === 'dismissed'}
                  disabled={busy === 'resolved'}
                  onClick={() => void answer('dismissed')}
                >
                  Dismiss
                </Button>
              </Tooltip>
              <Button
                size="xs"
                color="teal"
                leftSection={<IconCheck size={14} />}
                loading={busy === 'resolved'}
                disabled={busy === 'dismissed'}
                onClick={() => void answer('resolved')}
              >
                Resolve
              </Button>
            </Group>
          </Group>
        </Stack>
      </Stack>
    </Paper>
  );
}
