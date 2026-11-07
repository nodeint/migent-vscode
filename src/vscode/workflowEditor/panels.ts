import path from 'node:path';

import * as vscode from 'vscode';

import { describeCapability } from '../../cli/capabilityText';
import { invokeJson } from '../../cli/invoke';
import type { LaunchSpec } from '../../cli/locate';
import type { CapabilityState } from '../../cli/version';
import type { ClientChoice } from '../../core/controlArgs';
import { workflowsDir } from '../../core/paths';
import {
  emptyWorkflowForm,
  parseWorkflowAuthoringEnvelope,
  readWorkflowEditor,
  type WorkflowDiagnostic,
  workflowDraftFromForm,
  type WorkflowEditorModel,
  workflowFormFromClient,
} from '../../core/workflowEditor';
import {
  parseWorkflowEditorMessage,
  type WorkflowEditorMessageType,
} from '../../core/workflowEditorIntent';
import { isWorkflowFile } from '../../core/workflows';
import type { CapabilityService } from '../capability';
import type { MigentChange, ProjectKey } from '../changes';
import { pickModel } from '../modelPicker';
import { openFile } from '../openFile';
import type { ProjectContext, ProjectRegistry } from '../projects';
import { type PageDescriptor, pageResourceRoots, renderPage } from '../webview/page';
import { ClientCatalog } from './clientList';

export const WORKFLOW_EDITOR_VIEW_TYPE = 'migent.editWorkflow';

const PAGE: PageDescriptor = {
  folder: 'workfloweditor',
  styles: ['workfloweditor.css'],
  scripts: ['workflowform.js', 'workfloweditor.js'],
  title: 'Workflow',
};

export const EMPTY_VALIDATION: WorkflowEditorModel['validation'] = { errors: [], warnings: [] };

export const SAVE_TIMEOUT_MS = 30_000;

/** Exit code of a rejected save because the file no longer matches the base hash. */
export const EXIT_CONFLICT = 3;

/** A workflow file inside one project's `.migent/workflows` folder. */
export interface WorkflowEditorIdentity {
  project: ProjectKey;
  file: string;
}

export function isWorkflowEditorIdentity(value: unknown): value is WorkflowEditorIdentity {
  if (typeof value !== 'object' || value === null) return false;
  const { project, file } = value as Partial<WorkflowEditorIdentity>;
  return (
    typeof project === 'string' &&
    project !== '' &&
    typeof file === 'string' &&
    file !== '' &&
    path.basename(file) === file &&
    isWorkflowFile(file)
  );
}

function keyOf(identity: WorkflowEditorIdentity): string {
  return `${identity.project}#${identity.file}`;
}

/** One open page and the last model posted to it. */
class Entry {
  public readonly identity: WorkflowEditorIdentity;
  public readonly panel: vscode.WebviewPanel;
  public revision = 0;
  public lastModel: WorkflowEditorModel | null = null;
  /** Diagnostics of the last save attempt; they describe the page draft, not the file on disk. */
  public validation: WorkflowEditorModel['validation'] = EMPTY_VALIDATION;
  /** The file hash the diagnostics were produced against; a different file clears them. */
  public validationHash: string | null = null;
  /** One save at a time per page; a second request is ignored while the first is in flight. */
  public saving = false;
  /** Provider suggestions for the inline-agent fields; empty until the client reads answer. */
  public clients: ClientChoice[] = [];
  #lastJson: string | null = null;

  constructor(identity: WorkflowEditorIdentity, panel: vscode.WebviewPanel) {
    this.identity = identity;
    this.panel = panel;
  }

  /** Post the model unless the same model and transient state were posted already. */
  public publish(model: WorkflowEditorModel, isForced: boolean, transient?: unknown): void {
    const json = JSON.stringify(model) + (transient === undefined ? '' : JSON.stringify(transient));
    if (!isForced && json === this.#lastJson) return;
    this.#lastJson = json;
    this.lastModel = model;
    this.revision += 1;
    this.panel.title = `Workflow: ${model.id || model.file}`;
    void this.panel.webview.postMessage({
      type: 'model',
      revision: this.revision,
      identity: this.identity,
      model,
      ...(transient === undefined ? {} : { transient }),
    });
  }
}

/** An unavailable model keeps the page usable while its project is gone. */
function unavailable(identity: WorkflowEditorIdentity): WorkflowEditorModel {
  return {
    mode: 'edit',
    project: identity.project,
    file: identity.file,
    path: `.migent/workflows/${identity.file}`,
    id: path.basename(identity.file, path.extname(identity.file)),
    schemaVersion: null,
    state: 'unreadable',
    isSupported: false,
    readError: 'The project is no longer available.',
    form: emptyWorkflowForm(),
    yaml: '',
    roles: [],
    agents: [],
    workflows: [],
    clients: [],
    duplicateOf: [],
    validation: EMPTY_VALIDATION,
    savedHash: '',
    canSave: false,
  };
}

/** The transient state a page shows while a save is in flight or failed. */
interface WorkflowTransient {
  saving: boolean;
  applying: boolean;
  error: string | null;
}

function transient(error: string | null, isSaving = false): WorkflowTransient {
  return { saving: isSaving, applying: false, error };
}

export function splitDiagnostics(diagnostics: WorkflowDiagnostic[]): WorkflowEditorModel['validation'] {
  return {
    errors: diagnostics
      .filter((item) => item.severity === 'error')
      .map((item) => ({ path: item.path, message: item.message })),
    warnings: diagnostics
      .filter((item) => item.severity === 'warning')
      .map((item) => ({ path: item.path, message: item.message })),
  };
}

export function envelopeOf(stdout: string | undefined): ReturnType<typeof parseWorkflowAuthoringEnvelope> {
  if (stdout === undefined || stdout.trim() === '') return null;
  try {
    return parseWorkflowAuthoringEnvelope(JSON.parse(stdout) as unknown);
  } catch {
    return null;
  }
}

function saveArgs(file: string, baseHash: string): string[] {
  return [
    'workflow',
    'save',
    '-',
    '--target',
    file,
    '--format',
    'yaml',
    '--base-hash',
    baseHash,
    '--preserve-comments',
    '--json',
  ];
}

/**
 * Workflow editor pages: one per `(project, file)`, reused on reopen and restored by a serializer.
 * The page only shows and requests; the host reads the file and resolves every action itself.
 */
export class WorkflowEditorPanels implements vscode.Disposable {
  readonly #registry: ProjectRegistry;
  readonly #capability: CapabilityService;
  readonly #extensionUri: vscode.Uri;
  readonly #clients: ClientCatalog;
  readonly #entries = new Map<string, Entry>();
  readonly #dirty = new Set<string>();
  readonly #subscriptions: vscode.Disposable[];
  #flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(registry: ProjectRegistry, capability: CapabilityService, extensionUri: vscode.Uri) {
    this.#registry = registry;
    this.#capability = capability;
    this.#extensionUri = extensionUri;
    this.#clients = new ClientCatalog(capability);
    this.#subscriptions = [
      registry.onDidChange((change) => {
        this.#onChange(change);
      }),
      vscode.window.registerWebviewPanelSerializer(WORKFLOW_EDITOR_VIEW_TYPE, {
        deserializeWebviewPanel: (panel, state: unknown) => {
          this.#restore(panel, state);
          return Promise.resolve();
        },
      }),
    ];
  }

  /** Number of open pages (for tests). */
  public get count(): number {
    return this.#entries.size;
  }

  /** Whether this page is open (for tests). */
  public has(identity: WorkflowEditorIdentity): boolean {
    return this.#entries.has(keyOf(identity));
  }

  /** The model last posted to a page (for tests). */
  public lastModel(identity: WorkflowEditorIdentity): WorkflowEditorModel | null {
    return this.#entries.get(keyOf(identity))?.lastModel ?? null;
  }

  /** Open the page for a workflow file, or reveal the one that exists. */
  public open(identity: WorkflowEditorIdentity): void {
    if (!isWorkflowEditorIdentity(identity)) return;
    const existing = this.#entries.get(keyOf(identity));
    if (existing !== undefined) {
      existing.panel.reveal(existing.panel.viewColumn ?? vscode.ViewColumn.Active);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      WORKFLOW_EDITOR_VIEW_TYPE,
      `Workflow: ${identity.file}`,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: pageResourceRoots(this.#extensionUri, PAGE),
      },
    );
    this.#adopt(panel, identity);
  }

  public dispose(): void {
    if (this.#flushTimer !== null) clearTimeout(this.#flushTimer);
    this.#clients.dispose();
    for (const entry of [...this.#entries.values()]) entry.panel.dispose();
    this.#entries.clear();
    for (const subscription of this.#subscriptions.splice(0)) subscription.dispose();
  }

  #restore(panel: vscode.WebviewPanel, state: unknown): void {
    if (!isWorkflowEditorIdentity(state) || this.#entries.has(keyOf(state))) {
      panel.dispose();
      return;
    }
    const { webview } = panel;
    webview.options = {
      enableScripts: true,
      localResourceRoots: pageResourceRoots(this.#extensionUri, PAGE),
    };
    this.#adopt(panel, state);
  }

  #adopt(panel: vscode.WebviewPanel, identity: WorkflowEditorIdentity): void {
    const entry = new Entry(identity, panel);
    const key = keyOf(identity);
    const { webview } = panel;
    this.#entries.set(key, entry);
    webview.html = renderPage(webview, this.#extensionUri, PAGE);
    webview.onDidReceiveMessage((raw: unknown) => {
      void this.handle(identity, raw);
    });
    panel.onDidDispose(() => {
      this.#entries.delete(key);
      this.#dirty.delete(key);
    });
    this.#send(identity, true);
    void this.#loadClients(identity);
  }

  /** Handle a page message. Public so tests can drive the intent path without a webview. */
  public async handle(identity: WorkflowEditorIdentity, raw: unknown): Promise<void> {
    const entry = this.#entries.get(keyOf(identity));
    if (entry === undefined) return;
    if (typeof raw === 'object' && raw !== null && (raw as { type?: unknown }).type === 'ready') {
      this.#send(identity, true);
      return;
    }
    const message = parseWorkflowEditorMessage(raw);
    if (message === null) return;
    const context = this.#registry.project(identity.project);
    const file = context === undefined ? undefined : path.join(workflowsDir(context.root), identity.file);

    if (message.type === 'saveForm') {
      await this.#save(identity, message.form, message.baseHash);
      return;
    }
    const handlers: Record<Exclude<WorkflowEditorMessageType, 'saveForm'>, () => Promise<void> | void> = {
      reload: () => {
        entry.validation = EMPTY_VALIDATION;
        entry.validationHash = null;
        context?.catalog.reloadWorkflow(identity.file);
        this.#clients.invalidate(identity.project);
        void this.#loadClients(identity);
        this.#send(identity, true);
      },
      openFile: async () => {
        if (file !== undefined) await openFile(file, 'Workflow');
      },
      reveal: async () => {
        if (file !== undefined) await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(file));
      },
      run: async () => {
        if (file !== undefined) {
          await vscode.commands.executeCommand('migent.workflow.run', {
            kind: 'workflow',
            project: identity.project,
            file,
          });
        }
      },
      pickModel: () => this.#pickInlineModel(identity, entry),
      duplicate: () => this.#error(identity, 'Duplicating a workflow from the page is not available yet.'),
    };
    await handlers[message.type]();
  }

  /** Open the shared model picker and hand the choice back to the page's own draft. */
  async #pickInlineModel(identity: WorkflowEditorIdentity, entry: Entry): Promise<void> {
    if (entry.clients.length === 0) {
      this.#clients.invalidate(identity.project);
      await this.#loadClients(identity);
    }
    if (this.#entries.get(keyOf(identity)) !== entry) return;
    if (entry.clients.length === 0) {
      this.#error(identity, 'No client list is available. Check the Migent CLI, then Reload the page.');
      return;
    }
    const picked = await pickModel('Inline agent model', entry.clients, false);
    if (picked === undefined || this.#entries.get(keyOf(identity)) !== entry) return;
    void entry.panel.webview.postMessage({
      type: 'modelPicked',
      client: picked.model.client,
      model: picked.model.model,
    });
  }

  /** Save the page draft from stdin and accept only the CLI's versioned result. */
  async #save(identity: WorkflowEditorIdentity, rawForm: unknown, baseHash: string): Promise<void> {
    const entry = this.#entries.get(keyOf(identity));
    if (entry === undefined || entry.saving) return;
    entry.saving = true;
    try {
      await this.#runSave(identity, entry, { rawForm, baseHash });
    } finally {
      entry.saving = false;
    }
  }

  async #runSave(
    identity: WorkflowEditorIdentity,
    entry: Entry,
    request: { rawForm: unknown; baseHash: string },
  ): Promise<void> {
    if (!identity.file.endsWith('.yaml')) {
      this.#error(identity, 'Migent can only save .yaml workflow files. Rename this file to .yaml before editing it here.');
      return;
    }
    const context = this.#registry.project(identity.project);
    if (context === undefined) {
      this.#error(identity, 'The project is no longer available.');
      return;
    }
    const launch = await this.#launch(identity);
    if (launch === null) return;
    const draft = workflowDraftFromForm(workflowFormFromClient(request.rawForm));
    entry.publish(entry.lastModel ?? unavailable(identity), true, transient(null, true));
    const result = await invokeJson(launch, saveArgs(identity.file, request.baseHash), {
      cwd: context.root,
      input: draft,
      timeoutMs: SAVE_TIMEOUT_MS,
    });
    const envelope = result.kind === 'ok' ? parseWorkflowAuthoringEnvelope(result.value) : envelopeOf(result.error.stdout);
    if (result.kind === 'ok') {
      this.#saved(identity, context, envelope);
      return;
    }
    this.#saveFailed(identity, { exitCode: result.error.exitCode, stderr: result.error.stderr }, envelope);
  }

  /** Accept only a written result, then repost the file from disk. */
  #saved(
    identity: WorkflowEditorIdentity,
    context: ProjectContext,
    envelope: ReturnType<typeof parseWorkflowAuthoringEnvelope>,
  ): void {
    const entry = this.#entries.get(keyOf(identity));
    if (entry === undefined) return;
    if (!envelope?.written) {
      this.#error(identity, 'Migent did not confirm the save.');
      return;
    }
    entry.validation = splitDiagnostics(envelope.diagnostics);
    entry.validationHash = envelope.hash;
    context.catalog.reloadWorkflow(identity.file);
    this.#send(identity, true, transient(null));
  }

  #saveFailed(
    identity: WorkflowEditorIdentity,
    failure: { exitCode: number | undefined; stderr: string },
    envelope: ReturnType<typeof parseWorkflowAuthoringEnvelope>,
  ): void {
    const entry = this.#entries.get(keyOf(identity));
    if (entry === undefined) return;
    if (envelope !== null) {
      entry.validation = splitDiagnostics(envelope.diagnostics);
      entry.validationHash = entry.lastModel?.savedHash ?? null;
      if (failure.exitCode === EXIT_CONFLICT) {
        this.#publishLast(identity, 'The file changed on disk. Reload it from disk before saving again.');
        return;
      }
      if (entry.validation.errors.length > 0) {
        this.#send(identity, true, transient(null));
        return;
      }
    }
    this.#error(identity, saveFailure(failure.exitCode, failure.stderr));
  }

  /** The launch to use, or an error already posted to the page. */
  async #launch(identity: WorkflowEditorIdentity): Promise<LaunchSpec | null> {
    let state: CapabilityState = this.#capability.state(identity.project);
    if (state.kind === 'checking') state = await this.#capability.windowReady();
    if (state.kind === 'ok' && state.launch !== undefined) return state.launch;
    const diagnostic = describeCapability(state);
    this.#error(
      identity,
      `Saving needs a usable Migent CLI. ${diagnostic?.label ?? 'The CLI check has not finished; try again shortly.'}`,
    );
    return null;
  }

  #input(identity: WorkflowEditorIdentity): WorkflowEditorModel | undefined {
    const context = this.#registry.project(identity.project);
    if (context === undefined) return undefined;
    return readWorkflowEditor({
      projectKey: identity.project,
      projectName: context.folder.name,
      projectRoot: context.root,
      file: identity.file,
      scan: context.catalog.workflows(),
      config: context.catalog.config(),
      clients: this.#entries.get(keyOf(identity))?.clients ?? [],
    });
  }

  /** Read the provider list once, then repaint with the suggestions it enables. */
  async #loadClients(identity: WorkflowEditorIdentity): Promise<void> {
    const context = this.#registry.project(identity.project);
    if (context === undefined) return;
    const clients = await this.#clients.get(context);
    const entry = this.#entries.get(keyOf(identity));
    if (entry === undefined) return;
    entry.clients = clients;
    this.#send(identity, true);
  }

  #send(identity: WorkflowEditorIdentity, isForced: boolean, state?: unknown): void {
    const entry = this.#entries.get(keyOf(identity));
    if (entry === undefined) return;
    const model = this.#input(identity) ?? unavailable(identity);
    if (entry.validationHash !== null && model.savedHash !== entry.validationHash) {
      entry.validation = EMPTY_VALIDATION;
      entry.validationHash = null;
    }
    model.validation = entry.validation;
    entry.publish(model, isForced, state);
  }

  /** A model message with a page-level error, without replacing the saved model. */
  #error(identity: WorkflowEditorIdentity, message: string): void {
    const entry = this.#entries.get(keyOf(identity));
    if (entry === undefined) return;
    entry.validation = EMPTY_VALIDATION;
    entry.validationHash = null;
    this.#publishLast(identity, message);
  }

  /** Keep the shown model and draft, adding the last diagnostics and one error line. */
  #publishLast(identity: WorkflowEditorIdentity, message: string): void {
    const entry = this.#entries.get(keyOf(identity));
    if (entry === undefined) return;
    const model = entry.lastModel ?? unavailable(identity);
    model.validation = entry.validation;
    entry.publish(model, true, transient(message));
  }

  #onChange(change: MigentChange): void {
    switch (change.type) {
      case 'project':
        if (change.kind === 'workflows' || change.kind === 'config') {
          this.#mark((entry) => entry.identity.project === change.project);
        }
        return;
      case 'projects':
      case 'refresh':
        this.#mark(() => true);
        return;
      default:
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
        if (entry === undefined) continue;
        this.#send(entry.identity, false);
      }
    }, 0);
  }
}

/** A short, safe description of why the CLI could not save. */
export function saveFailure(exitCode: number | undefined, stderr: string): string {
  const last = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .at(-1);
  if (last !== undefined) return `Could not save: ${last}`;
  return exitCode === undefined ? 'Could not save: Migent could not be run.' : `Could not save: Migent exited with code ${exitCode}.`;
}
