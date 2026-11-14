// What a session is on, in three parts (shown side by side in Agent Manager Delux):
//   story:  the ticket and its title when the branch names one, else the session's title
//   task:   the technical step now: its in-progress todo, else the first line of what it last said
//   prompt: the person's latest prompt
// `agentctl story` and `agentctl task` pin a value the agent chose over the worked-out one.

import { LIMITS } from '@agent-manager-delux/shared';
import { firstLine } from './transcript';

/**
 * Jira-style keys such as AM-123 (Linear uses the same shape). Upper case only, so branches
 * like release-2024 or fix-12 aren't taken for tickets.
 */
const TICKET = /(?:^|[^A-Za-z0-9])([A-Z][A-Z0-9]{1,9}-\d+)(?![A-Za-z0-9])/;

/** The ticket a branch names, with the rest of the branch name as words. */
export function ticketFromBranch(branch: string | null): { key: string; words: string } | null {
  if (!branch) return null;
  const m = TICKET.exec(branch);
  if (!m) return null;
  const rest = branch.slice(m.index + m[0].length);
  const words = rest.replace(/[-_/]+/g, ' ').trim();
  return { key: m[1]!, words };
}

export function storyFrom(branch: string | null, title: string | null): string | null {
  const ticket = ticketFromBranch(branch);
  const story = ticket ? [ticket.key, title || ticket.words].filter(Boolean).join(': ') : title;
  return story ? story.slice(0, LIMITS.storyLength) : null;
}

interface Todo {
  status?: unknown;
  activeForm?: unknown;
  content?: unknown;
  subject?: unknown;
}

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * The step a task-list tool call puts the agent on: a string, null when the list is done,
 * or undefined when the call says nothing about it.
 */
export function taskFromTool(toolName: string, input: unknown): string | null | undefined {
  if (toolName === 'TodoWrite') {
    const todos = (input as { todos?: unknown } | null)?.todos;
    if (!Array.isArray(todos)) return undefined;
    const now = (todos as Todo[]).find((t) => t?.status === 'in_progress');
    if (now) return oneLine(text(now.activeForm) ?? text(now.content));
    return (todos as Todo[]).every((t) => t?.status === 'completed') ? null : undefined;
  }
  if (toolName === 'TaskUpdate' || toolName === 'TaskCreate') {
    const t = input as Todo | null;
    if (t?.status === 'in_progress') return oneLine(text(t.activeForm) ?? text(t.subject)) ?? undefined;
  }
  return undefined;
}

function oneLine(s: string | null): string | null {
  return s ? firstLine(s, LIMITS.taskLength) : null;
}

/** The prompt as sent: pasted blocks shortened to a marker, cut to the limit. */
export function promptText(prompt: string | undefined): string | null {
  if (!prompt) return null;
  const cleaned = prompt
    .replace(/<pasted_content\b[^>]*>[\s\S]*?<\/pasted_content>/g, '[pasted text]')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!cleaned) return null;
  return cleaned.length > LIMITS.promptLength ? `${cleaned.slice(0, LIMITS.promptLength - 1)}…` : cleaned;
}
