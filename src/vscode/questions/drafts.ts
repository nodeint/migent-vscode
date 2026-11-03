import type * as vscode from 'vscode';

import type { PendingQuestion } from '../../core/model';
import type { BatchDraft } from '../../core/questionAnswers';
import { type BatchIdentity, batchKeyOf } from './entry';

const DRAFT_PREFIX = 'migent.answerDraft:';
const ARCHIVE_PREFIX = 'migent.answerArchive:';

/** A batch with its draft. `fingerprint` is the content identity of `questions`. */
export interface StoredDraft {
  fingerprint: string;
  questions: PendingQuestion[];
  draft: BatchDraft;
}

/** Host-owned durable drafts in workspace state, outside `.migent/`. */
export class DraftStore {
  readonly #state: vscode.Memento;
  readonly #pending = new Set<Promise<void>>();

  constructor(state: vscode.Memento) {
    this.#state = state;
  }

  public load(id: BatchIdentity): StoredDraft | undefined {
    return this.#state.get<StoredDraft>(DRAFT_PREFIX + batchKeyOf(id));
  }

  /** Every write is tracked so callers can wait for durability and see failures. */
  async #track(write: Thenable<void>): Promise<void> {
    const pending = Promise.resolve(write);
    this.#pending.add(pending);
    try {
      await pending;
    } finally {
      this.#pending.delete(pending);
    }
  }

  /** Resolves when every write issued so far has finished; rejects with the first failure. */
  public async settle(): Promise<void> {
    await Promise.all([...this.#pending]);
  }

  public save(id: BatchIdentity, stored: StoredDraft): Promise<void> {
    return this.#track(this.#state.update(DRAFT_PREFIX + batchKeyOf(id), stored));
  }

  public delete(id: BatchIdentity): Promise<void> {
    return this.#track(this.#state.update(DRAFT_PREFIX + batchKeyOf(id), undefined));
  }

  /** The batch and draft replaced by "Load current questions". */
  public loadArchive(id: BatchIdentity): StoredDraft | undefined {
    return this.#state.get<StoredDraft>(ARCHIVE_PREFIX + batchKeyOf(id));
  }

  public saveArchive(id: BatchIdentity, stored: StoredDraft): Promise<void> {
    return this.#track(this.#state.update(ARCHIVE_PREFIX + batchKeyOf(id), stored));
  }
}
