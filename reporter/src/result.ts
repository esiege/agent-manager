// The report of finished work: what was asked, what was done, and what the person should see now.
// `agentctl done` sends one the agent wrote. When the agent committed during a request but didn't
// run it, the Stop hook builds one from the commit and the agent's final message.

import { LIMITS, type WorkResultInput } from '@agent-manager-delux/shared';
import type { CommitInfo } from './git';

/** Headings that introduce acceptance steps in an agent's final message. */
const CHECKS_HEADING =
  /^\s*(?:#{1,6}\s*|\*\*)?(?:how to (?:check|verify|test|try)|what you should see|to (?:check|verify)|acceptance(?: steps| checks)?|verify|try it(?: out)?|checks?)\b.*$/i;

/** Splits a final message into the summary and the acceptance steps under a "How to check" heading. */
export function splitChecks(message: string): { summary: string; checks: string[] } {
  const lines = message.split('\n');
  const at = lines.findIndex((l) => CHECKS_HEADING.test(l) && l.trim().length < 80);
  if (at < 0) return { summary: message.trim(), checks: [] };

  const checks: string[] = [];
  let end = at + 1;
  for (; end < lines.length; end++) {
    const line = lines[end]!;
    const item = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.+)$/.exec(line);
    if (item) checks.push(item[1]!.trim());
    else if (line.trim() && checks.length) break; // the list is over
  }
  if (!checks.length) return { summary: message.trim(), checks: [] };
  const summary = [...lines.slice(0, at), ...lines.slice(end)].join('\n').trim();
  return { summary, checks };
}

export function resultFrom(commit: CommitInfo, finalMessage: string | undefined): WorkResultInput {
  const { summary, checks } = splitChecks(finalMessage ?? '');
  return {
    title: commit.subject.slice(0, LIMITS.resultTitleLength) || commit.sha.slice(0, 7),
    summary: (summary || commit.subject).slice(0, LIMITS.resultSummaryLength),
    checks: checks.slice(0, LIMITS.resultChecks).map((c) => c.slice(0, LIMITS.resultCheckLength)),
    commit: commit.sha,
    commitUrl: commit.url,
    branch: commit.branch,
    pushed: commit.pushed,
  };
}
