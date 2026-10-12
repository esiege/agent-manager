// Alert subscriptions, managed by the signed-in owner on the Settings tab, plus the lost sweep
// an outside cron can call with a machine key.

import { randomUUID } from 'node:crypto';
import { validateAlertSubscription, type AlertsResponse, type AlertSubscription } from '@agent-manager/shared';
import { deliver, sweepLost } from '../alerts';
import { requireKey, requireOwner, requireOwnerWrite } from '../auth';
import { HttpError, fail, ok, publicOrigin, readJson, type Ctx, type Handler } from '../http';

const MAX_BODY = 8192;
const MAX_SUBSCRIPTIONS = 20;

function idField(body: unknown): string {
  const v = (body as Record<string, unknown> | null)?.id;
  if (typeof v !== 'string' || v.trim() === '') throw new HttpError(400, 'id is required');
  return v.trim();
}

async function mustGet(ctx: Ctx, id: string): Promise<AlertSubscription> {
  const sub = await ctx.store.getAlert(id);
  if (!sub) throw new HttpError(404, `No alert subscription with id ${id}`);
  return sub;
}

export const listAlerts: Handler = async (req, ctx) => {
  requireOwner(req, ctx);
  const subscriptions = (await ctx.store.listAlerts()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const body: AlertsResponse = { subscriptions };
  return ok(body);
};

/** Creates a subscription (no id) or updates one. */
export const saveAlert: Handler = async (req, ctx) => {
  requireOwnerWrite(req, ctx);
  const result = validateAlertSubscription(readJson(req, MAX_BODY));
  if (!result.ok) return fail(400, result.error);
  const input = result.value;

  const existing = input.id ? await mustGet(ctx, input.id) : null;
  if (!existing && (await ctx.store.listAlerts()).length >= MAX_SUBSCRIPTIONS) {
    throw new HttpError(409, `There are already ${MAX_SUBSCRIPTIONS} alert subscriptions; delete one first`);
  }
  const subscription: AlertSubscription = {
    id: existing?.id ?? randomUUID(),
    name: input.name,
    channel: input.channel,
    target: input.target,
    events: input.events,
    projects: input.projects ?? [],
    enabled: input.enabled ?? true,
    createdAt: existing?.createdAt ?? ctx.now().toISOString(),
    lastSentAt: existing?.lastSentAt ?? null,
    // A new target hasn't failed yet.
    lastError: existing && existing.target === input.target ? existing.lastError : null,
  };
  await ctx.store.putAlert(subscription);
  return ok({ subscription }, existing ? 200 : 201);
};

export const deleteAlert: Handler = async (req, ctx) => {
  requireOwnerWrite(req, ctx);
  const sub = await mustGet(ctx, idField(readJson(req, MAX_BODY)));
  await ctx.store.deleteAlert(sub.id);
  return ok({ ok: true });
};

/** Sends a test message, whether or not the subscription is enabled. */
export const testAlert: Handler = async (req, ctx) => {
  requireOwnerWrite(req, ctx);
  const sub = await mustGet(ctx, idField(readJson(req, MAX_BODY)));
  const error = await deliver(ctx, sub, {
    event: 'test',
    title: 'Agent Manager test',
    body: `Alerts for ${sub.name} arrive here.`,
    click: `${publicOrigin(req, ctx.env)}/settings`,
  });
  if (error) throw new HttpError(502, `The test didn't go through: ${error}`);
  return ok({ subscription: await mustGet(ctx, sub.id) });
};

/** For a cron (such as a scheduled GitHub Action) when nobody has the UI open. */
export const sweepAlerts: Handler = async (req, ctx) => {
  await requireKey(req, ctx);
  const sent = await sweepLost(ctx, publicOrigin(req, ctx.env), { force: true });
  return ok({ ok: true, sent });
};
