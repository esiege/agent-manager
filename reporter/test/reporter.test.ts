import { describe, expect, it } from 'vitest';
import { describeTool } from '../src/describe';
import { planHook, type HookInput, type PlanContext } from '../src/hook';
import type { SessionRecord } from '../src/sessions';
import { hasAgentctlHooks, withAgentctlHooks, withoutAgentctlHooks } from '../src/settings';

const ctx: PlanContext = {
  machine: 'pc-studio',
  now: new Date('2026-10-10T12:00:00Z'),
  claudePid: 4242,
  entrypoint: 'claude-vscode',
  project: () => 'musik',
  branch: () => 'main',
};

const ev = (hook_event_name: string, extra: Partial<HookInput> = {}): HookInput => ({
  hook_event_name,
  session_id: '4b1e9c2a-1111',
  cwd: 'C:/repos/musik',
  ...extra,
});

function started(): SessionRecord {
  return planHook(ev('SessionStart', { source: 'startup', model: 'claude-opus-5-5' }), null, [], ctx).session;
}

describe('planHook', () => {
  it('records a new session and reports it with its details', () => {
    const plan = planHook(ev('SessionStart', { source: 'startup', model: 'claude-opus-5-5', permission_mode: 'default' }), null, [], ctx);
    expect(plan.session).toMatchObject({ agentId: 'pc-studio/claude/4b1e9c2a-1111', name: 'musik-4b1e', pid: 4242 });
    expect(plan.ensureDaemon).toBe(true);
    expect(plan.reports).toEqual([
      {
        coalesce: false,
        report: expect.objectContaining({
          state: 'idle',
          activity: 'Session started',
          parentId: null,
          details: {
            sessionId: '4b1e9c2a-1111',
            model: 'claude-opus-5-5',
            surface: 'vscode',
            branch: 'main',
            folder: 'C:/repos/musik',
            permissionMode: 'default',
          },
        }),
      },
    ]);
  });

  it('sends the tool description but never the command', () => {
    const plan = planHook(
      ev('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'rm -rf secrets', description: 'Run screenshot tests' } }),
      started(),
      [],
      ctx,
    );
    expect(plan.reports[0]).toMatchObject({ coalesce: true, report: { state: 'working', activity: 'Run screenshot tests' } });
    expect(JSON.stringify(plan.reports)).not.toContain('rm -rf');
  });

  it('marks a question to the person as waiting, sent at once', () => {
    const plan = planHook(ev('PreToolUse', { tool_name: 'AskUserQuestion', tool_input: { questions: [] } }), started(), [], ctx);
    expect(plan.reports[0]).toMatchObject({ coalesce: false, report: { state: 'waiting', activity: 'Asking you a question' } });
  });

  it('turns a permission prompt into Waiting on you', () => {
    const plan = planHook(
      ev('Notification', { notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' }),
      started(),
      [],
      ctx,
    );
    expect(plan.reports[0]?.report).toMatchObject({ state: 'waiting', activity: 'Claude needs your permission to use Bash' });
  });

  it('reports sub-agents under their session', () => {
    const session = started();
    const start = planHook(ev('SubagentStart', { agent_id: 'sub1', agent_type: 'Explore' }), session, [], ctx);
    expect(start.subagentStart).toMatchObject({ subagentId: 'sub1', agentType: 'Explore' });
    expect(start.reports[0]?.report).toMatchObject({
      agentId: 'pc-studio/claude/4b1e9c2a-1111/sub1',
      parentId: 'pc-studio/claude/4b1e9c2a-1111',
      name: 'Explore',
      state: 'working',
    });

    const tool = planHook(ev('PreToolUse', { agent_id: 'sub1', agent_type: 'Explore', tool_name: 'Grep', tool_input: {} }), session, [], ctx);
    expect(tool.reports[0]?.report).toMatchObject({ agentId: 'pc-studio/claude/4b1e9c2a-1111/sub1', activity: 'Searching the code' });
  });

  it('stops the session and its running sub-agents at SessionEnd', () => {
    const subs = [{ agentId: 'x', subagentId: 'sub1', agentType: 'Explore', startedAt: '' }];
    const plan = planHook(ev('SessionEnd', { reason: 'prompt_input_exit' }), started(), subs, ctx);
    expect(plan.session.endedAt).toBe('2026-10-10T12:00:00.000Z');
    expect(plan.reports.map((r) => [r.report.agentId, r.report.state, r.report.activity])).toEqual([
      ['pc-studio/claude/4b1e9c2a-1111', 'stopped', 'Session closed'],
      ['pc-studio/claude/4b1e9c2a-1111/sub1', 'stopped', 'Session ended'],
    ]);
  });

  it('picks up a session that started before install', () => {
    const plan = planHook(ev('Stop'), null, [], ctx);
    expect(plan.sessionChanged).toBe(true);
    expect(plan.reports[0]?.report).toMatchObject({ state: 'idle', details: expect.objectContaining({ sessionId: '4b1e9c2a-1111' }) });
  });

  it('renames the session when it gets a title', () => {
    const plan = planHook(ev('UserPromptSubmit', { session_title: 'Fix the importer' }), started(), [], ctx);
    expect(plan.sessionChanged).toBe(true);
    expect(plan.reports[0]?.report).toMatchObject({ name: 'Fix the importer', state: 'working' });
  });
});

describe('describeTool', () => {
  it.each([
    ['Read', { file_path: 'C:/secret.txt' }, 'Reading files'],
    ['Agent', { description: 'Find the importer' }, 'Sub-agent: Find the importer'],
    ['mcp__github__create_issue', { title: 'x' }, 'Using github: create_issue'],
    ['SomethingNew', {}, 'Using SomethingNew'],
  ])('%s', (tool, input, activity) => expect(describeTool(tool, input).activity).toBe(activity));
});

describe('settings', () => {
  const node = 'C:\\Program Files\\nodejs\\node.exe';
  const script = 'C:\\Users\\me\\.agent-manager\\agentctl.js';
  const theirs = { type: 'command', command: 'echo theirs' };

  it('adds hooks without touching other settings or hooks, and replaces its own on reinstall', () => {
    const before = { model: 'opus', hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [theirs] }] } };
    const once = withAgentctlHooks(before, node, script);
    const twice = withAgentctlHooks(once, node, script);
    expect(twice).toEqual(once);
    expect(hasAgentctlHooks(once)).toBe(true);
    expect(once.model).toBe('opus');
    const pre = (once.hooks as Record<string, unknown[]>).PreToolUse;
    expect(pre).toEqual([
      { matcher: 'Bash', hooks: [theirs] },
      { hooks: [{ type: 'command', command: node, args: [script, 'hook'], async: true, timeout: 30 }] },
    ]);
    expect((once.hooks as Record<string, unknown[]>).SessionEnd).toEqual([
      { hooks: [{ type: 'command', command: node, args: [script, 'hook'], timeout: 5 }] },
    ]);
  });

  it('removes only its own hooks', () => {
    const before = { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [theirs] }] } };
    expect(withoutAgentctlHooks(withAgentctlHooks(before, node, script))).toEqual(before);
    expect(withoutAgentctlHooks(withAgentctlHooks({}, node, script))).toEqual({});
  });
});
