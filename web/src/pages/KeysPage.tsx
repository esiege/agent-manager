// U-08: keys. Machine keys (one per PC or service) on top, game keys (one per game, performance
// data only) below. Each has its own form and table, so the kind of key is never a hidden choice.

import { LIMITS, type CreateKeyResponse, type KeyScope, type MachineKey } from '@agent-manager-delux/shared';
import { Alert, Anchor, Badge, Button, Group, Modal, Paper, Stack, Text, TextInput, Title, Tooltip } from '@mantine/core';
import { IconAlertTriangle, IconDeviceDesktop, IconDeviceGamepad2, IconKey } from '@tabler/icons-react';
import { createColumnHelper, getCoreRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { CopyField } from '../components/Copy';
import { DataTable } from '../components/DataTable';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, LoadError, TableSkeleton } from '../components/States';
import { RelativeTime } from '../components/Time';
import { api } from '../lib/api';
import { notifyError, notifySuccess } from '../lib/notify';
import { formatAbsolute } from '../lib/time';
import { usePolling } from '../lib/usePolling';
import { useSortParam } from '../lib/urlState';

const loadKeys = (signal: AbortSignal) => api.keys(signal);
const NO_KEYS: MachineKey[] = [];
const col = createColumnHelper<MachineKey>();

/** Quote for PowerShell: single quotes, with ' doubled. */
const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;
/** Quote for bash: single quotes, with ' closed, escaped and reopened. */
const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

function NewKeyForm({ scope, placeholder, onCreated }: { scope: KeyScope; placeholder: string; onCreated: (res: CreateKeyResponse) => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const trimmed = name.trim();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!trimmed) return;
    setBusy(true);
    try {
      const res = await api.createKey(trimmed, scope);
      setName('');
      onCreated(res);
    } catch (err) {
      notifyError(err, "Couldn't create the key");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Group align="flex-end" gap="sm" component="form" onSubmit={submit} mb="md">
      <TextInput
        label="Name"
        placeholder={placeholder}
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
        maxLength={LIMITS.nameLength}
        required
        w={{ base: '100%', xs: 320 }}
      />
      <Button type="submit" loading={busy} disabled={!trimmed} leftSection={<IconKey size={16} />}>
        {scope === 'perf' ? 'Create game key' : 'Create machine key'}
      </Button>
    </Group>
  );
}

function SecretModal({ created, onClose }: { created: CreateKeyResponse | null; onClose: () => void }) {
  const secret = created?.secret ?? '';
  const isGame = created?.key.scope === 'perf';
  return (
    <Modal
      opened={created !== null}
      onClose={onClose}
      title={<Text fw={600}>{isGame ? 'Game key' : 'Machine key'} for {created?.key.name}</Text>}
      size="lg"
      closeOnClickOutside={false}
    >
      <Stack gap="md">
        <Alert color="yellow" icon={<IconAlertTriangle size={18} />} variant="light">
          Copy the key now. It won&apos;t be shown again.
        </Alert>
        <div>
          <Text size="sm" fw={500} mb={4}>
            Key
          </Text>
          <CopyField value={secret} label="Copy key" />
        </div>
        {isGame ? (
          <Text size="sm">
            Save it where your agent said the game will load it from (a build setting, an environment variable or a file that
            isn&apos;t committed), then tell the agent it&apos;s there. Don&apos;t paste it into the chat. The game sends it in the{' '}
            <code>X-Agent-Manager-Key</code> header of the calls{' '}
            <Anchor href="/performance.md" target="_blank" rel="noopener" size="sm">
              performance.md
            </Anchor>{' '}
            describes. Anyone with the build can read it out, which is why it can do nothing else; revoke it here if it&apos;s misused.
          </Text>
        ) : (
          <EnvLines secret={secret} />
        )}
        <Group justify="flex-end">
          <Button onClick={onClose}>Done</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function EnvLines({ secret }: { secret: string }) {
  return (
    <>
      <div>
        <Text size="sm" fw={500} mb={4}>
          Windows (PowerShell)
        </Text>
        <CopyField value={`[Environment]::SetEnvironmentVariable('AGENT_MANAGER_KEY', ${psQuote(secret)}, 'User')`} label="Copy PowerShell line" />
      </div>
      <div>
        <Text size="sm" fw={500} mb={4}>
          macOS or Linux (bash)
        </Text>
        <CopyField value={`export AGENT_MANAGER_KEY=${shQuote(secret)}`} label="Copy bash line" />
      </div>
      <Text size="xs" c="dimmed">
        Open a new terminal afterwards so it sees the variable. In bash, add the line to your shell profile to keep it.
      </Text>
    </>
  );
}

function RevokeModal({ target, onClose, onRevoked }: { target: MachineKey | null; onClose: () => void; onRevoked: () => void }) {
  const [busy, setBusy] = useState(false);
  const revoke = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await api.revokeKey(target.id);
      notifySuccess(`Revoked ${target.name}`);
      onRevoked();
      onClose();
    } catch (err) {
      notifyError(err, "Couldn't revoke the key");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal opened={target !== null} onClose={onClose} title={<Text fw={600}>Revoke {target?.name}?</Text>}>
      <Stack gap="md">
        <Text size="sm">Whatever uses this key stops reporting at once, and needs a new key to report again. This can&apos;t be undone.</Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button color="red" onClick={revoke} loading={busy} data-autofocus>
            Revoke key
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function KeyTable({ keys, sortParam, label, onRevoke }: { keys: MachineKey[]; sortParam: string; label: string; onRevoke: (k: MachineKey) => void }) {
  const [sorting, onSortingChange] = useSortParam(sortParam, [{ id: 'created', desc: true }]);

  const columns = useMemo(
    () => [
      col.accessor('name', {
        header: 'Name',
        sortingFn: 'text',
        cell: ({ getValue }) => (
          <Text fw={500} size="sm">
            {getValue()}
          </Text>
        ),
      }),
      col.accessor((k) => Date.parse(k.createdAt), {
        id: 'created',
        header: 'Created',
        cell: ({ row }) => <RelativeTime iso={row.original.createdAt} />,
      }),
      col.accessor((k) => (k.lastUsedAt ? Date.parse(k.lastUsedAt) : 0), {
        id: 'lastUsed',
        header: 'Last used',
        cell: ({ row }) =>
          row.original.lastUsedAt ? (
            <RelativeTime iso={row.original.lastUsedAt} />
          ) : (
            <Text size="sm" c="dimmed">
              Never
            </Text>
          ),
      }),
      col.accessor((k) => (k.revokedAt ? 1 : 0), {
        id: 'status',
        header: 'Status',
        sortDescFirst: false,
        cell: ({ row }) =>
          row.original.revokedAt ? (
            <Tooltip label={`Revoked ${formatAbsolute(row.original.revokedAt)}`}>
              <Badge color="gray" variant="light" radius="sm" tt="none">
                Revoked
              </Badge>
            </Tooltip>
          ) : (
            <Badge color="teal" variant="light" radius="sm" tt="none">
              Active
            </Badge>
          ),
      }),
      col.display({
        id: 'actions',
        header: '',
        meta: { label: 'Actions', width: 100 },
        cell: ({ row }) =>
          row.original.revokedAt ? null : (
            <Button variant="subtle" color="red" size="compact-sm" onClick={() => onRevoke(row.original)}>
              Revoke
            </Button>
          ),
      }),
    ],
    [onRevoke],
  );

  const table = useReactTable({
    data: keys,
    columns,
    state: { sorting },
    onSortingChange,
    getRowId: (k) => k.id,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableSortingRemoval: false,
  });

  return <DataTable table={table} label={label} minWidth={560} />;
}

function KeySection({ icon, title, intro, children }: { icon: ReactNode; title: string; intro: ReactNode; children: ReactNode }) {
  return (
    <Paper withBorder p="md" radius="md" mb="lg">
      <Group gap="xs" mb={4}>
        {icon}
        <Title order={2} size="h4">
          {title}
        </Title>
      </Group>
      <Text size="sm" c="dimmed" mb="sm">
        {intro}
      </Text>
      {children}
    </Paper>
  );
}

export function KeysPage() {
  const { data, error, refresh } = usePolling('keys', loadKeys, { intervalMs: null });
  const [created, setCreated] = useState<CreateKeyResponse | null>(null);
  const [revoking, setRevoking] = useState<MachineKey | null>(null);
  const keys = data?.keys ?? NO_KEYS;
  const machineKeys = useMemo(() => keys.filter((k) => k.scope !== 'perf'), [keys]);
  const gameKeys = useMemo(() => keys.filter((k) => k.scope === 'perf'), [keys]);

  const onCreated = (res: CreateKeyResponse) => {
    setCreated(res);
    refresh();
  };

  const list = (items: MachineKey[], sortParam: string, label: string, empty: ReactNode) =>
    !data ? (
      error ? (
        <LoadError message={error.message} onRetry={refresh} />
      ) : (
        <TableSkeleton rows={3} />
      )
    ) : items.length === 0 ? (
      <EmptyState title="None yet">{empty}</EmptyState>
    ) : (
      <KeyTable keys={items} sortParam={sortParam} label={label} onRevoke={setRevoking} />
    );

  return (
    <>
      <PageHeader title="Keys" />

      <KeySection
        icon={<IconDeviceDesktop size={20} />}
        title="Machine keys"
        intro="One per PC or service. Agents read it from the AGENT_MANAGER_KEY environment variable. It can report and read, so never put it in a game build."
      >
        <NewKeyForm scope="all" placeholder="The PC's name, for example pc-studio" onCreated={onCreated} />
        {list(machineKeys, 'msort', 'Machine keys', 'Make one above for each PC or service that reports.')}
      </KeySection>

      <KeySection
        icon={<IconDeviceGamepad2 size={20} />}
        title="Game keys"
        intro="One per game. It goes into the game's builds and can only send performance data, so it's safe on other people's machines."
      >
        <NewKeyForm scope="perf" placeholder="The game's name, for example musik" onCreated={onCreated} />
        {list(gameKeys, 'gsort', 'Game keys', 'Make one above for each game that sends performance data.')}
      </KeySection>

      <SecretModal created={created} onClose={() => setCreated(null)} />
      <RevokeModal target={revoking} onClose={() => setRevoking(null)} onRevoked={refresh} />
    </>
  );
}
