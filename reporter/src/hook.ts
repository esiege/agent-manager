// Maps one Claude Code hook event to the reports it causes (C-01). Pure, so it can be tested
// without files or a network; agentctl.ts does the reading, writing and sending.

import { INSTRUCTIONS_VERSION, type ReportInput, type ReportedState } from '@agent-manager/shared';
import { promptText, storyFrom, taskFromTool } from './context';
import { describeTool } from './describe';
import type { CommitInfo } from './git';
import { resultFrom } from './result';
import type { SessionContext, SessionRecord, SubagentRecord } from './sessions';
import type { TranscriptInfo, UsageRead } from './transcript';

/** The stdin fields agentctl reads. Everything else Claude Code sends is ignored and never leaves the PC. */
export interface HookInput {
  hook_event_name: string;
  session_id: string;
  transcript_path?: string;
  cwd?: string;
  permission_mode?: string;
  agent_id?: string;
  agent_type?: string;
  /** SubagentStop: the sub-agent's own transcript, for its token usage. */
  agent_transcript_path?: string;
  source?: string;
  model?: string;
  session_title?: string;
  /** UserPromptSubmit: what the person typed. Sent only as the agent's prompt, and only if allowed. */
  prompt?: string;
  reason?: string;
  tool_name?: string;
  tool_input?: unknown;
  message?: string;
  title?: string;
  notification_type?: string;
  error?: string;
  /** Stop: the agent's final message, used for the report of finished work. */
  last_assistant_message?: string;
}

export interface PlannedReport {
  report: ReportInput;
  /** Activity updates are combined: at most one per agent every 2 s (C-04). */
  coalesce: boolean;
}

export interface Plan {
  session: SessionRecord;
  sessionChanged: boolean;
  reports: PlannedReport[];
  subagentStart?: SubagentRecord;
  subagentStop?: string;
  /** The session's context.json, when this event changes it. */
  context?: SessionContext;
  ensureDaemon: boolean;
}

export interface PlanContext {
  machine: string;
  now: Date;
  /** The Claude Code process: the hook's parent, since hooks are started without a shell. */
  claudePid: number | null;
  /** CLAUDE_CODE_ENTRYPOINT, when Claude Code sets it. */
  entrypoint: string | undefined;
  project: (cwd: string) => string;
  branch: (cwd: string) => string | null;
  /** The commit HEAD points at (read from .git, fast). */
  head: (cwd: string) => string | null;
  /** About a commit, from git (slow: only used when a request ends with a new commit). */
  commit: (cwd: string, sha: string) => CommitInfo | null;
  /** What the transcript says; read at most once per event. */
  transcript: (path: string | undefined) => TranscriptInfo;
  /** The tokens used in a transcript from a byte offset on (transcript.ts readUsage). */
  usage: (path: string | undefined, offset: number | undefined, subagent?: boolean) => UsageRead | null;
  /** The session's context.json. */
  context: SessionContext;
  /** False when the config keeps prompts on this PC. */
  sendPrompts: boolean;
}

/** Events that say nothing about the story or task; they report only state and activity. */
const PLAIN_EVENTS = new Set(['Notification', 'SessionEnd', 'StopFailure', 'SubagentStart', 'SubagentStop']);

const WAITING_NOTIFICATIONS = new Set(['permission_prompt', 'elicitation_dialog', 'elicitation_url_dialog', 'agent_needs_input']);
const IDLE_NOTIFICATIONS = new Set(['idle_prompt']);

/**
 * Events that send the tokens used since the last count: the end of a request, a new prompt
 * (which also covers a request cut off with Esc), and the end of the session.
 */
const USAGE_EVENTS = new Set(['Stop', 'UserPromptSubmit', 'SessionEnd']);

const END_REASONS: Record<string, string> = {
  clear: 'Session cleared',
  resume: 'Switched to another session',
  logout: 'Logged out',
  prompt_input_exit: 'Session closed',
};

function surface(entrypoint: string | undefined): string | null {
  if (!entrypoint) return null;
  if (entrypoint.includes('vscode')) return 'vscode';
  if (entrypoint === 'cli') return 'terminal';
  if (entrypoint.startsWith('sdk')) return 'sdk';
  return entrypoint;
}

export function subagentAgentId(session: SessionRecord, subagentId: string): string {
  return `${session.agentId}/${subagentId}`;
}

export function planHook(
  input: HookInput,
  existing: SessionRecord | null,
  runningSubagents: SubagentRecord[],
  ctx: PlanContext,
): Plan {
  const now = ctx.now.toISOString();
  const event = input.hook_event_name;
  const sid = input.session_id;
  const isNew = !existing || event === 'SessionStart';

  // ---- The session record ----
  const cwd = input.cwd ?? existing?.cwd ?? '.';
  const project = existing && !isNew ? existing.project : ctx.project(cwd);
  const title = input.session_title?.trim();
  let session: SessionRecord;
  let sessionChanged = false;
  if (isNew) {
    session = {
      sessionId: sid,
      agentId: `${ctx.machine}/claude/${sid}`,
      name: title || existing?.name || `${project}-${sid.slice(0, 4)}`,
      project,
      cwd,
      pid: ctx.claudePid ?? existing?.pid ?? null,
      startedAt: existing?.startedAt ?? now,
      endedAt: null,
      details: {
        sessionId: sid,
        model: input.model ?? existing?.details.model ?? null,
        surface: surface(ctx.entrypoint),
        branch: ctx.branch(cwd),
        folder: cwd,
        permissionMode: input.permission_mode ?? null,
      },
    };
    sessionChanged = true;
  } else {
    session = { ...existing };
    if (title && title !== session.name) {
      session.name = title;
      sessionChanged = true;
    }
    if (session.endedAt && event !== 'SessionEnd') {
      session.endedAt = null; // a resumed session is running again
      sessionChanged = true;
    }
  }

  // ---- Story, task and prompt (context.ts) ----
  const main = !input.agent_id;
  let context = ctx.context;
  const what: Pick<ReportInput, 'story' | 'task' | 'prompt' | 'turn' | 'result' | 'workType' | 'usage'> = {};
  if (main && input.transcript_path) {
    // The count starts where the last one ended, in this transcript. A (re)started session starts
    // counting from now; a compacted one carries on.
    const sameFile = context.usagePath === input.transcript_path;
    const restart = event === 'SessionStart' && input.source !== 'compact';
    if (restart || !sameFile || USAGE_EVENTS.has(event)) {
      const read = ctx.usage(input.transcript_path, restart || !sameFile ? undefined : context.usageOffset);
      if (read) {
        if (read.offset !== context.usageOffset || !sameFile) context = { ...context, usagePath: input.transcript_path, usageOffset: read.offset };
        if (read.usage.length) what.usage = read.usage;
      }
    }
  }
  if (main && !PLAIN_EVENTS.has(event)) {
    let transcript: TranscriptInfo | null = null;
    const read = () => (transcript ??= ctx.transcript(input.transcript_path));

    if (event === 'UserPromptSubmit') {
      // A new prompt starts a new request and task: drop the task agentctl pinned for the last,
      // and note HEAD, so Stop can tell whether this request made a commit.
      context = { ...context, task: undefined, headAtPrompt: ctx.head(cwd) ?? undefined, reported: undefined };
      if (ctx.sendPrompts) what.prompt = promptText(input.prompt);
      what.task = context.todo ?? null;
      what.turn = 'start';
    }
    if (event === 'Stop') {
      what.turn = 'end';
      // Committed but didn't send a report with agentctl done: build one from the commit.
      const head = context.headAtPrompt !== undefined && !context.reported ? ctx.head(cwd) : null;
      if (head && head !== context.headAtPrompt) {
        const commit = ctx.commit(cwd, head);
        if (commit) what.result = resultFrom(commit, input.last_assistant_message);
        context = { ...context, headAtPrompt: head, reported: true };
      }
    }
    if (event === 'PreToolUse') {
      const todo = taskFromTool(input.tool_name ?? '', input.tool_input);
      if (todo !== undefined && todo !== (context.todo ?? null)) context = { ...context, todo: todo ?? undefined };
      const task = context.task ?? context.todo ?? read().narration;
      if (task) what.task = task;
    }
    const title = input.session_title?.trim() || read().title;
    const story = context.story ?? storyFrom(ctx.branch(cwd), title);
    if (story) what.story = story;
    if (context.workType) what.workType = context.workType;
  }

  const base = (): ReportInput => ({
    agentId: session.agentId,
    kind: 'claude-code',
    machine: ctx.machine,
    name: session.name,
    project: session.project,
    instructionsVersion: INSTRUCTIONS_VERSION,
    at: now,
    // A session seen for the first time sends everything the manager needs to show it.
    ...(isNew ? { parentId: null, details: session.details } : {}),
  });
  const sessionReport = (state: ReportedState, activity: string, coalesce = false): PlannedReport => ({
    report: { ...base(), state, activity, ...what },
    coalesce,
  });
  const subReport = (subagentId: string, agentType: string | undefined, state: ReportedState, activity: string, coalesce = false): PlannedReport => ({
    report: {
      agentId: subagentAgentId(session, subagentId),
      kind: 'claude-code',
      machine: ctx.machine,
      name: agentType || 'sub-agent',
      project: session.project,
      parentId: session.agentId,
      instructionsVersion: INSTRUCTIONS_VERSION,
      state,
      activity,
      at: now,
    },
    coalesce,
  });

  const plan: Plan = { session, sessionChanged, reports: [], ensureDaemon: isNew };
  if (context !== ctx.context) plan.context = context;

  switch (event) {
    case 'SessionStart': {
      if (input.source === 'compact') {
        // Auto-compaction happens mid-request in long runs (such as /loop): the session carries
        // on, so no state. Idle here would mark its request as cut off.
        plan.reports.push({ report: { ...base(), activity: 'Compacted its conversation', ...what }, coalesce: false });
        break;
      }
      const source = input.source && input.source !== 'startup' ? ` (${input.source})` : '';
      plan.reports.push(sessionReport('idle', `Session started${source}`));
      break;
    }
    case 'UserPromptSubmit':
      plan.reports.push(sessionReport('working', 'Working on your prompt'));
      plan.ensureDaemon = true;
      break;
    case 'PreToolUse': {
      const { activity, waiting } = describeTool(input.tool_name ?? 'a tool', input.tool_input);
      const state: ReportedState = waiting ? 'waiting' : 'working';
      plan.reports.push(
        input.agent_id
          ? subReport(input.agent_id, input.agent_type, state, activity, !waiting)
          : sessionReport(state, activity, !waiting),
      );
      break;
    }
    case 'Notification': {
      const type = input.notification_type ?? '';
      if (WAITING_NOTIFICATIONS.has(type)) {
        plan.reports.push(sessionReport('waiting', input.message?.trim() || input.title?.trim() || 'Waiting for you'));
      } else if (IDLE_NOTIFICATIONS.has(type)) {
        plan.reports.push(sessionReport('idle', 'Waiting for your next prompt'));
      }
      break;
    }
    case 'Stop':
      plan.reports.push(sessionReport('idle', 'Finished its turn'));
      break;
    case 'StopFailure':
      plan.reports.push(sessionReport('failed', `Stopped by an API error (${input.error ?? 'unknown'})`));
      break;
    case 'SubagentStart':
      if (input.agent_id) {
        plan.subagentStart = { agentId: subagentAgentId(session, input.agent_id), subagentId: input.agent_id, agentType: input.agent_type ?? 'sub-agent', startedAt: now };
        plan.reports.push(subReport(input.agent_id, input.agent_type, 'working', 'Started'));
      }
      break;
    case 'SubagentStop':
      if (input.agent_id) {
        plan.subagentStop = input.agent_id;
        const stopped = subReport(input.agent_id, input.agent_type, 'stopped', 'Finished');
        const usage = ctx.usage(input.agent_transcript_path, 0, true)?.usage;
        if (usage?.length) stopped.report.usage = usage;
        plan.reports.push(stopped);
      }
      break;
    case 'SessionEnd':
      session.endedAt = now;
      plan.sessionChanged = true;
      plan.ensureDaemon = false;
      plan.reports.push(sessionReport('stopped', END_REASONS[input.reason ?? ''] ?? 'Session ended'));
      for (const sub of runningSubagents) plan.reports.push(subReport(sub.subagentId, sub.agentType, 'stopped', 'Session ended'));
      break;
    default:
      if (isNew) plan.reports.push(sessionReport('working', 'Working'));
  }
  return plan;
}
