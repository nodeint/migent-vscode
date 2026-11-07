import * as vscode from 'vscode';

import type { ProviderChoice } from '../../core/controlArgs';
import { workflowDraftPath } from '../../core/paths';
import { SESSION_ACTIONS } from '../../core/resultsIntent';
import { readSessionWorkflow, type SessionWorkflowModel } from '../../core/sessionWorkflow';
import type { CapabilityService } from '../capability';
import type { MigentChange, ProjectKey } from '../changes';
import { pickModel } from '../modelPicker';
import { openFile } from '../openFile';
import type { ProjectRegistry } from '../projects';
import { SESSION_ACTION_COMMANDS } from '../results/panels';
import { type PageDescriptor, pageResourceRoots, renderPage } from '../webview/page';
import { ProviderCatalog } from '../workflowEditor/providerList';

export const SESSION_WORKFLOW_VIEW_TYPE = 'migent.sessionWorkflow';

const PAGE: PageDescriptor = {
  folder: 'sessionworkflow',
  styles: ['sessionworkflow.css'],
  scripts: ['sessionworkflow.js'],
  title: 'Session workflow',
  modules: { folder: 'workfloweditor', styles: ['workfloweditor.css'], scripts: ['workflowform.js'] },
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

const keyOf = (identity: SessionWorkflowIdentity): string => `${identity.project}#${identity.sessionId}`;

class Entry {
  public revision = 0;
  public providers: ProviderChoice[] = [];
  public lastModel: SessionWorkflowModel | null = null;
  #lastJson: string | null = null;
  constructor(
    public readonly identity: SessionWorkflowIdentity,
    public readonly panel: vscode.WebviewPanel,
  ) {}

  public publish(model: SessionWorkflowModel, isForced: boolean): void {
    const json = JSON.stringify(model);
    if (!isForced && json === this.#lastJson) return;
    this.#lastJson = json;
    this.lastModel = model;
    this.revision += 1;
    this.panel.title = `Session workflow: ${model.id || model.sessionId.slice(0, SHORT_ID)}`;
    void this.panel.webview.postMessage({ type: 'model', revision: this.revision, identity: this.identity, model });
  }
}

/**
 * Session workflow pages: one per `(project, session)`. They show the session's own `workflow.yaml` as the shared
 * workflow form and lock every field once a stage has run. Saving is not available yet.
 */
export class SessionWorkflowPanels implements vscode.Disposable {
  readonly #entries = new Map<string, Entry>();
  readonly #providers: ProviderCatalog;
  readonly #subscriptions: vscode.Disposable[];

  constructor(
    private readonly registry: ProjectRegistry,
    capability: CapabilityService,
    private readonly extensionUri: vscode.Uri,
  ) {
    this.#providers = new ProviderCatalog(capability);
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
    this.#providers.dispose();
    for (const entry of [...this.#entries.values()]) entry.panel.dispose();
    this.#entries.clear();
    for (const subscription of this.#subscriptions.splice(0)) subscription.dispose();
  }

  #options(): vscode.WebviewOptions {
    return { enableScripts: true, localResourceRoots: pageResourceRoots(this.extensionUri, PAGE) };
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
    void this.#loadProviders(identity);
  }

  /** Handle a page message; only a closed set is understood. */
  public async handle(identity: SessionWorkflowIdentity, raw: unknown): Promise<void> {
    const entry = this.#entries.get(keyOf(identity));
    const message = typeof raw === 'object' && raw !== null ? (raw as { type?: unknown; intent?: unknown; action?: unknown }) : {};
    const { type } = message;
    const context = this.registry.project(identity.project);
    if (entry === undefined || context === undefined) return;
    switch (type) {
      case 'ready':
      case 'reload':
        this.#send(identity, true);
        return;
      case 'intent':
        await this.#sessionAction(identity, message);
        return;
      case 'openFile':
        await openFile(workflowDraftPath(context.root, identity.sessionId), 'workflow.yaml');
        return;
      case 'pickModel': {
        if (entry.providers.length === 0) return;
        const picked = await pickModel('Inline agent model', entry.providers, false);
        if (picked === undefined) return;
        void entry.panel.webview.postMessage({
          type: 'modelPicked',
          provider: picked.model.provider,
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
    await vscode.commands.executeCommand(command, { project: identity.project, sessionId: identity.sessionId });
  }

  async #loadProviders(identity: SessionWorkflowIdentity): Promise<void> {
    const context = this.registry.project(identity.project);
    if (context === undefined) return;
    const providers = await this.#providers.get(context);
    const entry = this.#entries.get(keyOf(identity));
    if (entry === undefined) return;
    entry.providers = providers;
    this.#send(identity, true);
  }

  #send(identity: SessionWorkflowIdentity, isForced: boolean): void {
    const entry = this.#entries.get(keyOf(identity));
    const context = this.registry.project(identity.project);
    if (entry === undefined || context === undefined) return;
    entry.publish(
      readSessionWorkflow({
        projectKey: identity.project,
        projectName: context.folder.name,
        projectRoot: context.root,
        sessionId: identity.sessionId,
        snapshot: context.store.snapshot(identity.sessionId),
        scan: context.catalog.workflows(),
        config: context.catalog.config(),
        providers: entry.providers,
      }),
      isForced,
    );
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
