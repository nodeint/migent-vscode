import * as vscode from 'vscode';

import { describeCapability } from '../../cli/capabilityText';
import { invokeJson } from '../../cli/invoke';
import type { LaunchSpec } from '../../cli/locate';
import type { CapabilityState } from '../../cli/version';
import type { ClientChoice } from '../../core/controlArgs';
import { workflowDraftPath } from '../../core/paths';
import { SESSION_ACTIONS } from '../../core/resultsIntent';
import { readSessionWorkflow, type SessionWorkflowModel } from '../../core/sessionWorkflow';
import {
  parseWorkflowAuthoringEnvelope,
  workflowDraftFromForm,
  workflowFormFromClient,
} from '../../core/workflowEditor';
import { parseWorkflowEditorMessage } from '../../core/workflowEditorIntent';
import type { CapabilityService } from '../capability';
import type { MigentChange, ProjectKey } from '../changes';
import { pickModel } from '../modelPicker';
import { openFile } from '../openFile';
import type { ProjectRegistry } from '../projects';
import { SESSION_ACTION_COMMANDS } from '../results/panels';
import { type PageDescriptor, pageResourceRoots, renderPage } from '../webview/page';
import { ClientCatalog } from '../workflowEditor/clientList';
import {
  EMPTY_VALIDATION,
  envelopeOf,
  EXIT_CONFLICT,
  SAVE_TIMEOUT_MS,
  saveFailure,
  splitDiagnostics,
} from '../workflowEditor/panels';

export const SESSION_WORKFLOW_VIEW_TYPE = 'migent.sessionWorkflow';

const PAGE: PageDescriptor = {
  folder: 'sessionworkflow',
  styles: ['sessionworkflow.css'],
  scripts: ['sessionworkflow.js'],
  title: 'Session workflow',
  modules: {
    folder: 'workfloweditor',
    styles: ['workflowform.css'],
    scripts: ['workflowmodel.js', 'workflowform.js'],
  },
};

export interface SessionWorkflowIdentity {
  project: ProjectKey;
  sessionId: string;
}

function isIdentity(value: unknown): value is SessionWorkflowIdentity {
  if (typeof value !== 'object' || value === null) return false;
  const { project, sessionId } = value as Partial<SessionWorkflowIdentity>;
  return typeof project === 'string' && project !== '' && typeof sessionId === 'string' && sessionId !== '';
}

const SHORT_ID = 8;

const LOCKED_MESSAGE = 'A stage already ran, so this workflow can no longer be changed.';

interface SaveRequest {
  rawForm: unknown;
  baseHash: string;
}

interface Transient {
  saving: boolean;
  applying: boolean;
  error: string | null;
}

const transient = (error: string | null, isSaving = false): Transient => ({
  saving: isSaving,
  applying: false,
  error,
});

function saveArgs(sessionId: string, baseHash: string): string[] {
  return [
    'workflow',
    'save',
    '-',
    '--session',
    sessionId,
    '--format',
    'yaml',
    '--base-hash',
    baseHash,
    '--preserve-comments',
    '--json',
  ];
}

const keyOf = (identity: SessionWorkflowIdentity): string => `${identity.project}#${identity.sessionId}`;

class Entry {
  public revision = 0;
  public clients: ClientChoice[] = [];
  public lastModel: SessionWorkflowModel | null = null;
  /** Diagnostics of the last save attempt; they describe the page draft, not the file on disk. */
  public validation: SessionWorkflowModel['validation'] = EMPTY_VALIDATION;
  public validationHash: string | null = null;
  /** One save at a time per page. */
  #saving = false;
  #lastJson: string | null = null;
  constructor(
    public readonly identity: SessionWorkflowIdentity,
    public readonly panel: vscode.WebviewPanel,
  ) {}

  public setValidation(validation: SessionWorkflowModel['validation'], hash: string | null): void {
    this.validation = validation;
    this.validationHash = hash;
  }

  public beginSave(): boolean {
    if (this.#saving) return false;
    this.#saving = true;
    return true;
  }

  public endSave(): void {
    this.#saving = false;
  }

  public publish(model: SessionWorkflowModel, isForced: boolean, state?: Transient): void {
    const json = JSON.stringify(model) + (state === undefined ? '' : JSON.stringify(state));
    if (!isForced && json === this.#lastJson) return;
    this.#lastJson = json;
    this.lastModel = model;
    this.revision += 1;
    this.panel.title = `Session workflow: ${model.id || model.sessionId.slice(0, SHORT_ID)}`;
    void this.panel.webview.postMessage({
      type: 'model',
      revision: this.revision,
      identity: this.identity,
      model,
      ...(state === undefined ? {} : { transient: state }),
    });
  }
}

/**
 * Session workflow pages: one per `(project, session)`. They show the session's own `workflow.yaml` as the shared
 * workflow form and lock every field once a stage has run. Before that, the draft is saved with the CLI.
 */
export class SessionWorkflowPanels implements vscode.Disposable {
  readonly #entries = new Map<string, Entry>();
  readonly #clients: ClientCatalog;
  readonly #subscriptions: vscode.Disposable[];

  constructor(
    private readonly registry: ProjectRegistry,
    private readonly capability: CapabilityService,
    private readonly extensionUri: vscode.Uri,
  ) {
    this.#clients = new ClientCatalog(this.capability);
    this.#subscriptions = [
      registry.onDidChange((change) => {
        this.#onChange(change);
      }),
      vscode.window.registerWebviewPanelSerializer(SESSION_WORKFLOW_VIEW_TYPE, {
        deserializeWebviewPanel: (panel, state: unknown) => {
          if (!isIdentity(state) || this.#entries.has(keyOf(state))) panel.dispose();
          else {
            const { webview } = panel;
            webview.options = this.#options();
            this.#adopt(panel, state);
          }
          return Promise.resolve();
        },
      }),
    ];
  }

  public has(identity: SessionWorkflowIdentity): boolean {
    return this.#entries.has(keyOf(identity));
  }

  public lastModel(identity: SessionWorkflowIdentity): SessionWorkflowModel | null {
    return this.#entries.get(keyOf(identity))?.lastModel ?? null;
  }

  public open(identity: SessionWorkflowIdentity): void {
    if (!isIdentity(identity)) return;
    const existing = this.#entries.get(keyOf(identity));
    if (existing !== undefined) {
      existing.panel.reveal(existing.panel.viewColumn ?? vscode.ViewColumn.Active);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      SESSION_WORKFLOW_VIEW_TYPE,
      'Session workflow',
      vscode.ViewColumn.Active,
      { ...this.#options(), retainContextWhenHidden: true },
    );
    this.#adopt(panel, identity);
  }

  public dispose(): void {
    this.#clients.dispose();
    for (const entry of [...this.#entries.values()]) entry.panel.dispose();
    this.#entries.clear();
    for (const subscription of this.#subscriptions.splice(0)) subscription.dispose();
  }

  #options(): vscode.WebviewOptions {
    return {
      enableScripts: true,
      localResourceRoots: pageResourceRoots(this.extensionUri, PAGE),
    };
  }

  #adopt(panel: vscode.WebviewPanel, identity: SessionWorkflowIdentity): void {
    const entry = new Entry(identity, panel);
    const key = keyOf(identity);
    this.#entries.set(key, entry);
    const { webview } = panel;
    webview.html = renderPage(webview, this.extensionUri, PAGE);
    webview.onDidReceiveMessage((raw: unknown) => {
      void this.handle(identity, raw);
    });
    panel.onDidDispose(() => this.#entries.delete(key));
    this.#send(identity, true);
    void this.#loadClients(identity);
  }

  /** Handle a page message; only a closed set is understood. */
  public async handle(identity: SessionWorkflowIdentity, raw: unknown): Promise<void> {
    const entry = this.#entries.get(keyOf(identity));
    const message =
      typeof raw === 'object' && raw !== null ? (raw as { type?: unknown; intent?: unknown; action?: unknown }) : {};
    const { type } = message;
    const context = this.registry.project(identity.project);
    if (entry === undefined || context === undefined) return;
    switch (type) {
      case 'ready':
      case 'reload':
        this.#send(identity, true);
        return;
      case 'saveForm': {
        const parsed = parseWorkflowEditorMessage(raw);
        if (parsed?.type === 'saveForm')
          await this.#save(identity, entry, { rawForm: parsed.form, baseHash: parsed.baseHash });
        return;
      }
      case 'intent':
        await this.#sessionAction(identity, message);
        return;
      case 'openFile':
        await openFile(workflowDraftPath(context.root, identity.sessionId), 'workflow.yaml');
        return;
      case 'pickModel': {
        if (entry.clients.length === 0) return;
        const picked = await pickModel('Inline agent model', entry.clients, false);
        if (picked === undefined) return;
        void entry.panel.webview.postMessage({
          type: 'modelPicked',
          client: picked.model.client,
          model: picked.model.model,
        });
        return;
      }
      default:
        return;
    }
  }

  async #sessionAction(
    identity: SessionWorkflowIdentity,
    message: { intent?: unknown; action?: unknown },
  ): Promise<void> {
    const action = SESSION_ACTIONS.find((candidate) => candidate === message.action);
    if (message.intent !== 'sessionAction' || action === undefined || action === 'openWorkflow') return;
    // The Results tab opens the Results page; the action's own command opens the output file.
    const command = action === 'openResult' ? 'migent.session.openResult' : SESSION_ACTION_COMMANDS[action];
    await vscode.commands.executeCommand(command, {
      project: identity.project,
      sessionId: identity.sessionId,
    });
  }

  async #save(identity: SessionWorkflowIdentity, entry: Entry, request: SaveRequest): Promise<void> {
    if (!entry.beginSave()) return;
    try {
      await this.#runSave(identity, entry, request);
    } finally {
      entry.endSave();
    }
  }

  async #runSave(identity: SessionWorkflowIdentity, entry: Entry, request: SaveRequest): Promise<void> {
    const context = this.registry.project(identity.project);
    if (context === undefined) {
      this.#fail(entry, 'The project is no longer available.');
      return;
    }
    if (entry.lastModel?.isLocked ?? true) {
      this.#fail(entry, LOCKED_MESSAGE);
      return;
    }
    const launch = await this.#launch(entry);
    if (launch === null) return;
    this.#publishLast(entry, transient(null, true));
    const result = await invokeJson(launch, saveArgs(identity.sessionId, request.baseHash), {
      cwd: context.root,
      input: workflowDraftFromForm(workflowFormFromClient(request.rawForm), entry.lastModel?.schemaVersion ?? null),
      timeoutMs: SAVE_TIMEOUT_MS,
    });
    if (this.#entries.get(keyOf(identity)) !== entry) return;
    if (result.kind === 'ok') this.#saved(identity, entry, parseWorkflowAuthoringEnvelope(result.value));
    else this.#saveFailed(entry, result.error);
  }

  #saved(
    identity: SessionWorkflowIdentity,
    entry: Entry,
    envelope: ReturnType<typeof parseWorkflowAuthoringEnvelope>,
  ): void {
    if (!envelope?.written) {
      this.#fail(entry, 'Migent did not confirm the save.');
      return;
    }
    entry.setValidation(splitDiagnostics(envelope.diagnostics), envelope.hash);
    this.#send(identity, true, transient(null));
  }

  #saveFailed(entry: Entry, error: { exitCode?: number; stderr: string; stdout?: string }): void {
    const envelope = envelopeOf(error.stdout);
    if (envelope !== null) {
      entry.setValidation(splitDiagnostics(envelope.diagnostics), entry.lastModel?.savedHash ?? null);
      if (error.exitCode === EXIT_CONFLICT) {
        this.#publishLast(entry, transient('The file changed on disk. Reload it from disk before saving again.'));
        return;
      }
      if (entry.validation.errors.length > 0) {
        this.#publishLast(entry, transient(null));
        return;
      }
    }
    this.#fail(entry, saveFailure(error.exitCode, error.stderr));
  }

  async #launch(entry: Entry): Promise<LaunchSpec | null> {
    let state: CapabilityState = this.capability.state(entry.identity.project);
    if (state.kind === 'checking') state = await this.capability.windowReady();
    if (state.kind === 'ok' && state.launch !== undefined) return state.launch;
    const diagnostic = describeCapability(state);
    this.#fail(
      entry,
      `Saving needs a usable Migent CLI. ${diagnostic?.label ?? 'The CLI check has not finished; try again shortly.'}`,
    );
    return null;
  }

  #fail(entry: Entry, message: string): void {
    entry.setValidation(EMPTY_VALIDATION, null);
    this.#publishLast(entry, transient(message));
  }

  /** Repost the shown model with the current diagnostics and a transient state. */
  #publishLast(entry: Entry, state: Transient): void {
    if (entry.lastModel === null) return;
    entry.publish({ ...entry.lastModel, validation: entry.validation }, true, state);
  }

  async #loadClients(identity: SessionWorkflowIdentity): Promise<void> {
    const context = this.registry.project(identity.project);
    if (context === undefined) return;
    const clients = await this.#clients.get(context);
    const entry = this.#entries.get(keyOf(identity));
    if (entry === undefined) return;
    entry.clients = clients;
    this.#send(identity, true);
  }

  #send(identity: SessionWorkflowIdentity, isForced: boolean, state?: Transient): void {
    const entry = this.#entries.get(keyOf(identity));
    const context = this.registry.project(identity.project);
    if (entry === undefined || context === undefined) return;
    const model = readSessionWorkflow({
      projectKey: identity.project,
      projectName: context.folder.name,
      projectRoot: context.root,
      sessionId: identity.sessionId,
      snapshot: context.store.snapshot(identity.sessionId),
      scan: context.catalog.workflows(),
      config: context.catalog.config(),
      clients: entry.clients,
    });
    if (entry.validationHash !== null && model.savedHash !== entry.validationHash) {
      entry.setValidation(EMPTY_VALIDATION, null);
    }
    model.validation = entry.validation;
    entry.publish(model, isForced, state);
  }

  #onChange(change: MigentChange): void {
    if (change.type === 'capability' || change.type === 'cliWindow') return;
    for (const entry of this.#entries.values()) {
      const { project, sessionId } = entry.identity;
      const isMatch =
        change.type === 'projects' || change.type === 'refresh' || ('project' in change && change.project === project);
      if (isMatch) this.#send({ project, sessionId }, false);
    }
  }
}
