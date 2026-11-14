import { INSTRUCTIONS_VERSION, type AgentState, type LogLevel } from '@agent-manager-delux/shared';
import { Badge, Tooltip } from '@mantine/core';
import { LEVEL_COLOR, STATE_COLOR, STATE_LABEL } from '../lib/labels';

export function StateBadge({ state }: { state: AgentState }) {
  return (
    <Badge color={STATE_COLOR[state]} variant="light" radius="sm" tt="none" style={{ flexShrink: 0 }}>
      {STATE_LABEL[state]}
    </Badge>
  );
}

export function LevelBadge({ level }: { level: LogLevel }) {
  return (
    <Badge color={LEVEL_COLOR[level] ?? 'gray'} variant="light" radius="sm" tt="none" style={{ flexShrink: 0 }}>
      {level}
    </Badge>
  );
}

/** I-05: set up from an older instructions page. */
export function OldSetupBadge({ version }: { version: number | null }) {
  return (
    <Tooltip
      label={`Set up from instructions v${version ?? '?'}. The current version is v${INSTRUCTIONS_VERSION}: send its agent the update sentence from the Instructions tab.`}
      multiline
      maw={320}
    >
      <Badge color="yellow" variant="outline" radius="sm" size="sm" tt="none" style={{ flexShrink: 0 }}>
        old version
      </Badge>
    </Tooltip>
  );
}
