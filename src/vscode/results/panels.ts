import { randomBytes } from 'node:crypto';
import path from 'node:path';

import * as vscode from 'vscode';

import type { SessionSnapshot } from '../../core/model';
import { manifestPath, nextPath, sessionDir, workflowsDir } from '../../core/paths';
import { parseResultsMessage, type ResultsIntent } from '../../core/resultsIntent';
import {
  buildResultsModel,
  resolveHandoffPath,
  resolveOutputPath,
  type ResultsInput,
  type ResultsModel,
} from '../../core/resultsModel';
import { truncate } from '../../core/sessionPresentation';
import type { WorkflowEntry } from '../../core/workflows';
import type { MigentChange, ProjectKey } from '../changes';
import { openFile } from '../openFile';
import type { ProjectContext, ProjectRegistry } from '../projects';
import type { Releasable } from '../watchBackend';

const INFO_MESSAGE_MS = 5000;

export const RESULTS_VIEW_TYPE = 'migent.results';

const TITLE_MAX = 40;
const NONCE_BYTES = 16;

export interface Identity {
  project: ProjectKey;
  sessionId: string;
}

/** The session a command should act on when it is invoked from a Results panel. */
export interface ActiveTarget {
  activeTarget: () => Identity | undefined;
}

function keyOf(identity: Identity): string {
  return `${identity.project}#${identity.sessionId}`;
}

function isIdentity(value: unknown): value is Identity {
  if (typeof value !== 'object' || value === null) return false;
  const { project, sessionId } = value as Partial<Identity>;
  return typeof project === 'string' && typeof sessionId === 'string' && project !== '' && sessionId !== '';
}

function html(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = randomBytes(NONCE_BYTES).toString('base64');
  const asset = (name: string): string =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'results', name)).toString();
  const csp = `default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${asset('results.css')}">
<title>Result</title>
</head>
<body>
<main id="root"></main>
<script nonce="${nonce}" src="${asset('results.js')}"></script>
</body>
</html>`;
}

/** Actions the overview delegates to the Next step feature; set once by the extension. */
export interface ResultsActions {
  openNextStep: (identity: Identity, workflow: string) => void;
  reloadSuggestions: (context: ProjectContext, snapshot: SessionSnapshot) => Promise<void>;
}

/** One open panel and what was last posted to it. */
class Entry {
  public readonly project: ProjectKey;
  public readonly sessionId: string;
  public readonly panel: vscode.WebviewPanel;
  /** Posted messages so far; the page ignores a revision it has already shown. */
  public revision = 0;
  public lastModel: ResultsModel | null = null;
  #lastJson: string | null = null;
  /** Keeps `outputs/` watched while the panel is open, held against the watcher it was taken from. */
  #retained: { watcher: ProjectContext['watcher']; handle: Releasable } | null = null;

  constructor(identity: Identity, panel: vscode.WebviewPanel) {
    this.project = identity.project;
    this.sessionId = identity.sessionId;
    this.panel = panel;
  }

  /** Re-taken when the project's watcher was replaced; released when the project is gone. */
  public retain(context: ProjectContext | undefined): void {
    if (this.#retained !== null && this.#retained.watcher !== context?.watcher) this.release();
    if (context === undefined || this.#retained !== null) return;
    this.#retained = {
      watcher: context.watcher,
      handle: context.watcher.retain({ kind: 'outputs', sessionId: this.sessionId }),
    };
  }

  public release(): void {
    this.#retained?.handle.dispose();
    this.#retained = null;
  }

  /** Post the model unless it equals the last one (and the post is not forced). */
  public publish(model: ResultsModel, isForced: boolean): void {
    const json = JSON.stringify(model);
    if (!isForced && json === this.#lastJson) return;
    this.#lastJson = json;
    this.lastModel = model;
    this.revision += 1;
    this.panel.title = `Result: ${truncate(model.title, TITLE_MAX)}`;
    void this.panel.webview.postMessage({
      type: 'model',
      revision: this.revision,
      identity: { project: this.project, sessionId: this.sessionId },
      model,
    });
  }
}

/**
 * Read-only Results overview panels: one per `(project, session)`, reused on reopen and restored by a
 * serializer. Updates are posted with `postMessage`; only `open()` reveals a panel, and background
 * changes never focus, reveal or select anything.
 */
export class ResultsPanels implements vscode.Disposable, ActiveTarget {
  readonly #registry: ProjectRegistry;
  readonly #extensionUri: vscode.Uri;
  readonly #entries = new Map<string, Entry>();
  readonly #dirty = new Set<string>();
  readonly #subscriptions: vscode.Disposable[];
  #flushTimer: ReturnType<typeof setTimeout> | null = null;
  #actions: ResultsActions | null = null;

  constructor(registry: ProjectRegistry, extensionUri: vscode.Uri) {
    this.#registry = registry;
    this.#extensionUri = extensionUri;
    this.#subscriptions = [
      registry.onDidChange((change) => {
        this.#onChange(change);
      }),
      vscode.window.registerWebviewPanelSerializer(RESULTS_VIEW_TYPE, {
        deserializeWebviewPanel: (panel, state: unknown) => {
          this.#restore(panel, state);
          return Promise.resolve();
        },
      }),
    ];
  }

  public setActions(actions: ResultsActions): void {
    this.#actions = actions;
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
  public lastModel(identity: Identity): ResultsModel | null {
    return this.#entries.get(keyOf(identity))?.lastModel ?? null;
  }

  /** Messages posted to a panel so far (for tests). */
  public revision(identity: Identity): number {
    return this.#entries.get(keyOf(identity))?.revision ?? 0;
  }

  public activeTarget(): Identity | undefined {
    for (const entry of this.#entries.values()) {
      if (entry.panel.active) return { project: entry.project, sessionId: entry.sessionId };
    }
    return undefined;
  }

  /** Open the panel for a session, or reveal the one that exists. The only place a panel is revealed. */
  public open(identity: Identity): void {
    const existing = this.#entries.get(keyOf(identity));
    if (existing !== undefined) {
      existing.panel.reveal(existing.panel.viewColumn ?? vscode.ViewColumn.Active);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      RESULTS_VIEW_TYPE,
      'Result',
      vscode.ViewColumn.Active,
      this.#webviewOptions(),
    );
    this.#adopt(panel, identity);
  }

  /** Handle a message from a page. Public so tests can drive the intent path without a webview. */
  public async handle(identity: Identity, raw: unknown): Promise<void> {
    const message = parseResultsMessage(raw);
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
      localResourceRoots: [vscode.Uri.joinPath(this.#extensionUri, 'media', 'results')],
    };
  }

  #restore(panel: vscode.WebviewPanel, state: unknown): void {
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
    webview.html = html(webview, this.#extensionUri);
    webview.onDidReceiveMessage((raw: unknown) => {
      void this.handle(identity, raw);
    });
    panel.onDidDispose(() => {
      entry.release();
      this.#entries.delete(key);
      this.#dirty.delete(key);
    });
    this.#send(identity, true);
  }

  #input(identity: Identity): { context: ProjectContext; input: ResultsInput } | undefined {
    const context = this.#registry.project(identity.project);
    if (context === undefined) return undefined;
    return {
      context,
      input: {
        sessionId: identity.sessionId,
        sessionDirPath: sessionDir(context.root, identity.sessionId),
        snapshots: context.store.all(),
        eligibleIds: context.store.scanOutcome.eligible,
        workflows: context.catalog.workflows().entries,
      },
    };
  }

  #send(identity: Identity, isForced: boolean): void {
    const entry = this.#entries.get(keyOf(identity));
    if (entry === undefined) return;
    const resolved = this.#input(identity);
    entry.retain(resolved?.context);
    // Without its project the page shows the unavailable state until the project (re)appears.
    const model = buildResultsModel(
      resolved?.input ?? {
        sessionId: identity.sessionId,
        sessionDirPath: '',
        snapshots: [],
        eligibleIds: [],
        workflows: [],
      },
    );
    entry.publish(model, isForced);
  }

  #onChange(change: MigentChange): void {
    switch (change.type) {
      case 'session':
        this.#mark((entry) => entry.project === change.project);
        return;
      case 'files':
        if (change.targets.some((target) => target.kind === 'next' || target.kind === 'outputs')) {
          this.#mark((entry) => entry.project === change.project && entry.sessionId === change.sessionId);
        }
        return;
      case 'project':
        if (change.kind !== 'config') this.#mark((entry) => entry.project === change.project);
        return;
      case 'projects':
      case 'refresh':
        this.#mark(() => true);
        return;
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

  async #run(identity: Identity, intent: ResultsIntent): Promise<void> {
    const resolved = this.#input(identity);
    if (resolved === undefined) return;
    const { context, input } = resolved;
    switch (intent.intent) {
      case 'openOutput': {
        const file = resolveOutputPath(input, intent.name);
        if (file === null) void vscode.window.showWarningMessage(`Output not found: ${intent.name}`);
        else await openFile(file, 'Output');
        return;
      }
      case 'openHandoffFile': {
        const file = resolveHandoffPath(input, intent.name);
        if (file === null) void vscode.window.showWarningMessage(`Handoff file not found: ${intent.name}`);
        else await openFile(file, 'Handoff file');
        return;
      }
      case 'openNextStep':
      case 'reloadSuggestions':
        await this.#delegate(context, identity, intent);
        return;
      case 'openNextFile':
        await openFile(nextPath(context.root, identity.sessionId), 'next.json');
        return;
      case 'openManifest':
        await openFile(manifestPath(context.root, identity.sessionId), 'manifest.yaml');
        return;
      case 'openTargetWorkflow':
        await this.#openWorkflow(context, intent.workflow);
        return;
      case 'openSession':
        if (context.store.snapshot(intent.sessionId) === undefined) {
          vscode.window.setStatusBarMessage(
            `Session ${intent.sessionId} is not shown. Use Show more in the Sessions view.`,
            INFO_MESSAGE_MS,
          );
          return;
        }
        this.open({ project: identity.project, sessionId: intent.sessionId });
        return;
    }
  }

  /** Next-step actions belong to the Next step feature; the overview only forwards them. */
  async #delegate(
    context: ProjectContext,
    identity: Identity,
    intent: Extract<ResultsIntent, { intent: 'openNextStep' | 'reloadSuggestions' }>,
  ): Promise<void> {
    if (intent.intent === 'openNextStep') {
      this.#actions?.openNextStep(identity, intent.workflow);
      return;
    }
    const snapshot = context.store.snapshot(identity.sessionId);
    if (snapshot !== undefined) await this.#actions?.reloadSuggestions(context, snapshot);
  }

  async #openWorkflow(context: ProjectContext, workflow: string): Promise<void> {
    const matches = context.catalog.workflows().entries.filter((entry) => entry.id === workflow);
    if (matches.length === 0) {
      void vscode.window.showWarningMessage(`No workflow with id ${workflow} in this project.`);
      return;
    }
    let [target]: (WorkflowEntry | undefined)[] = matches;
    if (matches.length > 1) {
      const picked = await vscode.window.showQuickPick(
        matches.map((entry) => ({ label: entry.file, entry })),
        { title: `Workflow ${workflow} is defined more than once` },
      );
      target = picked?.entry;
    }
    if (target !== undefined) await openFile(path.join(workflowsDir(context.root), target.file), 'Workflow file');
  }
}
