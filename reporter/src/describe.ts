// Turns a tool call into a one-line activity. Only the tool's name and its own short
// description leave the PC, never its input (C-02): no commands, paths or file contents.

const VERBS: Record<string, string> = {
  Bash: 'Running a command',
  PowerShell: 'Running a command',
  Read: 'Reading files',
  Edit: 'Editing files',
  MultiEdit: 'Editing files',
  Write: 'Writing files',
  NotebookEdit: 'Editing a notebook',
  Grep: 'Searching the code',
  Glob: 'Finding files',
  LS: 'Listing files',
  WebFetch: 'Reading a web page',
  WebSearch: 'Searching the web',
  TodoWrite: 'Updating its task list',
  Task: 'Running a sub-agent',
  Agent: 'Running a sub-agent',
  Skill: 'Using a skill',
  ToolSearch: 'Loading tools',
  EnterPlanMode: 'Planning',
  AskUserQuestion: 'Asking you a question',
  ExitPlanMode: 'Waiting for you to approve its plan',
};

/** Tools that stop and wait for the person. */
const WAITING_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode']);

export interface ToolActivity {
  activity: string;
  waiting: boolean;
}

export function describeTool(toolName: string, toolInput: unknown): ToolActivity {
  const waiting = WAITING_TOOLS.has(toolName);
  const raw = (toolInput as { description?: unknown } | null)?.description;
  const description = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ').slice(0, 200) : '';

  if (description && !waiting) {
    return { activity: toolName === 'Agent' || toolName === 'Task' ? `Sub-agent: ${description}` : description, waiting };
  }
  const verb = VERBS[toolName];
  if (verb) return { activity: verb, waiting };

  const mcp = /^mcp__(.+?)__(.+)$/.exec(toolName);
  if (mcp) return { activity: `Using ${mcp[1]}: ${mcp[2]}`, waiting };
  return { activity: `Using ${toolName}`, waiting };
}
