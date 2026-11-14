// Machine keys, managed by the signed-in owner on the Settings tab (U-08).

import { KEY_SCOPES, type CreateKeyResponse, type KeyScope, type KeysResponse, type MachineKey } from '@agent-manager-delux/shared';
import { forgetKey, hashSecret, newKeySecret, publicKey, requireOwner, requireOwnerWrite } from '../auth';
import { HttpError, ok, readJson, type Handler } from '../http';

const MAX_BODY = 4096;

function stringField(body: unknown, field: string): string {
  const v = (body as Record<string, unknown> | null)?.[field];
  if (typeof v !== 'string' || v.trim() === '') throw new HttpError(400, `${field} is required`);
  return v.trim();
}

export const listKeys: Handler = async (req, ctx) => {
  requireOwner(req, ctx);
  const keys = (await ctx.store.listKeys()).map(publicKey).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const body: KeysResponse = { keys };
  return ok(body);
};

export const createKey: Handler = async (req, ctx) => {
  requireOwnerWrite(req, ctx);
  const input = readJson(req, MAX_BODY);
  const name = stringField(input, 'name');
  if (name.length > 60) throw new HttpError(400, 'name must be at most 60 characters');
  const scope = ((input as { scope?: unknown }).scope ?? 'all') as KeyScope;
  if (!KEY_SCOPES.includes(scope)) throw new HttpError(400, `scope must be one of ${KEY_SCOPES.join(', ')}`);

  const active = (await ctx.store.listKeys()).filter((k) => !k.revokedAt);
  if (active.some((k) => k.name.toLowerCase() === name.toLowerCase())) {
    throw new HttpError(409, `A key named ${name} already exists; revoke it first or pick another name`);
  }

  const { id, secret } = newKeySecret();
  const key = { id, name, scope, createdAt: ctx.now().toISOString(), lastUsedAt: null, revokedAt: null, hash: hashSecret(secret) };
  await ctx.store.putKey(key);
  const body: CreateKeyResponse = { key: publicKey(key), secret };
  return ok(body, 201);
};

export const revokeKey: Handler = async (req, ctx) => {
  requireOwnerWrite(req, ctx);
  const id = stringField(readJson(req, MAX_BODY), 'id');
  const key = await ctx.store.getKey(id);
  if (!key) throw new HttpError(404, `No key with id ${id}`);
  if (!key.revokedAt) {
    key.revokedAt = ctx.now().toISOString();
    await ctx.store.putKey(key);
  }
  forgetKey(id);
  const body: { key: MachineKey } = { key: publicKey(key) };
  return ok(body);
};
