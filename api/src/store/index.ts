import { CosmosStore } from './cosmos';
import { MemoryStore } from './memory';
import type { Store } from './types';

/** True when running in Azure rather than under `func start` on a PC. */
export function inAzure(env: Record<string, string | undefined>): boolean {
  return Boolean(env.WEBSITE_INSTANCE_ID || env.WEBSITE_SITE_NAME);
}

let store: Store | undefined;

/**
 * Cosmos DB when COSMOS_ENDPOINT and COSMOS_KEY are set. Otherwise a local JSON file, which is
 * only allowed off Azure: a deployed app with no database must fail loudly, not keep data in memory.
 */
export function getStore(env: Record<string, string | undefined>): Store {
  if (store) return store;
  if (env.COSMOS_ENDPOINT && env.COSMOS_KEY) {
    store = new CosmosStore(env.COSMOS_ENDPOINT, env.COSMOS_KEY, env.COSMOS_DATABASE || 'agentmanager');
  } else if (inAzure(env)) {
    throw new Error('Storage is not configured: set COSMOS_ENDPOINT and COSMOS_KEY in the app settings');
  } else {
    store = new MemoryStore(env.LOCAL_STORE_PATH || '.local-store.json');
  }
  return store;
}
