import { hostname } from 'node:os';
import { readJsonFile } from './files';
import { paths } from './paths';

export interface Config {
  /** The Agent Manager site, such as https://agent-manager.example.net */
  url: string;
  /** Machine key from the Settings tab. AGENT_MANAGER_KEY overrides it. */
  key: string;
  /** This PC's name in Agent Manager. */
  machine: string;
  /** Set to false in the config file to keep the person's prompts on this PC. */
  prompts?: boolean;
}

export class ConfigError extends Error {}

export function defaultMachineName(): string {
  return hostname().toLowerCase();
}

/** The saved config, with AGENT_MANAGER_KEY and AGENT_MANAGER_URL taking precedence. */
export function loadConfig(): Config {
  const saved = readJsonFile<Partial<Config>>(paths.config()) ?? {};
  const url = (process.env.AGENT_MANAGER_URL || saved.url || '').replace(/\/+$/, '');
  const key = process.env.AGENT_MANAGER_KEY || saved.key || '';
  if (!url) throw new ConfigError(`No Agent Manager URL: run "agentctl install --url <url>" (config: ${paths.config()})`);
  if (!key) throw new ConfigError('No machine key: set AGENT_MANAGER_KEY or run "agentctl install"');
  return { url, key, machine: saved.machine || defaultMachineName(), ...(saved.prompts === false ? { prompts: false } : {}) };
}
