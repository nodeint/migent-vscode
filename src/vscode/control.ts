import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import * as vscode from 'vscode';

import { parseSessionId } from '../cli/exitCode';
import { invokeJson, type InvokeResult, invokeText } from '../cli/invoke';
import type { LaunchSpec } from '../cli/locate';
import { runLong, type RunResult } from '../cli/runner';
import {
  cancelArgs,
  continueArgs,
  DEFAULT_RUN_SETTINGS,
  parsePrepared,
  prepareArgs,
  regenerateNextArgs,
  repairArgs,
  runDownstreamArgs,
  runNewArgs,
  runPreparedArgs,
  type RunSettings,
} from '../core/controlArgs';
import type { SessionSnapshot } from '../core/model';
import { type GateHandle, type GateKey, OperationGate } from '../core/operationGate';
import { isRecord } from '../core/record';
import { sessionLabel } from '../core/sessionPresentation';
import { checkWrite, describeBlock, type WriteBlock, type WriteCheck } from '../core/writeEligibility';
import type { CapabilityService } from './capability';
import { hasWorkflowDraft, isRejectedStart, runDoctor, workflowChange } from './controlHelpers';
import type { ProjectContext, ProjectRegistry } from './projects';
import { type PreparedSession, preparedSession, reportFailure } from './workflowDraft';

const INFO_MESSAGE_MS = 5000;

/** How long Stop waits for the CLI (it waits 15 seconds itself) before the extension gives up. */
export const STOP_TIMEOUT_MS = 20_000;
const RECONCILE_ATTEMPTS = 4;
const RECONCILE_DELAY_MS = 500;
const PREPARE_TIMEOUT_MS = 30_000;
const REGENERATE_TIMEOUT_MS = 60_000;
const STATUS_MESSAGE_MS = 3000;
/** `session cancel` exits 2 when the session does not exist, is not running, or runs elsewhere. */
const CANCEL_REFUSED_EXIT = 2;
/** `<session-id>/task.md` relative to `.migent/sessions`. */
const TASK_PATH_PARTS = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** The CLI launch, environment and log sinks for one project. */
export interface AnswerRuntime {
  launch: LaunchSpec;
  env: NodeJS.ProcessEnv;
  log: (line: string) => void;
  logError: (line: string) => void;
}

export type WorkflowChoice = 'session' | 'updated';

export interface PrepareInput {
  workflowId: string;
  title: string;
  /** The Completed source whose published outputs become this session's context. */
  priorSessionId?: string;
  /** Written to `task.md` after the session is prepared. */
  taskText?: string;
}

/** One long CLI command and the identity it acts on. */
interface Job {
  key: GateKey;
  args: string[];
  title: string;
  sessionId?: string;
}

/** What a running command is bound to; the session id is learned from stderr for a new session. */
interface RunState {
  title: string;
  handle: GateHandle;
  sessionId: string | undefined;
  before: SessionSnapshot | undefined;
}

/**
 * Starts, continues and stops sessions through the CLI. It never writes session files except the
 * user's `task.md`; every result returns through the watcher and store (plans/03-control.md §1).
 */
export class ControlService implements vscode.Disposable {
  public readonly gate = new OperationGate();
  readonly #registry: ProjectRegistry;
  readonly #capability: CapabilityService;
  readonly #output: vscode.LogOutputChannel;
  readonly #handles = new Map<string, GateHandle>();

  constructor(registry: ProjectRegistry, capability: CapabilityService) {
    this.#registry = registry;
    this.#capability = capability;
    this.#output = vscode.window.createOutputChannel('Migent', { log: true });
  }

  public dispose(): void {
    this.#output.dispose();
  }

  public showLog(): void {
    this.#output.show(true);
  }

  /** The write check for a target: CLI capability, a foreign lock, and any operation already pending. */
  public check(context: ProjectContext, snapshot?: SessionSnapshot): WriteCheck {
    const pending = snapshot === undefined ? undefined : this.gate.current(context.key, snapshot.sessionId)?.phase;
    return checkWrite({ capability: this.#capability.state(context.key).kind, snapshot, pendingPhase: pending });
  }

  /** Explain a blocked write with its recovery action. Returns true when the write may proceed. */
  public async ensureWritable(context: ProjectContext, snapshot?: SessionSnapshot): Promise<boolean> {
    const check = this.check(context, snapshot);
    if (check.ok) return true;
    await this.#explain(check);
    return false;
  }

  async #explain(block: WriteBlock): Promise<void> {
    const text = describeBlock(block);
    if (block.recovery === 'none') {
      vscode.window.setStatusBarMessage(text, INFO_MESSAGE_MS);
      return;
    }
    const action = { recheck: 'Recheck', refresh: 'Refresh' }[block.recovery];
    const command = {
      recheck: 'migent.cli.recheck',
      refresh: 'migent.refresh',
    }[block.recovery];
    const picked = await vscode.window.showWarningMessage(text, action, 'View log');
    if (picked === action) await vscode.commands.executeCommand(command);
    else if (picked === 'View log') this.showLog();
  }

  /** Offer Refresh and View log after a result that persisted state does not confirm. */
  async #offerRecovery(message: string): Promise<void> {
    const picked = await vscode.window.showWarningMessage(message, 'Refresh', 'View log');
    if (picked === 'Refresh') await vscode.commands.executeCommand('migent.refresh');
    else if (picked === 'View log') this.showLog();
  }

  public settings(context: ProjectContext): RunSettings {
    const config = vscode.workspace.getConfiguration('migent.run', context.folder.uri);
    return {
      maxDispatches: config.get<number>('maxDispatches', DEFAULT_RUN_SETTINGS.maxDispatches),
      progress: config.get<boolean>('progress', DEFAULT_RUN_SETTINGS.progress),
    };
  }

  #env(context: ProjectContext): NodeJS.ProcessEnv {
    const config = vscode.workspace.getConfiguration('migent', context.folder.uri);
    return { ...process.env, ...config.get<Record<string, string>>('env', {}) };
  }

  #launch(context: ProjectContext): LaunchSpec | undefined {
    return this.#capability.state(context.key).launch;
  }

  #sessionKey(context: ProjectContext, sessionId: string): GateKey {
    return { kind: 'session', project: context.key, sessionId };
  }

  /** Start a new session from a workflow and a one-line task. */
  public async runNew(context: ProjectContext, workflowId: string, task: string): Promise<void> {
    if (!(await this.ensureWritable(context))) return;
    await this.#execute(context, {
      key: { kind: 'launch', project: context.key, workflowId },
      args: runNewArgs({ workflowId, task }, this.settings(context)),
      title: `Running ${workflowId}`,
    });
  }

  /**
   * Start a new session from a Completed source (`session run --workflow --prior`). Returns the new
   * session id when it was observed. The launch key includes the source, so every entry point shares it.
   */
  public async runDownstream(
    context: ProjectContext,
    input: { workflowId: string; priorSessionId: string; task: string | null },
  ): Promise<string | undefined> {
    if (!(await this.ensureWritable(context))) return undefined;
    return this.#execute(context, {
      key: { kind: 'launch', project: context.key, workflowId: input.workflowId, priorSessionId: input.priorSessionId },
      args: runDownstreamArgs(input, this.settings(context)),
      title: `Running ${input.workflowId}`,
    });
  }

  /** Whether a launch for this source and target is pending in this extension instance. */
  public isDownstreamBusy(context: ProjectContext, workflowId: string, priorSessionId: string): boolean {
    return this.gate.isLaunchBusy({ kind: 'launch', project: context.key, workflowId, priorSessionId });
  }

  /**
   * Ask the CLI to regenerate `next.json` of a Completed source (`session continue <id>`, which dispatches
   * no stage). The result is read back from disk by the watcher; failures never change the session.
   */
  public async regenerateNext(context: ProjectContext, snapshot: SessionSnapshot): Promise<boolean> {
    if (snapshot.displayState.state !== 'completed') {
      vscode.window.setStatusBarMessage('The session is no longer completed.', INFO_MESSAGE_MS);
      return false;
    }
    if (!(await this.ensureWritable(context, snapshot))) return false;
    const launch = this.#launch(context);
    const handle = this.gate.tryAcquire(this.#sessionKey(context, snapshot.sessionId), 'Starting');
    if (launch === undefined || handle === null) return false;
    try {
      const result = await invokeText(launch, regenerateNextArgs(snapshot.sessionId), {
        cwd: context.root,
        env: this.#env(context),
        timeoutMs: REGENERATE_TIMEOUT_MS,
      });
      context.store.refreshSession(snapshot.sessionId);
      if (result.kind === 'error') {
        this.#output.error(`reload suggestions failed: ${result.error.detail} ${result.error.stderr}`.trim());
        void vscode.window.showErrorMessage(`Could not reload suggestions: ${result.error.detail}`);
        return false;
      }
      return true;
    } finally {
      handle.release();
    }
  }

  /** Start the prepared session `snapshot` (Save & Run). */
  public async runPrepared(context: ProjectContext, snapshot: SessionSnapshot, workflowId: string): Promise<void> {
    if (!(await this.ensureWritable(context, snapshot))) return;
    await this.#execute(context, {
      key: this.#sessionKey(context, snapshot.sessionId),
      args: runPreparedArgs({ sessionId: snapshot.sessionId, workflowId }, this.settings(context)),
      title: `Running ${sessionLabel(snapshot)}`,
      sessionId: snapshot.sessionId,
    });
  }

  /**
   * The write check for sending answers. A live lock (even this host's own runner) blocks sending, and
   * nothing is queued for when it is released.
   */
  public answerBlock(context: ProjectContext, snapshot: SessionSnapshot, hasGate = false): string | null {
    const check = hasGate
      ? checkWrite({ capability: this.#capability.state(context.key).kind, snapshot })
      : this.check(context, snapshot);
    if (!check.ok) return describeBlock(check);
    if (snapshot.lock.kind === 'alive') return 'The session is running. Send is available once the runner stops.';
    return null;
  }

  /** What a CLI call for `context` needs, or undefined while the CLI is unusable. */
  public runtime(context: ProjectContext): AnswerRuntime | undefined {
    const launch = this.#launch(context);
    if (launch === undefined) return undefined;
    return {
      launch,
      env: this.#env(context),
      log: (line) => {
        this.#output.appendLine(line);
      },
      logError: (line) => {
        this.#output.error(line);
      },
    };
  }

  public sessionKey(project: string, sessionId: string): GateKey {
    return { kind: 'session', project, sessionId };
  }

  /** Resume a stopped session. `choice` selects the workflow definition the user decided on. */
  public async continueSession(
    context: ProjectContext,
    snapshot: SessionSnapshot,
    choice: WorkflowChoice = 'session',
  ): Promise<void> {
    await this.#continue(context, snapshot, { choice, isOnce: false });
  }

  /** Dispatch the next eligible stage once (`--once`), without resetting revision counts. */
  public async continueOnce(
    context: ProjectContext,
    snapshot: SessionSnapshot,
    choice: WorkflowChoice = 'session',
  ): Promise<void> {
    await this.#continue(context, snapshot, { choice, isOnce: true });
  }

  async #continue(
    context: ProjectContext,
    snapshot: SessionSnapshot,
    options: { choice: WorkflowChoice; isOnce: boolean },
  ): Promise<void> {
    if (!(await this.ensureWritable(context, snapshot))) return;
    // A drafted session continues from its own copy: --refresh-workflow would re-freeze the draft, not the live file.
    const isAdopting = options.choice === 'updated' && !hasWorkflowDraft(context.root, snapshot.sessionId);
    const input = { sessionId: snapshot.sessionId, refreshWorkflow: isAdopting, once: options.isOnce };
    await this.#execute(context, {
      key: this.#sessionKey(context, snapshot.sessionId),
      args: continueArgs(input, this.settings(context)),
      title: `${options.isOnce ? 'Running next stage of' : 'Continuing'} ${sessionLabel(snapshot)}`,
      sessionId: snapshot.sessionId,
    });
  }

  /**
   * Whether the workflow file changed since the session froze its copy, and where both live.
   * Undefined when either side is unavailable: the session version then simply continues.
   */
  public workflowChange(
    context: ProjectContext, snapshot: SessionSnapshot,
  ): { frozen: string; current: string } | undefined {
    return workflowChange(context, snapshot);
  }

  /** `session prepare`, then (optionally) the user's task text. Returns the real file paths. */
  public async prepare(context: ProjectContext, input: PrepareInput): Promise<PreparedSession | undefined> {
    if (!(await this.ensureWritable(context))) return undefined;
    const handle = this.gate.tryAcquire({
      kind: 'launch',
      project: context.key,
      workflowId: input.workflowId,
      priorSessionId: input.priorSessionId,
    });
    if (handle === null) {
      vscode.window.setStatusBarMessage(`A ${input.workflowId} session is already being created.`, INFO_MESSAGE_MS);
      return undefined;
    }
    try {
      return await this.#prepareSession(context, input);
    } finally {
      handle.release();
    }
  }

  async #prepareSession(context: ProjectContext, input: PrepareInput): Promise<PreparedSession | undefined> {
    const launch = this.#launch(context);
    if (launch === undefined) return undefined;
    const result = await invokeJson(launch, prepareArgs(input), {
      cwd: context.root,
      env: this.#env(context),
      timeoutMs: PREPARE_TIMEOUT_MS,
    });
    if (result.kind === 'error') {
      this.#output.error(`prepare failed: ${result.error.detail} ${result.error.stderr}`.trim());
      void vscode.window.showErrorMessage(`Could not prepare the session: ${result.error.detail}`);
      return undefined;
    }
    const prepared = parsePrepared(result.value);
    if (prepared === null) {
      void vscode.window.showErrorMessage('Could not prepare the session: unexpected CLI output.');
      return undefined;
    }
    const taskFile = path.resolve(context.root, prepared.taskPath);
    await this.#writeTask(taskFile, input.taskText);
    context.store.refreshSession(prepared.sessionId);
    return preparedSession(context, prepared.sessionId, taskFile);
  }

  /** The CLI leaves `task.md` for the caller to write, so it always exists afterwards, empty if need be. */
  async #writeTask(file: string, content = ''): Promise<void> {
    try {
      await writeFile(file, content, { encoding: 'utf8', flag: content.length > 0 ? 'w' : 'wx' });
    } catch (error) {
      if (isRecord(error) && error.code === 'EEXIST') return;
      const detail = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`The session was prepared but task.md was not written: ${detail}`);
    }
  }

  /** `session repair` under the session's gate; the rebuilt `status.json` returns through the watcher. */
  public async repair(context: ProjectContext, snapshot: SessionSnapshot): Promise<void> {
    if (!(await this.ensureWritable(context, snapshot))) return;
    const launch = this.#launch(context);
    if (launch === undefined) return;
    const id = snapshot.sessionId;
    const handle = this.gate.tryAcquire(this.#sessionKey(context, id), 'Repairing');
    if (handle === null) {
      vscode.window.setStatusBarMessage('Another operation on this session is in progress.', INFO_MESSAGE_MS);
      return;
    }
    try {
      const options = { cwd: context.root, env: this.#env(context), timeoutMs: PREPARE_TIMEOUT_MS };
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: `Repairing ${sessionLabel(snapshot)}` },
        () => invokeText(launch, repairArgs(id), options),
      );
      context.store.refreshSession(id);
      if (result.kind === 'ok') {
        vscode.window.setStatusBarMessage(`Repaired ${sessionLabel(snapshot)}`, STATUS_MESSAGE_MS);
        return;
      }
      const detail = result.error.stderr.trim() || result.error.detail;
      this.#output.error(`repair failed: ${detail}`);
      const picked = await vscode.window.showErrorMessage(`Could not repair the session: ${detail}`, 'View log');
      if (picked === 'View log') this.showLog();
    } finally {
      handle.release();
    }
  }

  /** `doctor --json` shown in the Migent output channel. A failed check is a result, not an error. */
  public async doctor(context: ProjectContext): Promise<void> {
    if (!(await this.ensureWritable(context))) return;
    const launch = this.#launch(context);
    if (launch === undefined) return;
    await runDoctor(context, {
      launch, env: this.#env(context), output: this.#output, showLog: () => { this.showLog(); },
    });
  }

  /** Ask the session's runner to stop. Cancelled is shown only once persisted state agrees. */
  public async cancel(context: ProjectContext, snapshot: SessionSnapshot): Promise<void> {
    const check = checkWrite({ capability: this.#capability.state(context.key).kind, snapshot });
    const launch = this.#launch(context);
    if (!check.ok || launch === undefined) {
      if (!check.ok) await this.#explain(check);
      return;
    }
    const id = snapshot.sessionId;
    const existing = this.#handles.get(this.#handleKey(context, id));
    const handle = existing ?? this.gate.tryAcquire(this.#sessionKey(context, id), 'Stopping');
    if (handle === null) {
      vscode.window.setStatusBarMessage('Another operation on this session is in progress.', INFO_MESSAGE_MS);
      return;
    }
    handle.setPhase('Stopping');
    const result = await this.#requestStop(context, launch, snapshot);
    const current = context.store.snapshot(id);
    const isStopped = result.kind === 'ok' && current !== undefined && current.displayState.state !== 'running';
    // A runner's own gate stays held while the process may still run, so Continue cannot race it.
    if (existing === undefined) handle.release();
    else if (!isStopped) handle.setPhase('Running');
    await this.#reportStop(snapshot, result, isStopped);
  }

  async #reportStop(snapshot: SessionSnapshot, result: InvokeResult<unknown>, isStopped: boolean): Promise<void> {
    if (isStopped) {
      vscode.window.setStatusBarMessage(`Stopped ${sessionLabel(snapshot)}`, STATUS_MESSAGE_MS);
      return;
    }
    const isRefused = result.kind === 'error' && result.error.exitCode === CANCEL_REFUSED_EXIT;
    const detail = result.kind === 'error' ? result.error.stderr.trim() : '';
    const fallback = 'Stop not confirmed. The session may still be running.';
    await this.#offerRecovery(isRefused && detail.length > 0 ? detail : fallback);
  }

  async #requestStop(
    context: ProjectContext,
    launch: LaunchSpec,
    snapshot: SessionSnapshot,
  ): Promise<InvokeResult<unknown>> {
    const options = { location: vscode.ProgressLocation.Window, title: `Stopping ${sessionLabel(snapshot)}` };
    const result = await vscode.window.withProgress(options, async (progress) => {
      progress.report({ message: 'Sending stop request…' });
      const pending = invokeJson(launch, cancelArgs(snapshot.sessionId), {
        cwd: context.root,
        env: this.#env(context),
        timeoutMs: STOP_TIMEOUT_MS,
      });
      await sleep(RECONCILE_DELAY_MS);
      progress.report({ message: 'Waiting for session to stop…' });
      return pending;
    });
    context.store.refreshSession(snapshot.sessionId);
    return result;
  }

  #handleKey(context: ProjectContext, sessionId: string): string {
    return `${context.key}\u0000${sessionId}`;
  }

  #track(context: ProjectContext, sessionId: string, handle: GateHandle): void {
    this.#handles.set(this.#handleKey(context, sessionId), handle);
  }

  #release(context: ProjectContext, state: RunState): void {
    if (state.sessionId !== undefined) this.#handles.delete(this.#handleKey(context, state.sessionId));
    state.handle.release();
  }

  /** Whether persisted state shows the command had an effect on the session. */
  #isConfirmed(context: ProjectContext, sessionId: string, before: SessionSnapshot | undefined): boolean {
    const now = context.store.snapshot(sessionId);
    if (now === undefined) return false;
    if (now.lock.kind === 'alive') return true;
    if (before === undefined) return now.status !== null;
    return (
      now.status?.latestExecutionId !== before.status?.latestExecutionId ||
      now.displayState.state !== before.displayState.state
    );
  }

  async #reconcile(context: ProjectContext, state: RunState): Promise<boolean> {
    const { sessionId, before } = state;
    if (sessionId === undefined) return false;
    for (let attempt = 0; attempt < RECONCILE_ATTEMPTS; attempt += 1) {
      context.store.refreshSession(sessionId);
      if (this.#isConfirmed(context, sessionId, before)) return true;
      await sleep(RECONCILE_DELAY_MS);
    }
    return false;
  }

  /** Move the gate to Running once the store shows the session's lock or execution. */
  #watchRunning(context: ProjectContext, state: RunState): () => void {
    return context.store.onDidChange((event) => {
      if (event.sessionId !== state.sessionId) return;
      if (context.store.snapshot(event.sessionId)?.displayState.state === 'running') state.handle.setPhase('Running');
    });
  }

  /** A new session announces its id on stderr; the launch gate then becomes the session's gate. */
  #onLine(context: ProjectContext, state: RunState, line: string): void {
    this.#output.appendLine(line);
    if (state.sessionId !== undefined) return;
    const id = parseSessionId([line]);
    if (id === undefined) return;
    state.sessionId = id;
    const promoted = state.handle.promote(id);
    if (promoted !== null) state.handle = promoted;
    this.#track(context, id, state.handle);
    context.store.refreshSession(id);
  }

  async #execute(context: ProjectContext, job: Job): Promise<string | undefined> {
    const launch = this.#launch(context);
    if (launch === undefined) return undefined;
    const handle = this.gate.tryAcquire(job.key, 'Starting');
    if (handle === null) {
      vscode.window.setStatusBarMessage('This action is already in progress.', INFO_MESSAGE_MS);
      return undefined;
    }
    const known = job.sessionId;
    const state: RunState = {
      title: job.title,
      handle,
      sessionId: known,
      before: known === undefined ? undefined : context.store.snapshot(known),
    };
    if (known !== undefined) this.#track(context, known, handle);
    const stopWatching = this.#watchRunning(context, state);
    const run = runLong(launch, job.args, {
      cwd: context.root,
      env: this.#env(context),
      onStderrLine: (line) => {
        this.#onLine(context, state, line);
      },
    });
    const result = await this.#showProgress(state, run.result);
    stopWatching();
    await this.#finish(context, state, result);
    return state.sessionId;
  }

  async #showProgress(state: RunState, done: Promise<RunResult>): Promise<RunResult> {
    const options = {
      location: vscode.ProgressLocation.Window,
      title: `${state.title} — continues after closing VS Code`,
    };
    return vscode.window.withProgress(options, () => done);
  }

  async #finish(context: ProjectContext, state: RunState, result: RunResult): Promise<void> {
    if (result.kind === 'spawn-failed') {
      this.#release(context, state);
      this.#output.error(`spawn failed: ${result.detail}`);
      void vscode.window.showErrorMessage(`Could not start the Migent CLI: ${result.detail}`);
      return;
    }
    const isConfirmed = await this.#reconcile(context, state);
    // CLI 0.3.5 rejects the start of a prepared session with a bad draft before it writes anything (exit 2, still
    // prepared, no lock), so holding the gate would only block the retry. Any other unconfirmed result, such as an
    // exit 2 on a Continue, stays uncertain and keeps the gate.
    const { sessionId } = state;
    const isRejectedDraft =
      sessionId !== undefined && isRejectedStart(context, { sessionId, before: state.before, outcome: result.outcome });
    if (isConfirmed || isRejectedDraft || sessionId === undefined) {
      this.#release(context, state);
      if (!isConfirmed || result.outcome === 'ConfigError' || result.outcome === 'Unknown') {
        reportFailure({ context, sessionId }, result, () => { this.showLog(); });
      }
      return;
    }
    // Keep the gate until a later refresh shows an effect: a silent re-enable could duplicate the run.
    const { before } = state;
    const unsubscribe = context.store.onDidChange((event) => {
      if (event.sessionId !== sessionId || !this.#isConfirmed(context, sessionId, before)) return;
      unsubscribe();
      this.#release(context, state);
    });
    await this.#offerRecovery('Status not confirmed.');
  }

  /** Project of the editor document `uri` and its session id, when it is a session's `task.md`. */
  public sessionOfTask(uri: vscode.Uri): { context: ProjectContext; sessionId: string } | undefined {
    for (const context of this.#registry.projects()) {
      const relative = path.relative(path.join(context.root, '.migent', 'sessions'), uri.fsPath);
      const parts = relative.split(path.sep);
      if (relative.startsWith('..') || path.isAbsolute(relative) || parts.length !== TASK_PATH_PARTS) continue;
      if (parts[1] === 'task.md') return { context, sessionId: parts[0] };
    }
    return undefined;
  }
}
