// Performance of the games and apps we build. Games send sessions and samples with a key
// (a game key is enough). The Performance tab reads them as the signed-in owner, and agents
// read them with a machine key (agentctl perf).
// What games send is described in web/public/performance.md.

import {
  LIMITS,
  PERF_MAX_DAYS,
  PERF_SESSION_ID,
  addPerfSamples,
  emptyPerfTotals,
  maskDeep,
  perfSampleId,
  validatePerfSamples,
  validatePerfSession,
  worstPerfHitches,
  type PerfSample,
  type PerfSamplesResponse,
  type PerfSession,
  type PerfSessionDetailResponse,
  type PerfSessionResponse,
  type PerfSessionsResponse,
} from '@agent-manager-delux/shared';
import { requireKey, requireOwnerOrKey } from '../auth';
import { HttpError, fail, ok, publicOrigin, query, readJson, type Handler } from '../http';

const DEFAULT_DAYS = 30;
const MAX_SESSIONS = 2000;
/** About 14 hours of 10-second windows. */
const MAX_SAMPLES = 5000;

/** Start a session, update what's known about it, or end it. Fields left out keep their value. */
export const perfSession: Handler = async (req, ctx) => {
  const key = await requireKey(req, ctx, 'perf');
  const result = validatePerfSession(readJson(req, LIMITS.reportBytes));
  if (!result.ok) return fail(400, result.error);
  const input = result.value;

  const now = ctx.now().toISOString();
  const existing = await ctx.store.getPerfSession(input.sessionId);
  const pick = <T>(incoming: T | undefined, current: T | undefined): T | null => (incoming !== undefined ? incoming : (current ?? null));
  const session: PerfSession = {
    id: input.sessionId,
    game: input.game,
    machine: input.machine,
    build: pick(input.build, existing?.build),
    platform: pick(input.platform, existing?.platform),
    cpu: pick(input.cpu, existing?.cpu),
    gpu: pick(input.gpu, existing?.gpu),
    cpuCores: pick(input.cpuCores, existing?.cpuCores),
    ramMb: pick(input.ramMb, existing?.ramMb),
    vramMb: pick(input.vramMb, existing?.vramMb),
    os: pick(input.os, existing?.os),
    resolution: pick(input.resolution, existing?.resolution),
    refreshHz: pick(input.refreshHz, existing?.refreshHz),
    loadSeconds: pick(input.loadSeconds, existing?.loadSeconds),
    worstHitches: existing?.worstHitches ?? [],
    details: {
      ...existing?.details,
      ...(input.details ? maskDeep(input.details) : {}),
    },
    startedAt: existing?.startedAt ?? now,
    lastSeen: now,
    // `ended: false` reopens it: the game carried on after all.
    endedAt: input.ended === undefined ? (existing?.endedAt ?? null) : input.ended ? (existing?.endedAt ?? now) : null,
    totals: existing?.totals ?? emptyPerfTotals(),
    keyName: key.name,
  };

  if (!input.test) await ctx.store.putPerfSession(session);
  const body: PerfSessionResponse = {
    ok: true,
    test: Boolean(input.test),
    stored: session,
    warnings: result.warnings,
    sessionUrl: `${publicOrigin(req, ctx.env)}/performance/session?id=${encodeURIComponent(session.id)}`,
  };
  return ok(body);
};

export const perfSamples: Handler = async (req, ctx) => {
  await requireKey(req, ctx, 'perf');
  const result = validatePerfSamples(readJson(req, LIMITS.perfBytes));
  if (!result.ok) return fail(400, result.error);
  const input = result.value;

  const session = await ctx.store.getPerfSession(input.sessionId);
  if (!session) {
    throw new HttpError(404, `No performance session ${input.sessionId}; start it with POST /api/v1/perf/session first`);
  }

  const now = ctx.now().toISOString();
  const samples: PerfSample[] = input.samples.map((s) => ({
    ...s,
    id: perfSampleId(session.id, s.t),
    sessionId: session.id,
    receivedAt: now,
  }));
  let added = samples;
  if (!input.test) {
    // Only samples that weren't stored yet count, so a batch retried over a bad connection isn't counted twice.
    added = await ctx.store.addPerfSamples(samples);
    await ctx.store.putPerfSession({
      ...session,
      lastSeen: now,
      totals: addPerfSamples(session.totals, added),
      worstHitches: worstPerfHitches(session.worstHitches, input.hitchEvents ?? []),
    });
  }
  const body: PerfSamplesResponse = {
    ok: true,
    test: Boolean(input.test),
    stored: { count: added.length, duplicates: samples.length - added.length, hitchEvents: input.hitchEvents?.length ?? 0 },
    warnings: result.warnings,
  };
  return ok(body);
};

export const perfSessions: Handler = async (req, ctx) => {
  await requireOwnerOrKey(req, ctx);
  const game = query(req).get('game')?.trim().toLowerCase();
  const limitParam = query(req).get('limit');
  const limit = limitParam === null ? MAX_SESSIONS : Number(limitParam);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SESSIONS) {
    throw new HttpError(400, `limit must be a whole number from 1 to ${MAX_SESSIONS}`);
  }
  const daysParam = query(req).get('days');
  const days = daysParam === null ? DEFAULT_DAYS : Number(daysParam);
  if (!Number.isInteger(days) || days < 1 || days > PERF_MAX_DAYS) {
    throw new HttpError(400, `days must be a whole number from 1 to ${PERF_MAX_DAYS}`);
  }
  const now = ctx.now();
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const found = (await ctx.store.listPerfSessions(since, MAX_SESSIONS + 1)).filter((s) => !game || s.game.toLowerCase() === game);
  const body: PerfSessionsResponse = {
    now: now.toISOString(),
    days,
    sessions: found.slice(0, limit),
    truncated: found.length > limit,
  };
  return ok(body);
};

export const perfSessionDetail: Handler = async (req, ctx) => {
  await requireOwnerOrKey(req, ctx);
  const id = query(req).get('id');
  if (!id || !PERF_SESSION_ID.test(id)) throw new HttpError(400, 'id is required, for example /api/v1/perf/session?id=<sessionId>');
  const session = await ctx.store.getPerfSession(id);
  if (!session) throw new HttpError(404, `No performance session ${id}`);
  const samples = await ctx.store.listPerfSamples(id, MAX_SAMPLES + 1);
  const body: PerfSessionDetailResponse = {
    now: ctx.now().toISOString(),
    session,
    samples: samples.slice(-MAX_SAMPLES),
    truncated: samples.length > MAX_SAMPLES,
  };
  return ok(body);
};
