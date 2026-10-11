// Adds and removes agentctl's hooks in Claude Code's user settings (~/.claude/settings.json).
// Pure functions over the parsed settings; agentctl.ts reads, backs up and writes the file.

type Json = Record<string, unknown>;

interface CommandHook {
  type: 'command';
  command: string;
  args?: string[];
  async?: boolean;
  timeout?: number;
}

interface MatcherGroup {
  matcher?: string;
  hooks: Json[];
}

/** Events that report in the background, never holding up Claude (C-03). */
export const ASYNC_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'Notification',
  'Stop',
  'StopFailure',
  'SubagentStart',
  'SubagentStop',
] as const;

/**
 * SessionEnd runs in the foreground: Claude Code may exit right after it, which would cut off a
 * background hook. Its budget is short, so agentctl sends with a 1.5 s timeout and the heartbeat
 * catches anything it misses.
 */
export const SYNC_EVENTS = ['SessionEnd'] as const;

/** An agentctl handler: it runs some agentctl.js with the "hook" command. */
function isOurs(hook: Json): boolean {
  const parts = [hook.command, ...(Array.isArray(hook.args) ? hook.args : [])].filter((p): p is string => typeof p === 'string');
  return parts.some((p) => /agentctl\.js["']?(\s+hook)?$/i.test(p.trim())) && parts.some((p) => /(^|\s)hook$/.test(p.trim()));
}

/** Settings with every agentctl hook removed, dropping groups and events left empty. */
export function withoutAgentctlHooks(settings: Json): Json {
  const hooks = settings.hooks as Record<string, MatcherGroup[]> | undefined;
  if (!hooks || typeof hooks !== 'object') return settings;
  const next: Record<string, MatcherGroup[]> = {};
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) {
      next[event] = groups;
      continue;
    }
    const kept = groups
      .map((g) => ({ ...g, hooks: Array.isArray(g.hooks) ? g.hooks.filter((h) => !isOurs(h)) : g.hooks }))
      .filter((g) => !Array.isArray(g.hooks) || g.hooks.length > 0);
    if (kept.length) next[event] = kept;
  }
  const out: Json = { ...settings, hooks: next };
  if (Object.keys(next).length === 0) delete out.hooks;
  return out;
}

/** Settings with agentctl's hooks added (replacing any older ones), leaving every other hook alone. */
export function withAgentctlHooks(settings: Json, nodePath: string, scriptPath: string): Json {
  const clean = withoutAgentctlHooks(settings);
  const hooks: Record<string, MatcherGroup[]> = { ...((clean.hooks as Record<string, MatcherGroup[]>) ?? {}) };
  const handler = (async: boolean): CommandHook => ({
    type: 'command',
    command: nodePath,
    args: [scriptPath, 'hook'],
    ...(async ? { async: true, timeout: 30 } : { timeout: 5 }),
  });
  for (const event of ASYNC_EVENTS) hooks[event] = [...(hooks[event] ?? []), { hooks: [handler(true) as unknown as Json] }];
  for (const event of SYNC_EVENTS) hooks[event] = [...(hooks[event] ?? []), { hooks: [handler(false) as unknown as Json] }];
  return { ...clean, hooks };
}

/** True when the settings already hold agentctl hooks for every event. */
export function hasAgentctlHooks(settings: Json): boolean {
  const hooks = settings.hooks as Record<string, MatcherGroup[]> | undefined;
  if (!hooks) return false;
  return [...ASYNC_EVENTS, ...SYNC_EVENTS].every((event) =>
    (hooks[event] ?? []).some((g) => Array.isArray(g.hooks) && g.hooks.some(isOurs)),
  );
}
