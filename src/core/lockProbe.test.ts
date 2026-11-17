import { mkdirSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { probeLock, readLock } from './lockProbe';

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
    for (const pid of [-1, 0]) {
      expect(probeLock(lockFile(freshLock({ pid })), NOW)).toEqual({ kind: 'stale', reason: 'dead-pid' });
    }
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

const REQUIRED: [string, unknown][] = [
  ['pid', 'x'],
  ['host', 5],
  ['started_at', 5],
  ['heartbeat_at', 5],
  ['nonce', 5],
];

describe('readLock', () => {
  it('returns the contract record for a complete lock', () => {
    const lock = readLock(lockFile(freshLock({ pid: 42 })));
    expect(lock).toMatchObject({ pid: 42, host: os.hostname(), nonce: 'a'.repeat(24) });
  });

  it.each(REQUIRED)('rejects a lock with %s missing', (field) => {
    const lock = JSON.parse(freshLock()) as Record<string, unknown>;
    delete lock[field];
    expect(readLock(lockFile(JSON.stringify(lock)))).toBeNull();
  });

  it.each(['host', 'started_at', 'heartbeat_at', 'nonce'])('rejects a lock with an empty %s', (field) => {
    expect(readLock(lockFile(freshLock({ [field]: '' })))).toBeNull();
  });

  it('treats a lock with an empty required string as unparsable for liveness', () => {
    expect(probeLock(lockFile(freshLock({ nonce: '' }), NOW - 60_000), NOW)).toEqual({ kind: 'stale', reason: 'unparsable' });
  });

  it.each(REQUIRED)('rejects a lock with a wrong-typed %s', (field, bad) => {
    expect(readLock(lockFile(freshLock({ [field]: bad })))).toBeNull();
  });

  it('rejects non-object and unparsable content', () => {
    expect(readLock(lockFile('[]'))).toBeNull();
    expect(readLock(lockFile('{ nope'))).toBeNull();
  });
});

describe('probeLock with an incomplete lock', () => {
  for (const field of ['started_at', 'nonce']) {
    const incomplete = (): string => {
      const lock = JSON.parse(freshLock()) as Record<string, unknown>;
      delete lock[field];
      return JSON.stringify(lock);
    };
    it(`fresh lock missing ${field} is alive on a foreign host with no identity`, () => {
      expect(probeLock(lockFile(incomplete(), NOW - 5_000), NOW)).toEqual({
        kind: 'alive',
        pid: null,
        host: null,
        heartbeatAt: null,
        foreignHost: true,
      });
    });
    it(`expired lock missing ${field} is stale unparsable`, () => {
      expect(probeLock(lockFile(incomplete(), NOW - 60_000), NOW)).toEqual({ kind: 'stale', reason: 'unparsable' });
    });
  }
});

describe('session.lock fixtures', () => {
  const root = path.join(__dirname, 'fixtures', 'sessions');
  const locks = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name, 'session.lock'))
    .filter((file) => {
      try {
        readFileSync(file);
        return true;
      } catch {
        return false;
      }
    });

  it('finds the running and stale-lock fixtures', () => {
    expect(locks.map((file) => path.basename(path.dirname(file))).sort()).toEqual(['running', 'stale-lock']);
  });

  it.each(locks)('reads %s with the complete fixture values', (file) => {
    expect(readLock(file)).toEqual({
      pid: 999999,
      host: 'REDACTED_HOST',
      started_at: '2026-10-26T09:00:00.000+00:00',
      heartbeat_at: '2026-10-26T09:00:00.000+00:00',
      nonce: '000000000000000000000000',
    });
  });

  it.each(locks)('probes %s as alive on a foreign host with a fresh heartbeat', (file) => {
    expect(probeLock(file, Date.parse('2026-10-26T09:00:01.000+00:00'))).toEqual({
      kind: 'alive',
      pid: 999999,
      host: 'REDACTED_HOST',
      heartbeatAt: '2026-10-26T09:00:00.000+00:00',
      foreignHost: true,
    });
  });

  it.each(locks)('probes %s as stale by heartbeat once it is older than 30 seconds', (file) => {
    expect(probeLock(file, Date.parse('2026-10-26T09:01:00.000+00:00'))).toEqual({ kind: 'stale', reason: 'heartbeat' });
  });
});
