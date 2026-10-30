import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { probeLock } from './lockProbe';

const NOW = Date.parse('2026-10-26T12:00:00.000Z');
const dirs: string[] = [];

function lockFile(content: string | null, mtime?: number): string {
  const dir = path.join(os.tmpdir(), `migent-lock-${dirs.length}`);
  dirs.push(dir);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'session.lock');
  if (content !== null) {
    writeFileSync(file, content);
    if (mtime !== undefined) utimesSync(file, new Date(mtime), new Date(mtime));
  }
  return file;
}

const freshLock = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    pid: 999999,
    host: os.hostname(),
    started_at: '2026-10-26T11:59:00.000Z',
    heartbeat_at: new Date(NOW - 5_000).toISOString(),
    nonce: 'a'.repeat(24),
    ...over,
  });

describe('probeLock', () => {
  it('none: no lock file', () => {
    expect(probeLock(path.join(os.tmpdir(), 'no-such-lock'), NOW)).toEqual({ kind: 'none' });
  });

  it('alive: local host, live pid, fresh heartbeat', () => {
    const probe = probeLock(lockFile(freshLock({ pid: process.pid })), NOW);
    expect(probe.kind).toBe('alive');
    if (probe.kind === 'alive') expect(probe.foreignHost).toBe(false);
  });

  it('alive: foreign host shows Running but marks the lock foreign', () => {
    const probe = probeLock(lockFile(freshLock({ host: 'some-other-machine' })), NOW);
    expect(probe.kind).toBe('alive');
    if (probe.kind === 'alive') expect(probe.foreignHost).toBe(true);
  });

  it('stale: dead pid on this host, even with a fresh heartbeat', () => {
    // A pid that cannot exist: negative pids are never valid.
    const probe = probeLock(lockFile(freshLock({ pid: -1 })), NOW);
    expect(probe).toEqual({ kind: 'stale', reason: 'dead-pid' });
  });

  it('stale: heartbeat older than 30 seconds', () => {
    const old = JSON.stringify({
      pid: process.pid,
      host: os.hostname(),
      started_at: '2026-10-26T11:00:00.000Z',
      heartbeat_at: new Date(NOW - 31_000).toISOString(),
      nonce: 'b'.repeat(24),
    });
    expect(probeLock(lockFile(old), NOW)).toEqual({ kind: 'stale', reason: 'heartbeat' });
  });

  it('stale: unparsable lock falls back to the file mtime', () => {
    const file = lockFile('{ not json', NOW - 60_000);
    expect(probeLock(file, NOW)).toEqual({ kind: 'stale', reason: 'unparsable' });
    const recent = lockFile('{ not json', NOW - 10_000);
    const probe = probeLock(recent, NOW);
    expect(probe.kind).toBe('alive');
    if (probe.kind === 'alive') expect(probe.foreignHost).toBe(true);
  });

  it('stale: malformed lock fields fall back to mtime', () => {
    const file = lockFile(JSON.stringify({ pid: 'not-a-number' }), NOW - 60_000);
    expect(probeLock(file, NOW)).toEqual({ kind: 'stale', reason: 'unparsable' });
  });
});
