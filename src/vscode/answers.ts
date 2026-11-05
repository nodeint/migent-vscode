import { createHash, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { runLong, type RunResult } from '../cli/runner';
import { untilReceivedOrExited } from '../cli/untilReceived';
import { answerArgs } from '../core/controlArgs';
import type { GateHandle } from '../core/operationGate';
import { sessionDir } from '../core/paths';
import {
  type BatchTarget,
  reconcileSubmission,
  type Reconciliation,
  replyFileText,
  type ReplyMap,
  verifyBatch,
} from '../core/questionAnswers';
import { readQuestions } from '../core/questions';
import { isRecord } from '../core/record';
import type { AnswerRuntime, ControlService } from './control';
import type { ProjectContext } from './projects';

const RECONCILE_ATTEMPTS = 4;
const RECONCILE_DELAY_MS = 500;
const KEY_LENGTH = 32;
const RECORD_PREFIX = 'uncertain-';
const REPLY_PREFIX = 'reply-';
/** Only a committed record holds a session; `.tmp` files are unfinished writes. */
const COMMITTED = /^uncertain-[0-9a-f]+\.json$/;
const TEMPORARY = /^uncertain-.*\.tmp$/;

/** One batch submission: the target is captured once and never re-resolved. */
export interface AnswerRequest {
  context: ProjectContext;
  sessionId: string;
  target: BatchTarget;
  reply: ReplyMap;
  /** The `--stage` argument; null for a standalone role session, which has no stage target. */
  cliStage: string | null;
  /** Fingerprint of the batch the user answered. */
  fingerprint: string;
  /** Stable identity of the batch, used to find its persisted recovery record. */
  batchKey: string;
}

export type AnswerSubmission =
  | { kind: 'blocked'; reason: string }
  | { kind: 'failed'; detail: string }
  | { kind: 'done'; reconciliation: Reconciliation; stderrLast: string | null; cleanupError: string | null };

/** A recheck result: the confirmed outcome, and a cleanup failure that the next Recheck retries. */
export interface Rechecked {
  reconciliation: Reconciliation;
  cleanupError: string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** What survives a closed panel or a reload: the exact submission and where it was sent. */
interface RecoveryRecord {
  project: string;
  sessionId: string;
  batchKey: string;
  reply: ReplyMap;
  replyFile: string;
  /** Process id of the CLI once it started, so a later session can tell a running send from a rejected one. */
  pid?: number;
}

function parseReply(value: unknown): ReplyMap | null {
  if (!isRecord(value)) return null;
  const reply: ReplyMap = {};
  for (const [id, answer] of Object.entries(value)) {
    if (typeof answer === 'string') reply[id] = answer;
    else if (Array.isArray(answer) && answer.every((item) => typeof item === 'string')) reply[id] = answer.map(String);
    else return null;
  }
  return reply;
}

function parseRecord(text: string): RecoveryRecord | null {
  try {
    const value: unknown = JSON.parse(text);
    if (!isRecord(value)) return null;
    const { project, sessionId, batchKey, replyFile } = value;
    const reply = parseReply(value.reply);
    const isText = [project, sessionId, batchKey, replyFile].every((part) => typeof part === 'string' && part !== '');
    if (!isText || reply === null) return null;
    const pid = typeof value.pid === 'number' && Number.isInteger(value.pid) ? value.pid : undefined;
    return {
      project: String(project),
      sessionId: String(sessionId),
      batchKey: String(batchKey),
      reply,
      replyFile: String(replyFile),
      ...(pid === undefined ? {} : { pid }),
    };
  } catch {
    return null;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isRecord(error) && error.code === 'EPERM';
  }
}

/** Gates held for a session while at least one of its submissions is unresolved. */
interface Hold {
  handle: GateHandle;
  batches: Set<string>;
}

/**
 * Sends one question batch with `session continue --reply-file` and reconciles it from persisted records.
 * A recovery record is written atomically before the CLI starts and removed only when the question records
 * decide the outcome, so closing a panel or reloading mid-send cannot become a blind retry. At startup every
 * unresolved record re-takes its session's gate, so no other control can act on that session first.
 */
export class AnswerSubmitter {
  readonly #control: ControlService;
  readonly #storageDir: string;
  readonly #holds = new Map<string, Hold>();
  /** Batches whose CLI call is running in this process. */
  readonly #live = new Set<string>();

  constructor(control: ControlService, storageDir: string) {
    this.#control = control;
    this.#storageDir = storageDir;
    this.restore();
  }

  public get storageDir(): string {
    return this.#storageDir;
  }

  #holdKey(project: string, sessionId: string): string {
    return `${project}|${sessionId}`;
  }

  #recordPath(batchKey: string): string {
    const name = createHash('sha256').update(batchKey).digest('hex').slice(0, KEY_LENGTH);
    return path.join(this.#storageDir, `${RECORD_PREFIX}${name}.json`);
  }

  #hold(project: string, sessionId: string, batchKey: string): void {
    const key = this.#holdKey(project, sessionId);
    const existing = this.#holds.get(key);
    if (existing !== undefined) {
      existing.batches.add(batchKey);
      return;
    }
    const handle = this.#control.gate.tryAcquire(this.#control.sessionKey(project, sessionId), 'Sending reply');
    if (handle !== null) this.#holds.set(key, { handle, batches: new Set([batchKey]) });
  }

  #unhold(project: string, sessionId: string, batchKey: string): void {
    const key = this.#holdKey(project, sessionId);
    const hold = this.#holds.get(key);
    if (hold === undefined) return;
    hold.batches.delete(batchKey);
    if (hold.batches.size > 0) return;
    hold.handle.release();
    this.#holds.delete(key);
  }

  /** Re-take the gate of every unresolved submission found in storage. Runs before any panel opens. */
  public restore(): void {
    const names = this.#storageNames();
    const kept = new Set<string>();
    for (const name of names.filter((item) => COMMITTED.test(item))) {
      const record = this.#readRecord(path.join(this.#storageDir, name));
      if (record === null) continue;
      kept.add(path.resolve(record.replyFile));
      this.#hold(record.project, record.sessionId, record.batchKey);
    }
    // Abandoned unfinished writes and reply files no committed record refers to hold nothing: remove them.
    for (const name of names) {
      const file = path.join(this.#storageDir, name);
      const isOrphanReply = name.startsWith(REPLY_PREFIX) && !kept.has(path.resolve(file));
      if (TEMPORARY.test(name) || isOrphanReply) rmSync(file, { force: true });
    }
  }

  #storageNames(): string[] {
    try {
      return readdirSync(this.#storageDir);
    } catch {
      return [];
    }
  }

  #readRecord(file: string): RecoveryRecord | null {
    try {
      return parseRecord(readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
  }

  /** The recovery record is replaced atomically (temp file, then rename). */
  async #saveRecord(request: AnswerRequest, replyFile: string, pid?: number): Promise<void> {
    const record: RecoveryRecord = {
      project: request.context.key,
      sessionId: request.sessionId,
      batchKey: request.batchKey,
      reply: request.reply,
      replyFile,
      ...(pid === undefined ? {} : { pid }),
    };
    const file = this.#recordPath(request.batchKey);
    const temp = `${file}.${randomUUID()}.tmp`;
    await mkdir(this.#storageDir, { recursive: true });
    await writeFile(temp, JSON.stringify(record), 'utf8');
    await rename(temp, file);
  }

  /**
   * The outcome is decided, so the session is released first; deleting the files is then best effort. A failure
   * is returned (not thrown) and leaves the record for the next Recheck or startup. It never allows a resend:
   * the persisted question records already decide the batch.
   */
  async #clearRecord(project: string, sessionId: string, batchKey: string): Promise<string | null> {
    this.#unhold(project, sessionId, batchKey);
    const file = this.#recordPath(batchKey);
    const record = this.#readRecord(file);
    try {
      await rm(file, { force: true });
      if (record !== null) await rm(record.replyFile, { force: true });
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  /** The unresolved submission for a batch, restored after a closed panel or a reload. */
  public pending(batchKey: string): ReplyMap | null {
    return this.#readRecord(this.#recordPath(batchKey))?.reply ?? null;
  }

  /** The authoritative state right now: refreshed from disk, then judged. Null means the batch may be sent. */
  #blockNow(request: AnswerRequest): string | null {
    const { context, sessionId, target } = request;
    context.store.refreshSession(sessionId);
    const snapshot = context.store.snapshot(sessionId);
    if (snapshot === undefined) return 'The session is not available.';
    const blocked = this.#control.answerBlock(context, snapshot, true);
    if (blocked !== null) return blocked;
    const history = readQuestions(sessionDir(context.root, sessionId));
    const verified = verifyBatch({
      summary: snapshot.status?.questions ?? [],
      history,
      target,
      fingerprint: request.fingerprint,
    });
    return verified.kind === 'ok' ? null : verified.reason;
  }

  async #writeReply(request: AnswerRequest): Promise<{ kind: 'ok'; path: string } | { kind: 'error'; detail: string }> {
    const file = path.join(this.#storageDir, `reply-${randomUUID()}.json`);
    try {
      await mkdir(this.#storageDir, { recursive: true });
      await writeFile(file, replyFileText(request.reply), { encoding: 'utf8', flag: 'wx' });
      await this.#saveRecord(request, file);
      return { kind: 'ok', path: file };
    } catch (error) {
      await rm(file, { force: true });
      return { kind: 'error', detail: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Submit one complete batch. The gate is taken first; the reply file and the recovery record are saved; then
   * the target is refreshed and the capability, lock, exact membership and fingerprint are verified again
   * immediately before dispatch. Acceptance is decided only from the persisted question records.
   */
  public async submit(request: AnswerRequest): Promise<AnswerSubmission> {
    const { context, sessionId } = request;
    const runtime = this.#control.runtime(context);
    if (runtime === undefined) return { kind: 'blocked', reason: 'The Migent CLI is unavailable.' };
    const handle = this.#control.gate.tryAcquire(this.#control.sessionKey(context.key, sessionId), 'Sending reply');
    if (handle === null) return { kind: 'blocked', reason: 'Another operation on this session is in progress.' };
    const file = await this.#writeReply(request);
    const blocked = file.kind === 'error' ? `Could not save the answers: ${file.detail}` : this.#blockNow(request);
    if (file.kind === 'error' || blocked !== null) {
      handle.release();
      if (file.kind === 'ok') await this.#discard(request, file.path);
      return { kind: 'blocked', reason: blocked ?? 'The answers could not be saved.' };
    }
    this.#holds.set(this.#holdKey(context.key, sessionId), { handle, batches: new Set([request.batchKey]) });
    // No await between the verification above and the spawn.
    return this.#dispatch(request, runtime, file.path);
  }

  /** Run the CLI, remembering its pid in the record, and settle from the question records. */
  async #dispatch(request: AnswerRequest, runtime: AnswerRuntime, replyFile: string): Promise<AnswerSubmission> {
    const { context, sessionId, batchKey } = request;
    const args = answerArgs({ sessionId, stageId: request.cliStage, replyFile });
    this.#live.add(batchKey);
    const run = runLong(runtime.launch, args, { cwd: context.root, env: runtime.env, onStderrLine: runtime.log });
    const saved = this.#savePid(request, replyFile, run.pid);
    try {
      // The CLI runs the whole stage and exits only when it is done. The answers are received once the question
      // records show them, which is within moments, so that settles the send and the process carries on.
      const early = await untilReceivedOrExited(run.result, () => this.#receivedOutcome(request), RECONCILE_DELAY_MS);
      await saved;
      if (early.kind === 'received') return await this.#finish(request, early.value, null);
      return await this.#settle(request, early.result);
    } finally {
      this.#live.delete(batchKey);
    }
  }

  /** The pid is only a liveness hint; the record without it is still valid. */
  async #savePid(request: AnswerRequest, replyFile: string, pid: number | undefined): Promise<void> {
    if (pid === undefined) return;
    try {
      await this.#saveRecord(request, replyFile, pid);
    } catch {
      // Kept as it is.
    }
  }

  /** The decided outcome while the records already show it, or null: only a decision ends the wait early. */
  #receivedOutcome(request: AnswerRequest): Reconciliation | null {
    const outcome = this.#reconcile(request);
    return outcome.kind === 'recorded' || outcome.kind === 'answered-elsewhere' ? outcome : null;
  }

  /** Release the session, delete the saved files and report a decided outcome. */
  async #finish(
    request: AnswerRequest,
    reconciliation: Reconciliation,
    stderrLast: string | null,
  ): Promise<AnswerSubmission> {
    const cleanupError = await this.#clearRecord(request.context.key, request.sessionId, request.batchKey);
    return { kind: 'done', reconciliation, stderrLast, cleanupError };
  }

  async #discard(request: AnswerRequest, replyFile: string): Promise<void> {
    await rm(replyFile, { force: true });
    await rm(this.#recordPath(request.batchKey), { force: true });
  }

  async #settle(request: AnswerRequest, result: RunResult): Promise<AnswerSubmission> {
    const { context, sessionId, batchKey } = request;
    if (result.kind === 'spawn-failed') {
      // The CLI never ran, so there is nothing to reconcile.
      const cleanup = await this.#clearRecord(context.key, sessionId, batchKey);
      this.#control.runtime(context)?.logError(`spawn failed: ${result.detail}`);
      if (cleanup !== null) this.#control.runtime(context)?.logError(`cleanup failed: ${cleanup}`);
      return { kind: 'failed', detail: result.detail };
    }
    const reconciliation = await this.#reconcileWithRetry(request);
    const stderrLast = result.stderrTail.at(-1) ?? null;
    // An unconfirmed result keeps its record, reply file and gate until Recheck.
    if (reconciliation.kind === 'unconfirmed') return { kind: 'done', reconciliation, stderrLast, cleanupError: null };
    return this.#finish(request, reconciliation, stderrLast);
  }

  #reconcile(request: AnswerRequest): Reconciliation {
    const { context, sessionId, target, reply } = request;
    context.store.refreshSession(sessionId);
    const read = readQuestions(sessionDir(context.root, sessionId));
    return read.kind === 'ok' ? reconcileSubmission(read.questions, target, reply) : { kind: 'unconfirmed' };
  }

  async #reconcileWithRetry(request: AnswerRequest): Promise<Reconciliation> {
    let outcome: Reconciliation = { kind: 'unconfirmed' };
    for (let attempt = 0; attempt < RECONCILE_ATTEMPTS; attempt += 1) {
      outcome = this.#reconcile(request);
      if (outcome.kind === 'recorded' || outcome.kind === 'answered-elsewhere') return outcome;
      // `pending` right after the command ended is a rejection; allow one more look for late writes.
      if (outcome.kind === 'pending' && attempt >= 1) return outcome;
      await sleep(RECONCILE_DELAY_MS);
    }
    return outcome;
  }

  /** Whether the CLI call may still be running: here, or in a process that outlived a reload. */
  #isRunning(batchKey: string): boolean {
    if (this.#live.has(batchKey)) return true;
    const pid = this.#readRecord(this.#recordPath(batchKey))?.pid;
    return pid !== undefined && isAlive(pid);
  }

  /**
   * Re-read the records for an uncertain submission. While the CLI may still be running, `pending` is not a
   * rejection and nothing is released. Once the records decide it, the gate, file and record go.
   */
  public async recheck(request: AnswerRequest): Promise<Rechecked> {
    const outcome = this.#reconcile(request);
    const isRunning = outcome.kind === 'pending' && this.#isRunning(request.batchKey);
    if (isRunning || outcome.kind === 'unconfirmed') {
      return { reconciliation: { kind: 'unconfirmed' }, cleanupError: null };
    }
    const cleanupError = await this.#clearRecord(request.context.key, request.sessionId, request.batchKey);
    return { reconciliation: outcome, cleanupError };
  }
}
