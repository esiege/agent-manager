// Helpers for `agentctl blocker`: which files can go with a blocker, capturing the screen, and
// printing the owner's answer.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { BLOCKER_MEDIA_TYPES, LIMITS, type Blocker, type BlockerMediaType } from '@agent-manager-deluxe/shared';

const BY_EXTENSION: Record<string, BlockerMediaType> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
};

export class BlockerFileError extends Error {}

export interface BlockerFile {
  path: string;
  name: string;
  contentType: BlockerMediaType;
  bytes: Buffer;
}

/** Reads a screenshot or video, refusing types and sizes the manager won't take. */
export function readBlockerFile(path: string): BlockerFile {
  if (!existsSync(path) || !statSync(path).isFile()) throw new BlockerFileError(`No file at ${path}`);
  const contentType = BY_EXTENSION[extname(path).toLowerCase()];
  if (!contentType) {
    throw new BlockerFileError(`${basename(path)}: send a PNG, JPEG, WebP or GIF screenshot, or an MP4 or WebM video`);
  }
  const size = statSync(path).size;
  const max = BLOCKER_MEDIA_TYPES[contentType] === 'image' ? LIMITS.blockerImageBytes : LIMITS.blockerVideoBytes;
  if (size > max) {
    throw new BlockerFileError(`${basename(path)} is ${(size / 1024 / 1024).toFixed(1)} MB; the limit is ${max / 1024 / 1024} MB. Shrink or trim it.`);
  }
  return { path, name: basename(path), contentType, bytes: readFileSync(path) };
}

/**
 * Captures the whole screen to a temporary JPEG and reads it. Not on Windows: Defender's script
 * scanning (AMSI) blocks a PowerShell screen grab as malware, and agentctl doesn't work around it.
 */
export function captureScreen(): BlockerFile {
  if (process.platform === 'win32') {
    throw new BlockerFileError(
      "--screen doesn't work on Windows (Defender blocks scripted screen captures). Attach a screenshot you have instead: --screenshot <file>",
    );
  }
  const path = join(tmpdir(), `agent-manager-deluxe-screen-${Date.now()}.jpg`);
  try {
    if (process.platform === 'darwin') {
      execFileSync('screencapture', ['-x', '-t', 'jpg', path], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 30_000 });
    } else {
      captureLinux(path);
    }
  } catch (e) {
    const detail = (e as { stderr?: Buffer }).stderr?.toString().trim().split('\n').pop() || (e as Error).message;
    throw new BlockerFileError(`Couldn't capture the screen: ${detail}`);
  }
  if (!existsSync(path)) throw new BlockerFileError("Couldn't capture the screen: no image was written");
  try {
    return { ...readBlockerFile(path), name: 'screen.jpg' };
  } finally {
    rmSync(path, { force: true });
  }
}

function captureLinux(path: string) {
  const tools: [string, string[]][] = [
    ['gnome-screenshot', ['-f', path]],
    ['grim', [path]],
    ['import', ['-window', 'root', path]],
    ['scrot', ['-o', path]],
  ];
  for (const [tool, args] of tools) {
    try {
      execFileSync(tool, args, { stdio: ['ignore', 'ignore', 'pipe'], timeout: 30_000 });
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
  throw new Error('no screenshot tool found (gnome-screenshot, grim, ImageMagick import or scrot); pass --screenshot <file> instead');
}

/** What the agent reads: the status, and the owner's answer when there is one. */
export function describeBlocker(b: Blocker): string {
  if (b.status === 'open') {
    return `Blocker ${b.id} is still open: "${b.title}". The person hasn't answered yet.`;
  }
  const verb = b.status === 'resolved' ? 'resolved' : 'dismissed';
  const lines = [`Blocker ${b.id} was ${verb} by ${b.resolvedBy ?? 'the person'} at ${b.resolvedAt}: "${b.title}".`];
  if (b.status === 'dismissed') lines.push("They won't act on it: carry on without it, or stop and say why you can't.");
  lines.push(b.resolution ? `Their answer:\n${b.resolution}` : 'They left no note.');
  return lines.join('\n');
}
