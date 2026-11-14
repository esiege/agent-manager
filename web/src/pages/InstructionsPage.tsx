// U-07: the instructions agents read, rendered from the same raw file they fetch (I-01).

import { INSTRUCTIONS_UPDATED, INSTRUCTIONS_VERSION } from '@agent-manager-delux/shared';
import { Anchor, Box, Button, CopyButton, Group, Paper, Text, Title, Tooltip, Typography, UnstyledButton } from '@mantine/core';
import { IconBook2, IconCheck, IconChevronDown, IconCopy, IconDownload, IconFileText } from '@tabler/icons-react';
import { createElement, useState, type ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CopyField, CopyIcon, CopyTextButton } from '../components/Copy';
import { PageHeader } from '../components/PageHeader';
import { LoadError, TableSkeleton } from '../components/States';
import { usePolling } from '../lib/usePolling';

const INSTRUCTIONS_PATH = '/instructions.md';
const AGENTCTL_PATH = '/agentctl.js';
const UPDATE_PATH = '/update.md';
const PERFORMANCE_PATH = '/performance.md';

async function loadInstructions(signal: AbortSignal): Promise<string> {
  let res: Response;
  try {
    res = await fetch(INSTRUCTIONS_PATH, { signal, headers: { Accept: 'text/markdown, text/plain' } });
  } catch (e) {
    if (signal.aborted) throw e;
    throw new Error("Can't reach Agent Manager Delux. Check your connection.");
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

/** The sentence with its link picked out. */
function highlightLinks(sentence: string): ReactNode[] {
  return sentence.split(/(https?:\/\/\S+)/).map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} className="am-sentence-url">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

interface SideItemProps {
  title: string;
  description: string;
  /** The sentence to send to an agent. */
  sentence: string;
  copyLabel: string;
  meta?: string;
  link: { href: string; label: string };
}

/** A less common sentence, kept small beside the main steps. */
function SideItem({ title, description, sentence, copyLabel, meta, link }: SideItemProps) {
  return (
    <div className="am-side-item">
      <Text size="sm" fw={600}>
        {title}
      </Text>
      <Text size="sm" c="dimmed">
        {description}
      </Text>
      <Group gap="sm" mt={6}>
        <Tooltip label={sentence} multiline maw={360}>
          <span>
            <CopyTextButton value={sentence} size="xs" variant="default">
              {copyLabel}
            </CopyTextButton>
          </span>
        </Tooltip>
        <Anchor href={link.href} target="_blank" rel="noopener" size="xs">
          {link.label}
        </Anchor>
      </Group>
      {meta && (
        <Text size="xs" c="dimmed" mt={2}>
          {meta}
        </Text>
      )}
    </div>
  );
}

export function InstructionsPage() {
  const { data, error, refresh } = usePolling('instructions', loadInstructions, { intervalMs: null });
  // Hidden until asked for. A link to a heading in the instructions opens them.
  const [showFull, setShowFull] = useState(() => window.location.hash.length > 1);
  const instructionsUrl = `${window.location.origin}${INSTRUCTIONS_PATH}`;
  const sentence = `Read ${instructionsUrl} and set yourself up to report to Agent Manager Delux.`;
  const updateSentence = `Read ${window.location.origin}${UPDATE_PATH} (updated ${INSTRUCTIONS_UPDATED}) and update this PC's Agent Manager Delux reporting if it isn't on the latest.`;

  const performanceSentence = `Read ${window.location.origin}${PERFORMANCE_PATH} and add performance reporting to this game, so its sessions show up in Agent Manager Delux.`;

  return (
    <>
      <PageHeader title="Agent Instructions" />

      <div className="am-start">
        <ol className="am-steps">
          <li className="am-step">
            <div className="am-step-label">Step 1</div>
            <h2 className="am-step-title">Copy this sentence</h2>
            <CopyButton value={sentence} timeout={2000}>
              {({ copied, copy }) => (
                <>
                  {/* Clicking the sentence copies it too; the button is the keyboard way. */}
                  <div className="am-sentence" data-copied={copied || undefined} onClick={copy} title="Click to copy">
                    {highlightLinks(sentence)}
                  </div>
                  <Button
                    onClick={copy}
                    color={copied ? 'teal' : undefined}
                    leftSection={copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                  >
                    {copied ? 'Copied' : 'Copy sentence'}
                  </Button>
                </>
              )}
            </CopyButton>
          </li>
          <li className="am-step">
            <div className="am-step-label">Step 2</div>
            <h2 className="am-step-title">Send it to your agent</h2>
            <p className="am-step-desc">That's it. The agent sets itself up and appears on the Agents tab.</p>
          </li>
        </ol>

        <aside className="am-side">
          <SideItem
            title="Already set up?"
            description="Update a PC whose agents are marked “old version” by sending its agent the update sentence."
            sentence={updateSentence}
            copyLabel="Copy update sentence"
            meta={`Latest: version ${INSTRUCTIONS_VERSION}, ${INSTRUCTIONS_UPDATED}`}
            link={{ href: UPDATE_PATH, label: 'Open update page' }}
          />
          <SideItem
            title="Building a game?"
            description="Adds performance reporting to the game, so its frame rate, frame times and memory show up on the Game tab for every machine it runs on, and you can compare builds and GPUs."
            sentence={performanceSentence}
            copyLabel="Copy performance sentence"
            link={{ href: PERFORMANCE_PATH, label: 'Open performance page' }}
          />
        </aside>
      </div>

      {!showFull ? (
        // Stands in for the panel until it's opened; once open it stays open.
        <UnstyledButton className="am-full-reveal" onClick={() => setShowFull(true)}>
          <IconBook2 size={22} stroke={1.75} aria-hidden />
          <span className="am-full-reveal-text">
            <span className="am-full-reveal-title">Show Full Agent Instructions</span>
            <span className="am-full-reveal-desc">Everything an agent reads when you send it the sentence.</span>
          </span>
          <IconChevronDown className="am-full-reveal-chevron" size={20} aria-hidden />
        </UnstyledButton>
      ) : (
        <Paper withBorder radius="lg">
          <div className="am-full-head">
            <Group justify="space-between" align="center" gap="sm" wrap="wrap">
              <Title order={2} size="h4">
                Full instructions
              </Title>
              <Group gap="sm" wrap="wrap">
                <Button
                  component="a"
                  href={INSTRUCTIONS_PATH}
                  target="_blank"
                  rel="noopener"
                  variant="subtle"
                  color="gray"
                  size="xs"
                  leftSection={<IconFileText size={14} />}
                >
                  Open raw file
                </Button>
                <Button
                  component="a"
                  href={AGENTCTL_PATH}
                  download="agentctl.js"
                  variant="subtle"
                  color="gray"
                  size="xs"
                  leftSection={<IconDownload size={14} />}
                >
                  Download agentctl.js
                </Button>
              </Group>
            </Group>
            <Text size="sm" c="dimmed" mt={4} mb="xs">
              For agent instructions, give your agent this link, or copy all of the text below.
            </Text>
            <Group gap="sm" wrap="wrap" align="center">
              <Box maw={520} miw={0} style={{ flex: '1 1 260px' }}>
                <CopyField value={instructionsUrl} label="Copy link" />
              </Box>
              <CopyTextButton value={data ?? ''} disabled={data === undefined} size="xs" variant="default">
                Copy all text
              </CopyTextButton>
            </Group>
          </div>
          <div className="am-full-body">
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
          </div>
        </Paper>
      )}
    </>
  );
}
