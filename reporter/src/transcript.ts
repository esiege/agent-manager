// Reads what a session's transcript says about it: its title, and the first line of what the
// agent last said it was doing. The transcript's format is internal to Claude Code and changes
// between versions, so this is best effort: anything unexpected gives nulls, never an error.

import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

/** Only the end of the transcript is read, so a long session costs the same as a short one. */
const TAIL_BYTES = 512 * 1024;
const NARRATION_MAX = 200;

export interface TranscriptInfo {
  /** The session's title: one the person set, else the one Claude Code generated. */
  title: string | null;
  /** The first line of the agent's latest message in the current turn. */
  narration: string | null;
}

export const NO_TRANSCRIPT: TranscriptInfo = { title: null, narration: null };

export function readTranscript(file: string | undefined): TranscriptInfo {
  if (!file) return NO_TRANSCRIPT;
  try {
    return parseTranscript(readTail(file, TAIL_BYTES));
  } catch {
    return NO_TRANSCRIPT;
  }
}

function readTail(file: string, bytes: number): string {
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    const text = buf.toString('utf8');
    // Starting mid-file means the first line is a fragment.
    return start > 0 ? text.slice(text.indexOf('\n') + 1) : text;
  } finally {
    closeSync(fd);
  }
}

type Line = {
  type?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  aiTitle?: string;
  customTitle?: string;
  message?: { content?: unknown };
};

function parse(line: string): Line | null {
  try {
    return JSON.parse(line) as Line;
  } catch {
    return null;
  }
}

/** True for the person's own message, which starts a turn (tool results are user lines too). */
function isPrompt(line: Line): boolean {
  if (line.type !== 'user' || line.isMeta || line.isSidechain) return false;
  const content = line.message?.content;
  if (typeof content === 'string') return true;
  return Array.isArray(content) && content.some((c) => (c as { type?: string })?.type === 'text');
}

function assistantText(line: Line): string | null {
  if (line.type !== 'assistant' || line.isSidechain) return null;
  const content = line.message?.content;
  if (!Array.isArray(content)) return null;
  for (const c of content as { type?: string; text?: unknown }[]) {
    if (c?.type === 'text' && typeof c.text === 'string' && c.text.trim()) return c.text;
  }
  return null;
}

export function parseTranscript(text: string): TranscriptInfo {
  const lines = text.split('\n');
  let customTitle: string | null = null;
  let aiTitle: string | null = null;
  let narration: string | null = null;
  let turnStarted = false;

  // Newest first. Only lines that can matter are parsed: tool results can be large.
  for (let i = lines.length - 1; i >= 0; i--) {
    const raw = lines[i]!;
    if (!raw) continue;
    if (!customTitle && raw.includes('"custom-title"')) {
      customTitle = parse(raw)?.customTitle?.trim() || null;
    } else if (!aiTitle && raw.includes('"ai-title"')) {
      aiTitle = parse(raw)?.aiTitle?.trim() || null;
    } else if (!narration && !turnStarted && raw.includes('"assistant"') && raw.includes('"text"')) {
      const line = parse(raw);
      const said = line && assistantText(line);
      if (said) narration = firstLine(said, NARRATION_MAX);
    } else if (!turnStarted && raw.includes('"user"') && !raw.includes('"tool_result"')) {
      const line = parse(raw);
      if (line && isPrompt(line)) turnStarted = true;
    }
    if (customTitle && (narration || turnStarted)) break;
  }
  return { title: customTitle ?? aiTitle, narration };
}

/** The first non-empty line of Markdown as plain text, cut to `max` characters. */
export function firstLine(text: string, max: number): string | null {
  for (const raw of text.split('\n')) {
    const line = raw
      .replace(/^\s*(?:#+|[-*>]|\d+\.)\s+/, '')
      .replace(/\*\*|__|`/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
    if (line) return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
  }
  return null;
}
