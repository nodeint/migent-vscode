import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import * as vscode from 'vscode';

import { runLong, type RunResult } from '../cli/runner';
import { answerArgs } from '../core/controlArgs';
import { listExecutions, parseExecutionId } from '../core/executions';
import type { SessionSnapshot } from '../core/model';
import { EXECUTIONS_DIRNAME, sessionDir } from '../core/paths';
import { isRecord } from '../core/record';
import {
  type BlockedTarget,
  blockedTargets,
  readBlockerText,
  replyConsumed,
  replyDraftKey,
  replyHeader,
  type ReplyIdentity,
  replyText,
} from '../core/replyFlow';
import { sessionLabel } from '../core/sessionPresentation';
import type { ControlService } from './control';
import type { ProjectContext, ProjectRegistry } from './projects';

const INFO_MESSAGE_MS = 5000;

const DRAFT_DIRNAME = 'reply-drafts';
const KEY_LENGTH = 32;
const RECONCILE_ATTEMPTS = 4;
const RECONCILE_DELAY_MS = 500;
const STATUS_MESSAGE_MS = 3000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** What the sidecar next to a draft records: the exact blocked execution it answers. */
interface DraftMeta extends ReplyIdentity {
  stageId: string;
  attempt: number;
}

function parseMeta(text: string): DraftMeta | undefined {
  try {
    const value: unknown = JSON.parse(text);
    if (!isRecord(value)) return undefined;
    const { project, sessionId, executionId, stageId, attempt } = value;
    const isText = [project, sessionId, executionId, stageId].every((part) => typeof part === 'string' && part !== '');
    if (!isText || typeof attempt !== 'number') return undefined;
    return {
      project: String(project),
      sessionId: String(sessionId),
      executionId: String(executionId),
      stageId: String(stageId),
      attempt,
    };
  } catch {
    return undefined;
  }
}

type ExitedRun = Extract<RunResult, { kind: 'exited' }>;

/** Everything one submission acts on, captured before dispatch. */
interface SendInput {
  context: ProjectContext;
  meta: DraftMeta;
  target: BlockedTarget;
  text: string;
  /** The raw draft content that was submitted, to tell later edits apart. */
  content: string;
  replyFile: string;
}

export type SendResult =
  | { kind: 'sent'; hasKeptEdits: boolean }
  | { kind: 'blocked'; reason: string }
  | { kind: 'failed'; detail: string }
  | { kind: 'unconfirmed' };

/**
 * Extension-owned Reply drafts and their submission for ordinary Blocked stages
 * (plans/03c-reply-notifications.md §2). A draft is a real file in extension storage keyed by
 * `(project, session, blocked execution)`, so closing the editor or reloading the window keeps it. It is deleted only
 * after persisted evidence shows the reply was consumed, and never touches `.migent/`.
 */
export class ReplyService implements vscode.Disposable {
  readonly #registry: ProjectRegistry;
  readonly #control: ControlService;
  readonly #dir: string;
  /** Late-confirmation watchers still waiting; each stops its subscription and watchers when called. */
  readonly #late = new Set<() => void>();

  constructor(registry: ProjectRegistry, control: ControlService, storageDir: string) {
    this.#registry = registry;
    this.#control = control;
    this.#dir = path.join(storageDir, DRAFT_DIRNAME);
  }

  #base(identity: ReplyIdentity): string {
    const name = createHash('sha256').update(replyDraftKey(identity)).digest('hex').slice(0, KEY_LENGTH);
    return path.join(this.#dir, name);
  }

  public draftPath(identity: ReplyIdentity): string {
    return `${this.#base(identity)}.md`;
  }

  /** The blocked execution a draft file answers, or undefined when `uri` is not one of this service's drafts. */
  public identityOf(uri: vscode.Uri): DraftMeta | undefined {
    if (path.dirname(uri.fsPath) !== this.#dir || !uri.fsPath.endsWith('.md')) return undefined;
    try {
      return parseMeta(readFileSync(`${uri.fsPath.slice(0, -'.md'.length)}.json`, 'utf8'));
    } catch {
      return undefined;
    }
  }

  public hasDraft(identity: ReplyIdentity): boolean {
    return existsSync(this.draftPath(identity));
  }

  /** Open the Reply editor for one blocked execution, creating the draft with its blocker context the first time. */
  public async open(context: ProjectContext, snapshot: SessionSnapshot, target: BlockedTarget): Promise<void> {
    const { executionId } = target;
    const identity: ReplyIdentity = { project: context.key, sessionId: snapshot.sessionId, executionId };
    const file = this.draftPath(identity);
    if (!existsSync(file) && !(await this.#createDraft(context, identity, target))) return;
    await this.#show(file);
  }

  async #createDraft(context: ProjectContext, identity: ReplyIdentity, target: BlockedTarget): Promise<boolean> {
    const dir = sessionDir(context.root, identity.sessionId);
    const response = path.posix.join(EXECUTIONS_DIRNAME, target.executionId, 'response.md');
    const header = replyHeader({
      target,
      blocker: readBlockerText(dir, target.executionId),
      responsePath: existsSync(path.join(dir, response)) ? response : null,
    });
    const meta: DraftMeta = { ...identity, stageId: target.stageId, attempt: target.attempt };
    try {
      await mkdir(this.#dir, { recursive: true });
      await writeFile(`${this.#base(identity)}.json`, JSON.stringify(meta), 'utf8');
      await writeFile(this.draftPath(identity), header, { encoding: 'utf8', flag: 'wx' });
      return true;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`Could not create the reply draft: ${detail}`);
      return false;
    }
  }

  async #show(file: string): Promise<void> {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    await vscode.window.showTextDocument(document, { preview: false });
  }

  /** Delete a draft after the user confirmed `Discard reply…`. */
  public async discard(identity: ReplyIdentity): Promise<void> {
    await rm(this.draftPath(identity), { force: true });
    await rm(`${this.#base(identity)}.json`, { force: true });
  }

  /** Save the editor first so what is sent is exactly what the file holds; false when it cannot be saved. */
  async #savedContent(file: string): Promise<string | undefined> {
    const document = vscode.workspace.textDocuments.find((open) => open.uri.fsPath === file);
    if (document?.isDirty === true && !(await document.save())) return undefined;
    return readFile(file, 'utf8');
  }

  /** Whether `meta` still names a blocked execution of the session; the stored target is never re-resolved. */
  #validate(meta: DraftMeta): { context: ProjectContext; snapshot: SessionSnapshot; target: BlockedTarget } | string {
    const context = this.#registry.project(meta.project);
    if (context === undefined) return 'The project is no longer open.';
    context.store.refreshSession(meta.sessionId);
    const snapshot = context.store.snapshot(meta.sessionId);
    if (snapshot === undefined) return 'The session is not available.';
    const target = blockedTargets(snapshot).find((candidate) => candidate.executionId === meta.executionId);
    if (target === undefined) return 'The session is no longer blocked on this stage. Your draft was kept.';
    return { context, snapshot, target };
  }

  /**
   * Send the draft of `meta`. The gate is taken first, the target is validated again immediately before dispatch,
   * and acceptance is decided only by persisted evidence (a later execution whose prompt carries the reply).
   */
  public async send(meta: DraftMeta): Promise<SendResult> {
    const content = await this.#savedContent(this.draftPath(meta));
    if (content === undefined) return { kind: 'blocked', reason: 'The reply was not saved, so it was not sent.' };
    const text = replyText(content);
    if (text === '') return { kind: 'blocked', reason: 'Write a reply first, or use Continue without reply.' };
    const checked = this.#validate(meta);
    if (typeof checked === 'string') return { kind: 'blocked', reason: checked };
    const { context, snapshot, target } = checked;
    const handle = this.#control.gate.tryAcquire(this.#control.sessionKey(context.key, meta.sessionId), 'Sending reply');
    if (handle === null) return { kind: 'blocked', reason: 'Another operation on this session is in progress.' };
    const blocked = this.#control.answerBlock(context, snapshot, true);
    if (blocked !== null) {
      handle.release();
      return { kind: 'blocked', reason: blocked };
    }
    const replyFile = path.join(this.#dir, `send-${randomUUID()}.txt`);
    try {
      await writeFile(replyFile, text, { encoding: 'utf8', flag: 'wx' });
      return await this.#dispatch({ context, meta, target, text, content, replyFile }, handle);
    } catch (error) {
      handle.release();
      return { kind: 'failed', detail: error instanceof Error ? error.message : String(error) };
    } finally {
      await rm(replyFile, { force: true });
    }
  }

  async #dispatch(input: SendInput, handle: { release: () => void }): Promise<SendResult> {
    const { context, meta, target, replyFile } = input;
    const runtime = this.#control.runtime(context);
    if (runtime === undefined) {
      handle.release();
      return { kind: 'blocked', reason: 'The Migent CLI is unavailable.' };
    }
    // The temporary file was written asynchronously: another process may have changed the attempt, the lock or the
    // CLI meanwhile, so the exact execution, state, lock and capability are checked again right before the spawn.
    const refused = this.#recheck(meta);
    if (refused !== null) {
      handle.release();
      return { kind: 'blocked', reason: refused };
    }
    const args = answerArgs({ sessionId: meta.sessionId, stageId: target.stageId, replyFile });
    // No await between this validation and the spawn.
    const run = runLong(runtime.launch, args, { cwd: context.root, env: runtime.env, onStderrLine: runtime.log });
    const result = await run.result;
    if (result.kind === 'spawn-failed') {
      handle.release();
      runtime.logError(`spawn failed: ${result.detail}`);
      return { kind: 'failed', detail: result.detail };
    }
    return this.#settle(input, result, handle);
  }

  async #settle(input: SendInput, result: ExitedRun, handle: { release: () => void }): Promise<SendResult> {
    if (await this.#awaitConsumed(input)) {
      handle.release();
      return { kind: 'sent', hasKeptEdits: await this.#settleDraft(input.meta, input.content) };
    }
    // A rejection ended the command without consuming the reply: the draft stays and the user may send again.
    // Otherwise the gate stays held until a later refresh shows the effect, so nothing is sent twice.
    if (result.outcome === 'ConfigError' || result.outcome === 'Unknown') {
      handle.release();
      const detail = result.stderrTail.at(-1) ?? `Migent exited with code ${result.exitCode ?? 'unknown'}.`;
      return { kind: 'failed', detail };
    }
    this.#releaseWhenConsumed(input, handle);
    return { kind: 'unconfirmed' };
  }

  /** Why the target may not be answered now, or null: same blocked execution, writable session, usable CLI. */
  #recheck(meta: DraftMeta): string | null {
    const again = this.#validate(meta);
    return typeof again === 'string' ? again : this.#control.answerBlock(again.context, again.snapshot, true);
  }

  async #awaitConsumed({ context, meta, target, text }: SendInput): Promise<boolean> {
    const dir = sessionDir(context.root, meta.sessionId);
    for (let attempt = 0; attempt < RECONCILE_ATTEMPTS; attempt += 1) {
      context.store.refreshSession(meta.sessionId);
      if (replyConsumed(dir, target, text)) return true;
      await sleep(RECONCILE_DELAY_MS);
    }
    return false;
  }

  /**
   * After the wait timed out, keep looking for the evidence: watch the session's executions (and every later
   * execution, whose files hold the evidence), recheck on any change and on Refresh, and check once right after
   * subscribing so nothing written in between is missed. The gate stays held until then.
   */
  #releaseWhenConsumed(input: SendInput, handle: { release: () => void }): void {
    const stop = this.#watchConsumption(input, () => {
      stop();
      this.#late.delete(stop);
      handle.release();
      // Late confirmation settles the draft exactly like an immediate one, keeping newer edits.
      void this.#settleDraft(input.meta, input.content);
    });
    this.#late.add(stop);
  }

  /** Calls `onConsumed` once the evidence exists; the returned function stops the subscription and watchers. */
  #watchConsumption({ context, meta, target, text }: SendInput, onConsumed: () => void): () => void {
    const dir = sessionDir(context.root, meta.sessionId);
    const blockedOrder = parseExecutionId(target.executionId)?.order ?? 0;
    const held = new Map<string, vscode.Disposable>();
    held.set('', context.watcher.retain({ kind: 'executions', sessionId: meta.sessionId }));
    let isStopped = false;
    const check = (): void => {
      if (isStopped) return;
      for (const execution of listExecutions(dir)) {
        if (execution.order <= blockedOrder || held.has(execution.id)) continue;
        const executionId = execution.id;
        held.set(executionId, context.watcher.retain({ kind: 'execution', sessionId: meta.sessionId, executionId }));
      }
      if (replyConsumed(dir, target, text)) onConsumed();
    };
    const subscription = this.#registry.onDidChange((change) => {
      const isSession = 'sessionId' in change && change.sessionId === meta.sessionId;
      if (change.type === 'refresh' || isSession) check();
    });
    // Evidence written between the timeout and the subscription is found by this first check.
    queueMicrotask(check);
    return () => {
      isStopped = true;
      subscription.dispose();
      for (const release of held.values()) release.dispose();
    };
  }

  public dispose(): void {
    for (const stop of [...this.#late]) stop();
    this.#late.clear();
  }

  /** Delete the submitted draft, unless the user edited it while sending: newer edits are preserved. */
  async #settleDraft(identity: ReplyIdentity, submitted: string): Promise<boolean> {
    const file = this.draftPath(identity);
    let current: string | undefined;
    try {
      current = await readFile(file, 'utf8');
    } catch {
      current = undefined;
    }
    if (current !== undefined && current !== submitted) return true;
    // Unsaved edits live only in the editor: a dirty open document must keep its draft and identity.
    const open = vscode.workspace.textDocuments.find((document) => document.uri.fsPath === file);
    if (open?.isDirty === true) return true;
    await this.discard(identity);
    return false;
  }

  /** Report a send result and put the editor back in front after an unsuccessful one. */
  public async report(meta: DraftMeta, snapshot: SessionSnapshot | undefined, result: SendResult): Promise<void> {
    const label = snapshot === undefined ? meta.sessionId : sessionLabel(snapshot);
    if (result.kind === 'sent') {
      if (result.hasKeptEdits) {
        vscode.window.setStatusBarMessage('Reply sent. Edits made while sending were kept in the draft.', INFO_MESSAGE_MS);
      } else {
        vscode.window.setStatusBarMessage(`Reply sent to ${label}`, STATUS_MESSAGE_MS);
      }
      return;
    }
    const file = this.draftPath(meta);
    if (existsSync(file)) await this.#show(file);
    if (result.kind === 'unconfirmed') {
      const picked = await vscode.window.showWarningMessage('Status not confirmed. Your draft was kept.', 'Refresh', 'View log');
      if (picked === 'Refresh') await vscode.commands.executeCommand('migent.refresh');
      else if (picked === 'View log') this.#control.showLog();
      return;
    }
    const text = result.kind === 'blocked' ? result.reason : `Could not send the reply: ${result.detail} Your draft was kept.`;
    const picked = await vscode.window.showWarningMessage(text, 'View log');
    if (picked === 'View log') this.#control.showLog();
  }
}
