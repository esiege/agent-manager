// Loading, empty and error states.

import { Alert, Button, Paper, Skeleton, Stack, Text } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import type { ReactNode } from 'react';

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <Stack gap="xs" aria-busy="true" aria-label="Loading">
      <Skeleton height={28} />
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={22} opacity={1 - i * 0.12} />
      ))}
    </Stack>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <Paper withBorder p="xl" radius="md">
      <Stack gap={6} align="center" ta="center">
        <Text fw={600}>{title}</Text>
        {children && (
          <Text size="sm" c="dimmed" component="div">
            {children}
          </Text>
        )}
      </Stack>
    </Paper>
  );
}

export function LoadError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Alert color="red" icon={<IconAlertTriangle size={18} />} title="Couldn't load this">
      <Stack gap="xs" align="flex-start">
        <Text size="sm">{message}</Text>
        {onRetry && (
          <Button size="xs" variant="light" color="red" onClick={onRetry}>
            Try again
          </Button>
        )}
      </Stack>
    </Alert>
  );
}
