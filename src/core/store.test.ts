import { mkdirSync, mkdtempSync, readFileSync,rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { probeLock } from './lockProbe';
import type { SessionChangeEvent } from './model';
import { SessionStore } from './store';
import { makeProject } from './testHelpers';

const dirs: string[] = [];

beforeEach(() => {
  dirs.push(makeProject());
});

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function store(): SessionStore {
  return new SessionStore(dirs[dirs.length - 1]!);
}

function sessionDir(name: string): string {
  const project = dirs[dirs.length - 1]!;
  return path.join(project, '.migent', 'sessions', name);
}

function changes(s: SessionStore, run: () => void): SessionChangeEvent[] {
  const events: SessionChangeEvent[] = [];
  const unsubscribe = s.onDidChange((event) => events.push(event));
  try {
    run();
  } finally {
    unsubscribe();
  }
  return events;
}

/**
 * The committed fixture locks carry a stale heartbeat (safe to commit). Rewrite
 * one with a fresh heartbeat so it probes as alive; `foreignHost` selects whether
 * the holder is this machine.
 */
function freshenLock(name: string, foreignHost: boolean): void {
  writeFileSync(
    path.join(sessionDir(name), 'session.lock'),
    JSON.stringify({
      pid: process.pid,
      host: foreignHost ? 'some-other-machine' : os.hostname(),
      started_at: '2026-10-26T09:00:00.000Z',
      heartbeat_at: new Date().toISOString(),
      nonce: 'n'.repeat(24),
    }),
  );
}

describe('SessionStore.load', () => {
  it('scans the sessions directory and derives display states', () => {
    freshenLock('running', true);
    const s = store();
    s.load();
    const byState = new Map(s.all().map((snapshot) => [snapshot.displayState.state, snapshot.sessionId]));
    expect(byState.get('completed')).toBe('completed');
    expect(byState.get('failed')).toBe('failed');
    expect(byState.get('stopped')).toBe('active-stopped');
    expect(byState.get('blocked')).toBe('blocked');
    expect(byState.get('cancelled')).toBe('cancelled');
    expect(byState.get('prepared')).toBe('prepared');
    // The fake running lock points at pid 999999 on another host: alive, not writable.
    const running = s.snapshot('running')!;
    expect(running.displayState.state).toBe('running');
    expect(running.displayState.writable).toBe(false);
    // The stale lock leaves an active session stopped.
    expect(s.snapshot('stale-lock')?.displayState.state).toBe('stopped');
    // Corrupt status.json and unknown schema are both Unknown.
    expect(s.snapshot('corrupt-status')?.displayState.state).toBe('unknown');
    expect(s.snapshot('unknown-schema')?.displayState.state).toBe('unknown');
  });

  it('emits added events for new sessions and removed for deleted ones', () => {
    const s = store();
    s.load();
    rmSync(sessionDir('completed'), { recursive: true, force: true });
    const events = changes(s, () => {
      mkdirSync(path.join(sessionDir('new-session')), { recursive: true });
      writeFileSync(
        path.join(sessionDir('new-session'), 'manifest.yaml'),
        'session_id: new-session\nschema_version: 2\n',
      );
      s.load();
    });
    expect(events).toContainEqual(expect.objectContaining({ sessionId: 'new-session', kind: 'added' }));
    expect(events).toContainEqual(expect.objectContaining({ sessionId: 'completed', kind: 'removed' }));
  });

  it('emits updated when a status changes (running -> stopped)', () => {
    freshenLock('running', false);
    const s = store();
    s.load();
    expect(s.snapshot('running')?.displayState.state).toBe('running');
    rmSync(path.join(sessionDir('running'), 'session.lock'));
    const events = changes(s, () => s.refreshSession('running'));
    expect(events).toContainEqual(expect.objectContaining({ sessionId: 'running', kind: 'updated' }));
    expect(s.snapshot('running')?.displayState.state).toBe('stopped');
  });

  it('does not emit when nothing changed', () => {
    const s = store();
    s.load();
    const events = changes(s, () => s.load());
    expect(events).toEqual([]);
  });

  it('sorts newest first by created_at', () => {
    const s = store();
    s.load();
    const ids = s.all().map((snapshot) => snapshot.sessionId);
    expect(ids.indexOf('completed')).toBeLessThan(ids.indexOf('active-stopped'));
  });

  it('limits the number of sessions, dropping the oldest', () => {
    // Distinct created_at values: completed (newest), blocked, prepared, rest oldest.
    const stamp = (name: string, createdAt: string): void => {
      const file = path.join(sessionDir(name), 'manifest.yaml');
      writeFileSync(file, readFileSync(file, 'utf8').replace(/created_at: .*/, `created_at: ${createdAt}`));
    };
    stamp('completed', '2026-10-26T12:00:00.000+00:00');
    stamp('blocked', '2026-10-26T11:00:00.000+00:00');
    stamp('prepared', '2026-10-26T10:00:00.000+00:00');
    const s = new SessionStore(dirs[dirs.length - 1]!, { limit: 3 });
    s.load();
    expect(s.all().map((snapshot) => snapshot.sessionId)).toEqual(['completed', 'blocked', 'prepared']);
  });
});

describe('SessionStore lazy loading', () => {
  it('loads executions only on demand and emits an executions event on change', () => {
    const s = store();
    s.load();
    expect(s.snapshot('completed')?.executions).toEqual([]);
    const events = changes(s, () => {
      const rows = s.loadExecutions('completed');
      expect(rows).toHaveLength(1);
      expect(rows[0]?.stage).toBe('plan');
    });
    expect(events).toContainEqual(expect.objectContaining({ sessionId: 'completed', kind: 'executions' }));
    expect(s.snapshot('completed')?.executions).toHaveLength(1);
  });

  it('keeps a per-session event offset and de-duplicates by seq', () => {
    const s = store();
    s.load();
    const first = s.readNewEvents('completed');
    expect(first.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(s.snapshot('completed')?.lastEventSeq).toBe(5);
    const second = s.readNewEvents('completed');
    expect(second).toEqual([]);

    const eventsFile = path.join(sessionDir('completed'), 'events.jsonl');
    const events = changes(s, () => {
      writeFileSync(eventsFile, readFileSync(eventsFile, 'utf8') + '\n');
    });
    expect(events).toEqual([]); // empty line only: nothing new

    const nextSeq = 6;
    writeFileSync(
      eventsFile,
      readFileSync(eventsFile, 'utf8') +
        JSON.stringify({ v: 2, seq: nextSeq, event: 'provider.turn_completed', timestamp: 't', data: {} }) +
        '\n',
    );
    const third = changes(s, () => s.readNewEvents('completed')).filter((e) => e.kind === 'events');
    expect(third).toHaveLength(1);
    const eventsRead = s.readNewEvents('completed');
    expect(eventsRead).toEqual([]); // already consumed above
    expect(s.snapshot('completed')?.lastEventSeq).toBe(nextSeq);
  });

  it('stores no offsets or state for a session that disappears', () => {
    const s = store();
    s.load();
    s.readNewEvents('completed');
    s.removeSession('completed');
    expect(s.snapshot('completed')).toBeUndefined();
    expect(s.readNewEvents('completed')).toEqual([]);
  });
});

describe('SessionStore running fixture', () => {
  it('treats a lock held by this process as running and writable', () => {
    const project = mkdtempSync(path.join(os.tmpdir(), 'migent-live-'));
    dirs.push(project);
    const sessions = path.join(project, '.migent', 'sessions', 'live');
    mkdirSync(sessions, { recursive: true });
    writeFileSync(path.join(sessions, 'manifest.yaml'), 'session_id: live\nschema_version: 2\n');
    writeFileSync(
      path.join(sessions, 'status.json'),
      JSON.stringify({ session_id: 'live', status: 'active', updated_at: 't' }),
    );
    writeFileSync(
      path.join(sessions, 'session.lock'),
      JSON.stringify({ pid: process.pid, host: os.hostname(), started_at: 't', heartbeat_at: new Date().toISOString(), nonce: 'n' }),
    );
    const s = new SessionStore(project);
    s.load();
    expect(s.snapshot('live')?.displayState.state).toBe('running');
    expect(s.snapshot('live')?.displayState.writable).toBe(true);
    expect(probeLock(path.join(sessions, 'session.lock')).kind).toBe('alive');
  });
});
