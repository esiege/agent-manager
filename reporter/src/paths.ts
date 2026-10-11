import { homedir } from 'node:os';
import { join } from 'node:path';

/** Where agentctl keeps its config, session records and log. AGENT_MANAGER_HOME overrides it (tests). */
export function home(): string {
  return process.env.AGENT_MANAGER_HOME || join(homedir(), '.agent-manager');
}

export const paths = {
  config: () => join(home(), 'config.json'),
  script: () => join(home(), 'agentctl.js'),
  sessions: () => join(home(), 'sessions'),
  daemon: () => join(home(), 'daemon.json'),
  log: () => join(home(), 'reporter.log'),
  claudeSettings: () => process.env.CLAUDE_SETTINGS_PATH || join(homedir(), '.claude', 'settings.json'),
};
