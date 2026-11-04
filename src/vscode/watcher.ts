import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { Coalescer } from '../core/coalescer';
import { EXECUTIONS_DIRNAME, migentDir, sessionDir } from '../core/paths';
import type { ProjectCatalog } from '../core/projectCatalog';
import type { SessionStore } from '../core/store';
import {
  type ClassifiedPath,
  classifyPath,
  desiredWatches,
  diffWatches,
  type FileTarget,
  routeSessionChanges,
  type WatchPlanInput,
  type WatchSpec,
  type WatchTarget,
  watchTargetKey,
} from '../core/watchPlan';
import type { Releasable, WatchBackend, WatchEventKind } from './watchBackend';

const DEBOUNCE_MS = 150;
const MAX_WAIT_MS = 1000;
const PROJECT_KEY = 'project';
const SESSION_KEY_PREFIX = 'session:';

interface Pending {
  change: ClassifiedPath;
  kind: WatchEventKind;
}

export interface SyncOptions {
  /** Refresh the level of each newly created watcher: files written before it existed produced no event. */
  shouldReconcile?: boolean;
  /** Dispose every live watcher and create them again (the recovery path of a full Refresh). */
  shouldRebuild?: boolean;
}

export interface ProjectWatcherOptions {
  root: string;
  store: SessionStore;
  catalog: ProjectCatalog;
  backend: WatchBackend;
  onFiles: (sessionId: string, targets: FileTarget[]) => void;
}

function isDirectory(absolute: string): boolean {
  try {
    return statSync(absolute).isDirectory();
  } catch {
    return false;
  }
}

function listDirectories(absolute: string): string[] {
  try {
    return readdirSync(absolute, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * Owns every `FileSystemWatcher` of one project: the set mirrors `desiredWatches` and is
 * diffed after each store or catalog scan change and each retain or release. Events are
 * classified, coalesced per session (or per project) and routed to the store, the catalog
 * or the `onFiles` callback. This class reads no detail data.
 */
export class ProjectWatcher {
  readonly #options: ProjectWatcherOptions;
  readonly #live = new Map<string, { pattern: string; handle: Releasable }>();
  readonly #directoryWatches = new Set<Releasable>();
  readonly #retained = new Map<string, { target: WatchTarget; count: number }>();
  readonly #unsubscribe: (() => void)[] = [];
  readonly #coalescer: Coalescer<Pending>;
  #isSyncing = false;
  #pending: SyncOptions | null = null;
  #releaseTimer: ReturnType<typeof setTimeout> | null = null;
  #isDisposed = false;

  constructor(options: ProjectWatcherOptions) {
    this.#options = options;
    this.#coalescer = new Coalescer<Pending>({
      delayMs: DEBOUNCE_MS,
      maxWaitMs: MAX_WAIT_MS,
      flush: (key, items) => {
        this.#flush(key, items);
      },
    });
  }

  /** Number of live watchers (for tests and diagnostics). */
  public get watchCount(): number {
    return this.#live.size + this.#directoryWatches.size;
  }

  /** Watch one expanded directory in the session Files tree. */
  public watchDirectory(folder: string, onChange: () => void): Releasable {
    const watch = this.#options.backend.create({ id: folder, folder, pattern: '*' }, onChange);
    const handle: Releasable = { dispose: () => {
      if (!this.#directoryWatches.delete(handle)) return;
      watch.dispose();
    } };
    this.#directoryWatches.add(handle);
    return handle;
  }

  /** Subscribe to the store and catalog so scan changes keep the watcher set current. Call after the first `sync()`. */
  public start(): void {
    const { store, catalog } = this.#options;
    this.#unsubscribe.push(
      store.onDidChangeProject(() => {
        this.sync({ shouldReconcile: true });
      }),
      catalog.onDidChange((event) => {
        if (event.kind === 'workflows') this.sync({ shouldReconcile: true });
      }),
    );
  }

  /**
   * Keep a detail target watched until the returned handle is disposed. Retain before
   * reading the data, so a write between the read and the watcher cannot be missed.
   * Release takes effect at the end of the event-loop turn, so collapse-then-expand
   * does not recreate watchers.
   */
  public retain(target: WatchTarget): Releasable {
    const key = watchTargetKey(target);
    const entry = this.#retained.get(key) ?? { target, count: 0 };
    entry.count += 1;
    this.#retained.set(key, entry);
    if (entry.count === 1) this.sync();
    let isReleased = false;
    return {
      dispose: () => {
        if (isReleased) return;
        isReleased = true;
        entry.count -= 1;
        this.#scheduleRelease();
      },
    };
  }

  /** Bring the live watchers in line with the desired set. Re-entrant calls are merged. */
  public sync(options: SyncOptions = {}): void {
    if (this.#isDisposed) return;
    if (this.#isSyncing) {
      this.#pending = {
        shouldReconcile: options.shouldReconcile === true || this.#pending?.shouldReconcile === true,
        shouldRebuild: options.shouldRebuild === true || this.#pending?.shouldRebuild === true,
      };
      return;
    }
    this.#isSyncing = true;
    try {
      let next: SyncOptions | null = options;
      while (next !== null) {
        this.#pending = null;
        this.#syncOnce(next);
        next = this.#pending;
      }
    } finally {
      this.#isSyncing = false;
    }
  }

  public dispose(): void {
    this.#isDisposed = true;
    if (this.#releaseTimer !== null) clearTimeout(this.#releaseTimer);
    this.#coalescer.dispose();
    for (const handle of this.#directoryWatches) handle.dispose();
    for (const unsubscribe of this.#unsubscribe.splice(0)) unsubscribe();
    for (const { handle } of this.#live.values()) handle.dispose();
    this.#live.clear();
  }

  #scheduleRelease(): void {
    if (this.#releaseTimer !== null || this.#isDisposed) return;
    this.#releaseTimer = setTimeout(() => {
      this.#releaseTimer = null;
      for (const [key, entry] of this.#retained) {
        if (entry.count <= 0) this.#retained.delete(key);
      }
      this.sync();
    }, 0);
  }

  #planInput(): WatchPlanInput {
    const { root, store, catalog } = this.#options;
    const retained = [...this.#retained.values()].filter((entry) => entry.count > 0).map((entry) => entry.target);
    const turns: Record<string, string[]> = {};
    for (const target of retained) {
      if (target.kind !== 'execution') continue;
      const turnsDir = path.join(sessionDir(root, target.sessionId), EXECUTIONS_DIRNAME, target.executionId, 'turns');
      turns[`${target.sessionId}/${target.executionId}`] = listDirectories(turnsDir);
    }
    return {
      projectRoot: root,
      migentExists: isDirectory(migentDir(root)),
      sessionsState: store.scanOutcome.state,
      workflowsState: catalog.workflows().state,
      discoveredSessions: store.scanOutcome.discovered,
      retained,
      turns,
      dirExists: isDirectory,
    };
  }

  #syncOnce(options: SyncOptions): void {
    if (options.shouldRebuild === true) this.#disposeAll();
    const desired = desiredWatches(this.#planInput());
    const live = new Map([...this.#live].map(([id, entry]) => [id, entry.pattern]));
    const diff = diffWatches(desired, live);
    for (const id of diff.remove) {
      this.#live.get(id)?.handle.dispose();
      this.#live.delete(id);
    }
    for (const spec of diff.add) {
      const handle = this.#options.backend.create(spec, (kind, fsPath) => {
        this.#onEvent(kind, fsPath);
      });
      this.#live.set(spec.id, { pattern: spec.pattern, handle });
    }
    if (options.shouldReconcile === true) {
      for (const spec of diff.add) this.#reconcile(spec);
    }
  }

  #disposeAll(): void {
    for (const { handle } of this.#live.values()) handle.dispose();
    this.#live.clear();
  }

  /** A watcher on a folder that just appeared saw nothing written before it existed: refresh that level once. */
  #reconcile(spec: WatchSpec): void {
    const { root, store, catalog } = this.#options;
    const change = classifyPath(root, spec.folder);
    if (change === null) return;
    switch (change.kind) {
      case 'migent-dir':
        catalog.reloadConfig();
        return;
      case 'sessions-dir':
        store.load();
        return;
      case 'workflows-dir':
        catalog.load();
        return;
      case 'session-dir':
        store.refreshSession(change.sessionId);
        return;
      case 'session-files':
        this.#emitFiles(change.sessionId, [this.#detailTarget(change.target, spec.folder)]);
        return;
      default:
    }
  }

  /** The `executions` target of an execution directory itself means that execution's contents here. */
  #detailTarget(target: FileTarget, folder: string): FileTarget {
    if (target.kind === 'executions' && path.basename(folder) !== EXECUTIONS_DIRNAME) {
      return { kind: 'execution', executionId: path.basename(folder) };
    }
    return target;
  }

  #onEvent(kind: WatchEventKind, fsPath: string): void {
    const change = classifyPath(this.#options.root, fsPath);
    if (change === null || change.kind === 'migent-dir') return;
    const isFolder = change.kind === 'workflows-dir' || change.kind === 'sessions-dir' || change.kind === 'session-dir';
    // A folder's own `change` event (its mtime) says nothing about its existence.
    if (isFolder && kind === 'change') return;
    const key =
      'sessionId' in change ? `${SESSION_KEY_PREFIX}${change.sessionId}` : PROJECT_KEY;
    this.#coalescer.add(key, { change, kind });
  }

  #flush(key: string, items: readonly Pending[]): void {
    if (this.#isDisposed) return;
    if (key === PROJECT_KEY) {
      this.#flushProject(items);
      return;
    }
    this.#flushSession(key.slice(SESSION_KEY_PREFIX.length), items);
  }

  #flushProject(items: readonly Pending[]): void {
    const { store, catalog } = this.#options;
    const kinds = new Set(items.map((item) => item.change.kind));
    if (kinds.has('sessions-dir')) store.load();
    if (kinds.has('workflows-dir')) {
      catalog.load();
      return;
    }
    const files = new Set<string>();
    for (const { change } of items) {
      if (change.kind === 'workflow') files.add(change.file);
    }
    for (const file of files) catalog.reloadWorkflow(file);
    if (kinds.has('config')) catalog.reloadConfig();
  }

  #flushSession(sessionId: string, items: readonly Pending[]): void {
    const { root, store } = this.#options;
    if (items.some((item) => item.change.kind === 'session-dir')) {
      // Decide by existence now, not by event order: create and delete can share one window.
      store.rescanDirectories();
      if (isDirectory(sessionDir(root, sessionId))) store.refreshSession(sessionId);
      else store.removeSession(sessionId);
    } else if (items.some((item) => item.change.kind === 'session-snapshot')) {
      store.refreshSession(sessionId);
    }
    const { targets } = routeSessionChanges(items.map((item) => item.change));
    // Hidden, pending and removed sessions report nothing beyond their snapshot.
    if (targets.length === 0 || store.snapshot(sessionId) === undefined) return;
    if (this.#hasRetained(sessionId)) this.sync({ shouldReconcile: true });
    this.#emitFiles(sessionId, targets);
  }

  #hasRetained(sessionId: string): boolean {
    return [...this.#retained.values()].some((entry) => entry.count > 0 && entry.target.sessionId === sessionId);
  }

  #emitFiles(sessionId: string, targets: FileTarget[]): void {
    if (!this.#isDisposed) this.#options.onFiles(sessionId, targets);
  }
}
