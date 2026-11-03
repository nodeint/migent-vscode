import { randomBytes } from 'node:crypto';
import path from 'node:path';

import * as vscode from 'vscode';

import {
  buildNextStepModel,
  fingerprintOf,
  lookupSuggestion,
  type NextStepInput,
  type NextStepModel,
  type ResolvedLaunch,
  resolveLaunch,
  type TaskOverride,
} from '../../core/nextStep';
import { type NextStepIntent,parseNextStepMessage } from '../../core/nextStepIntent';
import { sessionDir, taskPath, workflowsDir } from '../../core/paths';
import { resolveOutputPath } from '../../core/resultsModel';
import { truncate } from '../../core/sessionPresentation';
import type { MigentChange, ProjectKey } from '../changes';
import type { ControlService } from '../control';
import { openFile } from '../openFile';
import type { ProjectContext, ProjectRegistry } from '../projects';
import type { ResultsPanels } from '../results/panels';

export const NEXT_STEP_VIEW_TYPE = 'migent.nextStep';

const TITLE_MAX = 40;
const SESSION_TITLE_MAX = 60;
const NONCE_BYTES = 16;
const OVERRIDE_PREFIX = 'migent.nextStep.task';

/** The page's identity: the source session and the target workflow it prepares. */
export interface NextStepIdentity {
  project: ProjectKey;
  sessionId: string;
  workflow: string;
}

export type LaunchMode = 'run' | 'prepare';

function keyOf(identity: NextStepIdentity): string {
  return JSON.stringify([identity.project, identity.sessionId, identity.workflow]);
}

export function isNextStepIdentity(value: unknown): value is NextStepIdentity {
  if (typeof value !== 'object' || value === null) return false;
  const { project, sessionId, workflow } = value as Partial<NextStepIdentity>;
  return [project, sessionId, workflow].every((part) => typeof part === 'string' && part !== '');
}

function html(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = randomBytes(NONCE_BYTES).toString('base64');
  const asset = (name: string): string =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'nextstep', name)).toString();
  const csp = `default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${asset('nextstep.css')}">
<title>Next step</title>
</head>
<body>
<main id="root"></main>
<script nonce="${nonce}" src="${asset('nextstep.js')}"></script>
</body>
</html>`;
}

function titleOf(text: string): string {
  const line = text.split(/\r?\n/).find((candidate) => candidate.trim().length > 0)?.trim() ?? 'Next step';
  return truncate(line, SESSION_TITLE_MAX);
}

/** Transient host state posted next to the model; it never comes from the page. */
interface Transient {
  pending: string | null;
  error: string | null;
}

class Entry {
  public revision = 0;
  public error: string | null = null;

  public setError(message: string | null): void {
    this.error = message;
  }
  public lastModel: NextStepModel | null = null;
  #lastJson: string | null = null;

  constructor(
    public readonly identity: NextStepIdentity,
    public readonly panel: vscode.WebviewPanel,
  ) {}

  public publish(model: NextStepModel, transient: Transient, isForced: boolean): void {
    const json = JSON.stringify([model, transient]);
    if (!isForced && json === this.#lastJson) return;
    this.#lastJson = json;
    this.lastModel = model;
    this.revision += 1;
    this.panel.title = `Next: ${truncate(model.target.workflow, TITLE_MAX)} ← ${truncate(model.sourceTitle, TITLE_MAX)}`;
    void this.panel.webview.postMessage({
      type: 'model',
      revision: this.revision,
      identity: this.identity,
      model,
      transient,
    });
  }
}

/**
 * Next step pages: one per `(project, source session, target workflow)`, separate from the source's Results
 * overview. The page edits a task and requests Run or Prepare; project, source, target, argv and files are
 * all derived by the host from the captured identity and fresh store data (plans/03b-downstream-handoff.md §5).
 */
export class NextStepPanels implements vscode.Disposable {
  readonly #registry: ProjectRegistry;
  readonly #extensionUri: vscode.Uri;
  readonly #control: ControlService;
  readonly #results: ResultsPanels;
  readonly #memento: vscode.Memento;
  readonly #entries = new Map<string, Entry>();
  readonly #dirty = new Set<string>();
  readonly #subscriptions: vscode.Disposable[];
  #flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    registry: ProjectRegistry,
    deps: { control: ControlService; results: ResultsPanels; memento: vscode.Memento },
    extensionUri: vscode.Uri,
  ) {
    this.#registry = registry;
    this.#extensionUri = extensionUri;
    this.#control = deps.control;
    this.#results = deps.results;
    this.#memento = deps.memento;
    const markAll = (): void => {
      this.#mark(() => true);
    };
    const stopGate = deps.control.gate.onDidChange(markAll);
    this.#subscriptions = [
      registry.onDidChange((change) => {
        this.#onChange(change);
      }),
      { dispose: stopGate },
      vscode.window.registerWebviewPanelSerializer(NEXT_STEP_VIEW_TYPE, {
        deserializeWebviewPanel: (panel, state: unknown) => {
          this.#restore(panel, state);
          return Promise.resolve();
        },
      }),
    ];
  }

  public get count(): number {
    return this.#entries.size;
  }

  public has(identity: NextStepIdentity): boolean {
    return this.#entries.has(keyOf(identity));
  }

  /** The model last posted to a page (for tests). */
  public lastModel(identity: NextStepIdentity): NextStepModel | null {
    return this.#entries.get(keyOf(identity))?.lastModel ?? null;
  }

  /** The page in focus, if any. */
  public activeIdentity(): NextStepIdentity | undefined {
    for (const entry of this.#entries.values()) if (entry.panel.active) return entry.identity;
    return undefined;
  }

  /** The source session of the page in focus, so the shared header actions keep their source target. */
  public activeTarget(): { project: ProjectKey; sessionId: string } | undefined {
    const identity = this.activeIdentity();
    return identity === undefined ? undefined : { project: identity.project, sessionId: identity.sessionId };
  }

  /** Open the page for a source and target, or reveal the one that exists. Only this reveals a page. */
  public open(identity: NextStepIdentity): void {
    const existing = this.#entries.get(keyOf(identity));
    if (existing !== undefined) {
      existing.panel.reveal(existing.panel.viewColumn ?? vscode.ViewColumn.Active);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      NEXT_STEP_VIEW_TYPE,
      'Next step',
      vscode.ViewColumn.Active,
      this.#webviewOptions(),
    );
    this.#adopt(panel, identity);
  }

  /** Handle a message from a page. Public so tests can drive the intent path without a webview. */
  public async handle(identity: NextStepIdentity, raw: unknown): Promise<void> {
    const message = parseNextStepMessage(raw);
    if (message === null) return;
    if (message.type === 'ready') {
      this.#send(identity, true);
      return;
    }
    await this.#run(identity, message.value);
  }

  /** Run or Prepare for a page, from the footer or a command. `task` defaults to the effective task. */
  public async launch(identity: NextStepIdentity, mode: LaunchMode, task?: string): Promise<void> {
    const entry = this.#entries.get(keyOf(identity));
    const context = this.#registry.project(identity.project);
    if (context === undefined) {
      this.#fail(entry, 'The project is no longer open.');
      return;
    }
    if (this.#isBusy(context, identity)) return;
    const launch = await this.#prepareLaunch(context, identity, task ?? this.#effectiveTask(context, identity));
    if (launch === undefined) return;
    await (mode === 'run' ? this.#run0(context, launch) : this.#prepare(context, launch));
    this.#send(identity, false);
  }

  public dispose(): void {
    if (this.#flushTimer !== null) clearTimeout(this.#flushTimer);
    for (const entry of [...this.#entries.values()]) entry.panel.dispose();
    this.#entries.clear();
    for (const subscription of this.#subscriptions.splice(0)) subscription.dispose();
  }

  /** Validate, remember the task and save the target workflow; every failure is shown on the page. */
  async #prepareLaunch(
    context: ProjectContext,
    identity: NextStepIdentity,
    requested: string,
  ): Promise<ResolvedLaunch | undefined> {
    const entry = this.#entries.get(keyOf(identity));
    // Re-resolve everything from the captured identity immediately before dispatch.
    const resolved = resolveLaunch(this.#inputFor(context, identity), requested);
    if (resolved.kind === 'blocked') {
      this.#fail(entry, resolved.reason);
      return undefined;
    }
    entry?.setError(null);
    await this.#remember(context, identity, resolved.launch.taskText);
    if (!(await this.#saveTargetWorkflow(context, resolved.launch))) {
      this.#fail(entry, 'The workflow was not saved, so it was not started.');
      return undefined;
    }
    // Saving may have changed the target: resolve once more, so the launch matches the saved file.
    context.catalog.reloadWorkflow(resolved.launch.workflowFile);
    const fresh = resolveLaunch(this.#inputFor(context, identity), resolved.launch.taskText);
    if (fresh.kind === 'blocked') {
      this.#fail(entry, fresh.reason);
      return undefined;
    }
    return fresh.launch;
  }

  async #run0(context: ProjectContext, launch: ResolvedLaunch): Promise<void> {
    await this.#control.runDownstream(context, {
      workflowId: launch.workflowId,
      priorSessionId: launch.priorSessionId,
      task: launch.task,
    });
  }

  async #prepare(context: ProjectContext, launch: ResolvedLaunch): Promise<void> {
    const file = await this.#control.prepare(context, {
      workflowId: launch.workflowId,
      priorSessionId: launch.priorSessionId,
      title: titleOf(launch.taskText),
      taskText: launch.taskText,
    });
    if (file !== undefined) await openFile(file, 'task.md');
  }

  /** Save the dirty target workflow document of this launch only; never Save All. */
  async #saveTargetWorkflow(context: ProjectContext, launch: ResolvedLaunch): Promise<boolean> {
    const file = path.join(workflowsDir(context.root), launch.workflowFile);
    const document = vscode.workspace.textDocuments.find((open) => open.uri.fsPath === file);
    return document?.isDirty !== true || (await document.save());
  }

  #isBusy(context: ProjectContext, identity: NextStepIdentity): boolean {
    return this.#control.isDownstreamBusy(context, identity.workflow, identity.sessionId);
  }

  #fail(entry: Entry | undefined, message: string): void {
    if (entry === undefined) {
      void vscode.window.showErrorMessage(message);
      return;
    }
    entry.setError(message);
    this.#send(entry.identity, true);
  }

  #overrideKey(context: ProjectContext, identity: NextStepIdentity): string {
    return `${OVERRIDE_PREFIX}.${keyOf({ ...identity, project: context.key })}`;
  }

  #override(context: ProjectContext, identity: NextStepIdentity): TaskOverride | null {
    return this.#memento.get<TaskOverride>(this.#overrideKey(context, identity)) ?? null;
  }

  #fingerprint(context: ProjectContext, identity: NextStepIdentity): string {
    const lookup = lookupSuggestion(sessionDir(context.root, identity.sessionId), identity.workflow);
    return fingerprintOf(lookup.suggestion);
  }

  async #remember(context: ProjectContext, identity: NextStepIdentity, task: string): Promise<void> {
    const override: TaskOverride = { task, fingerprint: this.#fingerprint(context, identity) };
    await this.#memento.update(this.#overrideKey(context, identity), override);
  }

  #inputFor(context: ProjectContext, identity: NextStepIdentity): Omit<NextStepInput, 'override'> {
    return {
      sourceId: identity.sessionId,
      sessionDirPath: sessionDir(context.root, identity.sessionId),
      snapshots: context.store.all(),
      workflows: context.catalog.workflows().entries,
      targetWorkflow: identity.workflow,
    };
  }

  #effectiveTask(context: ProjectContext, identity: NextStepIdentity): string {
    return buildNextStepModel({ ...this.#inputFor(context, identity), override: this.#override(context, identity) })
      .task;
  }

  #webviewOptions(): vscode.WebviewPanelOptions & vscode.WebviewOptions {
    return {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(this.#extensionUri, 'media', 'nextstep')],
    };
  }

  #restore(panel: vscode.WebviewPanel, state: unknown): void {
    if (!isNextStepIdentity(state) || this.#entries.has(keyOf(state))) {
      panel.dispose();
      return;
    }
    const { webview } = panel;
    webview.options = this.#webviewOptions();
    const { project, sessionId, workflow } = state;
    this.#adopt(panel, { project, sessionId, workflow });
  }

  #adopt(panel: vscode.WebviewPanel, identity: NextStepIdentity): void {
    const entry = new Entry(identity, panel);
    const key = keyOf(identity);
    this.#entries.set(key, entry);
    const { webview } = panel;
    webview.html = html(webview, this.#extensionUri);
    webview.onDidReceiveMessage((raw: unknown) => {
      void this.handle(identity, raw);
    });
    panel.onDidDispose(() => {
      this.#entries.delete(key);
      this.#dirty.delete(key);
    });
    this.#send(identity, true);
  }

  #send(identity: NextStepIdentity, isForced: boolean): void {
    const entry = this.#entries.get(keyOf(identity));
    if (entry === undefined) return;
    const context = this.#registry.project(identity.project);
    const input: NextStepInput = {
      sourceId: identity.sessionId,
      sessionDirPath: context === undefined ? '' : sessionDir(context.root, identity.sessionId),
      snapshots: context === undefined ? [] : context.store.all(),
      workflows: context === undefined ? [] : context.catalog.workflows().entries,
      targetWorkflow: identity.workflow,
      override: context === undefined ? null : this.#override(context, identity),
    };
    const pending = context !== undefined && this.#isBusy(context, identity) ? 'Starting' : null;
    entry.publish(buildNextStepModel(input), { pending, error: entry.error }, isForced);
  }

  #onChange(change: MigentChange): void {
    switch (change.type) {
      case 'session':
      case 'project':
        this.#mark((entry) => entry.identity.project === change.project);
        return;
      case 'files':
        if (change.targets.some((target) => target.kind === 'next')) {
          this.#mark(
            (entry) => entry.identity.project === change.project && entry.identity.sessionId === change.sessionId,
          );
        }
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
    for (const [key, entry] of this.#entries) if (isMatch(entry)) this.#dirty.add(key);
    if (this.#dirty.size === 0) return;
    this.#flushTimer ??= setTimeout(() => {
      this.#flushTimer = null;
      const keys = [...this.#dirty];
      this.#dirty.clear();
      for (const key of keys) {
        const entry = this.#entries.get(key);
        if (entry !== undefined) this.#send(entry.identity, false);
      }
    }, 0);
  }

  async #run(identity: NextStepIdentity, intent: NextStepIntent): Promise<void> {
    const context = this.#registry.project(identity.project);
    if (context === undefined) return;
    switch (intent.intent) {
      case 'setTask':
        // Stored without a repost, so typing never re-renders the field that has focus.
        await this.#remember(context, identity, intent.task);
        return;
      case 'resetTask':
        await this.#memento.update(this.#overrideKey(context, identity), undefined);
        this.#send(identity, true);
        return;
      case 'run':
      case 'prepare':
        await this.launch(identity, intent.intent, intent.task);
        return;
      default:
        await this.#openIntent(context, identity, intent);
        return;
    }
  }

  async #openIntent(context: ProjectContext, identity: NextStepIdentity, intent: NextStepIntent): Promise<void> {
    switch (intent.intent) {
      case 'openResults':
        this.#results.open({ project: identity.project, sessionId: identity.sessionId });
        return;
      case 'openTargetWorkflow': {
        const {file} = buildNextStepModel({ ...this.#inputFor(context, identity), override: null }).target;
        if (file === null) void vscode.window.showWarningMessage(`No single workflow file for ${identity.workflow}.`);
        else await openFile(path.join(workflowsDir(context.root), file), 'Workflow file');
        return;
      }
      case 'openSourceOutput': {
        const input = { ...this.#inputFor(context, identity), sessionId: identity.sessionId, eligibleIds: [] };
        const file = resolveOutputPath(input, `name:${intent.output}`);
        if (file === null) void vscode.window.showWarningMessage(`Output not found: ${intent.output}`);
        else await openFile(file, 'Output');
        return;
      }
      case 'openSession':
      case 'openChildTask': {
        if (context.store.snapshot(intent.sessionId)?.manifest?.priorSessionId !== identity.sessionId) {
          void vscode.window.showInformationMessage(`Session ${intent.sessionId} is not shown.`);
          return;
        }
        if (intent.intent === 'openSession') {
          this.#results.open({ project: identity.project, sessionId: intent.sessionId });
        } else await openFile(taskPath(context.root, intent.sessionId), 'task.md');
        return;
      }
      case 'recheck':
        await vscode.commands.executeCommand('migent.cli.recheck');
        return;
      default:
        return;
    }
  }
}
