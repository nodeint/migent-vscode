import * as vscode from 'vscode';

import { metricsPath, sessionDir } from '../../core/paths';
import { parseSessionMetricsMessage, type SessionMetricsIntent } from '../../core/sessionMetricsIntent';
import {
  buildSessionMetricsModel,
  type SessionMetricsInput,
  type SessionMetricsModel,
  sessionMetricsPanelTitle,
} from '../../core/sessionMetricsModel';
import type { MigentChange, ProjectKey } from '../changes';
import { openFile } from '../openFile';
import type { ProjectRegistry } from '../projects';
import { SESSION_ACTION_COMMANDS } from '../results/panels';
import { type PageDescriptor, pageResourceRoots, renderPage } from '../webview/page';

export const SESSION_METRICS_VIEW_TYPE = 'migent.sessionMetrics';

const PAGE: PageDescriptor = {
  folder: 'sessionmetrics',
  styles: ['sessionmetrics.css'],
  scripts: ['sessionmetrics.js'],
  title: 'Metrics',
};

export interface Identity {
  project: ProjectKey;
  sessionId: string;
}

function keyOf(identity: Identity): string {
  return `${identity.project}#${identity.sessionId}`;
}

function isIdentity(value: unknown): value is Identity {
  if (typeof value !== 'object' || value === null) return false;
  const { project, sessionId } = value as Partial<Identity>;
  return typeof project === 'string' && typeof sessionId === 'string' && project !== '' && sessionId !== '';
}

/** One open panel and what was last posted to it. */
class Entry {
  public readonly project: ProjectKey;
  public readonly sessionId: string;
  public readonly panel: vscode.WebviewPanel;
  /** Posted messages so far; the page ignores a revision it has already shown. */
  public revision = 0;
  public lastModel: SessionMetricsModel | null = null;
  #lastJson: string | null = null;

  constructor(identity: Identity, panel: vscode.WebviewPanel) {
    this.project = identity.project;
    this.sessionId = identity.sessionId;
    this.panel = panel;
  }

  /** Post the model unless it equals the last one (and the post is not forced). */
  public publish(model: SessionMetricsModel, isForced: boolean): void {
    const json = JSON.stringify(model);
    if (!isForced && json === this.#lastJson) return;
    this.#lastJson = json;
    this.lastModel = model;
    this.revision += 1;
    this.panel.title = sessionMetricsPanelTitle(model);
    void this.panel.webview.postMessage({
      type: 'model',
      revision: this.revision,
      identity: { project: this.project, sessionId: this.sessionId },
      model,
    });
  }
}

/**
 * Read-only Session Metrics panels: one per `(project, session)`, reused on reopen and restored by a
 * serializer. Updates are posted with `postMessage`; only `open()` reveals a panel, and background
 * changes never focus, reveal or select anything. `metrics.json` is a session-level file, so no detail
 * folder is retained.
 */
export class SessionMetricsPanels implements vscode.Disposable {
  readonly #registry: ProjectRegistry;
  readonly #extensionUri: vscode.Uri;
  readonly #entries = new Map<string, Entry>();
  readonly #dirty = new Set<string>();
  readonly #subscriptions: vscode.Disposable[];
  #flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(registry: ProjectRegistry, extensionUri: vscode.Uri) {
    this.#registry = registry;
    this.#extensionUri = extensionUri;
    this.#subscriptions = [
      registry.onDidChange((change) => {
        this.#onChange(change);
      }),
      vscode.window.registerWebviewPanelSerializer(SESSION_METRICS_VIEW_TYPE, {
        deserializeWebviewPanel: (panel, state: unknown) => {
          this.restore(panel, state);
          return Promise.resolve();
        },
      }),
    ];
  }

  /** Number of open panels (for tests). */
  public get count(): number {
    return this.#entries.size;
  }

  /** Whether a panel for this session is open (for tests). */
  public has(identity: Identity): boolean {
    return this.#entries.has(keyOf(identity));
  }

  /** The model last posted to a panel (for tests). */
  public lastModel(identity: Identity): SessionMetricsModel | null {
    return this.#entries.get(keyOf(identity))?.lastModel ?? null;
  }

  /** The editor tab title of a panel (for tests). */
  public title(identity: Identity): string | null {
    return this.#entries.get(keyOf(identity))?.panel.title ?? null;
  }

  /** Messages posted to a panel so far (for tests). */
  public revision(identity: Identity): number {
    return this.#entries.get(keyOf(identity))?.revision ?? 0;
  }

  /** Open the panel for a session, or reveal the one that exists. The only place a panel is revealed. */
  public open(identity: Identity): void {
    const existing = this.#entries.get(keyOf(identity));
    if (existing !== undefined) {
      existing.panel.reveal(existing.panel.viewColumn ?? vscode.ViewColumn.Active);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      SESSION_METRICS_VIEW_TYPE,
      'Metrics',
      vscode.ViewColumn.Active,
      this.#webviewOptions(),
    );
    this.#adopt(panel, identity);
  }

  /** Handle a message from a page. Public so tests can drive the intent path without a webview. */
  public async handle(identity: Identity, raw: unknown): Promise<void> {
    const message = parseSessionMetricsMessage(raw);
    if (message === null) return;
    if (message.type === 'ready') {
      this.#send(identity, true);
      return;
    }
    await this.#run(identity, message.value);
  }

  public dispose(): void {
    if (this.#flushTimer !== null) clearTimeout(this.#flushTimer);
    for (const entry of [...this.#entries.values()]) entry.panel.dispose();
    this.#entries.clear();
    for (const subscription of this.#subscriptions.splice(0)) subscription.dispose();
  }

  #webviewOptions(): vscode.WebviewPanelOptions & vscode.WebviewOptions {
    return {
      enableScripts: true,
      localResourceRoots: pageResourceRoots(this.#extensionUri, PAGE),
    };
  }

  /** Adopt a panel VS Code deserialized after a reload. Public so tests can drive it without a reload. */
  public restore(panel: vscode.WebviewPanel, state: unknown): void {
    if (!isIdentity(state) || this.#entries.has(keyOf(state))) {
      panel.dispose();
      return;
    }
    const { webview } = panel;
    webview.options = this.#webviewOptions();
    this.#adopt(panel, { project: state.project, sessionId: state.sessionId });
  }

  #adopt(panel: vscode.WebviewPanel, identity: Identity): void {
    const entry = new Entry(identity, panel);
    const key = keyOf(identity);
    this.#entries.set(key, entry);
    const { webview } = panel;
    webview.html = renderPage(webview, this.#extensionUri, PAGE);
    webview.onDidReceiveMessage((raw: unknown) => {
      void this.handle(identity, raw);
    });
    panel.onDidDispose(() => {
      this.#entries.delete(key);
      this.#dirty.delete(key);
    });
    this.#send(identity, true);
  }

  #input(identity: Identity): { root: string; input: SessionMetricsInput } | undefined {
    const context = this.#registry.project(identity.project);
    if (context === undefined) return undefined;
    return {
      root: context.root,
      input: {
        sessionId: identity.sessionId,
        sessionDirPath: sessionDir(context.root, identity.sessionId),
        snapshots: context.store.all(),
      },
    };
  }

  #send(identity: Identity, isForced: boolean): void {
    const entry = this.#entries.get(keyOf(identity));
    if (entry === undefined) return;
    // Without its project the page shows the unavailable state until the project (re)appears.
    const model = buildSessionMetricsModel(
      this.#input(identity)?.input ?? { sessionId: identity.sessionId, sessionDirPath: '', snapshots: [] },
    );
    entry.publish(model, isForced);
  }

  #onChange(change: MigentChange): void {
    switch (change.type) {
      case 'session':
        this.#mark((entry) => entry.project === change.project);
        return;
      case 'files':
        if (change.targets.some((target) => target.kind === 'metrics')) {
          this.#mark((entry) => entry.project === change.project && entry.sessionId === change.sessionId);
        }
        return;
      case 'projects':
      case 'refresh':
        this.#mark(() => true);
        return;
      case 'project':
      case 'capability':
        return;
    }
  }

  #mark(isMatch: (entry: Entry) => boolean): void {
    for (const [key, entry] of this.#entries) {
      if (isMatch(entry)) this.#dirty.add(key);
    }
    if (this.#dirty.size === 0) return;
    this.#flushTimer ??= setTimeout(() => {
      this.#flushTimer = null;
      const keys = [...this.#dirty];
      this.#dirty.clear();
      for (const key of keys) {
        const entry = this.#entries.get(key);
        if (entry !== undefined) this.#send(entry, false);
      }
    }, 0);
  }

  async #run(identity: Identity, intent: SessionMetricsIntent): Promise<void> {
    const resolved = this.#input(identity);
    if (resolved === undefined) return;
    const target = { project: identity.project, sessionId: identity.sessionId };
    switch (intent.intent) {
      case 'sessionAction':
        await vscode.commands.executeCommand(SESSION_ACTION_COMMANDS[intent.action], target);
        return;
      case 'openResults':
        await vscode.commands.executeCommand('migent.session.openResult', target);
        return;
      case 'openMetricsFile':
        await openFile(metricsPath(resolved.root, identity.sessionId), 'metrics.json');
        return;
    }
  }
}
