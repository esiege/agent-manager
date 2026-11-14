// Alerts (Settings > Alerts): tells subscriptions when an agent finishes, needs the owner,
// fails, or is cut off mid-request. ntfy is the only channel so far; others go in CHANNELS.

import {
  effectiveState,
  maskSecrets,
  type Agent,
  type AlertChannel,
  type AlertEvent,
  type AlertSubscription,
  type Blocker,
} from '@agent-manager-delux/shared';
import type { Ctx } from './http';

export interface AlertMessage {
  event: AlertEvent | 'test';
  title: string;
  body: string;
  /** The agent's page, opened when the alert is tapped. */
  click: string | null;
}

const SEND_TIMEOUT_MS = 3000;
const BODY_LENGTH = 1000;
const PROMPT_LENGTH = 120;
// The owner sent the next prompt, so they're right there: no need to tell them it was cut off.
const NEW_PROMPT = 'A new prompt came before it finished';
export const LOST_REASON = 'Connection lost mid-request';

const VERBS: Record<AlertEvent, string> = {
  finished: 'finished',
  waiting: 'needs you',
  failed: 'failed',
  unfinished: 'was cut off',
  blocker: 'is blocked',
};
const TAGS: Record<AlertMessage['event'], string> = {
  finished: 'white_check_mark',
  waiting: 'hourglass',
  failed: 'rotating_light',
  unfinished: 'warning',
  blocker: 'construction',
  test: 'bell',
};

// ---- What happened ----

interface Detected {
  event: AlertEvent;
  body: string;
}

const sameTurn = (before: Agent | null, after: Agent) =>
  before?.turn?.outcome === 'running' && before.turn.startedAt === after.turn?.startedAt;

function shorten(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function withPrompt(line: string, agent: Agent): string {
  const prompt = agent.turn?.prompt ?? agent.prompt;
  return prompt ? `${line}\nYou asked: ${shorten(prompt, PROMPT_LENGTH)}` : line;
}

function finishedLine(agent: Agent): string {
  const startedAt = agent.turn?.startedAt ?? '';
  if (agent.result && agent.result.at >= startedAt) return agent.result.title;
  return agent.story || 'Finished the request';
}

/** The alerts a change from `before` to `after` calls for. Only top-level agents alert. */
export function detect(before: Agent | null, after: Agent): Detected[] {
  if (after.parentId) return [];
  const found: Detected[] = [];
  if (after.state === 'waiting' && before?.state !== 'waiting') {
    found.push({ event: 'waiting', body: after.activity || 'Waiting for you' });
  }
  if (after.state === 'failed' && before?.state !== 'failed') {
    found.push({ event: 'failed', body: withPrompt(after.turn?.reason || after.activity || 'Failed', after) });
  }
  const turn = after.turn;
  if (turn && sameTurn(before, after)) {
    if (turn.outcome === 'finished') found.push({ event: 'finished', body: withPrompt(finishedLine(after), after) });
    if (turn.outcome === 'interrupted' && turn.reason !== NEW_PROMPT) {
      found.push({ event: 'unfinished', body: withPrompt(turn.reason || 'Cut off mid-request', after) });
    }
  }
  return found;
}

/** Who the alert is about: the project, else the agent's name. */
function subject(agent: Agent): string {
  return agent.project || agent.name;
}

export function agentPage(origin: string, agentId: string): string {
  return `${origin}/agents/detail?id=${encodeURIComponent(agentId)}`;
}

function message(agent: Agent, d: Detected, origin: string): AlertMessage {
  return {
    event: d.event,
    title: maskSecrets(`${subject(agent)} ${VERBS[d.event]}`),
    body: clip(maskSecrets(d.body), BODY_LENGTH),
    click: agentPage(origin, agent.id),
  };
}

// ---- Delivery ----

/** Header values must be Latin-1: anything else goes as an RFC 2047 encoded word, which ntfy reads. */
export function headerText(text: string): string {
  const flat = text.replace(/[\r\n]+/g, ' ');
  return /^[\x20-\x7e]*$/.test(flat) ? flat : `=?UTF-8?B?${Buffer.from(flat, 'utf8').toString('base64')}?=`;
}

async function sendNtfy(target: string, msg: AlertMessage): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': 'text/plain; charset=utf-8',
    Title: headerText(msg.title),
    Tags: TAGS[msg.event],
    Priority: msg.event === 'finished' || msg.event === 'test' ? 'default' : 'high',
  };
  if (msg.click) headers.Click = msg.click;
  const res = await fetch(target, { method: 'POST', headers, body: msg.body, signal: AbortSignal.timeout(SEND_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`ntfy answered ${res.status} ${res.statusText}`.trim());
}

const CHANNELS: Record<AlertChannel, (target: string, msg: AlertMessage) => Promise<void>> = { ntfy: sendNtfy };

/** One line saying why a send failed, without the target (the topic is the secret). */
function describe(e: unknown, target: string): string {
  const err = e as Error & { cause?: { message?: string; code?: string } };
  let text: string;
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') text = `No answer within ${SEND_TIMEOUT_MS / 1000} s`;
  else if (err?.cause) text = `Couldn't reach the server: ${err.cause.message ?? err.cause.code ?? err.message}`;
  else text = err?.message || String(e);
  return maskSecrets(text.split(target).join('<topic>').replace(/\s+/g, ' ').trim()).slice(0, 300);
}

/** Sends one message and records how it went on the subscription. Returns the error, or null. */
export async function deliver(ctx: Ctx, sub: AlertSubscription, msg: AlertMessage): Promise<string | null> {
  let error: string | null = null;
  try {
    await CHANNELS[sub.channel](sub.target, msg);
  } catch (e) {
    error = describe(e, sub.target);
  }
  try {
    // Re-read so an edit made meanwhile isn't overwritten.
    const latest = await ctx.store.getAlert(sub.id);
    if (latest) {
      const at = ctx.now().toISOString();
      await ctx.store.putAlert(error ? { ...latest, lastError: error } : { ...latest, lastSentAt: at, lastError: null });
    }
  } catch {
    // Recording is best effort; the alert itself went (or didn't) either way.
  }
  return error;
}

function wants(sub: AlertSubscription, agent: Pick<Agent, 'project'>, event: AlertEvent): boolean {
  return sub.enabled && sub.events.includes(event) && (sub.projects.length === 0 || sub.projects.includes(agent.project ?? ''));
}

// The same alert for the same agent within this window is dropped. Per instance.
const REPEAT_MS = 2 * 60_000;
const recent = new Map<string, number>();

function isRepeat(agentId: string, event: AlertEvent, now: number): boolean {
  const key = `${agentId}\n${event}`;
  const last = recent.get(key);
  if (last !== undefined && now - last < REPEAT_MS) return true;
  recent.set(key, now);
  if (recent.size > 1000) for (const [k, at] of recent) if (now - at >= REPEAT_MS) recent.delete(k);
  return false;
}

async function send(ctx: Ctx, subs: AlertSubscription[], agent: Agent, found: Detected[], origin: string): Promise<number> {
  const now = ctx.now().getTime();
  const jobs: Promise<unknown>[] = [];
  for (const d of found) {
    const to = subs.filter((s) => wants(s, agent, d.event));
    if (to.length === 0 || isRepeat(agent.id, d.event, now)) continue;
    const msg = message(agent, d, origin);
    jobs.push(...to.map((s) => deliver(ctx, s, msg)));
  }
  await Promise.allSettled(jobs);
  return jobs.length;
}

export function blockersPage(origin: string, blockerId: string): string {
  return `${origin}/blockers?${new URLSearchParams({ id: blockerId }).toString()}`;
}

/** Tells subscriptions about a new blocker. Never throws. */
export async function notifyBlocker(ctx: Ctx, blocker: Blocker, origin: string): Promise<void> {
  try {
    const subs = (await ctx.store.listAlerts()).filter((s) => wants(s, blocker, 'blocker'));
    if (subs.length === 0) return;
    const msg: AlertMessage = {
      event: 'blocker',
      title: maskSecrets(`${blocker.project || blocker.agentName} ${VERBS.blocker}`),
      body: clip(maskSecrets(`${blocker.title}
On ${blocker.machine}`), BODY_LENGTH),
      click: blockersPage(origin, blocker.id),
    };
    await Promise.allSettled(subs.map((s) => deliver(ctx, s, msg)));
  } catch (e) {
    console.error(`Blocker alert failed for ${blocker.id}: ${(e as Error).message}`);
  }
}

/** Called after an agent is written, with what it was before. Never throws. */
export async function notify(ctx: Ctx, before: Agent | null, after: Agent, origin: string): Promise<void> {
  try {
    const found = detect(before, after);
    if (found.length === 0) return; // most reports: no database read at all
    await send(ctx, await ctx.store.listAlerts(), after, found, origin);
  } catch (e) {
    console.error(`Alerts failed for ${after.id}: ${(e as Error).message}`);
  }
}

// ---- Lost sweep ----
// Going Lost is silence, so no report triggers it. Static Web Apps' managed functions can't run
// timers, so the sweep runs when the UI reads agents or a PC heartbeats (at most once a minute
// per instance), and on POST /api/v1/alerts/sweep for an outside cron.

const SWEEP_EVERY_MS = 60_000;
const SWEEP_DAYS = 1;
let lastSweep = -Infinity;

function cutOff(agent: Agent, now: number): boolean {
  return (
    !agent.parentId &&
    agent.turn?.outcome === 'running' &&
    agent.lostAlertFor !== agent.turn.startedAt &&
    effectiveState(agent, now) === 'lost'
  );
}

/**
 * Alerts "connection lost mid-request" once per request. `agents` saves a query when the caller
 * already has them. Returns how many messages went out. Never throws.
 */
export async function sweepLost(ctx: Ctx, origin: string, opts: { agents?: Agent[]; force?: boolean } = {}): Promise<number> {
  const now = ctx.now().getTime();
  if (!opts.force && now - lastSweep < SWEEP_EVERY_MS && now >= lastSweep) return 0;
  lastSweep = now;
  try {
    const subs = (await ctx.store.listAlerts()).filter((s) => s.enabled && s.events.includes('unfinished'));
    if (subs.length === 0) return 0;
    const agents = opts.agents ?? (await ctx.store.listAgentsSeenSince(new Date(now - SWEEP_DAYS * 86_400_000).toISOString()));
    let sent = 0;
    for (const candidate of agents.filter((a) => cutOff(a, now))) {
      // Mark first, on a fresh copy, so another instance's sweep or a racing report doesn't double up.
      const agent = await ctx.store.getAgent(candidate.id);
      if (!agent || !cutOff(agent, now)) continue;
      await ctx.store.putAgent({ ...agent, lostAlertFor: agent.turn!.startedAt });
      sent += await send(ctx, subs, agent, [{ event: 'unfinished', body: withPrompt(LOST_REASON, agent) }], origin);
    }
    return sent;
  } catch (e) {
    console.error(`The lost sweep failed: ${(e as Error).message}`);
    return 0;
  }
}

/** For tests. */
export function resetAlertState() {
  recent.clear();
  lastSweep = -Infinity;
}
