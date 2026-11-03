import type * as vscode from 'vscode';

import type { AnswerModel, AnswerState } from '../../core/answerModel';
import type { StateUpdate } from '../../core/answerState';
import type { PendingQuestion } from '../../core/model';
import { type AnswerDraft, type BatchDraft, batchFingerprint, type ReplyMap } from '../../core/questionAnswers';
import type { ProjectKey } from '../changes';

const DRAFT_DEBOUNCE_MS = 300;
const EDITABLE: ReadonlySet<AnswerState> = new Set(['editing', 'rejected', 'unconfirmed']);

export const batchKeyOf = (id: BatchIdentity): string =>
  `${id.project}#${id.sessionId}#${id.stageId ?? ''}#${id.executionId}`;

/** The exact batch a panel is bound to. Every async step carries it; nothing re-resolves "the current session". */
export interface BatchIdentity {
  project: ProjectKey;
  sessionId: string;
  stageId: string | null;
  executionId: string;
}

export interface EntryInit {
  identity: BatchIdentity;
  panel: vscode.WebviewPanel;
  questions: PendingQuestion[];
  draft: BatchDraft;
}

/** One open panel: the batch it shows, its local draft and where its submission stands. */
export class Entry {
  public readonly identity: BatchIdentity;
  public readonly panel: vscode.WebviewPanel;
  public revision = 0;
  /** Bumped whenever the host replaces the draft, so a delayed edit from before it can be dropped. */
  public generation = 0;
  /** The batch and draft replaced by Load current questions, kept read-only for reference. */
  public archive: { questions: PendingQuestion[]; draft: BatchDraft } | null = null;
  public state: AnswerState = 'editing';
  public message: string | null = null;
  public questions: PendingQuestion[];
  public fingerprint: string;
  public draft: BatchDraft;
  /** The reply of an uncertain submission, kept for Recheck. */
  public submitted: ReplyMap | null = null;
  public lastModel: AnswerModel | null = null;
  /** Why the last attempt to persist the draft failed; null once a save succeeded. */
  public saveError: string | null = null;
  #saveTimer: ReturnType<typeof setTimeout> | null = null;
  /** Counts every change to the draft; a save makes durable only the revision it started with. */
  #draftRevision = 0;
  #savedRevision = 0;
  readonly #save: (entry: Entry) => Promise<void>;
  readonly #onSaved: () => void;

  constructor(init: EntryInit, save: (entry: Entry) => Promise<void>, onSaved: () => void) {
    this.#save = save;
    this.#onSaved = onSaved;
    this.identity = init.identity;
    this.panel = init.panel;
    this.questions = init.questions;
    this.fingerprint = batchFingerprint(init.questions);
    this.draft = init.draft;
  }

  public get isEditable(): boolean {
    return EDITABLE.has(this.state);
  }

  public move(update: StateUpdate | null): void {
    if (update === null) return;
    this.state = update.state;
    this.message = update.message;
  }

  public clearDraft(): void {
    this.draft = {};
    this.generation += 1;
    this.#draftRevision += 1;
  }

  /** Whether the current draft is not yet in durable storage. */
  public get isUnsaved(): boolean {
    return this.#draftRevision > this.#savedRevision;
  }

  public setMessage(message: string | null): void {
    this.message = message;
  }

  public setSubmitted(reply: ReplyMap | null): void {
    this.submitted = reply;
  }

  /** Remember a model that was posted (its revision is already `revision + 1`). */
  public accept(model: AnswerModel): void {
    this.revision = model.revision;
    this.lastModel = model;
  }

  /** Keep the batch and draft that are about to be replaced. */
  public archiveCurrent(): { questions: PendingQuestion[]; draft: BatchDraft } {
    this.archive = { questions: this.questions, draft: this.draft };
    return this.archive;
  }

  public setTitle(title: string): void {
    this.panel.title = title;
  }

  public setDraft(questionId: string, value: AnswerDraft): void {
    this.draft = { ...this.draft, [questionId]: value };
    this.#draftRevision += 1;
  }

  /** Adopt the current batch. Old answers are not transferred to the new question numbers. */
  public replaceBatch(questions: PendingQuestion[]): void {
    this.questions = questions;
    this.fingerprint = batchFingerprint(questions);
    this.draft = {};
    this.generation += 1;
    this.#draftRevision += 1;
    this.move({ state: 'editing', message: null });
  }

  /** Mark the draft as not yet durable, e.g. one carried over from a panel whose close-time save failed. */
  public markUnsaved(): void {
    this.#draftRevision += 1;
  }

  public schedule(): void {
    if (this.#saveTimer !== null) clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => {
      this.#saveTimer = null;
      void this.persist().then(this.#onSaved);
    }, DRAFT_DEBOUNCE_MS);
  }

  /**
   * Write the draft to durable storage and wait for the result. A failure keeps the draft in memory (and marked
   * unsaved) and is returned, so the caller can refuse to go on.
   */
  public async persist(): Promise<string | null> {
    const started = this.#draftRevision;
    try {
      // The draft is read synchronously by the save, so it holds exactly revision `started`.
      await this.#save(this);
      this.#savedRevision = Math.max(this.#savedRevision, started);
      if (!this.isUnsaved) this.saveError = null;
    } catch (error) {
      this.saveError = error instanceof Error ? error.message : String(error);
    }
    return this.isUnsaved ? (this.saveError ?? 'The draft changed while it was being saved.') : null;
  }

  /** Persist now until nothing is unsaved (before submission or disposal). Null means durable. */
  public async flush(): Promise<string | null> {
    if (this.#saveTimer !== null) clearTimeout(this.#saveTimer);
    this.#saveTimer = null;
    while (this.isUnsaved) {
      await this.persist();
      if (this.saveError !== null) return this.saveError;
    }
    return null;
  }
}

/** Whether `value` is a well-formed batch identity (a command argument, restored panel state). */
export function isBatchIdentity(value: unknown): value is BatchIdentity {
  if (typeof value !== 'object' || value === null) return false;
  const { project, sessionId, stageId, executionId } = value as Partial<BatchIdentity>;
  const isStage = typeof stageId === 'string' || stageId === null;
  const isText = [project, sessionId, executionId].every((part) => typeof part === 'string' && part !== '');
  return isText && isStage;
}
