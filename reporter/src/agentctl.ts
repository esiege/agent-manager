// agentctl: reports the Claude Code sessions on this PC to Agent Manager.
// One file, Node built-ins only. See `agentctl help`.

import { execFileSync } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { INSTRUCTIONS_VERSION, REPORTED_STATES, type ReportInput, type ReportResponse, type ReportedState } from '@agent-manager/shared';
import { ConfigError, defaultMachineName, loadConfig, type Config } from './config';
import { ensureDaemon, runDaemon } from './daemon';
import { logLine, readJsonFile, writeJsonFile } from './files';
import { projectName, findRepoRoot, readBranch } from './git';
import { planHook, type HookInput, type PlannedReport } from './hook';
import { paths } from './paths';
import { ancestors, isAlive } from './proc';
import { post, SendError } from './send';
import {
  addSubagent,
  listSessions,
  listSubagents,
  readSendState,
  readSession,
  removeSubagent,
  writeSendState,
  writeSession,
} from './sessions';
import { hasAgentctlHooks, withAgentctlHooks, withoutAgentctlHooks } from './settings';

const HELP = `agentctl: reports the Claude Code sessions on this PC to Agent Manager.

  agentctl install --url <url> [--key <key>] [--machine <name>]
      Saves the URL and machine key, checks them, and adds the reporting hooks to
      ~/.claude/settings.json (backing it up first). The key defaults to AGENT_MANAGER_KEY.
  agentctl uninstall          Removes the hooks (the config stays).
  agentctl status "<text>" [--state working|waiting|idle]
      Sets this session's one-line activity. Run it from a Claude Code shell.
  agentctl test               Sends a test report and prints the answer.
  agentctl doctor             Shows the config, hooks, heartbeat, sessions and recent errors.
  agentctl hook               (used by the hooks) Reads one hook event from stdin.
  agentctl daemon             (started by the hooks) Runs the heartbeat.

Exit codes: 0 done, 1 bad usage, 2 not set up, 3 session not found, 4 Agent Manager refused or unreachable.`;

class UsageError extends Error {}
class NotFoundError extends Error {}

function parseArgs(argv: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const [name, inline] = a.slice(2).split('=', 2) as [string, string | undefined];
      const value = inline ?? argv[i + 1];
      if (value === undefined || (inline === undefined && value.startsWith('--'))) throw new UsageError(`--${name} needs a value`);
      flags[name] = value;
      if (inline === undefined) i++;
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function scriptPath(): string {
  return resolve(process.argv[1] ?? paths.script());
}

// ---- hook ----

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

const COALESCE_MS = 2000;

/** Sends one report, combining rapid activity updates: the latest one in each 2 s window goes out. */
async function deliver(config: Config, sessionId: string, planned: PlannedReport, timeoutMs: number) {
  const { report } = planned;
  const state = readSendState(sessionId, report.agentId);
  const wait = state.lastSentAt + COALESCE_MS - Date.now();
  if (planned.coalesce && wait > 0) {
    const seq = `${process.pid}-${Date.now()}`;
    writeSendState(sessionId, report.agentId, { ...state, pendingSeq: seq });
    await new Promise((r) => setTimeout(r, wait));
    if (readSendState(sessionId, report.agentId).pendingSeq !== seq) return; // a newer update will go instead
  }
  writeSendState(sessionId, report.agentId, { lastSentAt: Date.now(), pendingSeq: '' });
  await post(config, '/report', report, timeoutMs);
}

async function hookCommand() {
  const raw = await readStdin();
  let input: HookInput;
  try {
    input = JSON.parse(raw) as HookInput;
  } catch {
    logLine(`hook: stdin was not JSON: ${raw.slice(0, 200)}`);
    return;
  }
  if (!input.session_id || !input.hook_event_name) {
    logLine('hook: stdin had no session_id or hook_event_name');
    return;
  }
  const config = loadConfig();
  const existing = readSession(input.session_id);
  const plan = planHook(input, existing, input.hook_event_name === 'SessionEnd' ? listSubagents(input.session_id) : [], {
    machine: config.machine,
    now: new Date(),
    claudePid: process.ppid || null,
    entrypoint: process.env.CLAUDE_CODE_ENTRYPOINT,
    project: projectName,
    branch: (cwd) => {
      const root = findRepoRoot(cwd);
      return root ? readBranch(root) : null;
    },
  });

  if (plan.sessionChanged) writeSession(plan.session);
  if (plan.subagentStart) addSubagent(input.session_id, plan.subagentStart);
  if (plan.subagentStop) removeSubagent(input.session_id, plan.subagentStop);
  if (input.hook_event_name === 'SessionStart' && process.env.CLAUDE_ENV_FILE) {
    // Lets `agentctl status` find its session quickly in bash; it falls back to the process tree.
    appendFileSync(process.env.CLAUDE_ENV_FILE, `export AGENT_MANAGER_SESSION=${input.session_id}\n`);
  }
  if (plan.ensureDaemon) ensureDaemon(scriptPath());

  // SessionEnd runs in the foreground with a short budget; the heartbeat catches a missed one.
  const timeoutMs = input.hook_event_name === 'SessionEnd' ? 1500 : 5000;
  const results = await Promise.allSettled(plan.reports.map((r) => deliver(config, input.session_id, r, timeoutMs)));
  for (const r of results) {
    if (r.status === 'rejected') logLine(`hook ${input.hook_event_name}: ${(r.reason as Error).message}`);
  }
}

// ---- status ----

/** The calling session: AGENT_MANAGER_SESSION, or the live session whose Claude Code process is above us. */
function findCallingSession() {
  const fromEnv = process.env.AGENT_MANAGER_SESSION;
  if (fromEnv) {
    const s = readSession(fromEnv);
    if (s) return s;
  }
  const chain = ancestors();
  const candidates = listSessions()
    .filter((s) => !s.endedAt && s.pid !== null && chain.includes(s.pid))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  if (!candidates[0]) {
    throw new NotFoundError(
      'Could not tell which Claude Code session is calling. Run this from a Claude Code shell after agentctl install, or set AGENT_MANAGER_SESSION.',
    );
  }
  return candidates[0];
}

async function statusCommand(positional: string[], flags: Record<string, string>) {
  const text = positional.join(' ').trim();
  if (!text) throw new UsageError('Usage: agentctl status "<what you are working on>" [--state working|waiting|idle]');
  const state = flags.state as ReportedState | undefined;
  if (state && !(REPORTED_STATES as readonly string[]).includes(state)) {
    throw new UsageError(`--state must be one of ${REPORTED_STATES.join(', ')}`);
  }
  const config = loadConfig();
  const s = findCallingSession();
  const report: ReportInput = {
    agentId: s.agentId,
    kind: 'claude-code',
    machine: config.machine,
    name: s.name,
    project: s.project,
    instructionsVersion: INSTRUCTIONS_VERSION,
    activity: text,
    at: new Date().toISOString(),
    ...(state ? { state } : {}),
  };
  const res = await post<ReportResponse>(config, '/report', report);
  writeSendState(s.sessionId, s.agentId, { lastSentAt: Date.now(), pendingSeq: '' });
  console.log(`Activity set for ${s.name}: ${res.agentUrl}`);
}

// ---- install / uninstall ----

function readSettings(): Record<string, unknown> {
  const file = paths.claudeSettings();
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch (e) {
    throw new ConfigError(`${file} isn't valid JSON (${(e as Error).message}); fix it, then run install again`);
  }
}

function writeSettings(settings: Record<string, unknown>): string | null {
  const file = paths.claudeSettings();
  let backup: string | null = null;
  if (existsSync(file)) {
    backup = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    copyFileSync(file, backup);
  }
  writeJsonFile(file, settings);
  return backup;
}

/**
 * AGENT_MANAGER_KEY as saved for the Windows user. A shell started before the key was saved
 * (such as one inside an already-open VS Code) doesn't have it in its environment yet.
 */
function userEnvKey(): string {
  if (process.platform !== 'win32') return '';
  try {
    const out = execFileSync('reg', ['query', 'HKCU\\Environment', '/v', 'AGENT_MANAGER_KEY'], { encoding: 'utf8', windowsHide: true });
    return /AGENT_MANAGER_KEY\s+REG_\w+\s+(\S+)/.exec(out)?.[1] ?? '';
  } catch {
    return '';
  }
}

async function installCommand(flags: Record<string, string>) {
  const url = (flags.url || process.env.AGENT_MANAGER_URL || '').replace(/\/+$/, '');
  const key =
    flags.key || process.env.AGENT_MANAGER_KEY || userEnvKey() || readJsonFile<Partial<Config>>(paths.config())?.key || '';
  const machine = flags.machine || readJsonFile<Partial<Config>>(paths.config())?.machine || defaultMachineName();
  if (!/^https?:\/\//.test(url)) throw new UsageError('Usage: agentctl install --url https://<your Agent Manager> [--key <key>] [--machine <name>]');
  if (!key) throw new UsageError('No machine key: make one on the Settings tab, then set AGENT_MANAGER_KEY or pass --key');
  const config: Config = { url, key, machine };

  // Check the URL and key before touching anything.
  const check = await post<ReportResponse>(config, '/report', {
    agentId: `${machine}/agentctl`,
    kind: 'other',
    machine,
    test: true,
  });
  if (!check.ok) throw new SendError('Agent Manager did not accept the test report');

  mkdirSync(dirname(paths.script()), { recursive: true });
  if (resolve(scriptPath()) !== resolve(paths.script())) copyFileSync(scriptPath(), paths.script());
  writeJsonFile(paths.config(), config);

  const backup = writeSettings(withAgentctlHooks(readSettings(), process.execPath, paths.script()));
  console.log(`Agent Manager reporting is set up for ${machine}.
  Config:    ${paths.config()}
  agentctl:  ${paths.script()}
  Hooks:     ${paths.claudeSettings()}${backup ? `\n  Backup:    ${backup}` : ''}
New Claude Code sessions on this PC now appear at ${url}/agents within a few seconds.
Sessions that are already open start reporting once Claude Code reloads its settings.`);
}

function uninstallCommand() {
  const settings = readSettings();
  const cleaned = withoutAgentctlHooks(settings);
  if (JSON.stringify(cleaned) === JSON.stringify(settings)) {
    console.log('No agentctl hooks found; nothing to remove.');
    return;
  }
  const backup = writeSettings(cleaned);
  const d = readJsonFile<{ pid: number }>(paths.daemon());
  if (d && isAlive(d.pid)) process.kill(d.pid);
  console.log(`Removed the agentctl hooks from ${paths.claudeSettings()}${backup ? ` (backup: ${backup})` : ''}.`);
}

// ---- test / doctor ----

async function testCommand() {
  const config = loadConfig();
  const res = await post<ReportResponse>(config, '/report', {
    agentId: `${config.machine}/agentctl`,
    kind: 'other',
    machine: config.machine,
    activity: 'agentctl test',
    test: true,
  });
  console.log(`Agent Manager at ${config.url} accepted a test report from ${config.machine}.`);
  if (res.warnings.length) console.log(`Warnings: ${res.warnings.join('; ')}`);
}

async function doctorCommand() {
  const lines: string[] = [];
  let config: Config | null = null;
  try {
    config = loadConfig();
    lines.push(`Config:     ${config.url}, machine ${config.machine}, key ${config.key.slice(0, 13)}…`);
  } catch (e) {
    lines.push(`Config:     ${(e as Error).message}`);
  }
  const settings = (() => {
    try {
      return readSettings();
    } catch (e) {
      lines.push(`Hooks:      ${(e as Error).message}`);
      return null;
    }
  })();
  if (settings) lines.push(`Hooks:      ${hasAgentctlHooks(settings) ? 'installed' : 'missing (run agentctl install)'} in ${paths.claudeSettings()}`);
  const d = readJsonFile<{ pid: number; beatAt: string }>(paths.daemon());
  lines.push(`Heartbeat:  ${d && isAlive(d.pid) ? `running (pid ${d.pid}, last beat ${d.beatAt})` : 'not running (starts with the next session)'}`);
  const live = listSessions().filter((s) => !s.endedAt);
  lines.push(`Sessions:   ${live.length} open${live.map((s) => `\n            ${s.name} (pid ${s.pid ?? '?'}${s.pid && !isAlive(s.pid) ? ', gone' : ''})`).join('')}`);
  if (config) {
    try {
      await post(config, '/report', { agentId: `${config.machine}/agentctl`, kind: 'other', machine: config.machine, test: true });
      lines.push('Connection: OK');
    } catch (e) {
      lines.push(`Connection: ${(e as Error).message}`);
    }
  }
  const log = existsSync(paths.log()) ? readFileSync(paths.log(), 'utf8').trim().split('\n').slice(-10) : [];
  lines.push(`Recent log: ${log.length ? `\n            ${log.join('\n            ')}` : 'empty'}`);
  console.log(lines.join('\n'));
}

// ---- main ----

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  try {
    const { positional, flags } = parseArgs(rest);
    switch (command) {
      case 'hook':
        try {
          await hookCommand();
        } catch (e) {
          logLine(`hook: ${(e as Error).message}`);
        }
        return 0; // a hook never reports failure to Claude Code; the log has it
      case 'daemon':
        await runDaemon();
        return 0;
      case 'install':
        await installCommand(flags);
        return 0;
      case 'uninstall':
        uninstallCommand();
        return 0;
      case 'status':
        await statusCommand(positional, flags);
        return 0;
      case 'test':
        await testCommand();
        return 0;
      case 'doctor':
        await doctorCommand();
        return 0;
      case 'version':
        console.log(`agentctl, instructions version ${INSTRUCTIONS_VERSION}`);
        return 0;
      case undefined:
      case 'help':
      case '--help':
      case '-h':
        console.log(HELP);
        return 0;
      default:
        throw new UsageError(`Unknown command "${command}". Run agentctl help.`);
    }
  } catch (e) {
    console.error(`agentctl: ${(e as Error).message}`);
    if (e instanceof UsageError) return 1;
    if (e instanceof ConfigError) return 2;
    if (e instanceof NotFoundError) return 3;
    if (e instanceof SendError) return 4;
    return 1;
  }
}

main(process.argv.slice(2)).then((code) => process.exit(code));
