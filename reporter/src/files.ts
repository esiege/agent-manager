import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { paths } from './paths';

export function readJsonFile<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** Writes through a temp file and a rename, so a reader never sees half a file. */
export function writeJsonFile(file: string, value: unknown) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  renameSync(tmp, file);
}

const LOG_MAX_BYTES = 1024 * 1024;

/** Appends a line to reporter.log. Hooks run in the background, so this is where their failures go. */
export function logLine(message: string) {
  try {
    const file = paths.log();
    mkdirSync(dirname(file), { recursive: true });
    if (existsSync(file) && statSync(file).size > LOG_MAX_BYTES) renameSync(file, `${file}.1`);
    appendFileSync(file, `${new Date().toISOString()} [${process.pid}] ${message}\n`);
  } catch {
    // Nowhere left to report to.
  }
}
