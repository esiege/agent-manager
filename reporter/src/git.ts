// Reads the project folder, branch and HEAD straight from .git, without starting git (hooks
// must stay fast). commitInfo() does start git, and is only used when work is reported finished.

import { execFileSync } from 'node:child_process';
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

/** The repo's git folder. Handles worktrees, where .git is a file pointing at it. */
function gitDirOf(repoRoot: string): string | null {
  let gitDir = join(repoRoot, '.git');
  if (statSync(gitDir).isFile()) {
    const pointer = /^gitdir:\s*(.+)$/m.exec(readFileSync(gitDir, 'utf8'))?.[1]?.trim();
    if (!pointer) return null;
    gitDir = isAbsolute(pointer) ? pointer : resolve(repoRoot, pointer);
  }
  return gitDir;
}

/** The current branch, a short commit id when detached, or null. */
export function readBranch(repoRoot: string): string | null {
  try {
    const gitDir = gitDirOf(repoRoot);
    if (!gitDir) return null;
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

/** The commit HEAD points at, or null (no commits yet, or not readable). */
export function readHead(repoRoot: string): string | null {
  try {
    const gitDir = gitDirOf(repoRoot);
    if (!gitDir) return null;
    const head = readFileSync(join(gitDir, 'HEAD'), 'utf8').trim();
    const ref = /^ref:\s*(.+)$/.exec(head)?.[1];
    if (!ref) return /^[0-9a-f]{40,64}$/.test(head) ? head : null;
    // A worktree keeps its own HEAD but shares refs with the main repo.
    const common = existsSync(join(gitDir, 'commondir'))
      ? resolve(gitDir, readFileSync(join(gitDir, 'commondir'), 'utf8').trim())
      : gitDir;
    for (const dir of [gitDir, common]) {
      const file = join(dir, ref);
      if (existsSync(file)) return readFileSync(file, 'utf8').trim() || null;
    }
    const packed = join(common, 'packed-refs');
    if (!existsSync(packed)) return null;
    const line = readFileSync(packed, 'utf8')
      .split('\n')
      .find((l) => l.endsWith(` ${ref}`));
    return line?.split(' ')[0] ?? null;
  } catch {
    return null;
  }
}

export interface CommitInfo {
  sha: string;
  subject: string;
  branch: string | null;
  /** A web link to the commit when the remote is on a known host. */
  url: string | null;
  /** Whether a remote branch has it yet. */
  pushed: boolean;
}

function git(repoRoot: string, args: string[]): string {
  return execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8', timeout: 4000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

/** The web page of a commit on GitHub, GitLab, Bitbucket or Azure DevOps, from the remote's URL. */
export function commitWebUrl(remote: string, sha: string): string | null {
  const m = /^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/git@|git@)([^/:]+)[/:](.+?)(?:\.git)?\/?$/.exec(remote.trim());
  if (!m) return null;
  const [, host, path] = m as unknown as [string, string, string];
  if (host === 'github.com') return `https://github.com/${path}/commit/${sha}`;
  if (host.includes('gitlab')) return `https://${host}/${path}/-/commit/${sha}`;
  if (host === 'bitbucket.org') return `https://bitbucket.org/${path}/commits/${sha}`;
  if (host === 'dev.azure.com' || host.endsWith('visualstudio.com')) {
    const ado = /^(?:v3\/)?([^/]+)\/([^/]+)\/(?:_git\/)?([^/]+)$/.exec(path);
    return ado ? `https://dev.azure.com/${ado[1]}/${ado[2]}/_git/${ado[3]}/commit/${sha}` : null;
  }
  return null;
}

/** What a report of finished work says about a commit. Null when git isn't there or fails. */
export function commitInfo(repoRoot: string, sha: string): CommitInfo | null {
  try {
    const subject = git(repoRoot, ['log', '-1', '--format=%s', sha]);
    let url: string | null = null;
    try {
      url = commitWebUrl(git(repoRoot, ['remote', 'get-url', 'origin']), sha);
    } catch {
      // No origin remote.
    }
    let pushed = false;
    try {
      pushed = git(repoRoot, ['branch', '-r', '--contains', sha]) !== '';
    } catch {
      // Unknown: treat as not pushed.
    }
    return { sha, subject, branch: readBranch(repoRoot), url, pushed };
  } catch {
    return null;
  }
}

/** True when the working tree has changes that aren't committed. Null when git can't tell. */
export function hasUncommittedChanges(repoRoot: string): boolean | null {
  try {
    return git(repoRoot, ['status', '--porcelain']) !== '';
  } catch {
    return null;
  }
}
