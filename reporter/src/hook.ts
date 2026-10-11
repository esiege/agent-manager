// Maps one Claude Code hook event to the reports it causes (C-01). Pure, so it can be tested
// without files or a network; agentctl.ts does the reading, writing and sending.

import { INSTRUCTIONS_VERSION, type ReportInput, type ReportedState } from '@agent-manager/shared';
import { describeTool } from './describe';
import type { SessionRecord, SubagentRecord } from './sessions';

/** The stdin fields agentctl reads. Everything else Claude Code sends is ignored and never leaves the PC. */
export interface HookInput {
  hook_event_name: string;
  session_id: string;
  cwd?: string;
  permission_mode?: string;
  agent_id?: string;
  agent_type?: string;
  source?: string;
  model?: string;
  session_title?: string;
  reason?: string;
  tool_name?: string;
  tool_input?: unknown;
  message?: string;
  title?: string;
  notification_type?: string;
  error?: string;
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
}

const WAITING_NOTIFICATIONS = new Set(['permission_prompt', 'elicitation_dialog', 'elicitation_url_dialog', 'agent_needs_input']);
const IDLE_NOTIFICATIONS = new Set(['idle_prompt']);

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
    report: { ...base(), state, activity },
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

  switch (event) {
    case 'SessionStart': {
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
        plan.reports.push(subReport(input.agent_id, input.agent_type, 'stopped', 'Finished'));
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
