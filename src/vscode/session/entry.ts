import type * as vscode from 'vscode';

import type { AnswerModel } from '../../core/answerModel';
import type { ClientChoice } from '../../core/controlArgs';
import { type SessionPageModel, sessionPageTitle, type SessionTab } from '../../core/sessionPageModel';
import type { SessionWorkflowModel } from '../../core/sessionWorkflow';
import { EMPTY_VALIDATION } from '../authoringSave';
import type { ProjectKey } from '../changes';
import type { ProjectContext } from '../projects';
import type { BatchIdentity } from '../questions/entry';
import type { Releasable } from '../watchBackend';
import { tabIcon } from '../webview/page';

export interface Identity {
  project: ProjectKey;
  sessionId: string;
}

/** What a restored panel remembers: its session, the tab it showed and the selected batch. */
export interface RestoredState extends Identity {
  tab?: unknown;
  stageId?: unknown;
  executionId?: unknown;
}

export function keyOf(identity: Identity): string {
  return `${identity.project}#${identity.sessionId}`;
}

export function isIdentity(value: unknown): value is Identity {
  if (typeof value !== 'object' || value === null) return false;
  const { project, sessionId } = value as Partial<Identity>;
  return typeof project === 'string' && typeof sessionId === 'string' && project !== '' && sessionId !== '';
}

export const isTab = (value: unknown): value is SessionTab =>
  value === 'questions' || value === 'overview' || value === 'metrics' || value === 'workflow';

export interface Retained {
  watcher: ProjectContext['watcher'];
  handle: Releasable;
}

export interface Transient {
  saving: boolean;
  applying: boolean;
  error: string | null;
}

export const transient = (error: string | null, isSaving = false): Transient => ({
  saving: isSaving,
  applying: false,
  error,
});

export interface EntryInit {
  identity: Identity;
  panel: vscode.WebviewPanel;
  tab: SessionTab;
  batch: BatchIdentity | null;
  extensionUri: vscode.Uri;
}

/** The editor-tab icon file of a tab; the Workflow tab has no icon of its own. */
function iconOf(tab: SessionTab): 'questions' | 'overview' | 'metrics' {
  if (tab === 'questions') return 'questions';
  if (tab === 'metrics') return 'metrics';
  return 'overview';
}

/** One open Session panel and what was last posted to it. */
export class Entry {
  public readonly project: ProjectKey;
  public readonly sessionId: string;
  public readonly panel: vscode.WebviewPanel;
  public tab: SessionTab;
  public questionBatch: BatchIdentity | null = null;
  public lastAnswerModel: AnswerModel | null = null;
  public clients: ClientChoice[] = [];
  public validation: SessionWorkflowModel['validation'] = EMPTY_VALIDATION;
  public validationHash: string | null = null;
  public revision = 0;
  public lastModel: SessionPageModel | null = null;
  readonly #extensionUri: vscode.Uri;
  #lastJson: string | null = null;
  #saving = false;
  #retained: Retained | null = null;

  constructor(init: EntryInit) {
    this.project = init.identity.project;
    this.sessionId = init.identity.sessionId;
    this.panel = init.panel;
    this.tab = init.tab;
    this.questionBatch = init.batch;
    this.#extensionUri = init.extensionUri;
  }

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

  public beginSave(): boolean {
    if (this.#saving) return false;
    this.#saving = true;
    return true;
  }

  public endSave(): void {
    this.#saving = false;
  }

  public setValidation(validation: SessionWorkflowModel['validation'], hash: string | null): void {
    this.validation = validation;
    this.validationHash = hash;
  }

  /** Move to a tab and, when the caller picked one, to a batch. */
  public setTab(tab: SessionTab, batch: BatchIdentity | null): void {
    this.tab = tab;
    this.questionBatch = batch;
  }

  public setBatch(batch: BatchIdentity | null): void {
    this.questionBatch = batch;
  }

  public setAnswerModel(model: AnswerModel | null): void {
    this.lastAnswerModel = model;
  }

  public setClients(clients: ClientChoice[]): void {
    this.clients = clients;
  }

  /**
   * Post a model. A forced publish still sends an unchanged model because a freshly loaded webview may have
   * missed the earlier message, but it keeps the same revision: the page's revision counter restarts after a
   * reload, while a live page has already rendered that revision.
   */
  public publish(model: SessionPageModel, isForced: boolean, state?: Transient): void {
    const json = JSON.stringify(model) + (state === undefined ? '' : JSON.stringify(state));
    const isChanged = json !== this.#lastJson;
    if (!isForced && !isChanged) return;
    this.#lastJson = json;
    this.lastModel = model;
    if (isChanged) this.revision += 1;
    this.panel.title = sessionPageTitle(model.header);
    this.panel.iconPath = tabIcon(this.#extensionUri, iconOf(model.tab), model.header.state);
    void this.panel.webview.postMessage({
      type: 'model',
      revision: this.revision,
      identity: { project: this.project, sessionId: this.sessionId },
      model,
      ...(state === undefined ? {} : { transient: state }),
    });
  }
}
