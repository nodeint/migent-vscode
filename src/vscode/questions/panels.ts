import * as vscode from 'vscode';

import { type AnswerModel, buildAnswerModel, parseAnswerMessage } from '../../core/answerModel';
import { refreshBatchState } from '../../core/answerState';
import { listExecutions } from '../../core/executions';
import type { PendingQuestion, SessionSnapshot } from '../../core/model';
import { questionsPath, sessionDir } from '../../core/paths';
import {
  type AnswerDraft,
  batchFingerprint,
  type Reconciliation,
  type ReplyMap,
  serializeAnswers,
  verifyBatch,
} from '../../core/questionAnswers';
import { type QuestionRecord, type QuestionsRead, readQuestions } from '../../core/questions';
import { titleCase } from '../../core/resultsModel';
import { buildSessionMeta } from '../../core/sessionMeta';
import { sessionTitle, truncate } from '../../core/sessionPresentation';
import type { AnswerRequest, AnswerSubmitter } from '../answers';
import type { MigentChange } from '../changes';
import type { ControlService } from '../control';
import { openFile } from '../openFile';
import type { ProjectContext, ProjectRegistry } from '../projects';
import { SESSION_ACTION_COMMANDS } from '../results/panels';
import { type PageDescriptor, pageResourceRoots, renderPage, tabIcon } from '../webview/page';
import { DraftStore } from './drafts';
import { type BatchIdentity, batchKeyOf, Entry, isBatchIdentity } from './entry';

export type { BatchIdentity } from './entry';

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const workflowIdOf = (snapshot: SessionSnapshot | undefined): string | null =>
  snapshot?.status?.workflowId ?? snapshot?.manifest?.workflowId ?? null;

export const ANSWER_VIEW_TYPE = 'migent.answerQuestions';

const TITLE_MAX = 32;
const PAGE: PageDescriptor = {
  folder: 'questions',
  styles: ['questions.css'],
  scripts: ['questions.js'],
  title: 'Questions',
};
const WAITING = 'Loading the project…';

/** Pending records of one batch, in stored order. */
export function pendingBatch(snapshot: SessionSnapshot | undefined, id: BatchIdentity): PendingQuestion[] {
  return (snapshot?.status?.questions ?? []).filter(
    (question) => question.executionId === id.executionId && question.stageId === id.stageId,
  );
}

interface EditMessage {
  generation: number;
  fingerprint: string;
  questionId: string;
  draft: AnswerDraft;
}

/** A decided (or still unconfirmed) submission, ready to show. */
interface Settled {
  reconciliation: Reconciliation;
  stderrLast: string | null;
  cleanupError: string | null;
}

interface Resolved {
  context: ProjectContext;
  snapshot: SessionSnapshot | undefined;
}

/** The collaborators a panel set needs besides the registry. */
export interface AnswerServices {
  control: ControlService;
  submitter: AnswerSubmitter;
}

/**
 * Answer panels for pending human questions: one per `(project, session, stage, execution)`. The host
 * owns drafts, validation, the CLI call and reconciliation; the page only edits and asks (§9).
 */
export class AnswerPanels implements vscode.Disposable {
  readonly #registry: ProjectRegistry;
  readonly #control: ControlService;
  readonly #submitter: AnswerSubmitter;
  readonly #context: vscode.ExtensionContext;
  readonly #drafts: DraftStore;
  readonly #entries = new Map<string, Entry>();
  readonly #dirty = new Set<string>();
  /** Closed panels whose draft could not be saved; the draft is not lost until storage accepts it. */
  readonly #unsaved = new Map<string, Entry>();
  readonly #subscriptions: vscode.Disposable[];
  #flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(registry: ProjectRegistry, services: AnswerServices, context: vscode.ExtensionContext) {
    this.#registry = registry;
    this.#control = services.control;
    this.#submitter = services.submitter;
    this.#context = context;
    this.#drafts = new DraftStore(context.workspaceState);
    this.#subscriptions = [
      registry.onDidChange((change) => {
        this.#onChange(change);
      }),
      vscode.window.registerWebviewPanelSerializer(ANSWER_VIEW_TYPE, {
        deserializeWebviewPanel: (panel, state: unknown) => {
          this.#restore(panel, state);
          return Promise.resolve();
        },
      }),
    ];
  }

  /** Open panels (for tests). */
  public get count(): number {
    return this.#entries.size;
  }

  public lastModel(identity: BatchIdentity): AnswerModel | null {
    return this.#entries.get(batchKeyOf(identity))?.lastModel ?? null;
  }

  /** Open the panel for a batch, or reveal the one that exists. Never called by a background change. */
  public open(identity: BatchIdentity): void {
    const existing = this.#entries.get(batchKeyOf(identity));
    if (existing !== undefined) {
      existing.panel.reveal(existing.panel.viewColumn ?? vscode.ViewColumn.Active);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      ANSWER_VIEW_TYPE,
      'Questions',
      vscode.ViewColumn.Active,
      this.#webviewOptions(),
    );
    this.#adopt(panel, identity);
  }

  public dispose(): void {
    if (this.#flushTimer !== null) clearTimeout(this.#flushTimer);
    for (const entry of [...this.#entries.values()]) entry.panel.dispose();
    this.#entries.clear();
    for (const subscription of this.#subscriptions.splice(0)) subscription.dispose();
  }

  #webviewOptions(): vscode.WebviewPanelOptions & vscode.WebviewOptions {
    return {
      enableScripts: true,
      localResourceRoots: pageResourceRoots(this.#context.extensionUri, PAGE),
    };
  }

  #restore(panel: vscode.WebviewPanel, state: unknown): void {
    if (!isBatchIdentity(state) || this.#entries.has(batchKeyOf(state))) {
      panel.dispose();
      return;
    }
    // eslint-disable-next-line no-param-reassign -- a restored panel gets the same options as a new one
    panel.webview.options = this.#webviewOptions();
    this.#adopt(panel, state);
  }

  #resolve(identity: BatchIdentity): Resolved | undefined {
    const context = this.#registry.project(identity.project);
    return context === undefined ? undefined : { context, snapshot: context.store.snapshot(identity.sessionId) };
  }

  #saveDraft(entry: Entry): Promise<void> {
    return this.#drafts.save(entry.identity, {
      fingerprint: entry.fingerprint,
      questions: entry.questions,
      draft: entry.draft,
    });
  }

  #makeEntry(panel: vscode.WebviewPanel, identity: BatchIdentity): Entry {
    const current = pendingBatch(this.#resolve(identity)?.snapshot, identity);
    const kept = this.#unsaved.get(batchKeyOf(identity));
    this.#unsaved.delete(batchKeyOf(identity));
    const stored = kept === undefined ? this.#drafts.load(identity) : { questions: kept.questions, draft: kept.draft };
    const entry = new Entry(
      { identity, panel, questions: stored?.questions ?? current, draft: stored?.draft ?? {} },
      (target) => this.#saveDraft(target),
      () => {
        const open = this.#entries.get(batchKeyOf(identity));
        if (open !== undefined) this.#publish(open, false);
      },
    );
    const archived = this.#drafts.loadArchive(identity);
    if (archived !== undefined) entry.archive = { questions: archived.questions, draft: archived.draft };
    if (kept !== undefined) {
      entry.markUnsaved();
      entry.schedule();
    }
    this.#sync(entry);
    this.#restoreUncertain(entry);
    return entry;
  }

  /** An unconfirmed submission survives a closed panel or a reload: restore it before anything can be sent. */
  #restoreUncertain(entry: Entry): void {
    const reply = this.#submitter.pending(batchKeyOf(entry.identity));
    if (reply === null) return;
    entry.setSubmitted(reply);
    entry.move({ state: 'unconfirmed', message: 'Could not confirm that your answers arrived. Check again before sending them a second time.' });
  }

  #adopt(panel: vscode.WebviewPanel, identity: BatchIdentity): void {
    const entry = this.#makeEntry(panel, identity);
    const key = batchKeyOf(identity);
    this.#entries.set(key, entry);
    // eslint-disable-next-line no-param-reassign -- the panel is created by this host and owned by the entry
    panel.webview.html = renderPage(panel.webview, this.#context.extensionUri, PAGE);
    panel.webview.onDidReceiveMessage((raw: unknown) => {
      void this.handle(identity, raw);
    });
    panel.onDidDispose(() => {
      this.#entries.delete(key);
      this.#dirty.delete(key);
      void this.#retainIfUnsaved(key, entry);
    });
    this.#publish(entry, true);
  }

  /** A draft whose close-time save failed stays in memory and is adopted by the next panel for the batch. */
  async #retainIfUnsaved(key: string, entry: Entry): Promise<void> {
    if ((await entry.flush()) === null) return;
    this.#unsaved.set(key, entry);
  }

  /** Handle a page message for the panel of `identity`. Public so tests can drive it without a webview. */
  public async handle(identity: BatchIdentity, raw: unknown): Promise<void> {
    const entry = this.#entries.get(batchKeyOf(identity));
    const message = parseAnswerMessage(raw);
    if (entry === undefined || message === null) return;
    switch (message.type) {
      case 'edit':
        this.#edit(entry, message);
        return;
      case 'submit':
        if (message.revision === entry.revision && message.fingerprint === entry.fingerprint) await this.#submit(entry);
        else this.#publish(entry, true);
        return;
      case 'sessionAction':
        await this.#runSessionCommand(entry, SESSION_ACTION_COMMANDS[message.action]);
        return;
      default:
        await this.#command(entry, message.type);
    }
  }

  async #command(entry: Entry, type: string): Promise<void> {
    switch (type) {
      case 'reload':
        await this.#reload(entry);
        return;
      case 'discard':
        await this.#discard(entry);
        return;
      case 'recheck':
        await this.#recheck(entry);
        return;
      case 'continue':
        await this.#continue(entry);
        return;
      case 'viewLog':
        this.#control.showLog();
        return;
      case 'openQuestions':
        await this.#openQuestions(entry);
        return;
      case 'later':
        entry.panel.dispose();
        return;
      case 'openResults':
        await this.#runSessionCommand(entry, 'migent.session.openResult');
        return;
      case 'openMetrics':
        await this.#runSessionCommand(entry, SESSION_ACTION_COMMANDS.openMetrics);
        return;
      default:
        this.#publish(entry, true);
    }
  }

  /** A session command always receives this panel's own session, never the active panel or a picker. */
  async #runSessionCommand(entry: Entry, command: string): Promise<void> {
    const { project, sessionId } = entry.identity;
    await vscode.commands.executeCommand(command, { project, sessionId });
  }

  async #openQuestions(entry: Entry): Promise<void> {
    const resolved = this.#resolve(entry.identity);
    if (resolved === undefined) return;
    await openFile(questionsPath(resolved.context.root, entry.identity.sessionId), 'questions.json');
  }

  #edit(entry: Entry, message: EditMessage): void {
    // A late message from an older view, an older draft generation or another batch is dropped.
    const isKnown = entry.questions.some((question) => question.id === message.questionId);
    const isCurrent = message.fingerprint === entry.fingerprint && message.generation === entry.generation;
    if (!isCurrent || !entry.isEditable || !isKnown) {
      this.#publish(entry, true);
      return;
    }
    entry.setDraft(message.questionId, message.draft);
    entry.schedule();
    this.#publish(entry, false);
  }

  async #reload(entry: Entry): Promise<void> {
    const current = pendingBatch(this.#resolve(entry.identity)?.snapshot, entry.identity);
    if (current.length === 0 || entry.state !== 'stale') return;
    // The old batch and draft are archived durably before the current questions replace them.
    const old = { questions: entry.questions, draft: entry.draft };
    try {
      await this.#drafts.saveArchive(entry.identity, {
        fingerprint: batchFingerprint(old.questions),
        questions: old.questions,
        draft: old.draft,
      });
    } catch (error) {
      entry.setMessage(`The old draft could not be archived (${describeError(error)}), so the questions were not replaced.`);
      this.#publish(entry, true);
      return;
    }
    entry.archiveCurrent();
    entry.replaceBatch(current);
    await entry.persist();
    this.#publish(entry, true);
  }

  async #discard(entry: Entry): Promise<void> {
    if (!entry.isEditable && entry.state !== 'stale') return;
    const pick = await vscode.window.showWarningMessage(
      'Discard the saved answers for this batch?',
      { modal: true },
      'Discard draft',
    );
    if (pick !== 'Discard draft') return;
    entry.clearDraft();
    try {
      await this.#drafts.delete(entry.identity);
    } catch (error) {
      entry.setMessage(`The draft could not be deleted: ${describeError(error)}`);
    }
    this.#publish(entry, true);
  }

  async #continue(entry: Entry): Promise<void> {
    const resolved = this.#resolve(entry.identity);
    if (resolved?.snapshot === undefined) return;
    // Continue without the reply file: recorded answers are never submitted again.
    await this.#control.continueSession(resolved.context, resolved.snapshot);
  }

  #request(entry: Entry, context: ProjectContext, reply: ReplyMap): AnswerRequest {
    const { identity } = entry;
    return {
      context,
      sessionId: identity.sessionId,
      target: { stageId: identity.stageId, executionId: identity.executionId },
      reply,
      cliStage: context.store.snapshot(identity.sessionId)?.manifest?.role ? null : identity.stageId,
      fingerprint: entry.fingerprint,
      batchKey: batchKeyOf(identity),
    };
  }

  async #recheck(entry: Entry): Promise<void> {
    const resolved = this.#resolve(entry.identity);
    if (resolved === undefined || entry.submitted === null) {
      this.#publish(entry, true);
      return;
    }
    const { reconciliation, cleanupError } = await this.#submitter.recheck(
      this.#request(entry, resolved.context, entry.submitted),
    );
    this.#apply(entry, { reconciliation, stderrLast: null, cleanupError });
  }

  #readHistory(entry: Entry): QuestionsRead | null {
    const resolved = this.#resolve(entry.identity);
    return resolved === undefined ? null : readQuestions(sessionDir(resolved.context.root, entry.identity.sessionId));
  }

  /**
   * The reason Send is unavailable, or null. The whole authoritative batch is verified (a supported question
   * file, consistent membership, human recipients, the exact content shown), then the CLI and lock.
   * Draft editing stays possible either way.
   */
  #blockReason(entry: Entry, resolved: Resolved | undefined): string | null {
    const history = this.#readHistory(entry);
    if (resolved?.snapshot === undefined || history === null) return 'The session is not available.';
    const { executionId, stageId } = entry.identity;
    const verified = verifyBatch({
      summary: resolved.snapshot.status?.questions ?? [],
      history,
      target: { executionId, stageId },
      fingerprint: entry.fingerprint,
    });
    if (verified.kind !== 'ok') return verified.reason;
    return this.#control.answerBlock(resolved.context, resolved.snapshot);
  }

  /** The reply to send and where, or null with the reason left on the entry. */
  #prepareSubmit(entry: Entry): { context: ProjectContext; reply: ReplyMap } | null {
    const resolved = this.#resolve(entry.identity);
    const reply = serializeAnswers(entry.questions, entry.draft);
    const reason = this.#blockReason(entry, resolved);
    if (reply === null || reason !== null || resolved === undefined) {
      entry.setMessage(reason ?? 'Answer every question to send.');
      return null;
    }
    return { context: resolved.context, reply };
  }

  /** Sending waits until the draft is durable, so a storage failure cannot lose answers. */
  async #isDraftSaved(entry: Entry): Promise<boolean> {
    const unsaved = await entry.flush();
    if (unsaved === null) return true;
    entry.setMessage(`Your draft could not be saved (${unsaved}), so nothing was sent.`);
    return false;
  }

  async #submit(entry: Entry): Promise<void> {
    const before = { state: entry.state };
    if (before.state !== 'editing' && before.state !== 'rejected') return;
    // The sending state is set before the first await, so a second Submit cannot start a competing call.
    entry.move({ state: 'sending', message: 'Sending your answers…' });
    this.#publish(entry, true);
    const prepared = (await this.#isDraftSaved(entry)) ? this.#prepareSubmit(entry) : null;
    if (prepared === null) {
      // The failure reason is already on the entry; only the state goes back.
      entry.move({ state: before.state, message: entry.message });
      this.#publish(entry, true);
      return;
    }
    entry.setSubmitted(prepared.reply);
    const result = await this.#submitter.submit(this.#request(entry, prepared.context, prepared.reply));
    if (result.kind === 'done') {
      this.#apply(entry, result);
      return;
    }
    const message = result.kind === 'blocked' ? result.reason : `Could not start the Migent CLI: ${result.detail}`;
    entry.move({ state: 'editing', message });
    entry.setSubmitted(null);
    // A blocked send often means the batch moved: let persisted state decide whether it is now stale.
    this.#sync(entry, message);
    this.#publish(entry, true);
  }

  #apply(entry: Entry, settled: Settled): void {
    const { reconciliation: outcome, stderrLast, cleanupError } = settled;
    if (outcome.kind === 'recorded') {
      const note = cleanupError === null ? '' : ` A saved copy could not be removed (${cleanupError}). Reopen this page and press Check again to retry.`;
      entry.move({ state: 'recorded', message: `Answers sent.${note}` });
      // The exact submitted snapshot is archived; later edits would belong to a new batch.
      void this.#drafts.delete(entry.identity).catch(() => undefined);
      this.#sync(entry);
    } else if (outcome.kind === 'pending') {
      const detail = stderrLast === null ? '' : ` ${stderrLast}`;
      entry.move({ state: 'rejected', message: `Your answers were not accepted.${detail}` });
    } else if (outcome.kind === 'answered-elsewhere') {
      entry.move({ state: 'answered-elsewhere', message: 'These questions were already answered somewhere else.' });
    } else {
      entry.move({ state: 'unconfirmed', message: 'Could not confirm that your answers arrived. Check again before sending them a second time.' });
    }
    if (outcome.kind !== 'unconfirmed') entry.setSubmitted(null);
    this.#publish(entry, true);
  }

  #stateInput(entry: Entry, resolved: Resolved): Parameters<typeof refreshBatchState>[0] {
    const { identity } = entry;
    const history = this.#readHistory(entry);
    const dir = sessionDir(resolved.context.root, identity.sessionId);
    const running = (resolved.snapshot?.status?.runningStages ?? []).flatMap((stage) =>
      stage.executionId === null || stage.stageId === null ? [] : [{ id: stage.executionId, stage: stage.stageId }],
    );
    return {
      state: entry.state,
      fingerprint: entry.fingerprint,
      current: pendingBatch(resolved.snapshot, identity),
      history: history?.kind === 'ok' ? history.questions : null,
      target: { executionId: identity.executionId, stageId: identity.stageId },
      executions: [...listExecutions(dir).map(({ id, stage }) => ({ id, stage })), ...running],
    };
  }

  /**
   * Bring an entry in line with persisted state: wait for the project, load a batch that was not known yet
   * (a panel restored before discovery), then apply stale / answered / continuing transitions.
   */
  #sync(entry: Entry, keepMessage: string | null = null): void {
    const resolved = this.#resolve(entry.identity);
    if (resolved?.snapshot === undefined) {
      if (entry.state === 'editing' || entry.state === 'unavailable') {
        entry.move({ state: 'unavailable', message: WAITING });
      }
      return;
    }
    const current = pendingBatch(resolved.snapshot, entry.identity);
    if (entry.questions.length === 0 && current.length > 0) entry.replaceBatch(current);
    const update = refreshBatchState(this.#stateInput(entry, resolved));
    entry.move(update);
    if (update === null && keepMessage !== null) entry.setMessage(keepMessage);
  }

  /** Answered records of this batch, shown read-only once the form is no longer editable. */
  #recorded(entry: Entry): QuestionRecord[] | null {
    if (entry.isEditable || entry.state === 'stale') return null;
    const { executionId, stageId } = entry.identity;
    const history = this.#readHistory(entry);
    const records = history?.kind === 'ok' ? history.questions : [];
    return records.filter(
      (record) => record.executionId === executionId && record.stageId === stageId && record.status === 'answered',
    );
  }

  #buildModel(entry: Entry): AnswerModel {
    const resolved = this.#resolve(entry.identity);
    return buildAnswerModel({
      revision: entry.revision + 1,
      generation: entry.generation,
      fingerprint: entry.fingerprint,
      title: resolved?.snapshot === undefined ? entry.identity.sessionId : sessionTitle(resolved.snapshot),
      workflowId: workflowIdOf(resolved?.snapshot),
      meta: buildSessionMeta(resolved?.snapshot),
      sessionState: titleCase(resolved?.snapshot?.displayState.state ?? 'unavailable'),
      state: entry.state,
      message: entry.message ?? (entry.saveError === null ? null : `Draft not saved: ${entry.saveError}`),
      questions: entry.questions,
      draft: entry.draft,
      blockReason: this.#blockReason(entry, resolved),
      records: this.#recorded(entry),
      archive: entry.archive,
    });
  }

  #publish(entry: Entry, isForced: boolean): void {
    const model = this.#buildModel(entry);
    const withoutRevision = (value: AnswerModel): string => JSON.stringify({ ...value, revision: 0 });
    if (!isForced && entry.lastModel !== null && withoutRevision(entry.lastModel) === withoutRevision(model)) return;
    entry.accept(model);
    entry.setTitle(truncate(model.title, TITLE_MAX));
    entry.setIcon(
      tabIcon(this.#context.extensionUri, 'questions', this.#resolve(entry.identity)?.snapshot?.displayState.state ?? ''),
    );
    void entry.panel.webview.postMessage({ type: 'model', revision: model.revision, identity: entry.identity, model });
  }

  #onChange(change: MigentChange): void {
    switch (change.type) {
      case 'session':
      case 'project':
        this.#mark((entry) => entry.identity.project === change.project);
        return;
      case 'files':
        this.#mark(
          (entry) => entry.identity.project === change.project && entry.identity.sessionId === change.sessionId,
        );
        return;
      case 'projects':
      case 'refresh':
      case 'capability':
        this.#mark(() => true);
        return;
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
      if (entry === undefined) continue;
      this.#sync(entry);
      this.#publish(entry, false);
    }
  }
}
