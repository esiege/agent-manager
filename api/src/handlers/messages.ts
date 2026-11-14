// Messages from the owner to a Claude Code session (Docs/Agent-Messaging-Findings.md).
// The owner queues one here; agentctl on the session's PC collects it with its machine key and
// posts it into the session's inbox. Only the key that reports the agent can collect it, and a
// message nobody collects within MESSAGE_TTL_SECONDS expires.

import { randomUUID } from 'node:crypto';
import {
  LIMITS,
  MESSAGE_TTL_SECONDS,
  effectiveState,
  isRunning,
  maskSecrets,
  type Agent,
  type AgentEvent,
  type AgentMessage,
  type InboxResponse,
  type SendMessageResponse,
} from '@agent-manager-delux/shared';
import { requireKey, requireOwnerWrite } from '../auth';
import { HttpError, ok, readJson, type Ctx, type Handler } from '../http';

const MAX_BODY = 32 * 1024;
const REASON_LENGTH = 300;
const INBOX_LIMIT = 50;
const PREVIEW_LENGTH = 200;

function field(body: unknown, name: string): unknown {
  return (body as Record<string, unknown> | null)?.[name];
}

function stringField(body: unknown, name: string, max: number): string {
  const v = field(body, name);
  if (typeof v !== 'string' || v.trim() === '') throw new HttpError(400, `${name} is required`);
  if (v.length > max) throw new HttpError(400, `${name} is longer than ${max} characters`);
  return v.trim();
}

function messageEvent(agentId: string, activity: string, at: string): AgentEvent {
  return { id: randomUUID(), agentId, type: 'message', at, receivedAt: at, state: null, activity, link: null, details: null };
}

export function preview(text: string): string {
  const line = maskSecrets(text).replace(/\s+/g, ' ');
  return line.length > PREVIEW_LENGTH ? `${line.slice(0, PREVIEW_LENGTH - 1)}…` : line;
}

/** POST /api/v1/messages: the owner sends text to a running Claude Code session. */
export const sendMessage: Handler = async (req, ctx) => {
  const owner = requireOwnerWrite(req, ctx);
  const body = readJson(req, MAX_BODY);
  const agentId = stringField(body, 'agentId', LIMITS.idLength);
  const text = stringField(body, 'text', LIMITS.agentMessageLength);

  const agent = await ctx.store.getAgent(agentId);
  if (!agent) throw new HttpError(404, `No agent with id ${agentId}`);
  const now = ctx.now();
  const refused = whyNoMessages(agent, now);
  if (refused) throw new HttpError(409, refused);
  const message = await queueMessage(ctx, agent, text, owner.login, `Message sent by ${owner.login}: ${preview(text)}`);
  const res: SendMessageResponse = { message };
  return ok(res, 201);
};

/** Why the agent can't take a message now, or null when it can. */
export function whyNoMessages(agent: Agent, now: Date): string | null {
  if (agent.kind !== 'claude-code' || agent.parentId) {
    return 'Only Claude Code sessions take messages, not sub-agents or other kinds of agent';
  }
  const state = effectiveState(agent, now.getTime());
  if (!isRunning(state)) return `The session is ${state}, so nothing would deliver the message`;
  // Claude Code would treat agentctl's message as the session's own, so a session that skips
  // permission prompts would act on it unchecked. agentctl refuses these too.
  if (agent.details.permissionMode === 'bypassPermissions') {
    return "The session skips permission prompts, so it doesn't take messages from Agent Manager Delux";
  }
  return null;
}

/** Queues a message for agentctl on the agent's PC to post into the session. Check whyNoMessages first. */
export async function queueMessage(ctx: Ctx, agent: Agent, text: string, from: string, activity: string): Promise<AgentMessage> {
  const now = ctx.now();
  const at = now.toISOString();
  const message: AgentMessage = {
    id: randomUUID(),
    agentId: agent.id,
    machine: agent.machine,
    keyName: agent.keyName,
    text,
    from,
    createdAt: at,
    expiresAt: new Date(now.getTime() + MESSAGE_TTL_SECONDS * 1000).toISOString(),
    status: 'pending',
    doneAt: null,
    reason: null,
  };
  await ctx.store.putMessage(message);
  await ctx.store.addEvents([messageEvent(agent.id, activity, at)]);
  return message;
}

/** POST /api/v1/inbox: agentctl collects the messages waiting for sessions on its machine. */
export const inbox: Handler = async (req, ctx) => {
  const key = await requireKey(req, ctx);
  const machine = stringField(readJson(req, MAX_BODY), 'machine', LIMITS.nameLength);
  const now = ctx.now().toISOString();
  const pending = await ctx.store.listMessages(machine, { status: 'pending', limit: INBOX_LIMIT });
  const messages = pending
    .filter((m) => m.keyName === key.name && m.expiresAt > now)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const res: InboxResponse = { messages };
  return ok(res);
};

/** POST /api/v1/inbox/ack: agentctl says whether it delivered a message. */
export const ackMessage: Handler = async (req, ctx) => {
  const key = await requireKey(req, ctx);
  const body = readJson(req, MAX_BODY);
  const id = stringField(body, 'id', LIMITS.idLength);
  const machine = stringField(body, 'machine', LIMITS.nameLength);
  const status = field(body, 'status');
  if (status !== 'delivered' && status !== 'failed') throw new HttpError(400, 'status must be delivered or failed');
  const rawReason = field(body, 'reason');
  if (rawReason !== undefined && rawReason !== null && typeof rawReason !== 'string') throw new HttpError(400, 'reason must be a string');
  const reason = typeof rawReason === 'string' && rawReason.trim() ? rawReason.trim().slice(0, REASON_LENGTH) : null;

  const message = await ctx.store.getMessage(machine, id);
  if (!message || message.keyName !== key.name) throw new HttpError(404, `No message with id ${id} for this machine key`);
  // A repeated ack (the first answer was lost) changes nothing.
  if (message.status !== 'pending') return ok({ message });

  const at = ctx.now().toISOString();
  const done: AgentMessage = { ...message, status, doneAt: at, reason: status === 'failed' ? (reason ?? 'Not delivered') : null };
  await ctx.store.putMessage(done);
  const activity = status === 'delivered' ? "Message posted to the session's inbox" : `Message not delivered: ${done.reason}`;
  await ctx.store.addEvents([messageEvent(message.agentId, activity, at)]);
  return ok({ message: done });
};
