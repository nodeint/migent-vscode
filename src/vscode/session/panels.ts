import path from 'node:path';

import * as vscode from 'vscode';

import type { AnswerModel } from '../../core/answerModel';
import { manifestPath, metricsPath, nextPath, sessionDir, workflowDraftPath, workflowsDir } from '../../core/paths';
import type { ResultsIntent, SessionAction } from '../../core/resultsIntent';
import { resolveHandoffPath, resolveOutputPath, type ResultsInput } from '../../core/resultsModel';
import { parseSessionPageMessage, type SessionPageIntent, type SessionPageMessage } from '../../core/sessionPageIntent';
import { type SessionBatchRef, type SessionPageModel, type SessionTab,workflowHeader } from '../../core/sessionPageModel';
import { readSessionWorkflow } from '../../core/sessionWorkflow';
import type { WorkflowEntry } from '../../core/workflows';
import type { AnswerSubmitter } from '../answers';
import { EMPTY_VALIDATION } from '../authoringSave';
import type { CapabilityService } from '../capability';
import type { MigentChange } from '../changes';
import { ClientCatalog } from '../clientCatalog';
import type { ControlService } from '../control';
import { pickModel } from '../modelPicker';
import { openFile } from '../openFile';
import type { ProjectContext, ProjectRegistry } from '../projects';
import { QuestionBatches, type QuestionSurface } from '../questions/batches';
import { type BatchIdentity,batchKeyOf } from '../questions/entry';
import { SESSION_ACTION_COMMANDS } from '../sessionActions';
import { type PageDescriptor, pageResourceRoots, renderPage } from '../webview/page';
import {
  Entry,
  type Identity,
  isIdentity,
  isTab,
  keyOf,
  type RestoredState,
  type Transient,
} from './entry';
import {
  batchGroups,
  batchOf,
  buildEmptyAnswerHeader,
  buildMetricsPage,
  buildQuestionsPage,
  buildResultsPage,
  latestOf,
  summariesOf,
} from './pageModels';
import { type SaveRequest, WorkflowSaver } from './workflowSave';

const INFO_MESSAGE_MS = 5000;

export const SESSION_VIEW_TYPE = 'migent.session';

export type { Identity } from './entry';

const PAGE: PageDescriptor = {
  folder: 'session',
  styles: ['session.css'],
  scripts: [
    'sessionCopy.js',
    'resultsCopy.js',
    'metricsCopy.js',
    'sessionWorkflowCopy.js',
    'questionsCopy.js',
    'sessionHeader.js',
    'results.js',
    'metrics.js',
    'workflow.js',
    'questions.js',
    'session.js',
  ],
  title: 'Session',
  modules: {
    folder: 'workfloweditor',
    styles: ['workflowForm.css'],
    scripts: ['workflowCopy.js', 'workflowModel.js', 'workflowForm.js'],
  },
};

/** The session a command should act on when it is invoked from a Session panel. */
export interface ActiveTarget {
  activeTarget: () => Identity | undefined;
}

/** Actions the page delegates to the Next step feature; set once by the extension. */
export interface SessionActions {
  openNextStep: (identity: Identity, workflow: string) => void;
}

export interface SessionOpenOptions {
  tab?: SessionTab;
  batch?: SessionBatchRef;
}

/** Header actions that only move between tabs of this page instead of running a command. */
const TAB_ACTIONS: Partial<Record<SessionAction, SessionTab>> = {
  openResult: 'results',
  openMetrics: 'metrics',
  answerQuestions: 'questions',
  openQuestions: 'questions',
  openWorkflow: 'workflow',
};

/** What the Session panel set needs besides the registry. */
export interface SessionPanelsDeps {
  capability: CapabilityService;
  control: ControlService;
  submitter: AnswerSubmitter;
  extensionUri: vscode.Uri;
  memento: vscode.Memento;
}

/**
 * The one Session page: Results, Session Metrics, Session Workflow and Questions of one session, as tabs of a
 * single webview. One panel per `(project, session)`, reused on reopen and restored by a serializer. Only the
 * active tab is built; a background change reposts the model of that tab, never focusing or revealing anything.
 */
export class SessionPanels implements vscode.Disposable, ActiveTarget {
  readonly #registry: ProjectRegistry;
  readonly #deps: SessionPanelsDeps;
  readonly #entries = new Map<string, Entry>();
  readonly #dirty = new Set<string>();
  readonly #subscriptions: vscode.Disposable[];
  readonly #questions: QuestionBatches;
  readonly #clients: ClientCatalog;
  readonly #saver: WorkflowSaver;
  #flushTimer: ReturnType<typeof setTimeout> | null = null;
  #actions: SessionActions | null = null;

  constructor(registry: ProjectRegistry, deps: SessionPanelsDeps) {
    this.#registry = registry;
    this.#deps = deps;
    this.#questions = new QuestionBatches(
      registry,
      { control: deps.control, submitter: deps.submitter },
      deps.memento,
    );
    this.#clients = new ClientCatalog(deps.capability);
    this.#saver = new WorkflowSaver({
      registry,
      capability: deps.capability,
      isCurrent: (entry) => this.#entries.get(keyOf(entry)) === entry,
      send: (entry, state) => this.#sendWorkflow(entry, true, state),
      publishLast: (entry, state) => this.#publishWorkflowLast(entry, state),
    });
    this.#subscriptions = [
      registry.onDidChange((change) => {
        this.#onChange(change);
      }),
      vscode.window.registerWebviewPanelSerializer(SESSION_VIEW_TYPE, {
        deserializeWebviewPanel: (panel, state: unknown) => {
          this.#restore(panel, state);
          return Promise.resolve();
        },
      }),
    ];
  }

  public setActions(actions: SessionActions): void {
    this.#actions = actions;
  }

  /** Number of open panels (for tests). */
  public get count(): number {
    return this.#entries.size;
  }

  public has(identity: Identity): boolean {
    return this.#entries.has(keyOf(identity));
  }

  public lastModel(identity: Identity): SessionPageModel | null {
    return this.#entries.get(keyOf(identity))?.lastModel ?? null;
  }

  /** The answer model last posted for the selected batch (for tests). */
  public lastAnswerModel(identity: Identity): AnswerModel | null {
    return this.#entries.get(keyOf(identity))?.lastAnswerModel ?? null;
  }

  public revision(identity: Identity): number {
    return this.#entries.get(keyOf(identity))?.revision ?? 0;
  }

  public title(identity: Identity): string | null {
    return this.#entries.get(keyOf(identity))?.panel.title ?? null;
  }

  public activeTarget(): Identity | undefined {
    for (const entry of this.#entries.values()) {
      if (entry.panel.active) return { project: entry.project, sessionId: entry.sessionId };
    }
    return undefined;
  }

  /** Adopt a deserialized panel; the serializer and tests use this. Malformed or duplicate state disposes it. */
  public restore(panel: vscode.WebviewPanel, state: unknown): void {
    this.#restore(panel, state);
  }

  /** Open the panel for a session, or reveal it on the requested tab. The only place a panel is revealed. */
  public open(identity: Identity, options: SessionOpenOptions = {}): void {
    const existing = this.#entries.get(keyOf(identity));
    if (existing !== undefined) {
      const tab = options.tab ?? (options.batch === undefined ? undefined : 'questions');
      if (tab === undefined) existing.panel.reveal(existing.panel.viewColumn ?? vscode.ViewColumn.Active);
      else this.#reveal(existing, tab, options.batch);
      return;
    }
    const tab = options.tab ?? (options.batch === undefined ? 'results' : 'questions');
    const batch = options.batch === undefined ? null : batchOf(identity, options.batch);
    const panel = vscode.window.createWebviewPanel(
      SESSION_VIEW_TYPE,
      'Session',
      vscode.ViewColumn.Active,
      { ...this.#webviewOptions(), retainContextWhenHidden: true },
    );
    this.#adopt(panel, { identity, tab, batch });
  }

  /** Handle a message from the page. Public so tests can drive the intents without a webview. */
  public async handle(identity: Identity, raw: unknown): Promise<void> {
    const entry = this.#entries.get(keyOf(identity));
    if (entry === undefined) return;
    const message = parseSessionPageMessage(raw);
    if (message !== null) await this.#dispatch(entry, message, raw);
  }

  public dispose(): void {
    if (this.#flushTimer !== null) clearTimeout(this.#flushTimer);
    for (const entry of [...this.#entries.values()]) entry.panel.dispose();
    this.#entries.clear();
    this.#dirty.clear();
    this.#questions.dispose();
    this.#clients.dispose();
    for (const subscription of this.#subscriptions.splice(0)) subscription.dispose();
  }

  async #dispatch(entry: Entry, message: SessionPageMessage, raw: unknown): Promise<void> {
    switch (message.type) {
      case 'ready':
        this.#sendEntry(entry, true);
        return;
      case 'intent':
        await this.#runIntent(entry, message.value);
        return;
      case 'saveForm':
        await this.#saveForm(entry, { rawForm: message.form, baseHash: message.baseHash });
        return;
      case 'reload':
        await this.#reload(entry, raw);
        return;
      case 'openFile':
        await this.#openWorkflowFile(entry);
        return;
      case 'pickModel':
        await this.#pickModel(entry);
        return;
      default:
        await this.#handleAnswer(entry, raw, message.type);
    }
  }

  #webviewOptions(): vscode.WebviewPanelOptions & vscode.WebviewOptions {
    return {
      enableScripts: true,
      localResourceRoots: pageResourceRoots(this.#deps.extensionUri, PAGE),
    };
  }

  #restore(panel: vscode.WebviewPanel, state: unknown): void {
    if (!isIdentity(state) || this.#entries.has(keyOf(state))) {
      panel.dispose();
      return;
    }
    const restored = state as RestoredState;
    const tab = isTab(restored.tab) ? restored.tab : 'results';
    const executionId = typeof restored.executionId === 'string' ? restored.executionId : '';
    const stageId = typeof restored.stageId === 'string' ? restored.stageId : null;
    const batch: BatchIdentity | null =
      executionId === ''
        ? null
        : { project: restored.project, sessionId: restored.sessionId, stageId, executionId };
    const { webview } = panel;
    webview.options = this.#webviewOptions();
    this.#adopt(panel, { identity: { project: restored.project, sessionId: restored.sessionId }, tab, batch });
  }

  #adopt(
    panel: vscode.WebviewPanel,
    init: { identity: Identity; tab: SessionTab; batch: BatchIdentity | null },
  ): void {
    const entry = new Entry({ ...init, panel, extensionUri: this.#deps.extensionUri });
    const key = keyOf(init.identity);
    this.#entries.set(key, entry);
    const { webview } = panel;
    webview.html = renderPage(webview, this.#deps.extensionUri, PAGE);
    webview.onDidReceiveMessage((raw: unknown) => {
      void this.handle(init.identity, raw);
    });
    panel.onDidDispose(() => {
      entry.release();
      if (entry.questionBatch !== null) void this.#questions.release(entry.questionBatch);
      this.#entries.delete(key);
      this.#dirty.delete(key);
    });
    this.#sendEntry(entry, true);
    void this.#loadClients(entry);
  }

  #reveal(entry: Entry, tab: SessionTab, ref: SessionBatchRef | undefined): void {
    this.#selectTab(entry, tab, ref);
    entry.panel.reveal(entry.panel.viewColumn ?? vscode.ViewColumn.Active);
  }

  /** Move to a tab, detaching the answer batch when Questions stops being shown. */
  #selectTab(entry: Entry, tab: SessionTab, ref: SessionBatchRef | undefined): void {
    const next = ref === undefined ? entry.questionBatch : batchOf(entry, ref);
    const isBatchChange =
      next !== null && entry.questionBatch !== null && batchKeyOf(next) !== batchKeyOf(entry.questionBatch);
    if (entry.questionBatch !== null && (tab !== 'questions' || isBatchChange)) {
      this.#questions.detach(entry.questionBatch);
    }
    entry.setTab(tab, next);
    this.#sendEntry(entry, true);
  }

  #sendEntry(entry: Entry, isForced: boolean): void {
    entry.retain(this.#registry.project(entry.project));
    switch (entry.tab) {
      case 'questions':
        this.#sendQuestions(entry, isForced);
        return;
      case 'results':
        entry.publish(buildResultsPage(entry, this.#registry), isForced);
        return;
      case 'metrics':
        entry.publish(buildMetricsPage(entry, this.#registry), isForced);
        return;
      case 'workflow':
        this.#sendWorkflow(entry, isForced);
    }
  }

  #sendQuestions(entry: Entry, isForced: boolean): void {
    const groups = batchGroups(entry, this.#registry);
    if (entry.questionBatch === null) {
      const latest = latestOf(groups);
      if (latest !== undefined) entry.setBatch(batchOf(entry, latest));
    }
    const batch = entry.questionBatch;
    if (batch === null) {
      entry.setAnswerModel(null);
      const header = buildEmptyAnswerHeader(entry, this.#registry);
      entry.publish({ tab: 'questions', header, questions: { model: null, selected: null, batches: summariesOf(groups) } }, isForced);
      return;
    }
    this.#questions.attach(batch, this.#surface(entry));
  }

  #surface(entry: Entry): QuestionSurface {
    return {
      post: (model) => {
        entry.setAnswerModel(model);
        const page = buildQuestionsPage(entry, this.#registry, model);
        if (page !== null) entry.publish(page, false);
      },
      close: () => {
        this.#selectTab(entry, 'results', undefined);
      },
    };
  }

  #sendWorkflow(entry: Entry, isForced: boolean, state?: Transient): void {
    const context = this.#registry.project(entry.project);
    if (context === undefined) return;
    const model = readSessionWorkflow({
      projectKey: entry.project,
      projectName: context.folder.name,
      projectRoot: context.root,
      sessionId: entry.sessionId,
      snapshot: context.store.snapshot(entry.sessionId),
      scan: context.catalog.workflows(),
      config: context.catalog.config(),
      clients: entry.clients,
    });
    if (entry.validationHash !== null && model.savedHash !== entry.validationHash) {
      entry.setValidation(EMPTY_VALIDATION, null);
    }
    model.validation = entry.validation;
    entry.publish({ tab: 'workflow', header: workflowHeader(model), workflow: model }, isForced, state);
  }

  async #runIntent(entry: Entry, intent: SessionPageIntent): Promise<void> {
    switch (intent.intent) {
      case 'selectTab':
        this.#selectTab(entry, intent.tab, undefined);
        return;
      case 'selectBatch':
        this.#selectTab(entry, 'questions', intent.batch);
        return;
      case 'sessionAction':
        await this.#sessionAction(entry, intent.action);
        return;
      case 'openResults':
        this.#selectTab(entry, 'results', undefined);
        return;
      case 'openMetricsFile': {
        const context = this.#registry.project(entry.project);
        if (context !== undefined) await openFile(metricsPath(context.root, entry.sessionId), 'metrics.json');
        return;
      }
      default:
        await this.#runResultsIntent(entry, intent);
    }
  }

  async #sessionAction(entry: Entry, action: SessionAction): Promise<void> {
    const tab = TAB_ACTIONS[action];
    if (tab !== undefined) {
      this.#selectTab(entry, tab, undefined);
      return;
    }
    const command = SESSION_ACTION_COMMANDS[action];
    if (command === undefined) return;
    await vscode.commands.executeCommand(command, {
      project: entry.project,
      sessionId: entry.sessionId,
    });
  }

  async #runResultsIntent(entry: Entry, intent: ResultsIntent): Promise<void> {
    const context = this.#registry.project(entry.project);
    if (context === undefined) return;
    const input: ResultsInput = {
      sessionId: entry.sessionId,
      sessionDirPath: sessionDir(context.root, entry.sessionId),
      snapshots: context.store.all(),
      eligibleIds: context.store.scanOutcome.eligible,
      workflows: context.catalog.workflows().entries,
    };
    const identity = { project: entry.project, sessionId: entry.sessionId };
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
        this.#actions?.openNextStep(identity, intent.workflow);
        return;
      case 'openNextFile':
        await openFile(nextPath(context.root, entry.sessionId), 'next.json');
        return;
      case 'openManifest':
        await openFile(manifestPath(context.root, entry.sessionId), 'manifest.yaml');
        return;
      case 'openTargetWorkflow':
        await this.#openWorkflow(context, intent.workflow);
        return;
      case 'sessionAction':
        await this.#sessionAction(entry, intent.action);
        return;
      case 'openSession':
        this.#openSession(entry, context, intent.sessionId);
    }
  }

  #openSession(entry: Entry, context: ProjectContext, sessionId: string): void {
    if (context.store.snapshot(sessionId) === undefined) {
      vscode.window.setStatusBarMessage(
        `Session ${sessionId} is not shown. Use Show more in the Sessions view.`,
        INFO_MESSAGE_MS,
      );
      return;
    }
    this.open({ project: entry.project, sessionId }, { tab: 'results' });
  }

  async #openWorkflow(context: ProjectContext, workflow: string): Promise<void> {
    const matches = context.catalog.workflows().entries.filter((candidate) => candidate.id === workflow);
    if (matches.length === 0) {
      void vscode.window.showWarningMessage(`No workflow with id ${workflow} in this project.`);
      return;
    }
    let [target]: (WorkflowEntry | undefined)[] = matches;
    if (matches.length > 1) {
      const picked = await vscode.window.showQuickPick(
        matches.map((candidate) => ({ label: candidate.file, candidate })),
        { title: `Workflow ${workflow} is defined more than once` },
      );
      target = picked?.candidate;
    }
    if (target !== undefined) await openFile(path.join(workflowsDir(context.root), target.file), 'Workflow file');
  }

  async #handleAnswer(entry: Entry, raw: unknown, type: string): Promise<void> {
    if (type === 'openResults') {
      this.#selectTab(entry, 'results', undefined);
      return;
    }
    if (type === 'openMetrics') {
      this.#selectTab(entry, 'metrics', undefined);
      return;
    }
    if (entry.tab !== 'questions' || entry.questionBatch === null) return;
    await this.#questions.handle(entry.questionBatch, raw);
  }

  async #reload(entry: Entry, raw: unknown): Promise<void> {
    if (entry.tab === 'workflow') this.#sendWorkflow(entry, true);
    else await this.#handleAnswer(entry, raw, 'reload');
  }

  async #openWorkflowFile(entry: Entry): Promise<void> {
    const context = this.#registry.project(entry.project);
    if (context !== undefined) await openFile(workflowDraftPath(context.root, entry.sessionId), 'workflow.yaml');
  }

  async #saveForm(entry: Entry, request: SaveRequest): Promise<void> {
    if (entry.tab === 'workflow') await this.#saver.save(entry, request);
  }

  async #pickModel(entry: Entry): Promise<void> {
    if (entry.tab !== 'workflow' || entry.clients.length === 0) return;
    const picked = await pickModel('Inline agent model', entry.clients, false);
    if (picked === undefined) return;
    void entry.panel.webview.postMessage({
      type: 'modelPicked',
      client: picked.model.client,
      model: picked.model.model,
    });
  }

  /** Repost the shown workflow model with the current diagnostics and a transient state. */
  #publishWorkflowLast(entry: Entry, state: Transient): void {
    const last = entry.lastModel;
    if (last?.tab !== 'workflow') return;
    entry.publish({ ...last, workflow: { ...last.workflow, validation: entry.validation } }, true, state);
  }

  async #loadClients(entry: Entry): Promise<void> {
    const context = this.#registry.project(entry.project);
    if (context === undefined) return;
    const clients = await this.#clients.get(context);
    if (this.#entries.get(keyOf(entry)) !== entry) return;
    entry.setClients(clients);
    if (entry.tab === 'workflow') this.#sendWorkflow(entry, true);
  }

  #onChange(change: MigentChange): void {
    switch (change.type) {
      case 'session':
        this.#mark((entry) => entry.project === change.project);
        return;
      case 'files':
        this.#mark((entry) => entry.project === change.project && entry.sessionId === change.sessionId);
        return;
      case 'project':
        if (change.kind !== 'config') this.#mark((entry) => entry.project === change.project);
        return;
      case 'projects':
      case 'refresh':
        this.#mark(() => true);
        return;
      case 'capability':
      case 'cliWindow':
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
      this.#flushDirty();
    }, 0);
  }

  #flushDirty(): void {
    const keys = [...this.#dirty];
    this.#dirty.clear();
    for (const key of keys) {
      const entry = this.#entries.get(key);
      if (entry !== undefined) this.#sendEntry(entry, false);
    }
  }
}
