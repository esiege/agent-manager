import { describe, expect, it } from 'vitest';
import { promptText, storyFrom, taskFromTool, ticketFromBranch } from '../src/context';
import { describeTool } from '../src/describe';
import { commitWebUrl } from '../src/git';
import { splitChecks } from '../src/result';
import { planHook, type HookInput, type PlanContext } from '../src/hook';
import type { SessionRecord } from '../src/sessions';
import { hasAgentctlHooks, withAgentctlHooks, withoutAgentctlHooks } from '../src/settings';
import { firstLine, NO_TRANSCRIPT, parseTranscript } from '../src/transcript';

const ctx: PlanContext = {
  machine: 'pc-studio',
  now: new Date('2026-10-10T12:00:00Z'),
  claudePid: 4242,
  entrypoint: 'claude-vscode',
  project: () => 'musik',
  branch: () => 'main',
  transcript: () => NO_TRANSCRIPT,
  context: {},
  sendPrompts: true,
  head: () => null,
  commit: () => null,
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

describe('story, task and prompt', () => {
  const said = (narration: string | null, title: string | null = null): Partial<PlanContext> => ({
    transcript: () => ({ title, narration }),
  });

  it('sends the prompt, with pasted blocks shortened, and starts a fresh task', () => {
    const plan = planHook(
      ev('UserPromptSubmit', { prompt: 'Fix this:\n<pasted_content id="a1">huge log</pasted_content>' }),
      started(),
      [],
      { ...ctx, context: { task: 'Old pinned task' } },
    );
    expect(plan.reports[0]?.report).toMatchObject({ state: 'working', prompt: 'Fix this:\n[pasted text]', task: null, turn: 'start' });
    expect(plan.context).toMatchObject({ task: undefined });
  });

  it('keeps prompts on the PC when the config says so', () => {
    const plan = planHook(ev('UserPromptSubmit', { prompt: 'secret plans' }), started(), [], { ...ctx, sendPrompts: false });
    expect(JSON.stringify(plan.reports)).not.toContain('secret plans');
  });

  it('takes the task from what the agent last said', () => {
    const plan = planHook(ev('PreToolUse', { tool_name: 'Read', tool_input: {} }), started(), [], { ...ctx, ...said('Checking the importer') });
    expect(plan.reports[0]?.report).toMatchObject({ activity: 'Reading files', task: 'Checking the importer' });
  });

  it('prefers the in-progress todo, and remembers it for later tool calls', () => {
    const todos = {
      todos: [
        { content: 'Add tests', status: 'completed' },
        { content: 'Fix parser', activeForm: 'Fixing the parser', status: 'in_progress' },
      ],
    };
    const first = planHook(ev('PreToolUse', { tool_name: 'TodoWrite', tool_input: todos }), started(), [], { ...ctx, ...said('Next, the parser') });
    expect(first.reports[0]?.report.task).toBe('Fixing the parser');
    expect(first.context).toEqual({ todo: 'Fixing the parser' });

    const later = planHook(ev('PreToolUse', { tool_name: 'Edit', tool_input: {} }), started(), [], {
      ...ctx,
      ...said('Editing'),
      context: first.context!,
    });
    expect(later.reports[0]?.report.task).toBe('Fixing the parser');
    expect(later.context).toBeUndefined();
  });

  it('lets a pinned task win', () => {
    const plan = planHook(ev('PreToolUse', { tool_name: 'Edit', tool_input: {} }), started(), [], {
      ...ctx,
      ...said('Editing'),
      context: { task: 'Migrating the schema', todo: 'x' },
    });
    expect(plan.reports[0]?.report.task).toBe('Migrating the schema');
  });

  it('builds the story from the ticket in the branch and the session title', () => {
    const plan = planHook(ev('Stop'), started(), [], { ...ctx, branch: () => 'feature/AM-42-login-page', ...said(null, 'Login page polish') });
    expect(plan.reports[0]?.report).toMatchObject({ state: 'idle', story: 'AM-42: Login page polish', turn: 'end' });
  });

  it('lets a pinned story win, and leaves the story off plain events', () => {
    const pinned = { ...ctx, context: { story: 'AM-7: Export to CSV' }, ...said(null, 'Something else') };
    expect(planHook(ev('Stop'), started(), [], pinned).reports[0]?.report.story).toBe('AM-7: Export to CSV');
    const note = planHook(ev('Notification', { notification_type: 'idle_prompt' }), started(), [], pinned);
    expect(note.reports[0]?.report).not.toHaveProperty('story');
  });

  it('gives sub-agents no story, task or prompt', () => {
    const plan = planHook(ev('PreToolUse', { agent_id: 'sub1', tool_name: 'Grep', tool_input: {} }), started(), [], { ...ctx, ...said('x', 'y') });
    expect(plan.reports[0]?.report).not.toHaveProperty('task');
    expect(plan.reports[0]?.report).not.toHaveProperty('story');
  });

  it('finds tickets only in upper case', () => {
    expect(ticketFromBranch('feature/AM-123-add-login')).toEqual({ key: 'AM-123', words: 'add login' });
    expect(ticketFromBranch('release-2024')).toBeNull();
    expect(ticketFromBranch('main')).toBeNull();
    expect(storyFrom('AM-9', null)).toBe('AM-9');
    expect(storyFrom('main', 'A title')).toBe('A title');
    expect(storyFrom('main', null)).toBeNull();
  });

  it('reads task-list tools', () => {
    expect(taskFromTool('TodoWrite', { todos: [{ content: 'a', status: 'completed' }] })).toBeNull();
    expect(taskFromTool('TodoWrite', { todos: [{ content: 'a', status: 'pending' }] })).toBeUndefined();
    expect(taskFromTool('TaskUpdate', { taskId: '1', status: 'in_progress', activeForm: 'Writing docs' })).toBe('Writing docs');
    expect(taskFromTool('TaskUpdate', { taskId: '1', status: 'completed' })).toBeUndefined();
    expect(taskFromTool('Bash', { description: 'x' })).toBeUndefined();
  });

  it('cuts long prompts', () => {
    expect(promptText('x'.repeat(3000))).toHaveLength(2000);
    expect(promptText('   ')).toBeNull();
  });
});

describe('parseTranscript', () => {
  const line = (o: unknown) => JSON.stringify(o);
  const user = (text: string) => line({ type: 'user', message: { content: text } });
  const toolResult = line({ type: 'user', message: { content: [{ type: 'tool_result', content: 'big' }] } });
  const says = (text: string) => line({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
  const toolUse = line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read' }] } });

  it('finds the title and what the agent said last in this turn', () => {
    const text = [
      line({ type: 'ai-title', aiTitle: 'Old title' }),
      user('first prompt'),
      says('## Looking at the **importer**'),
      toolUse,
      toolResult,
      line({ type: 'ai-title', aiTitle: 'Importer fixes' }),
      says('Now fixing `parse()`.\nMore detail.'),
      toolUse,
    ].join('\n');
    expect(parseTranscript(text)).toEqual({ title: 'Importer fixes', narration: 'Now fixing parse().' });
  });

  it('prefers a title the person set, and ignores what was said before the latest prompt', () => {
    const text = [
      line({ type: 'custom-title', customTitle: 'Mine' }),
      says('Earlier work'),
      user('next prompt'),
      line({ type: 'ai-title', aiTitle: 'Generated' }),
    ].join('\n');
    expect(parseTranscript(text)).toEqual({ title: 'Mine', narration: null });
  });

  it('skips sub-agent lines and lines it cannot read', () => {
    const side = line({ type: 'assistant', isSidechain: true, message: { content: [{ type: 'text', text: 'Side' }] } });
    const text = [user('go'), says('Main agent'), side, '{"assistant" "text" broken'].join('\n');
    expect(parseTranscript(text).narration).toBe('Main agent');
  });

  it('turns Markdown into one plain line', () => {
    expect(firstLine('\n\n- [Link](http://x) and *more*', 100)).toBe('Link and *more*');
    expect(firstLine('a'.repeat(50), 10)).toBe('aaaaaaaaa…');
  });
});

describe('report of finished work', () => {
  const commit = { sha: 'abc1234def', subject: 'Group sessions into one row', branch: 'main', url: 'https://github.com/o/r/commit/abc1234def', pushed: true };
  const final = 'Grouped the sessions.\n\n## How to check\n- Open Agents: one row per project\n- Expand a row to see its sessions\n\nThanks!';

  it('notes HEAD at the prompt, then reports the commit made during the request at Stop', () => {
    const prompt = planHook(ev('UserPromptSubmit', { prompt: 'Group them' }), started(), [], { ...ctx, head: () => 'old' });
    expect(prompt.context).toMatchObject({ headAtPrompt: 'old' });

    const stop = planHook(ev('Stop', { last_assistant_message: final }), started(), [], {
      ...ctx,
      context: prompt.context!,
      head: () => 'abc1234def',
      commit: () => commit,
    });
    expect(stop.reports[0]?.report).toMatchObject({
      turn: 'end',
      result: {
        title: 'Group sessions into one row',
        summary: 'Grouped the sessions.\n\nThanks!',
        checks: ['Open Agents: one row per project', 'Expand a row to see its sessions'],
        commitUrl: 'https://github.com/o/r/commit/abc1234def',
        pushed: true,
      },
    });
    expect(stop.context).toMatchObject({ reported: true, headAtPrompt: 'abc1234def' });
  });

  it('sends no report when nothing was committed, or agentctl done already sent one', () => {
    const same = planHook(ev('Stop'), started(), [], { ...ctx, context: { headAtPrompt: 'h' }, head: () => 'h', commit: () => commit });
    expect(same.reports[0]?.report).not.toHaveProperty('result');
    const done = planHook(ev('Stop'), started(), [], { ...ctx, context: { headAtPrompt: 'h', reported: true }, head: () => 'new', commit: () => commit });
    expect(done.reports[0]?.report).not.toHaveProperty('result');
  });

  it('splits acceptance steps out of a message', () => {
    expect(splitChecks('Done.\n\n**What you should see**\n1. A green badge\n2. [ ] No errors')).toEqual({
      summary: 'Done.',
      checks: ['A green badge', 'No errors'],
    });
    expect(splitChecks('Just a reply.')).toEqual({ summary: 'Just a reply.', checks: [] });
  });

  it('links commits on known hosts', () => {
    expect(commitWebUrl('git@github.com:esiege/agent-manager.git', 'abc')).toBe('https://github.com/esiege/agent-manager/commit/abc');
    expect(commitWebUrl('https://github.com/esiege/agent-manager', 'abc')).toBe('https://github.com/esiege/agent-manager/commit/abc');
    expect(commitWebUrl('https://gitlab.com/g/p.git', 'abc')).toBe('https://gitlab.com/g/p/-/commit/abc');
    expect(commitWebUrl('https://me@dev.azure.com/org/proj/_git/repo', 'abc')).toBe('https://dev.azure.com/org/proj/_git/repo/commit/abc');
    expect(commitWebUrl('C:/repos/local', 'abc')).toBeNull();
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
