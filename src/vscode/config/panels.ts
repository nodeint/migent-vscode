import * as vscode from 'vscode';

import type { AuthoringDiagnostic } from '../../core/authoring';
import {
  CONFIG_SCHEMA_VERSION,
  configDraftFromForm,
  type ConfigForm,
  configFormFromClient,
  type ConfigIssue,
  type ConfigModel,
  type ConfigScope,
  type ConfigTabModel,
  type ConfigValidation,
  duplicateNameProblem,
  effectiveAgentNames,
  readConfigTab,
} from '../../core/config';
import { parseConfigMessage, type SaveBase } from '../../core/configIntent';
import type { ClientChoice } from '../../core/controlArgs';
import { configLocalPath, configPath } from '../../core/paths';
import { text } from '../../text';
import { EMPTY_VALIDATION, runAuthoringSave, type SaveOutcome, usableLaunch } from '../authoringSave';
import type { CapabilityService } from '../capability';
import type { MigentChange, ProjectKey } from '../changes';
import { ClientCatalog } from '../clientCatalog';
import { pickModel } from '../modelPicker';
import { notify } from '../notices';
import { openFile } from '../openFile';
import type { ProjectRegistry } from '../projects';
import { type PageDescriptor, pageResourceRoots, renderPage } from '../webview/page';

export const CONFIG_VIEW_TYPE = 'migent.config';

const PAGE: PageDescriptor = {
  folder: 'config',
  styles: ['config.css'],
  scripts: ['configcopy.js', 'configform.js', 'config.js'],
  title: text('shell.configPanel'),
};

/** The page edits one project's config; `tab` is the last tab shown, restored with the panel. */
export interface ConfigIdentity {
  project: ProjectKey;
  tab: ConfigScope;
}

export function isConfigIdentity(value: unknown): value is ConfigIdentity {
  if (typeof value !== 'object' || value === null) return false;
  const { project, tab } = value as Partial<ConfigIdentity>;
  return typeof project === 'string' && project !== '' && (tab === 'project' || tab === 'local');
}

interface Transient {
  saving: boolean;
  applying: boolean;
  error: string | null;
  /** The tab whose save the CLI confirmed; the page then adopts that tab's disk state as its new base. */
  saved?: ConfigScope;
  /** Set on the message that carries a save's own result: which tab, and a number that is new for every result. */
  result?: { tab: ConfigScope; seq: number };
}


const transient = (error: string | null, isSaving = false): Transient => ({ saving: isSaving, applying: false, error });

function notifySaveFailed(message: string): void {
  notify('config.saveFailed', { message });
}

/** The argv of one save. Create or replace comes from the draft's own base, never from the file's state now. */
export function saveArgs(scope: ConfigScope, base: SaveBase): string[] {
  const args = ['config', 'save', '-', '--scope', scope, '--format', 'yaml', '--preserve-comments'];
  if (base.kind === 'replace') args.push('--base-hash', base.hash);
  return [...args, '--json'];
}

/** Diagnostics of one save; one from the other layer is labelled with its file and is not an error of this form. */
export function validationOf(diagnostics: AuthoringDiagnostic[], scope: ConfigScope): ConfigValidation {
  const issues = (severity: AuthoringDiagnostic['severity']): ConfigIssue[] =>
    diagnostics
      .filter((item) => item.severity === severity)
      .map((item) => {
        const other = item.source === 'project' || item.source === 'local' ? item.source : scope;
        return {
          path: item.path,
          message: item.message,
          ...(other === scope ? {} : { file: other === 'project' ? 'config.yaml' : 'config.local.yaml' }),
        };
      });
  return { errors: issues('error'), warnings: issues('warning') };
}

class Entry {
  public revision = 0;
  public lastModel: ConfigModel | null = null;
  public clients: ClientChoice[] = [];
  #saving = false;
  public validation: Record<ConfigScope, { value: ConfigValidation; hash: string | null }> = {
    project: { value: EMPTY_VALIDATION, hash: null },
    local: { value: EMPTY_VALIDATION, hash: null },
  };
  #lastJson: string | null = null;

  public setValidation(scope: ConfigScope, value: ConfigValidation, hash: string | null): void {
    this.validation[scope] = { value, hash };
  }

  /** Keep the diagnostics of one save, tied to the file hash they describe. */
  public record(scope: ConfigScope, diagnostics: AuthoringDiagnostic[], hash: string | null): void {
    this.setValidation(scope, validationOf(diagnostics, scope), hash);
  }

  #resultSeq = 0;

  /** A new number for every save result, so the page can tell it from a repost of older diagnostics. */
  public nextResult(tab: ConfigScope): { tab: ConfigScope; seq: number } {
    this.#resultSeq += 1;
    return { tab, seq: this.#resultSeq };
  }

  public beginSave(): boolean {
    if (this.#saving) return false;
    this.#saving = true;
    return true;
  }

  public endSave(): void {
    this.#saving = false;
  }

  public selectTab(tab: ConfigScope): void {
    this.identity = { project: this.identity.project, tab };
  }

  constructor(
    public identity: ConfigIdentity,
    public readonly panel: vscode.WebviewPanel,
  ) {}

  public publish(model: ConfigModel, isForced: boolean, state?: Transient): void {
    const json = JSON.stringify(model) + JSON.stringify(this.identity) + (state === undefined ? '' : JSON.stringify(state));
    if (!isForced && json === this.#lastJson) return;
    this.#lastJson = json;
    this.lastModel = model;
    this.revision += 1;
    this.panel.title = text('shell.configPanel');
    void this.panel.webview.postMessage({
      type: 'model',
      revision: this.revision,
      identity: this.identity,
      model,
      ...(state === undefined ? {} : { transient: state }),
    });
  }
}

/** Configuration pages: one per project, restored by a serializer. The page requests; the host resolves every file. */
export class ConfigPanels implements vscode.Disposable {
  readonly #entries = new Map<ProjectKey, Entry>();
  readonly #clients: ClientCatalog;
  readonly #subscriptions: vscode.Disposable[];

  constructor(
    private readonly registry: ProjectRegistry,
    private readonly capability: CapabilityService,
    private readonly extensionUri: vscode.Uri,
  ) {
    this.#clients = new ClientCatalog(capability);
    this.#subscriptions = [
      registry.onDidChange((change) => {
        this.#onChange(change);
      }),
      vscode.window.registerWebviewPanelSerializer(CONFIG_VIEW_TYPE, {
        deserializeWebviewPanel: (panel, state: unknown) => {
          if (!isConfigIdentity(state) || this.#entries.has(state.project)) panel.dispose();
          else {
            this.#restoreOptions(panel);
            this.#adopt(panel, state);
          }
          return Promise.resolve();
        },
      }),
    ];
  }

  public get count(): number {
    return this.#entries.size;
  }

  public has(project: ProjectKey): boolean {
    return this.#entries.has(project);
  }

  public lastModel(project: ProjectKey): ConfigModel | null {
    return this.#entries.get(project)?.lastModel ?? null;
  }

  /** The tab the page shows now (for tests). */
  public tab(project: ProjectKey): ConfigScope | null {
    return this.#entries.get(project)?.identity.tab ?? null;
  }

  /** Open the page for a project, or reveal the one that exists. */
  public open(project: ProjectKey, tab: ConfigScope = 'project'): void {
    if (!isConfigIdentity({ project, tab })) return;
    const existing = this.#entries.get(project);
    if (existing !== undefined) {
      existing.panel.reveal(existing.panel.viewColumn ?? vscode.ViewColumn.Active);
      return;
    }
    const panel = vscode.window.createWebviewPanel(CONFIG_VIEW_TYPE, text('shell.configPanel'), vscode.ViewColumn.Active, {
      ...this.#options(),
      retainContextWhenHidden: true,
    });
    this.#adopt(panel, { project, tab });
  }

  public dispose(): void {
    this.#clients.dispose();
    for (const entry of [...this.#entries.values()]) entry.panel.dispose();
    this.#entries.clear();
    for (const subscription of this.#subscriptions.splice(0)) subscription.dispose();
  }

  #restoreOptions(panel: vscode.WebviewPanel): void {
    Object.assign(panel.webview, { options: this.#options() });
  }

  #options(): vscode.WebviewOptions {
    return { enableScripts: true, localResourceRoots: pageResourceRoots(this.extensionUri, PAGE) };
  }

  #adopt(panel: vscode.WebviewPanel, identity: ConfigIdentity): void {
    const entry = new Entry(identity, panel);
    this.#entries.set(identity.project, entry);
    // eslint-disable-next-line no-param-reassign -- the tab icon belongs to the panel this page adopts
    panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'media', 'migent.svg');
    const { webview } = panel;
    webview.html = renderPage(webview, this.extensionUri, PAGE);
    webview.onDidReceiveMessage((raw: unknown) => {
      void this.handle(identity.project, raw);
    });
    panel.onDidDispose(() => this.#entries.delete(identity.project));
    this.#send(identity.project, true);
    void this.#loadClients(identity.project);
  }

  /** Handle a page message. Public so tests can drive the intent path without a webview. */
  public async handle(project: ProjectKey, raw: unknown): Promise<void> {
    const entry = this.#entries.get(project);
    if (entry === undefined) return;
    if (typeof raw === 'object' && raw !== null && (raw as { type?: unknown }).type === 'ready') {
      this.#send(project, true);
      return;
    }
    const message = parseConfigMessage(raw);
    const context = this.registry.project(project);
    if (message === null || context === undefined) return;
    switch (message.type) {
      case 'ready':
        this.#send(project, true);
        return;
      case 'selectTab':
        entry.selectTab(message.tab);
        this.#send(project, true);
        return;
      case 'reload':
        entry.setValidation(message.tab, EMPTY_VALIDATION, null);
        this.#clients.invalidate(project);
        void this.#loadClients(project);
        this.#send(project, true);
        return;
      case 'openFile':
        await this.#openFile(context.root, message.tab);
        return;
      case 'pickModel':
        await this.#pickInlineModel(project, entry, message.tab);
        return;
      case 'saveForm':
        await this.#guardedSave(project, entry, message);
        return;
    }
  }

  /** A Local file that does not exist yet has nothing to open. */
  async #openFile(root: string, scope: ConfigScope): Promise<void> {
    const file = scope === 'project' ? configPath(root) : configLocalPath(root);
    if (readConfigTab(root, scope).exists) await openFile(file, text('documents.kindConfig'));
  }

  /** One save at a time per page; a second request is ignored while the first is in flight. */
  async #guardedSave(
    project: ProjectKey,
    entry: Entry,
    message: { tab: ConfigScope; form: Record<string, unknown>; base: SaveBase },
  ): Promise<void> {
    if (!entry.beginSave()) return;
    try {
      await this.#save(project, entry, message);
    } finally {
      entry.endSave();
    }
  }

  async #pickInlineModel(project: ProjectKey, entry: Entry, tab: ConfigScope): Promise<void> {
    if (entry.clients.length === 0) {
      this.#clients.invalidate(project);
      await this.#loadClients(project);
    }
    if (this.#entries.get(project) !== entry) return;
    if (entry.clients.length === 0) {
      this.#publishLast(entry, { error: text('prompts.noClientList') });
      return;
    }
    const picked = await pickModel(text('prompts.agentModel'), entry.clients, false);
    if (picked === undefined || this.#entries.get(project) !== entry) return;
    void entry.panel.webview.postMessage({
      type: 'modelPicked',
      tab,
      client: picked.model.client,
      model: picked.model.model,
    });
  }

  /** Why a save must be refused before anything is serialized, or null (the page's disabled state is not trusted). */
  #refusal(entry: Entry, message: { tab: ConfigScope; base: SaveBase }, form: ConfigForm): string | null {
    if (entry.lastModel?.tabs[message.tab].canSave !== true) {
      return text('prompts.configUnsavable');
    }
    // A project without config.yaml is outside this page's scope: only the Local file is ever created.
    if (message.tab === 'project' && message.base.kind === 'create') {
      return text('states.configNotCreated');
    }
    return duplicateNameProblem(form);
  }

  async #save(
    project: ProjectKey,
    entry: Entry,
    message: { tab: ConfigScope; form: Record<string, unknown>; base: SaveBase },
  ): Promise<void> {
    const context = this.registry.project(project);
    if (context === undefined) {
      this.#fail(entry, text('prompts.projectGone'));
      return;
    }
    const form = configFormFromClient(message.form);
    form.schemaVersion ??= CONFIG_SCHEMA_VERSION;
    const refusal = this.#refusal(entry, message, form);
    if (refusal !== null) {
      this.#fail(entry, refusal);
      return;
    }
    const launched = await usableLaunch(this.capability, project);
    if ('message' in launched) {
      this.#fail(entry, launched.message);
      return;
    }
    this.#publishLast(entry, { error: null, isSaving: true });
    const outcome = await runAuthoringSave(launched.launch, saveArgs(message.tab, message.base), {
      cwd: context.root,
      input: configDraftFromForm(form, message.tab),
    });
    if (this.#entries.get(project) === entry) this.#settle(entry, message.tab, outcome);
  }

  #settle(entry: Entry, scope: ConfigScope, outcome: SaveOutcome): void {
    switch (outcome.kind) {
      case 'written':
        entry.record(scope, outcome.envelope.diagnostics, outcome.envelope.hash);
        this.#send(entry.identity.project, true, {
          ...transient(null),
          saved: scope,
          result: entry.nextResult(scope),
        });
        return;
      case 'unconfirmed':
        this.#fail(entry, text('prompts.saveNotConfirmed'));
        return;
      case 'conflict':
        entry.record(scope, outcome.envelope.diagnostics, entry.lastModel?.tabs[scope].hash ?? null);
        notifySaveFailed(text('prompts.fileChanged'));
        this.#publishLast(entry, { error: text('prompts.fileChanged'), result: entry.nextResult(scope) });
        return;
      case 'invalid': {
        entry.record(scope, outcome.envelope.diagnostics, entry.lastModel?.tabs[scope].hash ?? null);
        const count = entry.validation[scope].value.errors.length;
        notifySaveFailed(text('states.problemsFound', { count }));
        this.#publishLast(entry, { error: null, result: entry.nextResult(scope) });
        return;
      }
      case 'failed':
        this.#fail(entry, outcome.message);
    }
  }

  #fail(entry: Entry, message: string): void {
    notifySaveFailed(message);
    this.#publishLast(entry, { error: message });
  }

  /** Repost the shown model with the current diagnostics, a save in flight or one error line. */
  #publishLast(
    entry: Entry,
    state: { error: string | null; isSaving?: boolean; result?: Transient['result'] },
  ): void {
    if (entry.lastModel === null) return;
    entry.publish(this.#withValidation(entry, entry.lastModel), true, {
      ...transient(state.error, state.isSaving === true),
      ...(state.result === undefined ? {} : { result: state.result }),
    });
  }

  #withValidation(entry: Entry, model: ConfigModel): ConfigModel {
    const tabs = { ...model.tabs };
    for (const scope of ['project', 'local'] as const) {
      const kept = entry.validation[scope];
      if (kept.hash !== null && tabs[scope].hash !== kept.hash) entry.setValidation(scope, EMPTY_VALIDATION, null);
      tabs[scope] = { ...tabs[scope], validation: entry.validation[scope].value };
    }
    return { ...model, tabs };
  }

  async #loadClients(project: ProjectKey): Promise<void> {
    const context = this.registry.project(project);
    if (context === undefined) return;
    const clients = await this.#clients.get(context);
    const entry = this.#entries.get(project);
    if (entry === undefined) return;
    entry.clients = clients;
    this.#send(project, true);
  }

  #model(project: ProjectKey, entry: Entry): ConfigModel {
    const context = this.registry.project(project);
    if (context === undefined) {
      const gone = (scope: ConfigScope): ConfigTabModel => ({
        ...readConfigTab('', scope),
        state: 'unreadable',
        readError: text('prompts.projectGone'),
        canSave: false,
      });
      const tabs = { project: gone('project'), local: gone('local') };
      return { project, tab: entry.identity.tab, tabs, clients: [], agentNames: [] };
    }
    const tabs = { project: readConfigTab(context.root, 'project'), local: readConfigTab(context.root, 'local') };
    return {
      project: context.folder.name,
      tab: entry.identity.tab,
      tabs,
      clients: entry.clients,
      agentNames: effectiveAgentNames(tabs.project.form, tabs.local.form),
    };
  }

  #send(project: ProjectKey, isForced: boolean, state?: Transient): void {
    const entry = this.#entries.get(project);
    if (entry === undefined) return;
    entry.publish(this.#withValidation(entry, this.#model(project, entry)), isForced, state);
  }

  #onChange(change: MigentChange): void {
    for (const project of this.#entries.keys()) {
      const isMatch =
        change.type === 'projects' ||
        change.type === 'refresh' ||
        (change.type === 'project' && change.kind === 'config' && change.project === project);
      if (isMatch) this.#send(project, false);
    }
  }
}
