import { readFileSync, statSync } from 'node:fs';
import os from 'node:os';

import type { LockProbe } from './model';
import { isRecord } from './record';

export const LOCK_STALE_MS = 30_000;

interface LockInfo {
  pid: number;
  host: string;
  heartbeat_at: string;
}

function readLock(lockPath: string): LockInfo | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(lockPath, 'utf8'));
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const raw = parsed;
  if (
    typeof raw.pid !== 'number' ||
    typeof raw.host !== 'string' ||
    typeof raw.heartbeat_at !== 'string'
  ) {
    return null;
  }
  return { pid: raw.pid, host: raw.host, heartbeat_at: raw.heartbeat_at };
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but we may not signal it: treat as alive.
    return isRecord(error) && error.code === 'EPERM';
  }
}

function heartbeatAge(heartbeatAt: string, now: number): number {
  const beat = Date.parse(heartbeatAt);
  return Number.isFinite(beat) ? now - beat : Number.POSITIVE_INFINITY;
}

/**
 * Probe `session.lock`. A lock from another host counts as alive (its pid cannot
 * be checked here) but the caller must disable write operations. A lock file that
 * does not parse falls back to the file's mtime, as session-lock.ts does.
 */
export function probeLock(lockPath: string, now: number = Date.now(), staleMs: number = LOCK_STALE_MS): LockProbe {
  let info: LockInfo | null;
  try {
    info = readLock(lockPath);
  } catch {
    info = null;
  }
  const isMissing = (() => {
    try {
      statSync(lockPath);
      return false;
    } catch {
      return true;
    }
  })();
  if (isMissing) return { kind: 'none' };

  if (info === null) {
    // Unparsable lock: as old as its mtime.
    let mtime: number;
    try {
      mtime = statSync(lockPath).mtimeMs;
    } catch {
      return { kind: 'none' };
    }
    return now - mtime > staleMs
      ? { kind: 'stale', reason: 'unparsable' }
      : { kind: 'alive', pid: null, host: null, heartbeatAt: null, foreignHost: true };
  }

  const isForeignHost = info.host !== os.hostname();
  if (!isForeignHost && !pidAlive(info.pid)) {
    return { kind: 'stale', reason: 'dead-pid' };
  }
  if (heartbeatAge(info.heartbeat_at, now) > staleMs) {
    return { kind: 'stale', reason: 'heartbeat' };
  }
  return {
    kind: 'alive',
    pid: info.pid,
    host: info.host,
    heartbeatAt: info.heartbeat_at,
    foreignHost: isForeignHost,
  };
}
