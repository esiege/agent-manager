// The machine heartbeat (C-05). One background process per PC, started by the hooks when a
// session starts, and gone again 10 minutes after the last session ends. Every 60 s it checks
// which Claude Code processes are still alive and tells Agent Manager Deluxe. With messages on, it also
// collects the owner's messages every 5 s and posts them into their sessions (inbox.ts).

import { spawn } from 'node:child_process';
import { closeSync, openSync, unlinkSync, writeSync } from 'node:fs';
import { INSTRUCTIONS_VERSION, type HeartbeatResponse, type ReportInput } from '@agent-manager-deluxe/shared';
import { loadConfig, type Config } from './config';
import { logLine, readJsonFile, writeJsonFile } from './files';
import { subagentAgentId } from './hook';
import { checkInbox } from './inbox';
import { paths } from './paths';
import { isAlive } from './proc';
import { post } from './send';
import { listSessions, listSubagents, pruneSessions, removeSubagent, writeSession, type SessionRecord } from './sessions';

const BEAT_MS = 60_000;
/** How often it asks for messages from the owner, when they're on (inbox.ts). */
const INBOX_MS = 5_000;
const EXIT_AFTER_IDLE_MS = 10 * 60_000;
const STALE_BEAT_MS = 3 * 60_000;

interface DaemonState {
  pid: number;
  beatAt: string;
}

/** Starts the heartbeat in the background unless one is already beating. Cheap: hooks call it. */
export function ensureDaemon(scriptPath: string) {
  const d = readJsonFile<DaemonState>(paths.daemon());
  if (d && isAlive(d.pid) && Date.now() - Date.parse(d.beatAt) < STALE_BEAT_MS) return;
  spawn(process.execPath, [scriptPath, 'daemon'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

/** Takes the single-instance lock, replacing a stale one. False when another heartbeat is running. */
function takeLock(): boolean {
  const lock = `${paths.daemon()}.lock`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(lock, 'wx');
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return true;
    } catch {
      const holder = readJsonFile<number>(lock);
      if (typeof holder === 'number' && holder !== process.pid && isAlive(holder)) return false;
      try {
        unlinkSync(lock);
      } catch {
        return false;
      }
    }
  }
  return false;
}

function releaseLock() {
  try {
    unlinkSync(`${paths.daemon()}.lock`);
  } catch {
    // Already gone.
  }
}

function fullReport(config: Config, s: SessionRecord, state: ReportInput['state'], activity: string): ReportInput {
  return {
    agentId: s.agentId,
    kind: 'claude-code',
    machine: config.machine,
    name: s.name,
    project: s.project,
    parentId: null,
    details: s.details,
    instructionsVersion: INSTRUCTIONS_VERSION,
    state,
    activity,
  };
}

/** One beat: notice closed windows, then send the list of live sessions. */
export async function beat(config: Config): Promise<number> {
  const now = new Date().toISOString();
  const live: SessionRecord[] = [];
  for (const s of listSessions()) {
    if (s.endedAt) continue;
    if (s.pid !== null && !isAlive(s.pid)) {
      // The window closed without a SessionEnd hook.
      writeSession({ ...s, endedAt: now });
      for (const sub of listSubagents(s.sessionId)) removeSubagent(s.sessionId, sub.subagentId);
      await post(config, '/report', fullReport(config, s, 'stopped', 'Window closed')).catch((e: Error) =>
        logLine(`heartbeat: could not report ${s.agentId} closed: ${e.message}`),
      );
      continue;
    }
    live.push(s);
  }

  const agentIds = live.flatMap((s) => [s.agentId, ...listSubagents(s.sessionId).map((sub) => subagentAgentId(s, sub.subagentId))]);
  const res = await post<HeartbeatResponse>(config, '/heartbeat', { machine: config.machine, kind: 'claude-code', agentIds });

  // Sessions the manager has never heard of (its first report failed, or it started before
  // agentctl was installed): send everything about them now.
  for (const id of res.stored.unknown) {
    const s = live.find((x) => x.agentId === id);
    if (s) await post(config, '/report', fullReport(config, s, 'idle', 'Reconnected')).catch((e: Error) => logLine(`heartbeat: ${e.message}`));
  }
  return live.length;
}

export async function runDaemon(): Promise<void> {
  if (!takeLock()) return;
  process.on('exit', releaseLock);
  logLine('heartbeat started');

  let idleSince: number | null = null;
  let lastPrune = 0;
  for (;;) {
    writeJsonFile(paths.daemon(), { pid: process.pid, beatAt: new Date().toISOString() } satisfies DaemonState);
    try {
      const live = await beat(loadConfig());
      idleSince = live > 0 ? null : (idleSince ?? Date.now());
    } catch (e) {
      logLine(`heartbeat: ${(e as Error).message}`);
    }
    if (Date.now() - lastPrune > 3_600_000) {
      pruneSessions(2);
      lastPrune = Date.now();
    }
    if (idleSince !== null && Date.now() - idleSince > EXIT_AFTER_IDLE_MS) {
      logLine('heartbeat stopping: no live sessions for 10 minutes');
      return;
    }
    await untilNextBeat();
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

/** Waits for the next beat. With messages on, it checks for them every few seconds meanwhile. */
async function untilNextBeat() {
  const next = Date.now() + BEAT_MS;
  while (Date.now() < next) {
    let config: Config | null = null;
    try {
      config = loadConfig();
    } catch {
      // The beat logs a broken config.
    }
    if (!config?.messages) return sleep(next - Date.now());
    await sleep(Math.min(INBOX_MS, next - Date.now()));
    await checkInbox(config).catch((e: Error) => logLine(`inbox: ${e.message}`));
  }
}
