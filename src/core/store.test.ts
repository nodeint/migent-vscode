import { mkdirSync, mkdtempSync, readFileSync,rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isRetentionExempt } from './attention';
import { probeLock } from './lockProbe';
import type { SessionChangeEvent } from './model';
import { SessionStore } from './store';
import { makeProject, syntheticDir } from './testHelpers';

// Lets one test make listing the sessions directory fail with a chosen error code.
const fault = vi.hoisted(() => ({ code: null as string | null }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readdirSync: ((...args: Parameters<typeof actual.readdirSync>) => {
      if (fault.code !== null && String(args[0]).endsWith('sessions')) {
        throw Object.assign(new Error('injected'), { code: fault.code });
      }
      return actual.readdirSync(...args);
    }) as typeof actual.readdirSync,
  };
});

// Counts the sessions whose execution summaries were read, to show a hidden session pays nothing for reply targets.
const reads = vi.hoisted(() => ({ dirs: [] as string[] }));

vi.mock('./executions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./executions')>();
  return {
    ...actual,
    listExecutions: (dir: string) => {
      reads.dirs.push(dir);
      return actual.listExecutions(dir);
    },
  };
});

const dirs: string[] = [];

beforeEach(() => {
  dirs.push(makeProject());
});

afterEach(() => {
  fault.code = null;
  reads.dirs.length = 0;
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

  it('records why a session is Unknown', () => {
    const s = store();
    s.load();
    expect(s.snapshot('corrupt-status')?.displayState.unknownReason).toBe('invalid-status');
    expect(s.snapshot('unknown-schema')?.displayState.unknownReason).toBe('unsupported-schema');
    // A session with a status but no readable manifest.
    mkdirSync(sessionDir('no-manifest'), { recursive: true });
    writeFileSync(path.join(sessionDir('no-manifest'), 'status.json'), '{"status":"active"}');
    // A session with a manifest but no status.json.
    mkdirSync(sessionDir('no-status'), { recursive: true });
    writeFileSync(path.join(sessionDir('no-status'), 'manifest.yaml'), 'session_id: x\nschema_version: 2\n');
    s.load();
    expect(s.snapshot('no-manifest')?.displayState.unknownReason).toBe('invalid-manifest');
    expect(s.snapshot('no-status')?.displayState.unknownReason).toBe('missing-status');
  });

  it('shows status = question as Question, and Running when a live lock exists', () => {
    mkdirSync(sessionDir('asking'), { recursive: true });
    writeFileSync(path.join(sessionDir('asking'), 'manifest.yaml'), 'session_id: asking\nschema_version: 2\n');
    writeFileSync(path.join(sessionDir('asking'), 'status.json'), '{"status":"question"}');
    const s = store();
    s.load();
    expect(s.snapshot('asking')?.displayState).toMatchObject({ state: 'question', icon: 'comment-discussion' });
    writeFileSync(
      path.join(sessionDir('asking'), 'session.lock'),
      JSON.stringify({ pid: process.pid, host: os.hostname(), heartbeat_at: new Date().toISOString() }),
    );
    s.refreshSession('asking');
    expect(s.snapshot('asking')?.displayState.state).toBe('running');
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

  it('keeps a prepared session older than the limit and does not count it as hidden', () => {
    const stamp = (name: string, createdAt: string): void => {
      const file = path.join(sessionDir(name), 'manifest.yaml');
      writeFileSync(file, readFileSync(file, 'utf8').replace(/created_at: .*/, `created_at: ${createdAt}`));
    };
    stamp('completed', '2026-10-26T12:00:00.000+00:00');
    stamp('prepared', '2026-01-01T10:00:00.000+00:00');
    const all = new SessionStore(dirs[dirs.length - 1]!);
    all.load();
    const exemptIds = all.all().filter((snapshot) => isRetentionExempt(snapshot)).map((snapshot) => snapshot.sessionId);
    const limited = new SessionStore(dirs[dirs.length - 1]!, { limit: 1 });
    limited.load();
    const ids = limited.all().map((snapshot) => snapshot.sessionId);
    expect(ids).toContain('prepared');
    expect(ids).toContain('completed');
    for (const id of exemptIds) expect(ids).toContain(id);
    expect(limited.hiddenCount).toBe(all.all().length - ids.length);
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

describe('SessionStore retention', () => {
  /** Give a fixture session a distinct creation time so the order does not depend on ids. */
  function stamp(name: string, createdAt: string): void {
    const file = path.join(sessionDir(name), 'manifest.yaml');
    writeFileSync(file, readFileSync(file, 'utf8').replace(/created_at: .*/, `created_at: ${createdAt}`));
  }

  function retained(s: SessionStore): string[] {
    return s.all().map((snapshot) => snapshot.sessionId).sort();
  }

  function limited(limit: number): SessionStore {
    stamp('completed', '2026-10-26T12:00:00.000+00:00');
    stamp('failed', '2026-10-26T11:00:00.000+00:00');
    return new SessionStore(dirs[dirs.length - 1]!, { limit });
  }

  it('retains the newest sessions plus every Running, Prepared, Blocked and Question session, and counts the rest as hidden', () => {
    freshenLock('running', false);
    const s = limited(2);
    s.load();
    expect(retained(s)).toEqual(['blocked', 'completed', 'failed', 'prepared', 'running']);
    // 10 fixture sessions, 5 retained.
    expect(s.scanOutcome.eligible).toHaveLength(10);
    expect(s.hiddenCount).toBe(5);
  });

  it('exempts a session that only has pending questions', () => {
    mkdirSync(sessionDir('asking'), { recursive: true });
    writeFileSync(
      path.join(sessionDir('asking'), 'manifest.yaml'),
      'session_id: asking\ncreated_at: 2020-01-01T00:00:00.000+00:00\nschema_version: 2\n',
    );
    writeFileSync(
      path.join(sessionDir('asking'), 'status.json'),
      readFileSync(path.join(syntheticDir('running-questions'), 'status.json'), 'utf8'),
    );
    const s = limited(2);
    s.load();
    expect(s.snapshot('asking')?.status?.questions).toHaveLength(1);
    expect(s.snapshot('asking')?.displayState.state).toBe('stopped');
  });

  it('lets a hidden session that resumes become retained, and emits a scan change for the hidden count', () => {
    const s = limited(1);
    s.load();
    expect(s.snapshot('stale-lock')).toBeUndefined();
    const hiddenBefore = s.hiddenCount;
    const project: string[] = [];
    s.onDidChangeProject((event) => project.push(event.kind));

    // A non-exempt hidden session refreshed again stays hidden, silently.
    const quiet = changes(s, () => s.refreshSession('stale-lock'));
    expect(quiet).toEqual([]);
    expect(project).toEqual([]);

    freshenLock('stale-lock', false);
    const events = changes(s, () => s.refreshSession('stale-lock'));
    expect(events).toContainEqual(expect.objectContaining({ sessionId: 'stale-lock', kind: 'added' }));
    expect(s.snapshot('stale-lock')?.displayState.state).toBe('running');
    expect(s.hiddenCount).toBe(hiddenBefore - 1);
    expect(project).toEqual(['scan']);
  });

  it('retains hidden sessions again when the limit is raised', () => {
    const s = limited(1);
    s.load();
    expect(s.hiddenCount).toBeGreaterThan(0);
    s.setLimit(100);
    expect(s.limit).toBe(100);
    expect(s.hiddenCount).toBe(0);
    expect(s.all()).toHaveLength(10);
  });

  it('drops a session whose markers disappeared on refresh, hidden or retained', () => {
    const s = limited(1);
    s.load();
    const hiddenBefore = s.hiddenCount;
    rmSync(sessionDir('blocked'), { recursive: true, force: true });
    rmSync(sessionDir('stale-lock'), { recursive: true, force: true });
    const events = changes(s, () => {
      s.refreshSession('blocked');
      s.refreshSession('stale-lock');
    });
    expect(events).toEqual([expect.objectContaining({ sessionId: 'blocked', kind: 'removed' })]);
    expect(s.snapshot('stale-lock')).toBeUndefined();
    expect(s.hiddenCount).toBe(hiddenBefore - 1);
  });

  it('does not create a snapshot for a refresh of a session that never existed', () => {
    const s = store();
    s.load();
    const events = changes(s, () => s.refreshSession('ghost'));
    expect(events).toEqual([]);
    expect(s.snapshot('ghost')).toBeUndefined();
  });
});

describe('SessionStore scan outcome', () => {
  function bare(): string {
    const root = mkdtempSync(path.join(os.tmpdir(), 'migent-vscode-scan-'));
    dirs.push(root);
    mkdirSync(path.join(root, '.migent'));
    return root;
  }

  it('separates discovered, eligible and pending directories', () => {
    const s = store();
    s.load();
    mkdirSync(sessionDir('just-created'));
    s.load();
    const scan = s.scanOutcome;
    expect(scan.state).toBe('ok');
    expect(scan.pending).toEqual(['just-created']);
    expect(scan.eligible).not.toContain('just-created');
    expect(scan.discovered).toContain('just-created');
    expect(s.snapshot('just-created')).toBeUndefined();
  });

  it('promotes a pending directory once its marker is written', () => {
    const s = store();
    mkdirSync(sessionDir('late'));
    s.load();
    expect(s.scanOutcome.pending).toEqual(['late']);
    writeFileSync(path.join(sessionDir('late'), 'manifest.yaml'), 'session_id: late\nschema_version: 2\n');
    const events = changes(s, () => s.refreshSession('late'));
    expect(events).toContainEqual(expect.objectContaining({ sessionId: 'late', kind: 'added' }));
    s.load();
    expect(s.scanOutcome.pending).toEqual([]);
  });

  it('reports missing and empty sessions directories distinctly', () => {
    const root = bare();
    const s = new SessionStore(root);
    s.load();
    expect(s.scanOutcome).toMatchObject({ state: 'missing', discovered: [] });
    mkdirSync(path.join(root, '.migent', 'sessions'));
    s.load();
    expect(s.scanOutcome).toMatchObject({ state: 'empty', discovered: [] });
  });

  it('reports an unreadable sessions directory and removes cached sessions', () => {
    const s = store();
    s.load();
    const before = s.all().map((snapshot) => snapshot.sessionId);
    expect(before.length).toBeGreaterThan(0);
    fault.code = 'EACCES';
    const events = changes(s, () => s.load());
    expect(s.scanOutcome).toMatchObject({ state: 'unreadable', error: 'EACCES', discovered: [] });
    expect(s.all()).toEqual([]);
    expect(events.filter((event) => event.kind === 'removed')).toHaveLength(before.length);
    fault.code = null;
    s.load();
    expect(s.scanOutcome.state).toBe('ok');
    expect(s.all().map((snapshot) => snapshot.sessionId).sort()).toEqual([...before].sort());
  });

  it('emits a project scan change only when the outcome changes', () => {
    const s = store();
    const seen: string[] = [];
    const unsubscribe = s.onDidChangeProject((event) => seen.push(event.kind));
    s.load();
    s.load();
    expect(seen).toEqual(['scan']);
    mkdirSync(sessionDir('pending-one'));
    s.load();
    expect(seen).toEqual(['scan', 'scan']);
    unsubscribe();
  });

  it('removes all sessions when the sessions directory is deleted', () => {
    const s = store();
    s.load();
    rmSync(path.join(dirs[dirs.length - 1]!, '.migent', 'sessions'), { recursive: true, force: true });
    s.load();
    expect(s.all()).toEqual([]);
    expect(s.scanOutcome.state).toBe('missing');
  });
});

describe('SessionStore single-directory updates', () => {
  it('rescanDirectories lists new and removed directories without reading sessions', () => {
    const s = store();
    s.load();
    const sessionEvents: SessionChangeEvent[] = [];
    s.onDidChange((event) => sessionEvents.push(event));
    const project: string[] = [];
    s.onDidChangeProject((event) => project.push(event.kind));

    mkdirSync(sessionDir('fresh'));
    s.rescanDirectories();
    expect(s.scanOutcome.pending).toEqual(['fresh']);
    expect(project).toEqual(['scan']);

    rmSync(sessionDir('completed'), { recursive: true, force: true });
    s.rescanDirectories();
    expect(s.scanOutcome.discovered).not.toContain('completed');
    // Sessions are only touched through refreshSession / removeSession.
    expect(sessionEvents).toEqual([]);
    expect(s.snapshot('completed')).toBeDefined();

    s.rescanDirectories();
    expect(project).toEqual(['scan', 'scan']);
  });

  it('refreshSession moves a directory from pending to eligible in the scan outcome', () => {
    const s = store();
    mkdirSync(sessionDir('late'));
    s.load();
    expect(s.scanOutcome.pending).toEqual(['late']);
    const project: string[] = [];
    s.onDidChangeProject((event) => project.push(event.kind));

    writeFileSync(path.join(sessionDir('late'), 'manifest.yaml'), 'session_id: late\nschema_version: 2\n');
    s.refreshSession('late');
    expect(s.scanOutcome.pending).toEqual([]);
    expect(s.scanOutcome.eligible).toContain('late');
    expect(project).toEqual(['scan']);
  });

  it('refreshSession keeps a markerless directory pending, and drops a deleted one from the scan', () => {
    const s = store();
    s.load();
    mkdirSync(sessionDir('empty-dir'));
    s.refreshSession('empty-dir');
    expect(s.scanOutcome.pending).toEqual(['empty-dir']);
    expect(s.snapshot('empty-dir')).toBeUndefined();

    rmSync(sessionDir('empty-dir'), { recursive: true });
    s.refreshSession('empty-dir');
    expect(s.scanOutcome.discovered).not.toContain('empty-dir');

    rmSync(sessionDir('blocked'), { recursive: true, force: true });
    s.refreshSession('blocked');
    expect(s.scanOutcome.eligible).not.toContain('blocked');
    expect(s.snapshot('blocked')).toBeUndefined();
  });
});

describe('replyTargets', () => {
  function writeCancelled(sessionId: string, executions: Record<string, Record<string, unknown>>): void {
    const dir = sessionDir(sessionId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'manifest.yaml'), `session_id: ${sessionId}
schema_version: 2
`);
    writeFileSync(path.join(dir, 'status.json'), JSON.stringify({ status: 'cancelled', workflow_id: 'w' }));
    for (const [id, record] of Object.entries(executions)) {
      mkdirSync(path.join(dir, 'executions', id), { recursive: true });
      writeFileSync(path.join(dir, 'executions', id, 'execution.json'), JSON.stringify(record));
    }
  }

  it('attaches the targets of a blocked session and none for a completed one', () => {
    const s = store();
    s.load();
    expect(s.snapshot('blocked')?.replyTargets.map((target) => target.kind)).toEqual(['blocker']);
    expect(s.snapshot('completed')?.replyTargets).toEqual([]);
  });

  it('reads the executions of a cancelled workflow once and leaves out a verify-only one', () => {
    writeCancelled('cancelled-one', {
      '0001-code--attempt-01': { status: 'cancelled', stage_id: 'code' },
      '0002-test--attempt-01': { status: 'cancelled', stage_id: 'test', kind: 'verify' },
    });
    const s = store();
    s.load();
    expect(s.snapshot('cancelled-one')?.replyTargets).toEqual([
      { executionId: '0001-code--attempt-01', stageId: 'code', attempt: 1, kind: 'cancelled' },
    ]);
  });

  it('emits updated when only the targets change', () => {
    writeCancelled('cancelled-two', { '0001-code--attempt-01': { status: 'cancelled', stage_id: 'code' } });
    const s = store();
    s.load();
    const events: SessionChangeEvent[] = [];
    s.onDidChange((event) => events.push(event));
    writeFileSync(
      path.join(sessionDir('cancelled-two'), 'executions', '0001-code--attempt-01', 'execution.json'),
      JSON.stringify({ status: 'completed', stage_id: 'code' }),
    );
    s.refreshSession('cancelled-two');
    expect(events).toEqual([expect.objectContaining({ sessionId: 'cancelled-two', kind: 'updated' })]);
    expect(s.snapshot('cancelled-two')?.replyTargets).toEqual([]);
  });

  it('reads no executions for a cancelled session the limit hides, and reads them once it is retained', () => {
    writeCancelled('cancelled-old', { '0001-code--attempt-01': { status: 'cancelled', stage_id: 'code' } });
    writeFileSync(
      path.join(sessionDir('cancelled-old'), 'manifest.yaml'),
      'session_id: cancelled-old\nschema_version: 2\ncreated_at: 2000-01-01T00:00:00Z\n',
    );
    const s = new SessionStore(dirs[0], { limit: 1 });
    s.load();
    expect(s.snapshot('cancelled-old')).toBeUndefined();
    expect(reads.dirs.filter((dir) => dir.includes('cancelled-old'))).toEqual([]);
    s.refreshSession('cancelled-old');
    expect(reads.dirs.filter((dir) => dir.includes('cancelled-old'))).toEqual([]);
    s.setLimit(500);
    expect(s.snapshot('cancelled-old')?.replyTargets).toHaveLength(1);
    expect(reads.dirs.filter((dir) => dir.includes('cancelled-old'))).toHaveLength(1);
  });
});

describe('SessionStore numeric ids and title overlay', () => {
  function addSession(id: string, createdAt: string, extra = ''): string {
    const root = dirs[dirs.length - 1]!;
    const dir = path.join(root, '.migent', 'sessions', id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'manifest.yaml'), `session_id: ${id}\nworkflow_id: plan\ncreated_at: ${createdAt}\nschema_version: 2\n${extra}`);
    writeFileSync(path.join(dir, 'status.json'), JSON.stringify({ session_id: id, status: 'prepared', updated_at: createdAt }));
    return dir;
  }

  it('orders sessions with equal creation times by number, and mixed ids without throwing', () => {
    const at = '2030-01-01T00:00:00.000+00:00';
    addSession('9', at);
    addSession('10', at);
    const s = store();
    s.load();
    const ids = s.all().map((snapshot) => snapshot.sessionId);
    expect(ids.indexOf('10')).toBeLessThan(ids.indexOf('9'));
    expect(ids.slice(0, 2)).toEqual(['10', '9']);
  });

  it('reads unquoted integer ids and links numeric lineage', () => {
    const at = '2030-01-01T00:00:00.000+00:00';
    addSession('2', at);
    addSession('3', at, 'prior_session_id: 2\n');
    const s = store();
    s.load();
    expect(s.snapshot('3')?.manifest?.priorSessionId).toBe('2');
    expect(s.snapshot('2')?.manifest?.sessionId).toBe('2');
  });

  it('emits updated when only title.json changes', () => {
    const dir = addSession('5', '2030-01-01T00:00:00.000+00:00');
    const s = store();
    s.load();
    expect(s.snapshot('5')?.titleOverride).toBeNull();
    const events: SessionChangeEvent[] = [];
    s.onDidChange((event) => events.push(event));
    writeFileSync(path.join(dir, 'title.json'), '{"title":"Renamed","updated_at":"t","history":[]}');
    s.refreshSession('5');
    expect(events).toEqual([expect.objectContaining({ sessionId: '5', kind: 'updated' })]);
    expect(s.snapshot('5')?.titleOverride).toBe('Renamed');
    writeFileSync(path.join(dir, 'title.json'), '{"title":"bad\\nline"}');
    s.refreshSession('5');
    expect(s.snapshot('5')?.titleOverride).toBeNull();
  });
});
