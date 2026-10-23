// One agent on the Dashboard: a clickable panel with its state and what it's doing.
// How much it shows depends on its size, through the container queries in styles.css.

import { unfinishedReason, type AgentView } from '@agent-manager/shared';
import { ActionIcon, Tooltip } from '@mantine/core';
import { IconEyeOff } from '@tabler/icons-react';
import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router';
import type { AgentGroup } from '../lib/agents';
import { agentPath, plural, STATE_COLOR, STATE_LABEL } from '../lib/labels';
import { RelativeTime } from './Time';

function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}

/** Machine, sessions, threads: shown only on larger tiles, each followed by a separator. */
function FootExtra({ children }: { children: ReactNode }) {
  return (
    <span className="am-tile-extra">
      <span className="am-tile-extra-text">{children}</span>
      <span aria-hidden="true">·</span>
    </span>
  );
}

/** Whether the latest finished-work report belongs to what the agent is showing now. */
export function currentResult(lead: AgentView): AgentView['result'] {
  const { result, turn } = lead;
  if (!result) return null;
  if (!turn || Date.parse(result.at) >= Date.parse(turn.startedAt)) return result;
  return lead.effectiveState === 'idle' || lead.effectiveState === 'stopped' ? result : null;
}

interface AgentTileProps {
  group: AgentGroup;
  flashing: boolean;
  /** Hides the agent's sessions. */
  onHide?: () => void;
}

export function AgentTile({ group, flashing, onHide }: AgentTileProps) {
  const { lead } = group;
  const state = lead.effectiveState;
  const color = STATE_COLOR[state];
  const unfinished = unfinishedReason(lead);
  const result = currentResult(lead);
  const threads = group.instances.reduce((n, i) => n + i.runningChildren, 0);
  // When it last did something: heartbeats move lastSeen but not lastReportAt.
  const lastActive = group.instances.reduce((m, i) => (i.lastReportAt > m ? i.lastReportAt : m), lead.lastReportAt);
  // Tint the panels that want the owner, so they stand out at a glance.
  const wantsOwner = state === 'waiting' || state === 'failed';
  const tinted = wantsOwner || unfinished !== null;
  // The task, or failing that the low-level activity, dimmed.
  const doing = lead.task || lead.activity;
  const nothingYet = !lead.story && !doing && !lead.prompt && !result && !unfinished;

  return (
    <div className="am-tile-wrap">
      <Link
        to={agentPath(lead.id)}
        className={cx('am-tile', tinted && 'am-tile-tinted', flashing && 'am-flash')}
        data-state={state}
        style={
          {
            '--am-tile-color': `var(--mantine-color-${color}-filled)`,
            '--am-tile-tint': `var(--mantine-color-${wantsOwner ? color : 'orange'}-light)`,
            '--am-tile-text': `var(--mantine-color-${color}-text)`,
          } as CSSProperties
        }
      >
        <div className="am-tile-head">
          <div className="am-tile-name" title={group.name}>
            {group.name}
          </div>
          <div className="am-tile-state">
            <span className="am-tile-dot" aria-hidden="true" />
            {STATE_LABEL[state]}
          </div>
        </div>

        <div className="am-tile-body">
          {unfinished && <div className="am-tile-unfinished am-tile-clamp">Unfinished: {unfinished}</div>}
          {result && (
            <div className="am-tile-result am-tile-clamp" title={result.title}>
              ✓ {result.title}
            </div>
          )}
          {lead.story && <div className="am-tile-story am-tile-clamp">{lead.story}</div>}
          {doing && (
            <div className={cx('am-tile-task am-tile-clamp', !lead.task && 'am-tile-dim', lead.story && 'am-tile-opt')}>
              {doing}
            </div>
          )}
          {lead.prompt && (
            <div className={cx('am-tile-prompt am-tile-clamp', (lead.story || doing) && 'am-tile-opt')}>You: {lead.prompt}</div>
          )}
          {nothingYet && <div className="am-tile-dim">Nothing reported yet</div>}
        </div>

        <div className="am-tile-foot">
          <FootExtra>{lead.machine}</FootExtra>
          {group.instances.length > 1 && <FootExtra>{plural(group.instances.length, 'session')}</FootExtra>}
          {threads > 0 && <FootExtra>{plural(threads, 'thread')}</FootExtra>}
          <RelativeTime iso={lastActive} size="xs" c="dimmed" />
        </div>
      </Link>
      {onHide && (
        // Beside the link, not in it: a button inside a link isn't allowed.
        <Tooltip label="Hide. Settings can show it again." withArrow>
          <ActionIcon className="am-tile-hide" variant="subtle" color="gray" size="sm" aria-label={`Hide ${group.name}`} onClick={onHide}>
            <IconEyeOff size={16} />
          </ActionIcon>
        </Tooltip>
      )}
    </div>
  );
}
