import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Blocker } from '@agent-manager-deluxe/shared';
import { BlockerFileError, describeBlocker, readBlockerFile } from '../src/blocker';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'am-blocker-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('readBlockerFile', () => {
  it('names the type from the extension', () => {
    const file = join(dir, 'Login Screen.PNG');
    writeFileSync(file, Buffer.from([1, 2, 3]));
    expect(readBlockerFile(file)).toMatchObject({ name: 'Login Screen.PNG', contentType: 'image/png' });
    writeFileSync(join(dir, 'clip.webm'), Buffer.from([1]));
    expect(readBlockerFile(join(dir, 'clip.webm')).contentType).toBe('video/webm');
  });

  it('refuses missing files, other types and files over the limit', () => {
    expect(() => readBlockerFile(join(dir, 'nope.png'))).toThrow(BlockerFileError);
    writeFileSync(join(dir, 'notes.txt'), 'x');
    expect(() => readBlockerFile(join(dir, 'notes.txt'))).toThrow(/PNG, JPEG, WebP or GIF/);
    writeFileSync(join(dir, 'big.png'), Buffer.alloc(8 * 1024 * 1024 + 1));
    expect(() => readBlockerFile(join(dir, 'big.png'))).toThrow(/limit is 8 MB/);
  });
});

describe('describeBlocker', () => {
  const base: Blocker = {
    id: '6f1c2c1e-0000-4000-8000-000000000001',
    agentId: 'pc/claude/s1',
    agentName: 'Fix login',
    kind: 'claude-code',
    project: 'webapp',
    machine: 'pc',
    title: 'Need the Stripe test key',
    details: null,
    media: [],
    status: 'open',
    createdAt: '2026-11-13T12:00:00.000Z',
    resolvedAt: null,
    resolvedBy: null,
    resolution: null,
    delivery: null,
    messageId: null,
    keyName: 'pc',
  };

  it('says when nobody has answered yet', () => {
    expect(describeBlocker(base)).toContain('is still open');
  });

  it('prints the answer', () => {
    const text = describeBlocker({ ...base, status: 'resolved', resolvedBy: 'me', resolvedAt: '2026-11-13T12:05:00.000Z', resolution: 'It is in .env now' });
    expect(text).toContain('was resolved by me');
    expect(text).toContain('Their answer:\nIt is in .env now');
  });

  it('tells the agent to carry on without it when dismissed', () => {
    expect(describeBlocker({ ...base, status: 'dismissed', resolvedBy: 'me' })).toContain("They won't act on it");
  });
});
