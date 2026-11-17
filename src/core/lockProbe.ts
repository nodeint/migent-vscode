import { readFileSync, statSync } from 'node:fs';
import os from 'node:os';

import type { SessionLockFile } from '@nodeint/migent-contracts';

import { declaredOf } from './contractRead';
import type { LockProbe } from './model';
import { isRecord } from './record';

export const LOCK_STALE_MS = 30_000;

/**
 * `session.lock` as the contract declares it. A lock missing any of the five required fields (or with a wrong-typed
 * one) is unparsable, so the mtime fallback in `probeLock` decides its liveness.
 */
export function readLock(lockPath: string): SessionLockFile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(lockPath, 'utf8'));
  } catch {
    return null;
  }
  const raw = declaredOf<SessionLockFile>(parsed);
  if (raw === null) return null;
  const { pid, host, started_at: startedAt, heartbeat_at: heartbeatAt, nonce } = raw;
  if (
    typeof pid !== 'number' ||
    typeof host !== 'string' ||
    host === '' ||
    typeof startedAt !== 'string' ||
    startedAt === '' ||
    typeof heartbeatAt !== 'string' ||
    heartbeatAt === '' ||
    typeof nonce !== 'string' ||
    nonce === ''
  ) {
    return null;
  }
  return { pid, host, started_at: startedAt, heartbeat_at: heartbeatAt, nonce };
}

function pidAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
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
  let info: SessionLockFile | null;
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
