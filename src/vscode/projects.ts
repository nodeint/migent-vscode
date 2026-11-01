import { statSync } from 'node:fs';

import * as vscode from 'vscode';

import { migentDir } from '../core/paths';
import { ProjectCatalog } from '../core/projectCatalog';
import { DEFAULT_SESSION_LIMIT, SessionStore } from '../core/store';
import { anchorWatch } from '../core/watchPlan';
import type { MigentChange, ProjectKey } from './changes';
import { type Releasable, vscodeWatchBackend,type WatchBackend } from './watchBackend';
import { ProjectWatcher } from './watcher';

export interface ProjectContext {
  key: ProjectKey;
  folder: vscode.WorkspaceFolder;
  /** `folder.uri.fsPath`: the `projectRoot` core events carry. */
  root: string;
  store: SessionStore;
  catalog: ProjectCatalog;
  watcher: ProjectWatcher;
}

interface ProjectEntry {
  context: ProjectContext;
  unsubscribe: (() => void)[];
}

interface Anchor {
  folder: vscode.WorkspaceFolder;
  handle: Releasable;
}

function hasMigentDir(root: string): boolean {
  try {
    return statSync(migentDir(root)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Discovers projects (workspace folders with a `.migent/` directory), owns one
 * `ProjectContext` per project and re-emits their changes as one stream. Every `file`
 * folder keeps an anchor watcher for `.migent`, so creating or deleting `.migent/`
 * promotes or demotes the folder without a reload.
 */
export class ProjectRegistry implements vscode.Disposable {
  readonly #emitter = new vscode.EventEmitter<MigentChange>();
  readonly #backend: WatchBackend;
  readonly #anchors = new Map<ProjectKey, Anchor>();
  readonly #projects = new Map<ProjectKey, ProjectEntry>();
  #folderSubscription: vscode.Disposable | null = null;
  #isLoaded = false;

  constructor(backend: WatchBackend = vscodeWatchBackend) {
    this.#backend = backend;
  }

  public get onDidChange(): vscode.Event<MigentChange> {
    return this.#emitter.event;
  }

  /** False until `start()` finished the first load of every project. */
  public get isLoaded(): boolean {
    return this.#isLoaded;
  }

  public projects(): ProjectContext[] {
    return [...this.#projects.values()].map((entry) => entry.context);
  }

  public project(key: ProjectKey): ProjectContext | undefined {
    return this.#projects.get(key)?.context;
  }

  /** Discover projects and load them. Called after `activate()` returned, so activation stays fast. */
  public start(): void {
    for (const folder of vscode.workspace.workspaceFolders ?? []) this.#addFolder(folder);
    this.#isLoaded = true;
    this.#emitter.fire({ type: 'projects' });
    this.#folderSubscription = vscode.workspace.onDidChangeWorkspaceFolders((event) => {
      for (const folder of event.removed) this.#removeFolder(folder);
      for (const folder of event.added) this.#addFolder(folder);
      this.#emitter.fire({ type: 'projects' });
    });
  }

  /**
   * Full Refresh: rescan every project, rebuild its watchers (recovery for dropped events),
   * then tell consumers to re-read what they display. Never runs automatically.
   */
  public refresh(): void {
    for (const key of [...this.#anchors.keys()]) this.#recreateAnchor(key);
    for (const { context } of this.#projects.values()) {
      context.store.load();
      context.catalog.load();
      context.watcher.sync({ shouldRebuild: true });
    }
    this.#emitter.fire({ type: 'refresh' });
  }

  public dispose(): void {
    this.#folderSubscription?.dispose();
    for (const key of [...this.#projects.keys()]) this.#removeProject(key);
    for (const { handle } of this.#anchors.values()) handle.dispose();
    this.#anchors.clear();
    this.#emitter.dispose();
  }

  #addFolder(folder: vscode.WorkspaceFolder): void {
    if (folder.uri.scheme !== 'file') return;
    const key = folder.uri.toString();
    if (this.#anchors.has(key)) return;
    this.#anchors.set(key, { folder, handle: this.#createAnchor(key, folder) });
    this.#reconcileFolder(key);
  }

  #removeFolder(folder: vscode.WorkspaceFolder): void {
    const key = folder.uri.toString();
    this.#anchors.get(key)?.handle.dispose();
    this.#anchors.delete(key);
    this.#removeProject(key);
  }

  #createAnchor(key: ProjectKey, folder: vscode.WorkspaceFolder): Releasable {
    return this.#backend.create(anchorWatch(folder.uri.fsPath), () => {
      if (this.#reconcileFolder(key)) this.#emitter.fire({ type: 'projects' });
    });
  }

  #recreateAnchor(key: ProjectKey): void {
    const anchor = this.#anchors.get(key);
    if (anchor === undefined) return;
    anchor.handle.dispose();
    anchor.handle = this.#createAnchor(key, anchor.folder);
    this.#reconcileFolder(key);
  }

  /** Make the project exist exactly when `.migent/` does. Returns whether a project was added or removed. */
  #reconcileFolder(key: ProjectKey): boolean {
    const anchor = this.#anchors.get(key);
    if (anchor === undefined) return false;
    const isPresent = hasMigentDir(anchor.folder.uri.fsPath);
    const isProject = this.#projects.has(key);
    if (isPresent && !isProject) {
      this.#addProject(key, anchor.folder);
      return true;
    }
    if (!isPresent && isProject) {
      this.#removeProject(key);
      return true;
    }
    return false;
  }

  #addProject(key: ProjectKey, folder: vscode.WorkspaceFolder): void {
    const root = folder.uri.fsPath;
    const limit = vscode.workspace
      .getConfiguration('migent', folder.uri)
      .get<number>('sessions.limit', DEFAULT_SESSION_LIMIT);
    const store = new SessionStore(root, { limit });
    const catalog = new ProjectCatalog(root);
    const watcher = new ProjectWatcher({
      root,
      store,
      catalog,
      backend: this.#backend,
      onFiles: (sessionId, targets) => {
        this.#emitter.fire({ type: 'files', project: key, sessionId, targets });
      },
    });
    // Load before subscribing: the first load is announced once, as `projects`.
    store.load();
    catalog.load();
    watcher.sync();
    watcher.start();
    const unsubscribe = [
      store.onDidChange((event) => {
        this.#emitter.fire({ type: 'session', project: key, sessionId: event.sessionId, kind: event.kind });
      }),
      store.onDidChangeProject((event) => {
        this.#emitter.fire({ type: 'project', project: key, kind: event.kind });
      }),
      catalog.onDidChange((event) => {
        this.#emitter.fire({ type: 'project', project: key, kind: event.kind });
      }),
    ];
    this.#projects.set(key, { context: { key, folder, root, store, catalog, watcher }, unsubscribe });
  }

  #removeProject(key: ProjectKey): void {
    const entry = this.#projects.get(key);
    if (entry === undefined) return;
    for (const unsubscribe of entry.unsubscribe) unsubscribe();
    entry.context.watcher.dispose();
    this.#projects.delete(key);
  }
}
