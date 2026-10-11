import { Button, Menu } from '@mantine/core';
import { IconChevronDown, IconDownload } from '@tabler/icons-react';
import { exportCsv, exportJson, type CsvColumn } from '../lib/csv';

interface ExportMenuProps<T> {
  /** File name prefix: "agents" gives agents-2026-10-10T18-22-05.csv. */
  baseName: string;
  /** Rows in the current filtered and sorted view. */
  rows: () => readonly T[];
  columns: readonly CsvColumn<T>[];
  count: number;
}

/** Export the current view as CSV or JSON (U-05). */
export function ExportMenu<T>({ baseName, rows, columns, count }: ExportMenuProps<T>) {
  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <Button
          variant="default"
          size="xs"
          leftSection={<IconDownload size={14} />}
          rightSection={<IconChevronDown size={14} />}
          disabled={count === 0}
        >
          Export {count > 0 ? `(${count})` : ''}
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item onClick={() => exportCsv(baseName, rows(), columns)}>CSV</Menu.Item>
        <Menu.Item onClick={() => exportJson(baseName, rows())}>JSON</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
