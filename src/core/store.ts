import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { deriveDisplayState } from './displayState';
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
} from './paths';
import { isRecord } from './record';
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
  displayState: SessionSnapshot['displayState'];
}

function sameBody(a: SnapshotBody, b: SnapshotBody): boolean {
  return (
    JSON.stringify(a.manifest?.raw ?? null) === JSON.stringify(b.manifest?.raw ?? null) &&
    JSON.stringify(a.status?.raw ?? null) === JSON.stringify(b.status?.raw ?? null) &&
    a.statusError === b.statusError &&
    JSON.stringify(a.lock) === JSON.stringify(b.lock) &&
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
  return a.sessionId > b.sessionId;
}

/**
 * Holds one SessionSnapshot per session of one project, and emits change events so
 * views refresh only what changed. Initial load scans the sessions directory with
 * direct reads, faster than spawning the CLI. It holds snapshots only: executions,
 * events and other per-session files are read by their own readers on demand.
 */
export class SessionStore {
  public readonly projectRoot: string;
  public readonly limit: number;

  readonly #sessions = new Map<string, SessionSnapshot>();
  readonly #changes = new Emitter<SessionChangeEvent>();
  readonly #projectChanges = new Emitter<ProjectChangeEvent>();
  #scan: ScanOutcome = { state: 'missing', error: null, discovered: [], eligible: [], pending: [] };

  constructor(projectRoot: string, options: SessionStoreOptions = {}) {
    this.projectRoot = projectRoot;
    this.limit = options.limit ?? DEFAULT_SESSION_LIMIT;
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

  /** Full scan of the sessions directory: direct reads, faster than spawning the CLI. */
  public load(): void {
    const scan = this.scanSessions();
    this.#setScan(scan);
    const seen = new Set<string>();
    for (const sessionId of scan.eligible) {
      seen.add(sessionId);
      if (this.#sessions.has(sessionId)) {
        this.refreshSession(sessionId);
      } else {
        this.#setSession(sessionId, this.buildSnapshot(sessionId), 'added');
      }
    }
    for (const sessionId of [...this.#sessions.keys()]) {
      if (!seen.has(sessionId)) this.removeSession(sessionId);
    }
    this.applyLimit();
  }

  public refreshSession(sessionId: string): void {
    const current = this.#sessions.get(sessionId);
    if (current === undefined) {
      this.#setSession(sessionId, this.buildSnapshot(sessionId), 'added');
      this.applyLimit();
      return;
    }
    const next = this.buildSnapshot(sessionId);
    if (!sameBody(next, current)) {
      this.#setSession(sessionId, next, 'updated');
    }
  }

  public removeSession(sessionId: string): void {
    if (!this.#sessions.has(sessionId)) return;
    this.#sessions.delete(sessionId);
    this.#emit(sessionId, 'removed');
  }

  #setScan(scan: ScanOutcome): void {
    const isChanged = JSON.stringify(scan) !== JSON.stringify(this.#scan);
    this.#scan = scan;
    if (isChanged) this.#projectChanges.emit({ project: this.projectRoot, kind: 'scan' });
  }

  #setSession(sessionId: string, snapshot: SessionSnapshot, kind: SessionChangeKind): void {
    this.#sessions.set(sessionId, snapshot);
    this.#emit(sessionId, kind);
  }

  #emit(sessionId: string, kind: SessionChangeKind): void {
    this.#changes.emit({ project: this.projectRoot, sessionId, kind });
  }

  private applyLimit(): void {
    if (this.#sessions.size <= this.limit) return;
    const ordered = this.all();
    for (const snapshot of ordered.slice(this.limit)) {
      this.removeSession(snapshot.sessionId);
    }
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
      const dir = sessionDir(this.projectRoot, entry.name);
      const hasMarker = [MANIFEST_FILENAME, STATUS_FILENAME].some((marker) => {
        try {
          statSync(path.join(dir, marker));
          return true;
        } catch {
          return false;
        }
      });
      (hasMarker ? eligible : pending).push(entry.name);
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
      displayState,
    };
  }
}
