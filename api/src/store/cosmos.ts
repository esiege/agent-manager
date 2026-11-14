// Cosmos DB (NoSQL API, serverless) store used in Azure.
// Containers: agents (/id), keys (/id), alerts (/id), events (/agentId, 30-day TTL), logs (/source, 30-day TTL),
// messages (/machine, 1-day TTL), perfSessions (/id, 1-year TTL), perfSamples (/sessionId, 30-day TTL),
// blockers (/id, 90-day TTL from the last change).
// infra/main.bicep creates the same containers; ensure() creates them too when they're missing.

import { createHash } from 'node:crypto';
import { CosmosClient, type Container, type SqlParameter } from '@azure/cosmos';
import type { Agent, AgentEvent, AgentKind, AgentMessage, AlertSubscription, Blocker, LogEntry, PerfSample, PerfSession } from '@agent-manager-deluxe/shared';
import {
  BLOCKER_RETENTION_SECONDS,
  isReportingEvent,
  MESSAGE_RETENTION_SECONDS,
  PERF_SAMPLE_RETENTION_SECONDS,
  PERF_SESSION_RETENTION_SECONDS,
  REPORTING_RETENTION_DAYS,
  RETENTION_DAYS,
  type LogFilter,
  type MessageFilter,
  type Store,
  type StoredKey,
} from './types';

const TTL_SECONDS = RETENTION_DAYS * 86_400;
/** Per-item TTL on reporting events, which overrides the events container's default. */
const REPORTING_TTL_SECONDS = REPORTING_RETENTION_DAYS * 86_400;

/** An event as stored: reporting events carry their own, longer TTL. */
function eventDoc(e: AgentEvent): AgentEvent & { ttl?: number } {
  return isReportingEvent(e) ? { ...e, ttl: REPORTING_TTL_SECONDS } : e;
}

const CONTAINERS = {
  agents: { partitionKey: '/id' },
  keys: { partitionKey: '/id' },
  alerts: { partitionKey: '/id' },
  events: { partitionKey: '/agentId', defaultTtl: TTL_SECONDS },
  logs: { partitionKey: '/source', defaultTtl: TTL_SECONDS },
  messages: { partitionKey: '/machine', defaultTtl: MESSAGE_RETENTION_SECONDS },
  perfSessions: { partitionKey: '/id', defaultTtl: PERF_SESSION_RETENTION_SECONDS },
  perfSamples: { partitionKey: '/sessionId', defaultTtl: PERF_SAMPLE_RETENTION_SECONDS },
  blockers: { partitionKey: '/id', defaultTtl: BLOCKER_RETENTION_SECONDS },
} as const;

type Name = keyof typeof CONTAINERS;

/** Drops Cosmos system fields (_rid, _etag, _ts...) from an item. */
function clean<T>(item: T & Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(item)) if (!k.startsWith('_')) out[k] = v;
  return out as T;
}

// Cosmos document ids can't contain / \ # ?, but agent ids do ("pc/claude/<session>").
// Agents are stored under a hash of their id, with the real id kept in agentId.
export function agentDocId(agentId: string): string {
  return createHash('sha256').update(agentId).digest('hex');
}

type AgentDoc = Omit<Agent, 'id'> & { id: string; agentId: string };

export function toAgentDoc(agent: Agent): AgentDoc {
  return { ...agent, id: agentDocId(agent.id), agentId: agent.id };
}

export function fromAgentDoc(doc: AgentDoc): Agent {
  const { agentId, ...rest } = doc;
  return { ...rest, id: agentId };
}

export class CosmosStore implements Store {
  private readonly client: CosmosClient;
  private ready: Promise<Record<Name, Container>> | undefined;

  constructor(
    endpoint: string,
    key: string,
    private readonly databaseId: string,
  ) {
    this.client = new CosmosClient({ endpoint, key });
  }

  private containers(): Promise<Record<Name, Container>> {
    this.ready ??= (async () => {
      const { database } = await this.client.databases.createIfNotExists({ id: this.databaseId });
      const entries = await Promise.all(
        (Object.keys(CONTAINERS) as Name[]).map(async (name) => {
          const def = CONTAINERS[name];
          const { container } = await database.containers.createIfNotExists({
            id: name,
            partitionKey: { paths: [def.partitionKey] },
            ...('defaultTtl' in def ? { defaultTtl: def.defaultTtl } : {}),
          });
          return [name, container] as const;
        }),
      );
      return Object.fromEntries(entries) as Record<Name, Container>;
    })().catch((e) => {
      this.ready = undefined; // retry on the next call
      throw e;
    });
    return this.ready;
  }

  private async c(name: Name) {
    return (await this.containers())[name];
  }

  private async query<T>(name: Name, sql: string, parameters: SqlParameter[], partitionKey?: string): Promise<T[]> {
    const container = await this.c(name);
    const { resources } = await container.items
      .query<T & Record<string, unknown>>({ query: sql, parameters }, partitionKey ? { partitionKey } : {})
      .fetchAll();
    return resources.map(clean<T>);
  }

  private async read<T>(name: Name, id: string, partitionKey: string): Promise<T | null> {
    const container = await this.c(name);
    const { resource } = await container.item(id, partitionKey).read<T & Record<string, unknown>>();
    return resource ? clean<T>(resource) : null;
  }

  getKey(id: string) {
    return this.read<StoredKey>('keys', id, id);
  }
  listKeys() {
    return this.query<StoredKey>('keys', 'SELECT * FROM c', []);
  }
  async putKey(key: StoredKey) {
    await (await this.c('keys')).items.upsert(key);
  }

  async getAgent(id: string) {
    const docId = agentDocId(id);
    const doc = await this.read<AgentDoc>('agents', docId, docId);
    return doc ? fromAgentDoc(doc) : null;
  }
  async putAgent(agent: Agent) {
    await (await this.c('agents')).items.upsert(toAgentDoc(agent));
  }
  private async queryAgents(sql: string, parameters: SqlParameter[]) {
    return (await this.query<AgentDoc>('agents', sql, parameters)).map(fromAgentDoc);
  }
  listAgentsSeenSince(since: string) {
    return this.queryAgents('SELECT * FROM c WHERE c.lastSeen >= @since', [{ name: '@since', value: since }]);
  }
  listAgentsOn(machine: string, kind: AgentKind) {
    return this.queryAgents('SELECT * FROM c WHERE c.machine = @machine AND c.kind = @kind', [
      { name: '@machine', value: machine },
      { name: '@kind', value: kind },
    ]);
  }
  listChildren(parentId: string) {
    return this.queryAgents('SELECT * FROM c WHERE c.parentId = @parentId', [{ name: '@parentId', value: parentId }]);
  }

  async addEvents(events: AgentEvent[]) {
    const container = await this.c('events');
    await Promise.all(events.map((e) => container.items.create(eventDoc(e))));
  }
  listEvents(agentId: string, limit: number) {
    return this.query<AgentEvent>(
      'events',
      'SELECT TOP @limit * FROM c WHERE c.agentId = @agentId ORDER BY c.at DESC',
      [
        { name: '@limit', value: limit },
        { name: '@agentId', value: agentId },
      ],
      agentId,
    );
  }

  async listReportingEvents(since: string) {
    const container = await this.c('events');
    const { resources } = await container.items
      .query<AgentEvent & { ttl?: number } & Record<string, unknown>>({
        query: "SELECT * FROM c WHERE c.at >= @since AND (c.type = 'turn' OR c.type = 'result' OR ARRAY_LENGTH(c.usage) > 0)",
        parameters: [{ name: '@since', value: since }],
      })
      .fetchAll();
    // Events stored before reporting kept them longer still expire with the container's default:
    // write them once more with the longer TTL (the clock restarts from the write).
    const old = resources.filter((r) => r.ttl === undefined);
    for (let i = 0; i < old.length; i += 50) {
      await Promise.all(old.slice(i, i + 50).map((r) => container.items.upsert(eventDoc(clean<AgentEvent>(r)))));
    }
    return resources.map((r) => {
      const { ttl: _ttl, ...event } = clean<AgentEvent & { ttl?: number }>(r);
      return event as AgentEvent;
    });
  }

  async addLogs(logs: LogEntry[]) {
    const container = await this.c('logs');
    // Small batches keep a 500-entry call from tripping serverless request-rate limits.
    for (let i = 0; i < logs.length; i += 50) {
      await Promise.all(logs.slice(i, i + 50).map((l) => container.items.create(l)));
    }
  }
  async queryLogs(f: LogFilter) {
    const where: string[] = [];
    const parameters: SqlParameter[] = [{ name: '@limit', value: f.limit + 1 }];
    if (f.levels.length) {
      where.push('ARRAY_CONTAINS(@levels, c.level)');
      parameters.push({ name: '@levels', value: f.levels });
    }
    const eq = (field: 'source' | 'agentId' | 'correlationId', value: string | undefined) => {
      if (!value) return;
      where.push(`c.${field} = @${field}`);
      parameters.push({ name: `@${field}`, value });
    };
    eq('source', f.source);
    eq('agentId', f.agentId);
    eq('correlationId', f.correlationId);
    if (f.text) {
      where.push('CONTAINS(c.message, @text, true)');
      parameters.push({ name: '@text', value: f.text });
    }
    if (f.from) {
      where.push('c.at >= @from');
      parameters.push({ name: '@from', value: f.from });
    }
    if (f.to) {
      where.push('c.at <= @to');
      parameters.push({ name: '@to', value: f.to });
    }
    const sql = `SELECT TOP @limit * FROM c${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY c.at DESC`;
    const rows = await this.query<LogEntry>('logs', sql, parameters, f.source || undefined);
    return { logs: rows.slice(0, f.limit), truncated: rows.length > f.limit };
  }

  getAlert(id: string) {
    return this.read<AlertSubscription>('alerts', id, id);
  }
  listAlerts() {
    return this.query<AlertSubscription>('alerts', 'SELECT * FROM c', []);
  }
  async putAlert(subscription: AlertSubscription) {
    await (await this.c('alerts')).items.upsert(subscription);
  }
  async deleteAlert(id: string) {
    try {
      await (await this.c('alerts')).item(id, id).delete();
    } catch (e) {
      if ((e as { code?: number }).code !== 404) throw e; // already gone
    }
  }

  getMessage(machine: string, id: string) {
    return this.read<AgentMessage>('messages', id, machine);
  }
  async putMessage(message: AgentMessage) {
    await (await this.c('messages')).items.upsert(message);
  }
  listMessages(machine: string, f: MessageFilter) {
    const where = ['c.machine = @machine'];
    const parameters: SqlParameter[] = [
      { name: '@limit', value: f.limit },
      { name: '@machine', value: machine },
    ];
    if (f.agentId) {
      where.push('c.agentId = @agentId');
      parameters.push({ name: '@agentId', value: f.agentId });
    }
    if (f.status) {
      where.push('c.status = @status');
      parameters.push({ name: '@status', value: f.status });
    }
    const sql = `SELECT TOP @limit * FROM c WHERE ${where.join(' AND ')} ORDER BY c.createdAt DESC`;
    return this.query<AgentMessage>('messages', sql, parameters, machine);
  }

  getBlocker(id: string) {
    return this.read<Blocker>('blockers', id, id);
  }
  async putBlocker(blocker: Blocker) {
    await (await this.c('blockers')).items.upsert(blocker);
  }
  listBlockers(since: string) {
    return this.query<Blocker>(
      'blockers',
      "SELECT * FROM c WHERE c.status = 'open' OR c.resolvedAt >= @since ORDER BY c.createdAt DESC",
      [{ name: '@since', value: since }],
    );
  }

  getPerfSession(id: string) {
    return this.read<PerfSession>('perfSessions', id, id);
  }
  async putPerfSession(session: PerfSession) {
    await (await this.c('perfSessions')).items.upsert(session);
  }
  listPerfSessions(since: string, limit: number) {
    return this.query<PerfSession>('perfSessions', 'SELECT TOP @limit * FROM c WHERE c.lastSeen >= @since ORDER BY c.lastSeen DESC', [
      { name: '@limit', value: limit },
      { name: '@since', value: since },
    ]);
  }
  async addPerfSamples(samples: PerfSample[]) {
    const container = await this.c('perfSamples');
    const added: PerfSample[] = [];
    // Create, not upsert: a sample that is already there (a batch sent twice) answers 409 and is left out.
    for (let i = 0; i < samples.length; i += 50) {
      await Promise.all(
        samples.slice(i, i + 50).map(async (sample) => {
          try {
            await container.items.create(sample);
            added.push(sample);
          } catch (e) {
            if ((e as { code?: number }).code !== 409) throw e;
          }
        }),
      );
    }
    return added;
  }
  async listPerfSamples(sessionId: string, limit: number) {
    const latest = await this.query<PerfSample>(
      'perfSamples',
      'SELECT TOP @limit * FROM c WHERE c.sessionId = @sessionId ORDER BY c.t DESC',
      [
        { name: '@limit', value: limit },
        { name: '@sessionId', value: sessionId },
      ],
      sessionId,
    );
    return latest.reverse();
  }
}
