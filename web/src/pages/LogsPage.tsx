// U-04: every log, newest first, filtered on the server; filters and sort live in the URL.

import { LOG_LEVELS, type LogEntry, type LogLevel, type LogsQuery } from '@agent-manager/shared';
import { Alert, Button, MultiSelect, NumberInput, Switch, Text, TextInput } from '@mantine/core';
import { useLocalStorage } from '@mantine/hooks';
import { IconRefresh, IconSearch } from '@tabler/icons-react';
import { useCallback, useMemo, useState } from 'react';
import { DataTable, sortedRows } from '../components/DataTable';
import { DebouncedTextInput } from '../components/DebouncedTextInput';
import { ExportMenu } from '../components/ExportMenu';
import { FilterBar } from '../components/FilterBar';
import { LogDetail, LOG_CSV_COLUMNS, useLogsTable, type LogFilterField } from '../components/LogsTable';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, LoadError, TableSkeleton } from '../components/States';
import { UpdatedAgo } from '../components/Time';
import { api, logsQueryString } from '../lib/api';
import { isLogLevel, plural } from '../lib/labels';
import { isoToLocalInput, localInputToIso } from '../lib/time';
import { usePolling } from '../lib/usePolling';
import { useSortParam, useUrlState } from '../lib/urlState';

const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 5000; // The API refuses more.
const AUTO_REFRESH_MS = 10_000;
const LEVEL_OPTIONS = LOG_LEVELS.map((l) => ({ value: l, label: l }));
const NO_LOGS: LogEntry[] = [];
const FILTER_KEYS = ['level', 'source', 'agentId', 'correlationId', 'q', 'from', 'to', 'limit'] as const;

function readLimit(raw: string | null): number {
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_LIMIT) : DEFAULT_LIMIT;
}

/** A datetime-local input whose value is kept as ISO 8601. */
function DateTimeFilter({ label, iso, onChange }: { label: string; iso: string; onChange: (iso: string) => void }) {
  return (
    <TextInput
      type="datetime-local"
      label={label}
      value={iso ? isoToLocalInput(iso) : ''}
      onChange={(e) => onChange(localInputToIso(e.currentTarget.value))}
      w={{ base: '100%', xs: 210 }}
    />
  );
}

/** The limit, committed on blur or Enter so typing "500" doesn't load 5, then 50. */
function LimitInput({ value, onCommit }: { value: number; onCommit: (n: number) => void }) {
  const [draft, setDraft] = useState<string | number>(value);
  const [committed, setCommitted] = useState(value);
  if (value !== committed) {
    setCommitted(value);
    setDraft(value);
  }
  const commit = () => {
    const n = typeof draft === 'number' ? draft : Number.parseInt(draft, 10);
    if (Number.isFinite(n) && n > 0) onCommit(Math.min(Math.round(n), MAX_LIMIT));
    else setDraft(value);
  };
  return (
    <NumberInput
      label="Limit"
      value={draft}
      onChange={setDraft}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
      min={1}
      max={MAX_LIMIT}
      step={100}
      allowDecimal={false}
      allowNegative={false}
      thousandSeparator=","
      w={{ base: '100%', xs: 110 }}
    />
  );
}

export function LogsPage() {
  const { params, update } = useUrlState();
  const [sorting, onSortingChange] = useSortParam('sort', [{ id: 'time', desc: true }]);
  const [autoRefresh, setAutoRefresh] = useLocalStorage({ key: 'agent-manager:logs-auto-refresh', defaultValue: false });

  const query: LogsQuery = useMemo(
    () => ({
      level: params.getAll('level').filter(isLogLevel) as LogLevel[],
      source: params.get('source') ?? '',
      agentId: params.get('agentId') ?? '',
      correlationId: params.get('correlationId') ?? '',
      q: params.get('q') ?? '',
      from: params.get('from') ?? '',
      to: params.get('to') ?? '',
      limit: readLimit(params.get('limit')),
    }),
    [params],
  );
  const queryKey = logsQueryString(query);
  const load = useCallback((signal: AbortSignal) => api.logs(query, signal), [query]);
  const { data, error, loading, updatedAt, refresh } = usePolling(`logs?${queryKey}`, load, {
    intervalMs: autoRefresh ? AUTO_REFRESH_MS : null,
  });

  const onFilter = useCallback((field: LogFilterField, value: string) => update({ [field]: value }), [update]);
  const logs = data?.logs ?? NO_LOGS;
  const table = useLogsTable({ logs, sorting, onSortingChange, onFilter });

  const activeCount = FILTER_KEYS.filter((k) => params.has(k)).length;
  const hasFilters = activeCount > 0;
  const clearFilters = () => update(Object.fromEntries(FILTER_KEYS.map((k) => [k, null])));

  return (
    <>
      <PageHeader title="Logs">
        <UpdatedAgo updatedAt={updatedAt} error={data ? error : null} />
        <Switch
          label="Auto-refresh (10 s)"
          checked={autoRefresh}
          onChange={(e) => setAutoRefresh(e.currentTarget.checked)}
        />
        <Button variant="default" size="xs" leftSection={<IconRefresh size={14} />} onClick={refresh} loading={loading && !!data}>
          Refresh
        </Button>
        <ExportMenu baseName="logs" rows={() => sortedRows(table)} columns={LOG_CSV_COLUMNS} count={logs.length} />
      </PageHeader>

      <FilterBar activeCount={activeCount}>
        <MultiSelect
          label="Level"
          placeholder={query.level?.length ? undefined : 'All'}
          data={LEVEL_OPTIONS}
          value={query.level ?? []}
          onChange={(level) => update({ level })}
          clearable
          w={{ base: '100%', xs: 260 }}
        />
        <DebouncedTextInput label="Source" value={query.source ?? ''} onCommit={(source) => update({ source })} w={{ base: '100%', xs: 160 }} />
        <DebouncedTextInput
          label="Agent id"
          value={query.agentId ?? ''}
          onCommit={(agentId) => update({ agentId })}
          styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)' } }}
          w={{ base: '100%', xs: 220 }}
        />
        <DebouncedTextInput
          label="Correlation id"
          value={query.correlationId ?? ''}
          onCommit={(correlationId) => update({ correlationId })}
          styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)' } }}
          w={{ base: '100%', xs: 170 }}
        />
        <DebouncedTextInput
          label="Text"
          placeholder="In the message"
          leftSection={<IconSearch size={16} />}
          value={query.q ?? ''}
          onCommit={(q) => update({ q })}
          w={{ base: '100%', xs: 220 }}
        />
        <DateTimeFilter label="From" iso={query.from ?? ''} onChange={(from) => update({ from })} />
        <DateTimeFilter label="To" iso={query.to ?? ''} onChange={(to) => update({ to })} />
        <LimitInput value={query.limit ?? DEFAULT_LIMIT} onCommit={(n) => update({ limit: n === DEFAULT_LIMIT ? null : String(n) })} />
        {hasFilters && (
          <Button variant="subtle" size="xs" mb={6} onClick={clearFilters}>
            Clear filters
          </Button>
        )}
      </FilterBar>

      {data?.truncated && (
        <Alert color="yellow" variant="light" mb="sm" py="xs">
          More logs match than the limit of {query.limit?.toLocaleString()}. Showing the newest. Narrow the filters or raise the limit to see the rest.
        </Alert>
      )}

      {!data ? (
        error ? (
          <LoadError message={error.message} onRetry={refresh} />
        ) : (
          <TableSkeleton />
        )
      ) : logs.length === 0 ? (
        <EmptyState title={hasFilters ? 'No logs match these filters' : 'No logs yet'}>
          {hasFilters ? (
            <Button variant="light" size="xs" mt={4} onClick={clearFilters}>
              Clear filters
            </Button>
          ) : (
            'Clients send logs to /api/v1/logs. See the Instructions tab.'
          )}
        </EmptyState>
      ) : (
        <>
          <Text size="sm" c="dimmed" mb={4}>
            {plural(logs.length, 'entry', 'entries')}
          </Text>
          <DataTable
            key={queryKey}
            table={table}
            label="Logs"
            minWidth={1000}
            pageSize={200}
            renderDetail={(row) => <LogDetail row={row} />}
          />
        </>
      )}
    </>
  );
}
