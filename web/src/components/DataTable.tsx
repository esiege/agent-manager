// A TanStack table drawn with Mantine: sortable headers, row click, expandable rows,
// and horizontal scrolling inside its container at narrow widths (U-11).

import { Button, Center, Group, Table, Text, UnstyledButton } from '@mantine/core';
import { IconArrowDown, IconArrowUp, IconArrowsSort } from '@tabler/icons-react';
import { flexRender, type Header, type Row, type RowData, type Table as TanTable } from '@tanstack/react-table';
import { Fragment, useState, type MouseEvent, type ReactNode } from 'react';

declare module '@tanstack/react-table' {
  // The type parameters must match TanStack's declaration.
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Header text for screen readers when the header itself isn't text. */
    label?: string;
    width?: number | string;
    nowrap?: boolean;
  }
}

interface DataTableProps<T> {
  table: TanTable<T>;
  /** Accessible name of the table. */
  label: string;
  /** Below this width the table scrolls sideways. */
  minWidth?: number;
  onRowClick?: (row: Row<T>) => void;
  rowClassName?: (row: Row<T>) => string | undefined;
  /** Shown under an expanded row that has no sub-rows. */
  renderDetail?: (row: Row<T>) => ReactNode;
  /** Rows drawn at first, then this many more per "Show more". */
  pageSize?: number;
}

const INTERACTIVE = 'a, button, input, select, textarea, label, [role="button"], [role="menuitem"], [data-no-row-click]';

function SortHeader<T>({ header }: { header: Header<T, unknown> }) {
  const content = header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext());
  if (!header.column.getCanSort()) return <>{content}</>;
  const sorted = header.column.getIsSorted();
  const Icon = sorted === 'asc' ? IconArrowUp : sorted === 'desc' ? IconArrowDown : IconArrowsSort;
  return (
    <UnstyledButton
      onClick={header.column.getToggleSortingHandler()}
      title="Sort (Shift-click to sort by more than one column)"
      fw={600}
      fz="sm"
      style={{ whiteSpace: 'nowrap' }}
    >
      <Group gap={4} wrap="nowrap">
        <span>{content}</span>
        <Icon size={14} style={{ opacity: sorted ? 1 : 0.35 }} aria-hidden />
      </Group>
    </UnstyledButton>
  );
}

export function DataTable<T>({
  table,
  label,
  minWidth = 700,
  onRowClick,
  rowClassName,
  renderDetail,
  pageSize,
}: DataTableProps<T>) {
  const [shown, setShown] = useState(pageSize ?? Infinity);
  const rows = table.getRowModel().rows;
  const visible = rows.length > shown ? rows.slice(0, shown) : rows;
  const columnCount = table.getVisibleLeafColumns().length;

  const handleClick = (row: Row<T>) => (event: MouseEvent<HTMLTableRowElement>) => {
    if (!onRowClick) return;
    if ((event.target as HTMLElement).closest(INTERACTIVE)) return;
    if (window.getSelection()?.toString()) return; // the user is selecting text
    onRowClick(row);
  };

  return (
    <>
      <Table.ScrollContainer minWidth={minWidth} type="native">
        <Table highlightOnHover={!!onRowClick} verticalSpacing={6} fz="sm" aria-label={label}>
          <Table.Thead>
            {table.getHeaderGroups().map((group) => (
              <Table.Tr key={group.id}>
                {group.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  const meta = header.column.columnDef.meta;
                  return (
                    <Table.Th
                      key={header.id}
                      colSpan={header.colSpan}
                      w={meta?.width}
                      aria-label={meta?.label}
                      aria-sort={
                        header.column.getCanSort()
                          ? sorted === 'asc'
                            ? 'ascending'
                            : sorted === 'desc'
                              ? 'descending'
                              : 'none'
                          : undefined
                      }
                    >
                      <SortHeader header={header} />
                    </Table.Th>
                  );
                })}
              </Table.Tr>
            ))}
          </Table.Thead>
          <Table.Tbody>
            {visible.map((row) => (
              <Fragment key={row.id}>
                <Table.Tr
                  className={rowClassName?.(row)}
                  onClick={onRowClick ? handleClick(row) : undefined}
                  style={onRowClick ? { cursor: 'pointer' } : undefined}
                >
                  {row.getVisibleCells().map((cell) => {
                    const meta = cell.column.columnDef.meta;
                    return (
                      <Table.Td key={cell.id} style={meta?.nowrap ? { whiteSpace: 'nowrap' } : undefined}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </Table.Td>
                    );
                  })}
                </Table.Tr>
                {renderDetail && row.getIsExpanded() && row.subRows.length === 0 && (
                  <Table.Tr className="am-detail-row">
                    <Table.Td colSpan={columnCount}>{renderDetail(row)}</Table.Td>
                  </Table.Tr>
                )}
              </Fragment>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {rows.length > visible.length && pageSize !== undefined && (
        <Center mt="xs">
          <Button variant="subtle" size="xs" onClick={() => setShown((n) => n + pageSize)}>
            Show {Math.min(pageSize, rows.length - visible.length)} more ({rows.length - visible.length} hidden)
          </Button>
        </Center>
      )}
      {rows.length > 0 && rows.length === visible.length && pageSize !== undefined && rows.length > pageSize && (
        <Text size="xs" c="dimmed" ta="center" mt="xs">
          All {rows.length} rows shown
        </Text>
      )}
    </>
  );
}

/** Every row in the table's current order, sub-rows after their parent, open or not: for export. */
export function sortedRows<T>(table: TanTable<T>): T[] {
  const out: T[] = [];
  const walk = (rows: Row<T>[]) => {
    for (const r of rows) {
      out.push(r.original);
      walk(r.subRows);
    }
  };
  walk(table.getSortedRowModel().rows);
  return out;
}
