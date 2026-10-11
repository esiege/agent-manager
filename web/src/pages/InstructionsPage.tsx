// U-07: the instructions agents read, rendered from the same raw file they fetch (I-01).

import { INSTRUCTIONS_UPDATED, INSTRUCTIONS_VERSION } from '@agent-manager/shared';
import { Anchor, Box, Button, Code, Group, Paper, Stack, Text, Typography } from '@mantine/core';
import { IconDownload, IconFileText } from '@tabler/icons-react';
import { createElement, type ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CopyIcon, CopyTextButton } from '../components/Copy';
import { PageHeader } from '../components/PageHeader';
import { LoadError, TableSkeleton } from '../components/States';
import { usePolling } from '../lib/usePolling';

const INSTRUCTIONS_PATH = '/instructions.md';
const AGENTCTL_PATH = '/agentctl.js';
const UPDATE_PATH = '/update.md';

async function loadInstructions(signal: AbortSignal): Promise<string> {
  let res: Response;
  try {
    res = await fetch(INSTRUCTIONS_PATH, { signal, headers: { Accept: 'text/markdown, text/plain' } });
  } catch (e) {
    if (signal.aborted) throw e;
    throw new Error("Can't reach Agent Manager. Check your connection.");
  }
  // A missing file can come back as the app's own HTML page.
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || type.includes('text/html')) {
    throw new Error(`${INSTRUCTIONS_PATH} isn't available (${res.ok ? 'got a web page instead' : res.status}).`);
  }
  return res.text();
}

/** The plain text of a Markdown syntax-tree node. */
function textOf(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as { type?: unknown; value?: unknown; children?: unknown };
  if (n.type === 'text' && typeof n.value === 'string') return n.value;
  return Array.isArray(n.children) ? n.children.map(textOf).join('') : '';
}

/** Heading anchors in the usual Markdown style, so links like #claude-code work. */
function slug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-');
}

function heading(tag: 'h1' | 'h2' | 'h3' | 'h4') {
  return function Heading({ node, children }: { node?: unknown; children?: ReactNode }) {
    return createElement(tag, { id: slug(textOf(node)) }, children);
  };
}

const components: Components = {
  // Every code block gets a copy button (U-06).
  pre({ node, children }) {
    const text = textOf(node).replace(/\n$/, '');
    return (
      <div className="am-code-block">
        <pre>{children}</pre>
        <div className="am-code-copy">
          <CopyIcon value={text} label="Copy code" />
        </div>
      </div>
    );
  },
  a({ href, children }) {
    const external = !!href && /^https?:\/\//i.test(href) && !href.startsWith(window.location.origin);
    return (
      <Anchor href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
        {children}
      </Anchor>
    );
  },
  h1: heading('h1'),
  h2: heading('h2'),
  h3: heading('h3'),
  h4: heading('h4'),
};

export function InstructionsPage() {
  const { data, error, refresh } = usePolling('instructions', loadInstructions, { intervalMs: null });
  const sentence = `Read ${window.location.origin}${INSTRUCTIONS_PATH} and set yourself up to report to Agent Manager.`;
  const updateSentence = `Read ${window.location.origin}${UPDATE_PATH} (updated ${INSTRUCTIONS_UPDATED}) and update this PC's Agent Manager reporting if it isn't on the latest.`;

  return (
    <>
      <PageHeader title="Instructions">
        <Button
          component="a"
          href={INSTRUCTIONS_PATH}
          target="_blank"
          rel="noopener"
          variant="default"
          size="xs"
          leftSection={<IconFileText size={14} />}
        >
          Open raw file
        </Button>
        <Button component="a" href={AGENTCTL_PATH} download="agentctl.js" variant="default" size="xs" leftSection={<IconDownload size={14} />}>
          Download agentctl.js
        </Button>
      </PageHeader>

      <Paper withBorder p="md" radius="md" mb="lg">
        <Stack gap="xs">
          <Text size="sm">To set up an agent, send it this sentence:</Text>
          <Code block style={{ whiteSpace: 'pre-wrap' }}>
            {sentence}
          </Code>
          <Group>
            <CopyTextButton value={sentence} size="sm">
              Copy onboarding sentence
            </CopyTextButton>
          </Group>
        </Stack>
      </Paper>

      <Paper withBorder p="md" radius="md" mb="lg">
        <Stack gap="xs">
          <Group gap="xs" justify="space-between">
            <Text size="sm">
              To update a PC that's already set up (agents marked &ldquo;old setup&rdquo;), send its agent this sentence:
            </Text>
            <Anchor href={UPDATE_PATH} target="_blank" rel="noopener" size="sm">
              Open update page
            </Anchor>
          </Group>
          <Code block style={{ whiteSpace: 'pre-wrap' }}>
            {updateSentence}
          </Code>
          <Group>
            <CopyTextButton value={updateSentence} size="sm">
              Copy update sentence
            </CopyTextButton>
            <Text size="xs" c="dimmed">
              Latest: version {INSTRUCTIONS_VERSION}, {INSTRUCTIONS_UPDATED}
            </Text>
          </Group>
        </Stack>
      </Paper>

      {data === undefined ? (
        error ? (
          <LoadError message={error.message} onRetry={refresh} />
        ) : (
          <TableSkeleton rows={10} />
        )
      ) : (
        <Box maw={900}>
          <Typography className="am-markdown">
            <Markdown remarkPlugins={[remarkGfm]} components={components}>
              {data}
            </Markdown>
          </Typography>
        </Box>
      )}
    </>
  );
}
