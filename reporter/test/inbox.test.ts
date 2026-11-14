import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentMessage } from '@agent-manager-deluxe/shared';
import { deliverMessage, formatMessage, nextInbox, postToSession } from '../src/inbox';
import type { InboxRecord } from '../src/sessions';

const ENV = { CLAUDE_CODE_MESSAGING_SOCKET: '\\\\.\\pipe\\cc-test', CLAUDE_CODE_MESSAGING_TOKEN: 'tok' };
const INBOX: InboxRecord = { socket: ENV.CLAUDE_CODE_MESSAGING_SOCKET, token: 'tok', permissionMode: 'default' };

const message: AgentMessage = {
  id: 'm1',
  agentId: 'pc/claude/s1',
  machine: 'pc',
  keyName: 'pc',
  text: 'Run the tests',
  from: 'owner',
  createdAt: '2026-10-11T12:00:00.000Z',
  expiresAt: '2026-10-11T12:10:00.000Z',
  status: 'pending',
  doneAt: null,
  reason: null,
};

describe('nextInbox', () => {
  it('saves the address and token Claude Code exported, only when messages are on', () => {
    expect(nextInbox(true, 'SessionStart', 'default', ENV, null)).toEqual(INBOX);
    expect(nextInbox(false, 'SessionStart', 'default', ENV, null)).toBeUndefined();
    expect(nextInbox(true, 'SessionStart', 'default', {}, null)).toBeUndefined();
  });

  it('rewrites only on a change, and keeps the last known permission mode', () => {
    expect(nextInbox(true, 'PreToolUse', 'default', ENV, INBOX)).toBeUndefined();
    expect(nextInbox(true, 'PreToolUse', undefined, ENV, INBOX)).toBeUndefined();
    expect(nextInbox(true, 'PreToolUse', 'bypassPermissions', ENV, INBOX)).toEqual({ ...INBOX, permissionMode: 'bypassPermissions' });
  });

  it('forgets the token when the session ends or messages are turned off', () => {
    expect(nextInbox(true, 'SessionEnd', 'default', ENV, INBOX)).toBeNull();
    expect(nextInbox(false, 'PreToolUse', 'default', ENV, INBOX)).toBeNull();
  });
});

describe('deliverMessage', () => {
  const sent: string[] = [];
  const send = async (_inbox: InboxRecord, text: string) => {
    sent.push(text);
  };

  it('posts the text with who sent it, and acks it as delivered', async () => {
    expect(await deliverMessage(message, INBOX, 'pc', send)).toEqual({ id: 'm1', machine: 'pc', status: 'delivered' });
    expect(sent.at(-1)).toBe('Run the tests\n\n(Sent from Agent Manager Deluxe by owner)');
    expect(formatMessage(message)).toBe(sent.at(-1));
  });

  it('refuses sessions that skip permission prompts, and ones it has no inbox for', async () => {
    const before = sent.length;
    const bypass = await deliverMessage(message, { ...INBOX, permissionMode: 'bypassPermissions' }, 'pc', send);
    expect(bypass).toMatchObject({ status: 'failed', reason: expect.stringContaining('skips permission prompts') });
    expect((await deliverMessage(message, undefined, 'pc', send)).status).toBe('failed');
    expect(sent.length).toBe(before);
  });

  it('reports a pipe error as the reason', async () => {
    const ack = await deliverMessage(message, INBOX, 'pc', async () => {
      throw new Error("Couldn't reach the session's inbox: ENOENT");
    });
    expect(ack).toEqual({ id: 'm1', machine: 'pc', status: 'failed', reason: "Couldn't reach the session's inbox: ENOENT" });
  });
});

describe('postToSession', () => {
  let server: Server | undefined;
  afterEach(() => server?.close());

  const address =
    process.platform === 'win32' ? `\\\\.\\pipe\\agentctl-test-${process.pid}-${Date.now()}` : join(tmpdir(), `agentctl-${process.pid}-${Date.now()}.sock`);

  it('writes the auth line, then the message as a user line', async () => {
    const received = new Promise<string>((resolve) => {
      server = createServer((conn) => {
        let data = '';
        conn.on('data', (d) => (data += d.toString()));
        conn.on('end', () => resolve(data));
      });
    });
    await new Promise<void>((r) => server!.listen(address, r));

    await postToSession({ ...INBOX, socket: address }, 'hello\nworld');
    const lines = (await received).split('\n');
    expect(JSON.parse(lines[0]!)).toEqual({ type: 'auth', token: 'tok' });
    expect(JSON.parse(lines[1]!)).toEqual({ type: 'user', message: { role: 'user', content: 'hello\nworld' } });
    expect(lines[2]).toBe('');
  });

  it('fails with a reason when nothing is listening', async () => {
    await expect(postToSession({ ...INBOX, socket: `${address}-missing` }, 'hi', 1000)).rejects.toThrow("Couldn't reach the session's inbox");
  });
});
