import path from 'node:path';

import * as vscode from 'vscode';

import type { ClientChoice } from '../../core/controlArgs';
import { workflowsDir } from '../../core/paths';
import {
  duplicateArtifactProblem,
  emptyWorkflowForm,
  readWorkflowEditor,
  workflowDraftFromForm,
  type WorkflowEditorModel,
  workflowFormFromClient,
} from '../../core/workflowEditor';
import {
  parseWorkflowEditorMessage,
  type WorkflowEditorMessageType,
} from '../../core/workflowEditorIntent';
import { isWorkflowFile } from '../../core/workflows';
import {
  EMPTY_VALIDATION,
  envelopeOf,
  EXIT_CONFLICT,
  runAuthoringSave,
  SAVE_TIMEOUT_MS,
  saveFailure,
  type SaveOutcome,
  splitDiagnostics,
  usableLaunch,
} from '../authoringSave';
import type { CapabilityService } from '../capability';
import type { MigentChange, ProjectKey } from '../changes';
import { ClientCatalog } from '../clientCatalog';
import { pickModel } from '../modelPicker';
import { openFile } from '../openFile';
import type { ProjectContext, ProjectRegistry } from '../projects';
import { type PageDescriptor, pageResourceRoots, renderPage } from '../webview/page';

export const WORKFLOW_EDITOR_VIEW_TYPE = 'migent.editWorkflow';

const PAGE: PageDescriptor = {
  folder: 'workfloweditor',
  styles: ['workflowform.css', 'workfloweditor.css'],
  scripts: ['workflowcopy.js', 'workflowmodel.js', 'workflowform.js', 'workfloweditor.js'],
  title: 'Workflow',
};

export { EMPTY_VALIDATION, envelopeOf, EXIT_CONFLICT, SAVE_TIMEOUT_MS, saveFailure, splitDiagnostics };

const UNSAVABLE_MESSAGE =
  'This workflow cannot be saved from the page. If it uses an older schema, run `migent migrate` and reload the page.';

function notifySaveFailed(message: string): void {
  void vscode.window.showErrorMessage(`Workflow not saved. ${message}`);
}

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
  /** The file does not exist yet; the page edits a starter draft and the first save creates it. */
  public isNew = false;
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
      // The page persists this identity; `isNew` lets a reloaded window restore an unsaved draft.
      identity: this.isNew ? { ...this.identity, isNew: true } : this.identity,
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

/** A new file is saved without a base hash, so the CLI creates it and refuses to replace one that appeared. */
export function saveArgs(file: string, baseHash: string | null): string[] {
  const base = ['workflow', 'save', '-', '--target', file, '--format', 'yaml'];
  return baseHash === null ? [...base, '--json'] : [...base, '--base-hash', baseHash, '--preserve-comments', '--json'];
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

  /** Close the page of a workflow file, if open (the file was deleted). */
  public close(identity: WorkflowEditorIdentity): void {
    this.#entries.get(keyOf(identity))?.panel.dispose();
  }

  /** Open the page for a workflow file, or reveal the one that exists. `isNew` edits a draft with no file yet. */
  public open(identity: WorkflowEditorIdentity, options: { isNew?: boolean } = {}): void {
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
    this.#adopt(panel, identity, options.isNew === true);
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
    // A draft is restored as new; `#input` drops the flag if the file exists by now.
    const { project, file } = state;
    this.#adopt(panel, { project, file }, 'isNew' in state && state.isNew === true);
  }

  #adopt(panel: vscode.WebviewPanel, identity: WorkflowEditorIdentity, isNew = false): void {
    const entry = new Entry(identity, panel);
    entry.isNew = isNew;
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
    if (entry.isNew && message.type !== 'pickModel' && message.type !== 'reload') return;
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
      duplicate: async () => {
        await vscode.commands.executeCommand('migent.workflow.duplicate', { kind: 'workflow', project: identity.project, file });
      },
      delete: async () => {
        await vscode.commands.executeCommand('migent.workflow.delete', { kind: 'workflow', project: identity.project, file });
      },
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
    const form = workflowFormFromClient(request.rawForm);
    const refusal = saveRefusal(identity, entry.lastModel) ?? duplicateArtifactProblem(form);
    if (refusal !== null) {
      this.#saveError(identity, refusal);
      return;
    }
    const context = this.#registry.project(identity.project);
    if (context === undefined) {
      this.#saveError(identity, 'The project is no longer available.');
      return;
    }
    const launched = await usableLaunch(this.#capability, identity.project);
    if ('message' in launched) {
      this.#saveError(identity, launched.message);
      return;
    }
    const draft = workflowDraftFromForm(form, entry.lastModel?.schemaVersion ?? null);
    entry.publish(entry.lastModel ?? unavailable(identity), true, transient(null, true));
    const outcome = await runAuthoringSave(
      launched.launch,
      saveArgs(identity.file, entry.isNew ? null : request.baseHash),
      { cwd: context.root, input: draft },
    );
    this.#settle(identity, context, outcome);
  }

  /** Accept only a written result, then repost the file from disk; every other outcome keeps the draft. */
  #settle(identity: WorkflowEditorIdentity, context: ProjectContext, outcome: SaveOutcome): void {
    const entry = this.#entries.get(keyOf(identity));
    if (entry === undefined) return;
    switch (outcome.kind) {
      case 'written':
        entry.isNew = false;
        entry.validation = splitDiagnostics(outcome.envelope.diagnostics);
        entry.validationHash = outcome.envelope.hash;
        context.catalog.reloadWorkflow(identity.file);
        this.#send(identity, true, transient(null));
        return;
      case 'unconfirmed':
        this.#saveError(identity, 'Migent did not confirm the save.');
        return;
      case 'conflict':
        entry.validation = splitDiagnostics(outcome.envelope.diagnostics);
        entry.validationHash = entry.lastModel?.savedHash ?? null;
        notifySaveFailed('The file changed on disk. Reload it from disk before saving again.');
        this.#publishLast(identity, 'The file changed on disk. Reload it from disk before saving again.');
        return;
      case 'invalid': {
        entry.validation = splitDiagnostics(outcome.envelope.diagnostics);
        entry.validationHash = entry.lastModel?.savedHash ?? null;
        const count = entry.validation.errors.length;
        notifySaveFailed(`${count} problem${count === 1 ? '' : 's'} found. Fix them and save again.`);
        this.#send(identity, true, transient(null));
        return;
      }
      case 'failed':
        this.#saveError(identity, outcome.message);
        return;
    }
  }

  #input(identity: WorkflowEditorIdentity): WorkflowEditorModel | undefined {
    const context = this.#registry.project(identity.project);
    if (context === undefined) return undefined;
    const entry = this.#entries.get(keyOf(identity));
    const model = readWorkflowEditor({
      projectKey: identity.project,
      projectName: context.folder.name,
      projectRoot: context.root,
      file: identity.file,
      scan: context.catalog.workflows(),
      config: context.catalog.config(),
      clients: entry?.clients ?? [],
      isNew: entry?.isNew === true,
    });
    // The file exists (saved elsewhere, or a restored draft whose file appeared): it is an ordinary edit now.
    if (entry !== undefined && model.mode === 'edit') entry.isNew = false;
    return model;
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

  /** A save failure: the page error line plus a toast, so it shows wherever the form is scrolled. */
  #saveError(identity: WorkflowEditorIdentity, message: string): void {
    notifySaveFailed(message);
    this.#error(identity, message);
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

/**
 * Why a save request must be refused before anything is serialized, or null. The request comes from the webview, so
 * the page's own disabled state is not trusted: only a published model with `canSave` may be saved.
 */
export function saveRefusal(identity: WorkflowEditorIdentity, model: Pick<WorkflowEditorModel, 'canSave'> | null): string | null {
  if (model?.canSave !== true) return UNSAVABLE_MESSAGE;
  if (!identity.file.endsWith('.yaml')) {
    return 'Migent can only save .yaml workflow files. Rename this file to .yaml before editing it here.';
  }
  return null;
}
