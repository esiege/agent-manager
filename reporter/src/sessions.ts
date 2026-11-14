// What agentctl remembers about each Claude Code session on this PC, one folder per session:
//   sessions/<sessionId>/session.json       written at start and end (rare, so no write races)
//   sessions/<sessionId>/sub-<agentId>.json one file per running sub-agent
//   sessions/<sessionId>/send-<key>.json    coalescing state for one agent's activity reports
//   sessions/<sessionId>/context.json       the story and task pinned by agentctl, and the current todo
//   sessions/<sessionId>/inbox.json         the session's inbox address and token, only while messages are on

import type { WorkType } from '@agent-manager-deluxe/shared';
import { existsSync, readdirSync, rmSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { readJsonFile, writeJsonFile } from './files';
import { paths } from './paths';

export interface SessionRecord {
  sessionId: string;
  agentId: string;
  name: string;
  project: string;
  cwd: string;
  /** The Claude Code process, used by the heartbeat to notice closed windows. */
  pid: number | null;
  startedAt: string;
  endedAt: string | null;
  details: Record<string, unknown>;
}

export interface SubagentRecord {
  agentId: string;
  subagentId: string;
  agentType: string;
  startedAt: string;
}

/** What the session is on beyond what each hook event says (see context.ts). */
export interface SessionContext {
  /** Set by `agentctl story`; wins over the story worked out from the branch and title. */
  story?: string;
  /** Set by `agentctl task`; wins until the person's next prompt. */
  task?: string;
  /** The in-progress item of the agent's todo list, if it keeps one. */
  todo?: string;
  /** HEAD when the current request started. */
  headAtPrompt?: string;
  /** True once this request's finished work was reported. */
  reported?: boolean;
  /** Set by `agentctl story --type`: the kind of work, for the Reporting tab. */
  workType?: WorkType;
  /** The transcript whose tokens are counted, and how far (bytes) they have been. */
  usagePath?: string;
  usageOffset?: number;
}

/**
 * Where to post a message into the session (inbox.ts). The token lets anything holding it act as
 * the session itself, so it stays in this file on this PC and is never sent anywhere.
 */
export interface InboxRecord {
  /** CLAUDE_CODE_MESSAGING_SOCKET: a named pipe on Windows. */
  socket: string;
  /** CLAUDE_CODE_MESSAGING_TOKEN. */
  token: string;
  /** The session's latest permission mode, from its hook events. */
  permissionMode: string | null;
}

export interface SendState {
  lastSentAt: number;
  /** Marks the newest activity report waiting for the coalescing window to close. */
  pendingSeq: string;
}

// Session and sub-agent ids come from Claude Code; keep them to safe file-name characters anyway.
const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, '_');

const dirOf = (sessionId: string) => join(paths.sessions(), safe(sessionId));
const sessionFile = (sessionId: string) => join(dirOf(sessionId), 'session.json');
const subFile = (sessionId: string, subId: string) => join(dirOf(sessionId), `sub-${safe(subId)}.json`);
const contextFile = (sessionId: string) => join(dirOf(sessionId), 'context.json');
const inboxFile = (sessionId: string) => join(dirOf(sessionId), 'inbox.json');
const sendFile = (sessionId: string, agentId: string) =>
  join(dirOf(sessionId), `send-${safe(agentId.split('/').pop() ?? 'main')}.json`);

export function readSession(sessionId: string): SessionRecord | null {
  return readJsonFile<SessionRecord>(sessionFile(sessionId));
}

export function writeSession(s: SessionRecord) {
  writeJsonFile(sessionFile(s.sessionId), s);
}

export function listSessions(): SessionRecord[] {
  if (!existsSync(paths.sessions())) return [];
  return readdirSync(paths.sessions())
    .map((d) => readJsonFile<SessionRecord>(join(paths.sessions(), d, 'session.json')))
    .filter((s): s is SessionRecord => s !== null);
}

export function addSubagent(sessionId: string, sub: SubagentRecord) {
  writeJsonFile(subFile(sessionId, sub.subagentId), sub);
}

export function removeSubagent(sessionId: string, subId: string) {
  try {
    unlinkSync(subFile(sessionId, subId));
  } catch {
    // Already gone.
  }
}

export function listSubagents(sessionId: string): SubagentRecord[] {
  const dir = dirOf(sessionId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith('sub-'))
    .map((f) => readJsonFile<SubagentRecord>(join(dir, f)))
    .filter((s): s is SubagentRecord => s !== null);
}

export function readContext(sessionId: string): SessionContext {
  return readJsonFile<SessionContext>(contextFile(sessionId)) ?? {};
}

export function writeContext(sessionId: string, context: SessionContext) {
  writeJsonFile(contextFile(sessionId), context);
}

export function readInbox(sessionId: string): InboxRecord | null {
  return readJsonFile<InboxRecord>(inboxFile(sessionId));
}

export function writeInbox(sessionId: string, inbox: InboxRecord) {
  writeJsonFile(inboxFile(sessionId), inbox);
}

export function removeInbox(sessionId: string) {
  if (!existsSync(inboxFile(sessionId))) return;
  try {
    unlinkSync(inboxFile(sessionId));
  } catch {
    // Already gone.
  }
}

export function readSendState(sessionId: string, agentId: string): SendState {
  return readJsonFile<SendState>(sendFile(sessionId, agentId)) ?? { lastSentAt: 0, pendingSeq: '' };
}

export function writeSendState(sessionId: string, agentId: string, state: SendState) {
  writeJsonFile(sendFile(sessionId, agentId), state);
}

/** Deletes the folders of sessions that ended more than `days` ago. */
export function pruneSessions(days: number) {
  if (!existsSync(paths.sessions())) return;
  const cutoff = Date.now() - days * 86_400_000;
  for (const d of readdirSync(paths.sessions())) {
    const dir = join(paths.sessions(), d);
    const s = readJsonFile<SessionRecord>(join(dir, 'session.json'));
    const ended = s?.endedAt ? Date.parse(s.endedAt) : null;
    const orphan = !s && statSync(dir).mtimeMs < cutoff;
    if ((ended !== null && ended < cutoff) || orphan) rmSync(dir, { recursive: true, force: true });
  }
}
