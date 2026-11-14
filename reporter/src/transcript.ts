// Reads what a session's transcript says about it: its title, and the first line of what the
// agent last said it was doing. The transcript's format is internal to Claude Code and changes
// between versions, so this is best effort: anything unexpected gives nulls, never an error.

import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import type { TokenUsage } from '@agent-manager-delux/shared';

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

// ---- Token usage ----

/** A turn bigger than this is skipped rather than read into memory; its tokens go uncounted. */
const USAGE_MAX_BYTES = 64 * 1024 * 1024;

export interface UsageRead {
  /** Tokens per model in the lines read. */
  usage: TokenUsage[];
  /** Where the next read starts: just past the last whole line. */
  offset: number;
}

/**
 * The tokens used in the transcript from byte `offset` on. Without an offset (a session this
 * agentctl hasn't counted yet) it counts nothing and starts from the end, so history that was
 * never counted, or a resumed session's, isn't counted now as if it just happened.
 */
export function readUsage(file: string | undefined, offset: number | undefined, subagent = false): UsageRead | null {
  if (!file) return null;
  let fd: number;
  try {
    fd = openSync(file, 'r');
  } catch {
    return null;
  }
  try {
    const size = fstatSync(fd).size;
    // A shorter file than before was rewritten: start over from its end.
    if (offset === undefined || offset > size) return { usage: [], offset: size };
    if (size - offset > USAGE_MAX_BYTES) return { usage: [], offset: size };
    const buf = Buffer.alloc(size - offset);
    readSync(fd, buf, 0, buf.length, offset);
    // A line still being written is left for the next read.
    const end = buf.lastIndexOf(0x0a) + 1;
    return { usage: parseUsage(buf.subarray(0, end).toString('utf8'), subagent), offset: offset + end };
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

type UsageLine = {
  type?: string;
  isSidechain?: boolean;
  message?: {
    id?: string;
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation?: { ephemeral_1h_input_tokens?: number };
    };
  };
};

const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);

/**
 * Sums the usage of the assistant messages in transcript lines. Claude Code writes one line per
 * content block, each repeating its message's usage, so each message counts once, at its largest.
 * A session's transcript can hold its sub-agents' lines (isSidechain) too; those are counted from
 * the sub-agents' own transcripts instead, where every line is a sidechain one (`subagent`).
 */
export function parseUsage(text: string, subagent = false): TokenUsage[] {
  const messages = new Map<string, TokenUsage>();
  let unnamed = 0;
  for (const raw of text.split('\n')) {
    if (!raw.includes('"usage"') || !raw.includes('"assistant"')) continue;
    const line = parse(raw) as UsageLine | null;
    const m = line?.message;
    if (!line || line.type !== 'assistant' || (line.isSidechain && !subagent) || !m?.usage || !m.model || m.model.startsWith('<')) continue;
    const u = m.usage;
    const next: TokenUsage = {
      model: m.model,
      input: count(u.input_tokens),
      output: count(u.output_tokens),
      cacheWrite: count(u.cache_creation_input_tokens),
      cacheWrite1h: count(u.cache_creation?.ephemeral_1h_input_tokens),
      cacheRead: count(u.cache_read_input_tokens),
    };
    const id = m.id ?? `unnamed-${unnamed++}`;
    const seen = messages.get(id);
    messages.set(id, seen ? maxUsage(seen, next) : next);
  }
  const byModel = new Map<string, TokenUsage>();
  for (const u of messages.values()) {
    const total = byModel.get(u.model);
    byModel.set(u.model, total ? addUsage(total, u) : { ...u });
  }
  return [...byModel.values()].filter((u) => u.input + u.output + u.cacheWrite + u.cacheRead > 0);
}

const FIELDS = ['input', 'output', 'cacheWrite', 'cacheWrite1h', 'cacheRead'] as const;

function maxUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  const out = { ...a };
  for (const f of FIELDS) out[f] = Math.max(a[f], b[f]);
  return out;
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  const out = { ...a };
  for (const f of FIELDS) out[f] = a[f] + b[f];
  return out;
}
