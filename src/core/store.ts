import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { deriveDisplayState } from "./displayState";
import { listExecutions } from "./executions";
import { tailEvents, type TailEvent } from "./eventTail";
import { readManifest } from "./manifest";
import type {
  ExecutionSnapshot,
  SessionChangeEvent,
  SessionChangeKind,
  SessionSnapshot,
} from "./model";
import { probeLock } from "./lockProbe";
import {
  MANIFEST_FILENAME,
  STATUS_FILENAME,
  eventsPath,
  lockPath,
  manifestPath,
  sessionDir,
  sessionsDir,
  statusPath,
} from "./paths";
import { readStatus } from "./statusReader";

export const DEFAULT_SESSION_LIMIT = 50;

/** Minimal local emitter: the store must not import `vscode`. */
export class Emitter<T> {
  #listeners = new Set<(event: T) => void>();

  subscribe(listener: (event: T) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  emit(event: T): void {
    for (const listener of this.#listeners) listener(event);
  }
}

export interface SessionStoreOptions {
  /** Show the N most recent sessions. The directory can reach hundreds of entries. */
  limit?: number;
}

interface SnapshotBody {
  manifest: SessionSnapshot["manifest"];
  status: SessionSnapshot["status"];
  statusError: boolean;
  lock: SessionSnapshot["lock"];
  displayState: SessionSnapshot["displayState"];
}

function sameBody(a: SnapshotBody, b: SnapshotBody): boolean {
  return (
    JSON.stringify(a.manifest?.raw ?? null) === JSON.stringify(b.manifest?.raw ?? null) &&
    JSON.stringify(a.status?.raw ?? null) === JSON.stringify(b.status?.raw ?? null) &&
    a.statusError === b.statusError &&
    JSON.stringify(a.lock) === JSON.stringify(b.lock) &&
    a.displayState.state === b.displayState.state &&
    a.displayState.writable === b.displayState.writable
  );
}

function createdAtOf(snapshot: SessionSnapshot): string | null {
  return snapshot.manifest?.createdAt ?? snapshot.status?.createdAt ?? null;
}

function isNewer(a: SessionSnapshot, b: SessionSnapshot): boolean {
  const left = createdAtOf(a) ?? "";
  const right = createdAtOf(b) ?? "";
  if (left !== right) return left > right;
  return a.sessionId > b.sessionId;
}

/**
 * Holds one SessionSnapshot per session of one project, and emits change events so
 * views refresh only what changed. Initial load scans the sessions directory with
 * direct reads, faster than spawning the CLI. The execution list is read lazily;
 */
export class SessionStore {
  readonly projectRoot: string;
  readonly limit: number;

  readonly #sessions = new Map<string, SessionSnapshot>();
  readonly #offsets = new Map<string, number>();
  readonly #changes = new Emitter<SessionChangeEvent>();

  constructor(projectRoot: string, options: SessionStoreOptions = {}) {
    this.projectRoot = projectRoot;
    this.limit = options.limit ?? DEFAULT_SESSION_LIMIT;
  }

  /** Subscribe to changes. Returns an unsubscribe function. */
  get onDidChange(): (listener: (event: SessionChangeEvent) => void) => () => void {
    return (listener) => this.#changes.subscribe(listener);
  }

  /** All snapshots, newest first. */
  all(): SessionSnapshot[] {
    return [...this.#sessions.values()].sort((a, b) => (isNewer(b, a) ? 1 : -1));
  }

  snapshot(sessionId: string): SessionSnapshot | undefined {
    return this.#sessions.get(sessionId);
  }

  /** Full scan of the sessions directory: direct reads, faster than spawning the CLI. */
  load(): void {
    const seen = new Set<string>();
    for (const sessionId of this.listSessionIds()) {
      seen.add(sessionId);
      if (this.#sessions.has(sessionId)) {
        this.refreshSession(sessionId);
      } else {
        this.#setSession(sessionId, this.buildSnapshot(sessionId), "added");
      }
    }
    for (const sessionId of [...this.#sessions.keys()]) {
      if (!seen.has(sessionId)) this.removeSession(sessionId);
    }
    this.applyLimit();
  }

  refreshSession(sessionId: string): void {
    const current = this.#sessions.get(sessionId);
    if (current === undefined) {
      this.#setSession(sessionId, this.buildSnapshot(sessionId), "added");
      this.applyLimit();
      return;
    }
    const next = this.buildSnapshot(sessionId);
    if (!sameBody(next, current)) {
      this.#setSession(sessionId, next, "updated");
    }
  }

  removeSession(sessionId: string): void {
    if (!this.#sessions.has(sessionId)) return;
    this.#sessions.delete(sessionId);
    this.#offsets.delete(sessionId);
    this.#emit(sessionId, "removed");
  }

  /** Read the execution list. Only when a node is expanded or the session is running. */
  loadExecutions(sessionId: string): ExecutionSnapshot[] {
    const snapshot = this.#sessions.get(sessionId);
    if (snapshot === undefined) return [];
    const executions = listExecutions(sessionDir(this.projectRoot, sessionId));
    const changed = JSON.stringify(snapshot.executions) !== JSON.stringify(executions);
    snapshot.executions = executions;
    if (changed) this.#emit(sessionId, "executions");
    return executions;
  }

  /**
   * Tail events.jsonl from the stored byte offset. Only complete lines are
   * consumed; `seq` de-duplicates against the snapshot's `lastEventSeq`.
   */
  readNewEvents(sessionId: string): TailEvent[] {
    const snapshot = this.#sessions.get(sessionId);
    if (snapshot === undefined) return [];
    const offset = this.#offsets.get(sessionId) ?? 0;
    const read = tailEvents(eventsPath(this.projectRoot, sessionId), offset);
    this.#offsets.set(sessionId, read.offset);
    const fresh = read.events.filter(
      (event) => event.seq === null || snapshot.lastEventSeq === 0 || event.seq > snapshot.lastEventSeq,
    );
    for (const event of fresh) {
      if (event.seq !== null && event.seq > snapshot.lastEventSeq) snapshot.lastEventSeq = event.seq;
    }
    if (fresh.length > 0) this.#emit(sessionId, "events");
    return fresh;
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

  private listSessionIds(): string[] {
    let entries;
    try {
      entries = readdirSync(sessionsDir(this.projectRoot), { withFileTypes: true });
    } catch {
      return [];
    }
    const ids: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = sessionDir(this.projectRoot, entry.name);
      const hasMarker = (() => {
        try {
          statSync(path.join(dir, MANIFEST_FILENAME));
          return true;
        } catch {
          try {
            statSync(path.join(dir, STATUS_FILENAME));
            return true;
          } catch {
            return false;
          }
        }
      })();
      if (hasMarker) ids.push(entry.name);
    }
    return ids;
  }

  private buildSnapshot(sessionId: string): SessionSnapshot {
    const manifest = readManifest(manifestPath(this.projectRoot, sessionId));
    const statusRead = readStatus(statusPath(this.projectRoot, sessionId));
    const lock = probeLock(lockPath(this.projectRoot, sessionId));
    const displayState = deriveDisplayState(
      {
        status: statusRead.kind === "ok" ? statusRead.status : null,
        statusError: statusRead.kind === "error",
        schemaSupported: manifest?.schemaSupported ?? false,
      },
      lock,
    );
    return {
      sessionId,
      manifest,
      status: statusRead.kind === "ok" ? statusRead.status : null,
      statusError: statusRead.kind === "error",
      lock,
      displayState,
      executions: [],
      lastEventSeq: 0,
    };
  }
}
