import { Group, Title } from '@mantine/core';
import type { ReactNode } from 'react';

/** The page title, with the page's actions on the right. Also sets the browser tab title. */
export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <Group justify="space-between" align="center" gap="sm" mb="md" wrap="wrap">
      <title>{`${title} · Agent Manager Deluxe`}</title>
      <Title order={1} size="h2">
        {title}
      </Title>
      {children && (
        <Group gap="sm" wrap="wrap">
          {children}
        </Group>
      )}
    </Group>
  );
}
