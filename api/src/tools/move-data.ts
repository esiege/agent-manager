// Copies an install's data between "on this PC" (api/.local-store.json and api/.local-media) and
// "in the cloud" (Cosmos DB and Blob Storage). Run by scripts/move-data.ps1, which reads the cloud's
// connection details from Azure and sets them as environment variables.
//
//   node api/dist/move-data.js to-cloud [store file] [media folder]
//   node api/dist/move-data.js to-local [store file] [media folder]
//
// To the cloud, every write is an upsert, so running it again is safe. Each item gets a TTL of what's
// left of its retention, so data kept locally for 20 of its 30 days is deleted after 10 more.
// To this PC, an existing store file is kept beside the new one as <file>.bak.

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { CosmosClient, type Database } from '@azure/cosmos';
import type { Blocker } from '@agent-manager-delux/shared';
import { eventDoc, fromAgentDoc, toAgentDoc } from '../store/cosmos';
import { BlobMediaStore, FolderMediaStore, type MediaStore } from '../store/media';
import type { Snapshot } from '../store/memory';
import {
  BLOCKER_RETENTION_SECONDS,
  isReportingEvent,
  PERF_SAMPLE_RETENTION_SECONDS,
  PERF_SESSION_RETENTION_SECONDS,
  REPORTING_RETENTION_DAYS,
  RETENTION_DAYS,
} from '../store/types';

/** The containers copied, in order. Messages are left out: they're only kept a day. */
export const CONTAINERS = ['keys', 'alerts', 'agents', 'blockers', 'perfSessions', 'perfSamples', 'events'] as const;
export type DataContainer = (typeof CONTAINERS)[number];

export interface CloudPlan {
  docs: Record<DataContainer, Record<string, unknown>[]>;
  /** Items left out because their retention has already run out. */
  expired: number;
}

const DAY = 86_400;

/**
 * What's left of an item's retention, in seconds, counted from `from` (an ISO time).
 * Null when it has run out. At least a minute, so an item about to expire still arrives.
 */
function remaining(from: string, retentionSeconds: number, now: Date): number | null {
  const left = retentionSeconds - Math.floor((now.getTime() - Date.parse(from)) / 1000);
  if (!Number.isFinite(left) || left <= 0) return null;
  return Math.max(60, left);
}

/** Turns a local snapshot into the Cosmos documents to write, each with the TTL it has left. */
export function toCloud(snap: Snapshot, now = new Date()): CloudPlan {
  let expired = 0;
  const withTtl = <T extends object>(item: T, from: string, retentionSeconds: number) => {
    const ttl = remaining(from, retentionSeconds, now);
    if (ttl === null) {
      expired++;
      return [];
    }
    return [{ ...item, ttl } as Record<string, unknown>];
  };
  const docs: CloudPlan['docs'] = {
    keys: snap.keys.map((k) => ({ ...k })),
    alerts: (snap.alerts ?? []).map((a) => ({ ...a })),
    agents: snap.agents.map((a) => ({ ...toAgentDoc(a) })),
    blockers: (snap.blockers ?? []).flatMap((b) => withTtl(b, b.resolvedAt ?? b.createdAt, BLOCKER_RETENTION_SECONDS)),
    perfSessions: (snap.perfSessions ?? []).flatMap((p) => withTtl(p, p.lastSeen, PERF_SESSION_RETENTION_SECONDS)),
    perfSamples: (snap.perfSamples ?? []).flatMap((p) => withTtl(p, p.receivedAt, PERF_SAMPLE_RETENTION_SECONDS)),
    events: snap.events.flatMap((e) =>
      withTtl(eventDoc(e), e.receivedAt, (isReportingEvent(e) ? REPORTING_RETENTION_DAYS : RETENTION_DAYS) * DAY),
    ),
  };
  return { docs, expired };
}

/** Drops Cosmos's system fields (_rid, _etag, _ts...) and the TTL from a document. */
function strip(doc: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc)) if (!k.startsWith('_') && k !== 'ttl') out[k] = v;
  return out;
}

/** Turns the documents read from Cosmos into a local snapshot. */
export function toLocal(docs: Record<DataContainer, Record<string, unknown>[]>): Snapshot {
  const plain = (name: DataContainer) => docs[name].map(strip);
  return {
    keys: plain('keys') as unknown as Snapshot['keys'],
    alerts: plain('alerts') as unknown as NonNullable<Snapshot['alerts']>,
    agents: plain('agents').map((d) => fromAgentDoc(d as never)),
    blockers: plain('blockers') as unknown as NonNullable<Snapshot['blockers']>,
    perfSessions: plain('perfSessions') as unknown as NonNullable<Snapshot['perfSessions']>,
    perfSamples: plain('perfSamples') as unknown as NonNullable<Snapshot['perfSamples']>,
    events: plain('events') as unknown as Snapshot['events'],
    messages: [],
  };
}

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} isn't set. Run this through scripts/move-data.ps1, which sets it.`);
  return value;
}

function cloud(): { database: Database; media: MediaStore | null } {
  const client = new CosmosClient({ endpoint: env('COSMOS_ENDPOINT'), key: env('COSMOS_KEY') });
  const media =
    process.env.BLOB_ACCOUNT && process.env.BLOB_KEY
      ? new BlobMediaStore(process.env.BLOB_ACCOUNT, process.env.BLOB_KEY, process.env.BLOB_CONTAINER || 'blocker-media')
      : null;
  return { database: client.database(process.env.COSMOS_DATABASE || 'agentmanager'), media };
}

/** Copies each blocker's screenshots and videos. */
async function copyMedia(blockers: Blocker[], from: MediaStore, to: MediaStore) {
  let copied = 0;
  let missing = 0;
  for (const b of blockers) {
    for (const m of b.media ?? []) {
      const name = `${b.id}/${m.id}`;
      const file = await from.get(name);
      if (!file) {
        missing++;
        continue;
      }
      await to.put(name, file.bytes, m.contentType);
      copied++;
    }
  }
  console.log(`  media: ${copied} file(s)${missing ? `, ${missing} not found` : ''}`);
}

async function moveToCloud(storeFile: string, mediaDir: string) {
  if (!existsSync(storeFile)) throw new Error(`No local data at ${storeFile}.`);
  const snap = JSON.parse(readFileSync(storeFile, 'utf8')) as Snapshot;
  const plan = toCloud(snap);
  const { database, media } = cloud();

  console.log(`Copying ${storeFile} to ${env('COSMOS_ENDPOINT')}`);
  for (const name of CONTAINERS) {
    const container = database.container(name);
    const docs = plan.docs[name];
    for (let i = 0; i < docs.length; i += 50) {
      await Promise.all(docs.slice(i, i + 50).map((d) => container.items.upsert(d)));
    }
    console.log(`  ${name}: ${docs.length}`);
  }
  if (plan.expired) console.log(`  left out ${plan.expired} item(s) past their retention`);

  if (media && existsSync(mediaDir)) {
    await copyMedia(plan.docs.blockers as unknown as Blocker[], new FolderMediaStore(mediaDir), media);
  }
}

async function moveToLocal(storeFile: string, mediaDir: string) {
  const { database, media } = cloud();
  console.log(`Copying ${env('COSMOS_ENDPOINT')} to ${storeFile}`);
  const docs = {} as Record<DataContainer, Record<string, unknown>[]>;
  for (const name of CONTAINERS) {
    const { resources } = await database.container(name).items.query<Record<string, unknown>>('SELECT * FROM c').fetchAll();
    docs[name] = resources;
    console.log(`  ${name}: ${resources.length}`);
  }
  const snap = toLocal(docs);

  if (existsSync(storeFile)) {
    copyFileSync(storeFile, `${storeFile}.bak`);
    console.log(`  kept the old local data as ${storeFile}.bak`);
  }
  mkdirSync(dirname(storeFile), { recursive: true });
  writeFileSync(storeFile, JSON.stringify(snap));

  if (media) await copyMedia(snap.blockers ?? [], media, new FolderMediaStore(mediaDir));
}

async function main() {
  const [direction, storeFile = 'api/.local-store.json', mediaDir = 'api/.local-media'] = process.argv.slice(2);
  if (direction === 'to-cloud') await moveToCloud(storeFile, mediaDir);
  else if (direction === 'to-local') await moveToLocal(storeFile, mediaDir);
  else throw new Error('Usage: node api/dist/move-data.js to-cloud|to-local [store file] [media folder]');
  console.log('Done.');
}

if (require.main === module) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
