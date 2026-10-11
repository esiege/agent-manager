import { Box, Button, Collapse, Group } from '@mantine/core';
import { useDisclosure, useMediaQuery } from '@mantine/hooks';
import { IconChevronDown, IconChevronUp, IconFilter } from '@tabler/icons-react';
import { useId, type ReactNode } from 'react';

/** A row of filters. On a phone it folds behind a "Filters" button so the list stays in view (U-11). */
export function FilterBar({ activeCount, children }: { activeCount: number; children: ReactNode }) {
  const narrow = useMediaQuery('(max-width: 48em)', false, { getInitialValueInEffect: false });
  const [opened, { toggle }] = useDisclosure(false);
  const panelId = useId();

  const row = (
    <Group gap="sm" align="flex-end" wrap="wrap" mb="sm">
      {children}
    </Group>
  );
  if (!narrow) return row;

  return (
    <Box mb="sm">
      <Button
        variant="default"
        size="xs"
        leftSection={<IconFilter size={14} />}
        rightSection={opened ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
        onClick={toggle}
        aria-expanded={opened}
        aria-controls={panelId}
        mb={opened ? 'xs' : 0}
      >
        Filters{activeCount ? ` (${activeCount})` : ''}
      </Button>
      <Collapse in={opened} id={panelId}>
        {row}
      </Collapse>
    </Box>
  );
}
