import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { isRetentionExempt } from './attention';
import { deriveDisplayState } from './displayState';
import { listExecutions } from './executions';
import { probeLock } from './lockProbe';
import { readManifest } from './manifest';
import type {
  ProjectChangeEvent,
  ScanOutcome,
  SessionChangeEvent,
  SessionChangeKind,
  SessionSnapshot,
} from './model';
import {
  lockPath,
  MANIFEST_FILENAME,
  manifestPath,
  sessionDir,
  sessionsDir,
  STATUS_FILENAME,
  statusPath,
  titlePath,
} from './paths';
import { isRecord } from './record';
import { replyNeedsExecutions, replyTargets } from './replyFlow';
import { compareSessionIds } from './sessionId';
import { readTitleOverride } from './sessionTitle';
import { readStatus } from './statusReader';

export const DEFAULT_SESSION_LIMIT = 50;

/** Minimal local emitter: the store must not import `vscode`. */
export class Emitter<T> {
  readonly #listeners = new Set<(event: T) => void>();

  public subscribe(listener: (event: T) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  public emit(event: T): void {
    for (const listener of this.#listeners) listener(event);
  }
}

export interface SessionStoreOptions {
  /** Show the N most recent sessions. The directory can reach hundreds of entries. */
  limit?: number;
}

interface SnapshotBody {
  manifest: SessionSnapshot['manifest'];
  status: SessionSnapshot['status'];
  statusError: boolean;
  lock: SessionSnapshot['lock'];
  titleOverride: SessionSnapshot['titleOverride'];
  displayState: SessionSnapshot['displayState'];
  replyTargets: SessionSnapshot['replyTargets'];
}

function sameJson(a: unknown = null, b: unknown = null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function sameBody(a: SnapshotBody, b: SnapshotBody): boolean {
  return (
    sameJson(a.manifest?.raw, b.manifest?.raw) &&
    sameJson(a.status?.raw, b.status?.raw) &&
    sameJson(a.status?.latestProviderEvent, b.status?.latestProviderEvent) &&
    a.statusError === b.statusError &&
    sameJson(a.lock, b.lock) &&
    sameDisplay(a, b) &&
    sameJson(a.replyTargets, b.replyTargets)
  );
}

function sameDisplay(a: SnapshotBody, b: SnapshotBody): boolean {
  return (
    a.titleOverride === b.titleOverride &&
    a.displayState.state === b.displayState.state &&
    a.displayState.unknownReason === b.displayState.unknownReason &&
    a.displayState.writable === b.displayState.writable
  );
}

function manifestState(manifest: SessionSnapshot['manifest']): 'ok' | 'invalid' | 'unsupported' {
  if (manifest === null) return 'invalid';
  return manifest.schemaSupported ? 'ok' : 'unsupported';
}

function createdAtOf(snapshot: SessionSnapshot): string | null {
  return snapshot.manifest?.createdAt ?? snapshot.status?.createdAt ?? null;
}

function isNewer(a: SessionSnapshot, b: SessionSnapshot): boolean {
  const left = createdAtOf(a) ?? '';
  const right = createdAtOf(b) ?? '';
  if (left !== right) return left > right;
  return compareSessionIds(a.sessionId, b.sessionId) > 0;
}

/**
 * Holds one SessionSnapshot per session of one project, and emits change events so
 * views refresh only what changed. Initial load scans the sessions directory with
 * direct reads, faster than spawning the CLI. It holds snapshots only: executions,
 * events and other per-session files are read by their own readers on demand.
 */
export class SessionStore {
  public readonly projectRoot: string;

  readonly #sessions = new Map<string, SessionSnapshot>();
  /** Eligible sessions the limit hides. Ids only: their snapshots are rebuilt when needed. */
  #hidden = new Set<string>();
  readonly #changes = new Emitter<SessionChangeEvent>();
  readonly #projectChanges = new Emitter<ProjectChangeEvent>();
  #scan: ScanOutcome = { state: 'missing', error: null, discovered: [], eligible: [], pending: [] };
  #limit: number;

  constructor(projectRoot: string, options: SessionStoreOptions = {}) {
    this.projectRoot = projectRoot;
    this.#limit = options.limit ?? DEFAULT_SESSION_LIMIT;
  }

  /** Effective limit on non-exempt retained sessions. */
  public get limit(): number {
    return this.#limit;
  }

  /** Eligible sessions the limit currently hides (pending directories are not counted). */
  public get hiddenCount(): number {
    return this.#hidden.size;
  }

  /** Subscribe to changes. Returns an unsubscribe function. */
  public get onDidChange(): (listener: (event: SessionChangeEvent) => void) => () => void {
    return (listener) => this.#changes.subscribe(listener);
  }

  /** Subscribe to project-level changes (`scan` outcome changed). */
  public get onDidChangeProject(): (listener: (event: ProjectChangeEvent) => void) => () => void {
    return (listener) => this.#projectChanges.subscribe(listener);
  }

  /** Outcome of the last sessions directory scan; `missing` before the first `load()`. */
  public get scanOutcome(): ScanOutcome {
    return this.#scan;
  }

  /** All snapshots, newest first. */
  public all(): SessionSnapshot[] {
    return [...this.#sessions.values()].sort((a, b) => (isNewer(b, a) ? 1 : -1));
  }

  public snapshot(sessionId: string): SessionSnapshot | undefined {
    return this.#sessions.get(sessionId);
  }

  /**
   * Full scan of the sessions directory: direct reads, faster than spawning the CLI.
   * Every eligible session is read, then the limit decides which snapshots are retained.
   */
  public load(): void {
    const scan = this.scanSessions();
    const isScanChanged = JSON.stringify(scan) !== JSON.stringify(this.#scan);
    this.#scan = scan;

    const candidates = scan.eligible.map((sessionId) => this.buildSnapshot(sessionId));
    const keep = this.selectRetained(candidates);
    for (const candidate of candidates) {
      if (!keep.has(candidate.sessionId)) continue;
      // Reply targets read execution summaries, so only a retained session pays for them.
      const snapshot = this.withReplyTargets(candidate);
      const current = this.#sessions.get(snapshot.sessionId);
      if (current === undefined) this.#setSession(snapshot.sessionId, snapshot, 'added');
      else if (!sameBody(snapshot, current)) this.#setSession(snapshot.sessionId, snapshot, 'updated');
    }
    for (const sessionId of [...this.#sessions.keys()]) {
      if (!keep.has(sessionId)) this.removeSession(sessionId);
    }
    const hidden = new Set(candidates.map((s) => s.sessionId).filter((id) => !keep.has(id)));
    this.#finish(isScanChanged || hidden.size !== this.#hidden.size, hidden);
  }

  /**
   * Re-read one session. A session with neither marker is removed. A hidden session is
   * rebuilt only to learn whether it became exempt (for example, resumed and Running);
   * it stays hidden, silently, otherwise.
   */
  public refreshSession(sessionId: string): void {
    const hasMarker = this.hasMarker(sessionId);
    this.syncScanEntry(sessionId, hasMarker);
    if (!hasMarker) {
      this.removeSession(sessionId);
      return;
    }
    const read = this.buildSnapshot(sessionId);
    const current = this.#sessions.get(sessionId);
    if (current !== undefined) {
      const next = this.withReplyTargets(read);
      if (!sameBody(next, current)) this.#setSession(sessionId, next, 'updated');
      return;
    }
    if (this.#hidden.has(sessionId) && !isRetentionExempt(read)) return;
    this.#setSession(sessionId, this.withReplyTargets(read), 'added');
    this.enforceLimit();
  }

  public removeSession(sessionId: string): void {
    if (this.#hidden.has(sessionId)) {
      const hidden = new Set(this.#hidden);
      hidden.delete(sessionId);
      this.#finish(true, hidden);
    }
    if (!this.#sessions.has(sessionId)) return;
    this.#sessions.delete(sessionId);
    this.#emit(sessionId, 'removed');
  }

  /**
   * Re-list the sessions directory (names and marker presence only) without reading any
   * session. For a directory created or deleted: cheaper than `load()`, which reads every
   * session. Emits `scan` when the outcome changed; call `refreshSession` or `removeSession`
   * for the affected id.
   */
  public rescanDirectories(): void {
    this.#replaceScan(this.scanSessions());
  }

  /**
   * Change the effective limit (for "Show more") and rescan so hidden sessions that now
   * fit are retained. Same cost as `load()`.
   */
  public setLimit(limit: number): void {
    this.#limit = Math.max(1, Math.floor(limit));
    this.load();
  }

  #replaceScan(scan: ScanOutcome): void {
    const isChanged = JSON.stringify(scan) !== JSON.stringify(this.#scan);
    this.#scan = scan;
    if (isChanged) this.#projectChanges.emit({ project: this.projectRoot, kind: 'scan' });
  }

  /** Keep the last scan's lists in step with a single-session refresh (pending to eligible, or gone). */
  private syncScanEntry(sessionId: string, hasMarker: boolean): void {
    if (this.#scan.state !== 'ok' && this.#scan.state !== 'empty') return;
    const others = (list: string[]): string[] => list.filter((id) => id !== sessionId);
    const discovered = others(this.#scan.discovered);
    const eligible = others(this.#scan.eligible);
    const pending = others(this.#scan.pending);
    if (hasMarker || this.isDirectory(sessionDir(this.projectRoot, sessionId))) {
      discovered.push(sessionId);
      (hasMarker ? eligible : pending).push(sessionId);
    }
    this.#replaceScan({
      state: discovered.length === 0 ? 'empty' : 'ok',
      error: null,
      discovered: discovered.sort(),
      eligible: eligible.sort(),
      pending: pending.sort(),
    });
  }

  private isDirectory(absolute: string): boolean {
    try {
      return statSync(absolute).isDirectory();
    } catch {
      return false;
    }
  }

  #finish(isProjectChanged: boolean, hidden: Set<string>): void {
    this.#hidden = hidden;
    if (isProjectChanged) this.#projectChanges.emit({ project: this.projectRoot, kind: 'scan' });
  }

  #setSession(sessionId: string, snapshot: SessionSnapshot, kind: SessionChangeKind): void {
    this.#sessions.set(sessionId, snapshot);
    this.#emit(sessionId, kind);
  }

  #emit(sessionId: string, kind: SessionChangeKind): void {
    this.#changes.emit({ project: this.projectRoot, sessionId, kind });
  }

  /** Ids to retain: the newest `limit` sessions plus every retention-exempt one. */
  private selectRetained(snapshots: readonly SessionSnapshot[]): Set<string> {
    const ordered = [...snapshots].sort((a, b) => (isNewer(b, a) ? 1 : -1));
    const keep = new Set(ordered.slice(0, this.#limit).map((snapshot) => snapshot.sessionId));
    for (const snapshot of ordered) {
      if (isRetentionExempt(snapshot)) keep.add(snapshot.sessionId);
    }
    return keep;
  }

  /** Move retained sessions beyond the limit to hidden, emitting `removed` for each. */
  private enforceLimit(): void {
    const retained = this.all();
    const keep = this.selectRetained(retained);
    const hidden = new Set(this.#hidden);
    for (const snapshot of retained) {
      if (keep.has(snapshot.sessionId)) continue;
      this.#sessions.delete(snapshot.sessionId);
      hidden.add(snapshot.sessionId);
      this.#emit(snapshot.sessionId, 'removed');
    }
    for (const sessionId of keep) hidden.delete(sessionId);
    this.#finish(hidden.size !== this.#hidden.size, hidden);
  }

  private hasMarker(sessionId: string): boolean {
    const dir = sessionDir(this.projectRoot, sessionId);
    return [MANIFEST_FILENAME, STATUS_FILENAME].some((marker) => {
      try {
        statSync(path.join(dir, marker));
        return true;
      } catch {
        return false;
      }
    });
  }

  private scanSessions(): ScanOutcome {
    let entries;
    try {
      entries = readdirSync(sessionsDir(this.projectRoot), { withFileTypes: true });
    } catch (error) {
      const code = isRecord(error) && typeof error.code === 'string' ? error.code : 'unknown error';
      const state = code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'unreadable';
      return {
        state,
        error: state === 'unreadable' ? code : null,
        discovered: [],
        eligible: [],
        pending: [],
      };
    }
    const discovered: string[] = [];
    const eligible: string[] = [];
    const pending: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      discovered.push(entry.name);
      (this.hasMarker(entry.name) ? eligible : pending).push(entry.name);
    }
    discovered.sort();
    eligible.sort();
    pending.sort();
    return {
      state: discovered.length === 0 ? 'empty' : 'ok',
      error: null,
      discovered,
      eligible,
      pending,
    };
  }

  private buildSnapshot(sessionId: string): SessionSnapshot {
    const manifest = readManifest(manifestPath(this.projectRoot, sessionId));
    const statusRead = readStatus(statusPath(this.projectRoot, sessionId));
    const lock = probeLock(lockPath(this.projectRoot, sessionId));
    const displayState = deriveDisplayState(
      {
        status: statusRead.kind === 'ok' ? statusRead.status : null,
        statusError: statusRead.kind === 'error' ? statusRead.reason : null,
        manifest: manifestState(manifest),
      },
      lock,
    );
    return {
      sessionId,
      manifest,
      status: statusRead.kind === 'ok' ? statusRead.status : null,
      statusError: statusRead.kind === 'error',
      lock,
      titleOverride: readTitleOverride(titlePath(this.projectRoot, sessionId)),
      displayState,
      replyTargets: [],
    };
  }

  /**
   * Attach the one reply-eligibility answer every surface reads. Execution summaries are read only for a cancelled
   * workflow session, which changes rarely while it is stopped, and never for a session the limit hides.
   */
  private withReplyTargets(snapshot: SessionSnapshot): SessionSnapshot {
    const dir = sessionDir(this.projectRoot, snapshot.sessionId);
    const executions = replyNeedsExecutions(snapshot) ? listExecutions(dir) : [];
    return { ...snapshot, replyTargets: replyTargets(snapshot, executions) };
  }
}
