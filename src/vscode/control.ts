import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import * as vscode from 'vscode';

import { parseSessionId } from '../cli/exitCode';
import { invokeJson,type InvokeResult } from '../cli/invoke';
import type { LaunchSpec } from '../cli/locate';
import { runLong, type RunResult } from '../cli/runner';
import {
  cancelArgs,
  continueArgs,
  DEFAULT_RUN_SETTINGS,
  parsePrepared,
  prepareArgs,
  runNewArgs,
  runPreparedArgs,
  type RunSettings,
} from '../core/controlArgs';
import type { SessionSnapshot } from '../core/model';
import { type GateHandle, type GateKey, OperationGate } from '../core/operationGate';
import { frozenWorkflowPath, workflowsDir } from '../core/paths';
import { isRecord } from '../core/record';
import { sessionLabel } from '../core/sessionPresentation';
import { checkWrite, describeBlock, type WriteBlock, type WriteCheck } from '../core/writeEligibility';
import type { CapabilityService } from './capability';
import type { ProjectContext, ProjectRegistry } from './projects';

/** How long Stop waits for the CLI (it waits 15 seconds itself) before the extension gives up. */
export const STOP_TIMEOUT_MS = 20_000;
const RECONCILE_ATTEMPTS = 4;
const RECONCILE_DELAY_MS = 500;
const PREPARE_TIMEOUT_MS = 30_000;
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

function normalizeYaml(text: string): string {
  return text.replaceAll('\r\n', '\n').replace(/[ \t]+$/gm, '').trim();
}

function readText(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
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
      void vscode.window.showInformationMessage(text);
      return;
    }
    const action = { settings: 'Open Settings', recheck: 'Recheck', refresh: 'Refresh' }[block.recovery];
    const command = {
      settings: 'migent.openSettings',
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
    if (!(await this.ensureWritable(context, snapshot))) return;
    const input = { sessionId: snapshot.sessionId, refreshWorkflow: choice === 'updated' };
    await this.#execute(context, {
      key: this.#sessionKey(context, snapshot.sessionId),
      args: continueArgs(input, this.settings(context)),
      title: `Continuing ${sessionLabel(snapshot)}`,
      sessionId: snapshot.sessionId,
    });
  }

  /**
   * Whether the workflow file changed since the session froze its copy, and where both live.
   * Undefined when either side is unavailable: the session version then simply continues.
   */
  public workflowChange(
    context: ProjectContext,
    snapshot: SessionSnapshot,
  ): { frozen: string; current: string } | undefined {
    const workflowId = snapshot.manifest?.workflowId;
    if (workflowId === null || workflowId === undefined) return undefined;
    const {entries} = context.catalog.workflows();
    const entry = entries.find((candidate) => candidate.id === workflowId && !candidate.duplicate);
    if (entry === undefined) return undefined;
    const frozen = frozenWorkflowPath(context.root, snapshot.sessionId);
    const frozenText = readText(frozen);
    const current = path.join(workflowsDir(context.root), entry.file);
    const currentText = readText(current);
    if (frozenText === undefined || currentText === undefined) return undefined;
    return normalizeYaml(frozenText) === normalizeYaml(currentText) ? undefined : { frozen, current };
  }

  /** `session prepare`, then (optionally) the user's task text. Returns the real `task.md` path. */
  public async prepare(context: ProjectContext, input: PrepareInput): Promise<string | undefined> {
    if (!(await this.ensureWritable(context))) return undefined;
    const handle = this.gate.tryAcquire({ kind: 'launch', project: context.key, workflowId: input.workflowId });
    if (handle === null) {
      void vscode.window.showInformationMessage(`A ${input.workflowId} session is already being created.`);
      return undefined;
    }
    try {
      return await this.#prepareSession(context, input);
    } finally {
      handle.release();
    }
  }

  async #prepareSession(context: ProjectContext, input: PrepareInput): Promise<string | undefined> {
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
    return taskFile;
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
      void vscode.window.showInformationMessage('Another operation on this session is in progress.');
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
    const options = { location: vscode.ProgressLocation.Notification, title: `Stopping ${sessionLabel(snapshot)}` };
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

  async #execute(context: ProjectContext, job: Job): Promise<void> {
    const launch = this.#launch(context);
    if (launch === undefined) return;
    const handle = this.gate.tryAcquire(job.key, 'Starting');
    if (handle === null) {
      void vscode.window.showInformationMessage('This action is already in progress.');
      return;
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
    const result = await this.#showProgress(context, state, run.result);
    stopWatching();
    await this.#finish(context, state, result);
  }

  async #showProgress(context: ProjectContext, state: RunState, done: Promise<RunResult>): Promise<RunResult> {
    const onCancel = (): void => {
      const target = state.sessionId === undefined ? undefined : context.store.snapshot(state.sessionId);
      if (target !== undefined) void this.cancel(context, target);
    };
    const options = {
      location: vscode.ProgressLocation.Notification,
      title: `${state.title} — continues after closing VS Code`,
      cancellable: true,
    };
    return vscode.window.withProgress(options, (_progress, token) => {
      token.onCancellationRequested(onCancel);
      return done;
    });
  }

  async #finish(context: ProjectContext, state: RunState, result: RunResult): Promise<void> {
    if (result.kind === 'spawn-failed') {
      this.#release(context, state);
      this.#output.error(`spawn failed: ${result.detail}`);
      void vscode.window.showErrorMessage(`Could not start the Migent CLI: ${result.detail}`);
      return;
    }
    const isConfirmed = await this.#reconcile(context, state);
    if (isConfirmed || state.sessionId === undefined) {
      this.#release(context, state);
      if (!isConfirmed || result.outcome === 'ConfigError' || result.outcome === 'Unknown') this.#reportFailure(result);
      return;
    }
    // Keep the gate until a later refresh shows an effect: a silent re-enable could duplicate the run.
    const { sessionId, before } = state;
    const unsubscribe = context.store.onDidChange((event) => {
      if (event.sessionId !== sessionId || !this.#isConfirmed(context, sessionId, before)) return;
      unsubscribe();
      this.#release(context, state);
    });
    await this.#offerRecovery('Status not confirmed.');
  }

  #reportFailure(result: Extract<RunResult, { kind: 'exited' }>): void {
    const last = result.stderrTail.at(-1);
    const text =
      result.outcome === 'ConfigError'
        ? 'Migent reported a configuration error.'
        : `Migent exited with code ${result.exitCode ?? 'unknown'}.`;
    const message = last === undefined ? text : `${text} ${last}`;
    void vscode.window.showErrorMessage(message, 'Open Settings', 'View log').then((picked) => {
      if (picked === 'Open Settings') void vscode.commands.executeCommand('migent.openSettings');
      else if (picked === 'View log') this.showLog();
    });
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
