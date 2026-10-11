// Process helpers: is a PID alive, and which Claude Code process is above this one.

import { execFileSync } from 'node:child_process';

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: it exists but belongs to someone else.
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

interface Proc {
  pid: number;
  ppid: number;
  name: string;
}

function processTable(): Map<number, Proc> {
  const table = new Map<number, Proc>();
  if (process.platform === 'win32') {
    const out = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name | ForEach-Object { "$($_.ProcessId)`t$($_.ParentProcessId)`t$($_.Name)" }',
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 15_000 },
    );
    for (const line of out.split(/\r?\n/)) {
      const [pid, ppid, name] = line.split('\t');
      if (pid && ppid) table.set(Number(pid), { pid: Number(pid), ppid: Number(ppid), name: name ?? '' });
    }
  } else {
    const out = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,comm='], { encoding: 'utf8', timeout: 15_000 });
    for (const line of out.split('\n')) {
      const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
      if (m) table.set(Number(m[1]), { pid: Number(m[1]), ppid: Number(m[2]), name: m[3]!.trim() });
    }
  }
  return table;
}

/** The PIDs above this process, nearest first. Slow on Windows (about a second): only for commands, never hooks. */
export function ancestors(): number[] {
  const table = processTable();
  const chain: number[] = [];
  let pid = process.ppid;
  while (pid > 0 && !chain.includes(pid)) {
    chain.push(pid);
    pid = table.get(pid)?.ppid ?? 0;
  }
  return chain;
}
