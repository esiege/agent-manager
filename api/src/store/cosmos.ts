// Cosmos DB (NoSQL API, serverless) store used in Azure.
// Containers: agents (/id), keys (/id), alerts (/id), events (/agentId, 30-day TTL), logs (/source, 30-day TTL).
// infra/main.bicep creates the same containers; ensure() creates them too when they're missing.

import { createHash } from 'node:crypto';
import { CosmosClient, type Container, type SqlParameter } from '@azure/cosmos';
import type { Agent, AgentEvent, AgentKind, AlertSubscription, LogEntry } from '@agent-manager/shared';
import { RETENTION_DAYS, type LogFilter, type Store, type StoredKey } from './types';

const TTL_SECONDS = RETENTION_DAYS * 86_400;

const CONTAINERS = {
  agents: { partitionKey: '/id' },
  keys: { partitionKey: '/id' },
  events: { partitionKey: '/agentId', defaultTtl: TTL_SECONDS },
  alerts: { partitionKey: '/id' },
  logs: { partitionKey: '/source', defaultTtl: TTL_SECONDS },
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
    await Promise.all(events.map((e) => container.items.create(e)));
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
}
