// CSV and JSON export (U-05).

import { fileStamp } from './time';

export type CsvValue = string | number | boolean | null | undefined;

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => CsvValue;
}

/**
 * One CSV cell, RFC 4180 style: quoted when it holds a comma, quote, line break or edge whitespace.
 * Text that a spreadsheet would run as a formula (=, +, -, @) gets a leading apostrophe, because
 * logs and activities can carry text from the public.
 */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  let s = value;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s) || /^\s|\s$/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const lines = [columns.map((c) => csvCell(c.header)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => csvCell(c.value(row))).join(','));
  return lines.join('\r\n') + '\r\n';
}

export function downloadText(filename: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportCsv<T>(baseName: string, rows: readonly T[], columns: readonly CsvColumn<T>[]): void {
  // The byte-order mark makes Excel read the file as UTF-8.
  downloadText(`${baseName}-${fileStamp()}.csv`, '﻿' + toCsv(rows, columns), 'text/csv;charset=utf-8');
}

export function exportJson(baseName: string, rows: readonly unknown[]): void {
  downloadText(`${baseName}-${fileStamp()}.json`, JSON.stringify(rows, null, 2) + '\n', 'application/json');
}

/** A short JSON rendering for a CSV cell. */
export function jsonCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && Object.keys(value).length === 0) return '';
  return JSON.stringify(value);
}
