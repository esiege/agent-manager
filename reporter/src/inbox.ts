// Messages the owner sends from an agent's page in Agent Manager Deluxe (Docs/Agent-Messaging-Findings.md).
// Off unless `agentctl install --allow-messages`. When on:
//   - the hooks keep each session's inbox address and token in sessions/<id>/inbox.json, on this PC only;
//   - the heartbeat asks Agent Manager Deluxe for waiting messages every few seconds and posts each one into
//     its session's inbox (a named pipe on Windows), the same two lines Claude Code's own recipe writes.
// Claude Code treats a post carrying the session's token as coming from the session itself, so a
// session that skips permission prompts never gets one.

import { connect } from 'node:net';
import type { AgentMessage, InboxResponse, MessageAckInput } from '@agent-manager-deluxe/shared';
import type { Config } from './config';
import { logLine } from './files';
import { isAlive } from './proc';
import { post } from './send';
import { listSessions, readInbox, removeInbox, writeInbox, type InboxRecord } from './sessions';

const POST_TIMEOUT_MS = 5000;
const BYPASS = 'bypassPermissions';

/** What inbox.json should hold after a hook event: null to remove it, undefined to leave it alone. */
export function nextInbox(
  enabled: boolean,
  event: string,
  permissionMode: string | undefined,
  env: Record<string, string | undefined>,
  current: InboxRecord | null,
): InboxRecord | null | undefined {
  if (!enabled || event === 'SessionEnd') return current ? null : undefined;
  const socket = env.CLAUDE_CODE_MESSAGING_SOCKET;
  const token = env.CLAUDE_CODE_MESSAGING_TOKEN;
  if (!socket || !token) return undefined; // a Claude Code without messaging
  const next: InboxRecord = { socket, token, permissionMode: permissionMode ?? current?.permissionMode ?? null };
  const same = current && current.socket === next.socket && current.token === next.token && current.permissionMode === next.permissionMode;
  return same ? undefined : next;
}

/** Called by every hook: keeps the session's inbox.json in step with what Claude Code exported. */
export function syncInbox(config: Config, sessionId: string, event: string, permissionMode: string | undefined) {
  const next = nextInbox(config.messages === true, event, permissionMode, process.env, readInbox(sessionId));
  if (next === null) removeInbox(sessionId);
  else if (next) writeInbox(sessionId, next);
}

/** The text the session sees: the owner's words, then where they came from. */
export function formatMessage(m: Pick<AgentMessage, 'text' | 'from'>): string {
  return `${m.text}\n\n(Sent from Agent Manager Deluxe by ${m.from})`;
}

/**
 * Posts one message into a session's inbox: an auth line with the session's token, then the
 * message as a user line. Claude Code doesn't answer; it closes the connection, and drops the
 * message without saying so if the token is wrong.
 */
export function postToSession(inbox: InboxRecord, text: string, timeoutMs = POST_TIMEOUT_MS): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect(inbox.socket);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`The session's inbox didn't take the message within ${timeoutMs} ms`));
    }, timeoutMs);
    socket.on('connect', () => {
      const auth = JSON.stringify({ type: 'auth', token: inbox.token });
      const message = JSON.stringify({ type: 'user', message: { role: 'user', content: text } });
      socket.end(`${auth}\n${message}\n`);
    });
    socket.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`Couldn't reach the session's inbox: ${e.message}`));
    });
    socket.on('close', (hadError) => {
      clearTimeout(timer);
      if (!hadError) resolve();
    });
    socket.resume(); // nothing is expected back; don't let anything pile up
  });
}

/** Tries one message and says what happened, in the form Agent Manager Deluxe's ack takes. */
export async function deliverMessage(
  m: AgentMessage,
  inbox: InboxRecord | undefined,
  machine: string,
  send: (inbox: InboxRecord, text: string) => Promise<void> = postToSession,
): Promise<MessageAckInput> {
  const failed = (reason: string): MessageAckInput => ({ id: m.id, machine, status: 'failed', reason });
  if (!inbox) return failed('The session isn’t open on this PC, or hasn’t run a hook since messages were turned on');
  if (inbox.permissionMode === BYPASS) return failed('The session skips permission prompts, so agentctl won’t post into it');
  try {
    await send(inbox, formatMessage(m));
  } catch (e) {
    return failed((e as Error).message);
  }
  return { id: m.id, machine, status: 'delivered' };
}

// Acks Agent Manager Deluxe hasn't confirmed yet. The message stays pending there, so the next check
// sees it again and resends the ack rather than posting the message twice.
const unacked = new Map<string, MessageAckInput>();

/** One check: collect waiting messages for the open sessions here, post them, acknowledge them. */
export async function checkInbox(config: Config): Promise<void> {
  const inboxes = new Map<string, InboxRecord>();
  for (const s of listSessions()) {
    if (s.endedAt || (s.pid !== null && !isAlive(s.pid))) continue;
    const inbox = readInbox(s.sessionId);
    if (inbox) inboxes.set(s.agentId, inbox);
  }
  if (inboxes.size === 0) return; // nothing here can take a message

  const { messages } = await post<InboxResponse>(config, '/inbox', { machine: config.machine });
  for (const id of unacked.keys()) if (!messages.some((m) => m.id === id)) unacked.delete(id);
  for (const m of messages) {
    let ack = unacked.get(m.id);
    if (!ack) {
      ack = await deliverMessage(m, inboxes.get(m.agentId), config.machine);
      logLine(`inbox: message ${m.id} for ${m.agentId}: ${ack.status}${ack.reason ? ` (${ack.reason})` : ''}`);
      unacked.set(m.id, ack);
    }
    try {
      await post(config, '/inbox/ack', ack);
      unacked.delete(m.id);
    } catch (e) {
      logLine(`inbox: could not acknowledge ${m.id}: ${(e as Error).message}`);
    }
  }
}

/** For `agentctl uninstall` and when messages are turned off: forget every session's token. */
export function removeAllInboxes() {
  for (const s of listSessions()) removeInbox(s.sessionId);
}
