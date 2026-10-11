// Reads the project folder and branch straight from .git, without starting git.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

/** The repo root above `cwd`, or null outside a repo. */
export function findRepoRoot(cwd: string): string | null {
  let dir = resolve(cwd);
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** The current branch, a short commit id when detached, or null. Handles worktrees, where .git is a file. */
export function readBranch(repoRoot: string): string | null {
  try {
    let gitDir = join(repoRoot, '.git');
    if (statSync(gitDir).isFile()) {
      const pointer = /^gitdir:\s*(.+)$/m.exec(readFileSync(gitDir, 'utf8'))?.[1]?.trim();
      if (!pointer) return null;
      gitDir = isAbsolute(pointer) ? pointer : resolve(repoRoot, pointer);
    }
    const head = readFileSync(join(gitDir, 'HEAD'), 'utf8').trim();
    const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head)?.[1];
    return ref ?? (/^[0-9a-f]{7,}$/.test(head) ? head.slice(0, 7) : null);
  } catch {
    return null;
  }
}

/** The project name: the repo folder's name, or the working folder's name outside a repo. */
export function projectName(cwd: string): string {
  return basename(findRepoRoot(cwd) ?? resolve(cwd)) || cwd;
}
