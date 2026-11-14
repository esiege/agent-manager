import type { AgentState, AgentView } from '@agent-manager-deluxe/shared';
import { useEffect, useRef, useState } from 'react';

const FLASH_MS = 2000;
const NONE: ReadonlySet<string> = new Set();

/** Ids of agents whose state changed in the latest poll, for a brief highlight (U-09). */
export function useStateFlash(agents: readonly AgentView[] | undefined): ReadonlySet<string> {
  const previous = useRef<Map<string, AgentState> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [flashing, setFlashing] = useState<ReadonlySet<string>>(NONE);

  useEffect(() => {
    if (!agents) {
      previous.current = null;
      return;
    }
    const next = new Map(agents.map((a) => [a.id, a.effectiveState]));
    const before = previous.current;
    previous.current = next;
    if (!before) return;

    const changed = new Set<string>();
    for (const [id, state] of next) {
      const old = before.get(id);
      if (old !== undefined && old !== state) changed.add(id);
    }
    if (changed.size === 0) return;
    clearTimeout(timer.current);
    setFlashing(changed);
    timer.current = setTimeout(() => setFlashing(NONE), FLASH_MS);
  }, [agents]);

  useEffect(() => () => clearTimeout(timer.current), []);
  return flashing;
}
