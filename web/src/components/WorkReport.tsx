// The report of finished work: its name (the commit's subject, linked to the commit), what was
// asked, what was done, and what the owner should see now. Loaded on demand: it brings Markdown.

import type { WorkResult } from '@agent-manager-delux/shared';
import { Anchor, Badge, Blockquote, Checkbox, Group, Paper, Stack, Text, Title, Tooltip, Typography } from '@mantine/core';
import { IconCircleCheck, IconExternalLink, IconGitCommit } from '@tabler/icons-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { safeHref } from '../lib/labels';
import { formatAbsolute } from '../lib/time';
import { CopyIcon } from './Copy';
import { RelativeTime } from './Time';

export function WorkReport({ result }: { result: WorkResult }) {
  const commitHref = safeHref(result.commitUrl);
  return (
    <Paper withBorder p="md" radius="md" style={{ borderLeft: '4px solid var(--mantine-color-teal-filled)' }}>
      <Stack gap="sm">
        <Group gap="xs" wrap="nowrap" align="flex-start">
          <IconCircleCheck size={22} color="var(--mantine-color-teal-filled)" style={{ flexShrink: 0, marginTop: 2 }} aria-hidden />
          <Stack gap={2} miw={0} style={{ flex: 1 }}>
            <Title order={3} size="h4" style={{ overflowWrap: 'anywhere' }}>
              {commitHref ? (
                <Anchor href={commitHref} target="_blank" rel="noopener noreferrer" inherit>
                  {result.title} <IconExternalLink size={14} style={{ verticalAlign: 'middle' }} />
                </Anchor>
              ) : (
                result.title
              )}
            </Title>
            <Group gap="xs" wrap="wrap">
              <Tooltip label={formatAbsolute(result.at)}>
                <Text size="xs" c="dimmed">
                  Finished <RelativeTime iso={result.at} />
                </Text>
              </Tooltip>
              {result.commit && (
                <Group gap={2} wrap="nowrap">
                  <IconGitCommit size={14} color="var(--mantine-color-dimmed)" aria-hidden />
                  <Text size="xs" ff="monospace" c="dimmed">
                    {result.commit.slice(0, 7)}
                  </Text>
                  <CopyIcon value={result.commit} label="Copy commit id" size="xs" />
                </Group>
              )}
              {result.branch && (
                <Text size="xs" c="dimmed">
                  on {result.branch}
                </Text>
              )}
              {result.commit && result.pushed === false && (
                <Tooltip label="The commit link works once it's pushed.">
                  <Badge color="yellow" variant="light" size="sm" radius="sm" tt="none">
                    not pushed
                  </Badge>
                </Tooltip>
              )}
              {!result.commit && (
                <Badge color="gray" variant="light" size="sm" radius="sm" tt="none">
                  no commit
                </Badge>
              )}
            </Group>
          </Stack>
        </Group>

        {result.prompt && (
          <div>
            <Text size="xs" c="dimmed" mb={4}>
              You asked
            </Text>
            <Blockquote p="xs" radius="sm" color="gray" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 'var(--mantine-font-size-sm)' }}>
              {result.prompt}
            </Blockquote>
          </div>
        )}

        <div>
          <Text size="xs" c="dimmed" mb={4}>
            What was done
          </Text>
          <Typography className="am-markdown" fz="sm" style={{ overflowWrap: 'anywhere' }}>
            <Markdown remarkPlugins={[remarkGfm]} skipHtml>
              {result.summary}
            </Markdown>
          </Typography>
        </div>

        {result.checks.length > 0 && (
          <div>
            <Text size="xs" c="dimmed" mb={6}>
              What you should see now
            </Text>
            {/* Ticking is just for the owner while they check; it isn't saved. */}
            <Stack gap={6}>
              {result.checks.map((check, i) => (
                <Checkbox key={i} size="sm" label={check} styles={{ label: { overflowWrap: 'anywhere' } }} />
              ))}
            </Stack>
          </div>
        )}
      </Stack>
    </Paper>
  );
}
