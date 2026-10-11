// U-02: every live agent and those stopped in the last week, filterable, sortable, nested.
// One row per agent: a project's sessions on one machine share a row that opens to show each.

import { AGENT_KINDS, RECENT_DAYS, type AgentView } from '@agent-manager/shared';
import { Anchor, Button, Group, MultiSelect, Switch, Text } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import type { ExpandedState } from '@tanstack/react-table';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { rowAgentId, useAgentsTable } from '../components/AgentsTable';
import { DataTable, sortedRows } from '../components/DataTable';
import { DebouncedTextInput } from '../components/DebouncedTextInput';
import { ExportMenu } from '../components/ExportMenu';
import { FilterBar } from '../components/FilterBar';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, LoadError, TableSkeleton } from '../components/States';
import { UpdatedAgo } from '../components/Time';
import { useAgentsFeed } from '../hooks/useAgentsFeed';
import {
  AGENT_CSV_COLUMNS,
  buildAgentTree,
  groupRows,
  hasActiveFilters,
  matchesFilters,
  type AgentFilters,
} from '../lib/agents';
import { AGENT_STATES, agentPath, KIND_LABEL, plural, STATE_LABEL } from '../lib/labels';
import { useSortParam, useUrlState } from '../lib/urlState';

const KIND_OPTIONS = AGENT_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }));
const STATE_OPTIONS = AGENT_STATES.map((s) => ({ value: s, label: STATE_LABEL[s] }));
const NO_AGENTS: AgentView[] = [];
/** The kind is nearly always Claude Code, the project is in the name, and Started is on each agent's page. */
const HIDDEN_COLUMNS = { kind: false, project: false, started: false };

/** Options from the data, plus any selected value the data no longer has (so it still shows). */
function optionsFrom(values: Iterable<string>, selected: readonly string[]): string[] {
  return [...new Set([...values, ...selected])].sort((a, b) => a.localeCompare(b));
}

export function AgentsPage() {
  const navigate = useNavigate();
  const { data, error, updatedAt, refresh, flashing } = useAgentsFeed();
  const { params, update } = useUrlState();
  const [sorting, onSortingChange] = useSortParam('sort', [{ id: 'lastSeen', desc: true }]);

  const filters: AgentFilters = useMemo(
    () => ({
      q: params.get('q') ?? '',
      kinds: params.getAll('kind'),
      machines: params.getAll('machine'),
      states: params.getAll('state'),
      showStopped: params.get('stopped') !== '0',
    }),
    [params],
  );
  const filtering = hasActiveFilters(filters);
  const activeCount =
    [filters.q.trim(), filters.kinds.length, filters.machines.length, filters.states.length].filter(Boolean).length +
    (filters.showStopped ? 0 : 1);
  const clearFilters = () => update({ q: null, kind: null, machine: null, state: null, stopped: null });

  const agents = data?.agents ?? NO_AGENTS;
  const tree = useMemo(() => buildAgentTree(agents, (a) => matchesFilters(a, filters)), [agents, filters]);
  const rows = useMemo(() => groupRows(tree.roots), [tree.roots]);
  const machineOptions = useMemo(
    () => optionsFrom(new Set(agents.map((a) => a.machine)), filters.machines),
    [agents, filters.machines],
  );

  // Open every parent while filtering, so matching sub-agents are visible.
  const [expanded, setExpanded] = useState<ExpandedState>({});
  const filterKey = JSON.stringify([filters.q, filters.kinds, filters.machines, filters.states]);
  useEffect(() => {
    setExpanded(filtering ? true : {});
  }, [filtering, filterKey]);

  const table = useAgentsTable({
    data: rows,
    childrenOf: tree.children,
    sorting,
    onSortingChange,
    expanded,
    onExpandedChange: setExpanded,
    columnVisibility: HIDDEN_COLUMNS,
  });
  const anyNested = tree.children.size > 0 || rows.some((r) => r.group);
  // Exports list sessions, not the rows that stand for a group of them.
  const exportRows = () => sortedRows(table).filter((r) => !r.group);

  return (
    <>
      <PageHeader title="Agents">
        <UpdatedAgo updatedAt={updatedAt} error={error} />
        <ExportMenu baseName="agents" rows={exportRows} columns={AGENT_CSV_COLUMNS} count={tree.flat.length} />
      </PageHeader>

      <FilterBar activeCount={activeCount}>
        <DebouncedTextInput
          label="Search"
          placeholder="Name, project, story, task, prompt"
          leftSection={<IconSearch size={16} />}
          value={filters.q}
          onCommit={(q) => update({ q })}
          w={{ base: '100%', sm: 260 }}
        />
        <MultiSelect
          label="Kind"
          placeholder={filters.kinds.length ? undefined : 'All'}
          data={KIND_OPTIONS}
          value={[...filters.kinds]}
          onChange={(kind) => update({ kind })}
          clearable
          w={{ base: '100%', sm: 220 }}
        />
        <MultiSelect
          label="Machine"
          placeholder={filters.machines.length ? undefined : 'All'}
          data={machineOptions}
          value={[...filters.machines]}
          onChange={(machine) => update({ machine })}
          clearable
          searchable
          w={{ base: '100%', sm: 220 }}
        />
        <MultiSelect
          label="State"
          placeholder={filters.states.length ? undefined : 'All'}
          data={STATE_OPTIONS}
          value={[...filters.states]}
          onChange={(state) => update({ state })}
          clearable
          w={{ base: '100%', sm: 240 }}
        />
        <Switch
          label="Show stopped"
          checked={filters.showStopped}
          onChange={(e) => update({ stopped: e.currentTarget.checked ? null : '0' })}
          mb={8}
        />
        {activeCount > 0 && (
          <Button variant="subtle" size="xs" mb={6} onClick={clearFilters}>
            Clear filters
          </Button>
        )}
      </FilterBar>

      {!data ? (
        error ? (
          <LoadError message={error.message} onRetry={refresh} />
        ) : (
          <TableSkeleton />
        )
      ) : agents.length === 0 ? (
        <EmptyState title="No agents yet">
          No agents have reported yet. See the{' '}
          <Anchor component={Link} to="/instructions" size="sm">
            Instructions
          </Anchor>{' '}
          tab.
        </EmptyState>
      ) : tree.roots.length === 0 ? (
        <EmptyState title="No agents match these filters">
          <Button variant="light" size="xs" mt={4} onClick={clearFilters}>
            Clear filters
          </Button>
        </EmptyState>
      ) : (
        <>
          <Group justify="space-between" mb={4} gap="xs">
            <Text size="sm" c="dimmed">
              {tree.matched.size === agents.length
                ? `${plural(rows.length, 'agent')} seen in the last ${RECENT_DAYS} days (${agents.length} sessions and sub-agents)`
                : `Showing ${tree.matched.size} of ${plural(agents.length, 'session')}`}
            </Text>
            {anyNested && (
              <Button variant="subtle" size="compact-xs" onClick={() => table.toggleAllRowsExpanded()}>
                {table.getIsAllRowsExpanded() ? 'Collapse all' : 'Expand all'}
              </Button>
            )}
          </Group>
          <DataTable
            table={table}
            label="Agents"
            minWidth={1100}
            onRowClick={(row) => navigate(agentPath(rowAgentId(row.original)))}
            rowClassName={(row) => {
              const classes = [];
              if (flashing.has(rowAgentId(row.original))) classes.push('am-flash');
              if (!row.original.group && !tree.matched.has(row.original.id)) classes.push('am-context');
              return classes.join(' ') || undefined;
            }}
          />
        </>
      )}
    </>
  );
}
