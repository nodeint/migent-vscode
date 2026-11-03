import { readFile } from 'node:fs/promises';
import path from 'node:path';

import * as vscode from 'vscode';

import type { SessionSnapshot } from '../../core/model';
import { sessionDir, TASK_FILENAME } from '../../core/paths';
import type { WorkflowEntry } from '../../core/workflows';
import type { ControlService, WorkflowChoice } from '../control';
import { pickProject } from '../pick';
import type { ProjectContext } from '../projects';
import { isMetaFileNode } from '../views/projectNodes';
import { type CommandHost, resolveWith } from './sessionCommands';

const LAST_WORKFLOW_KEY = 'migent.lastWorkflow';
const TITLE_MAX_LENGTH = 60;

const isPrepared = (snapshot: SessionSnapshot): boolean => snapshot.displayState.state === 'prepared';
const isRunning = (snapshot: SessionSnapshot): boolean => snapshot.displayState.state === 'running';
export const CONTINUABLE = new Set(['stopped', 'cancelled', 'failed']);
const isContinuable = (snapshot: SessionSnapshot): boolean => CONTINUABLE.has(snapshot.displayState.state);

type TaskInput = { kind: 'task'; text: string } | { kind: 'compose'; text: string };

/** Input Box for the task; its button hands the text over to an editor (the real `task.md`). */
function askTask(workflowId: string): Promise<TaskInput | undefined> {
  return new Promise((resolveInput) => {
    const box = vscode.window.createInputBox();
    box.title = `Run ${workflowId}`;
    box.prompt = 'Describe the task';
    box.buttons = [{ iconPath: new vscode.ThemeIcon('edit'), tooltip: 'Compose in editor' }];
    let isDone = false;
    const finish = (value: TaskInput | undefined): void => {
      if (isDone) return;
      isDone = true;
      box.dispose();
      resolveInput(value);
    };
    box.onDidAccept(() => {
      const text = box.value.trim();
      if (text.length === 0) {
        box.validationMessage = 'Enter a task, or use Compose in editor.';
        return;
      }
      finish({ kind: 'task', text });
    });
    box.onDidTriggerButton(() => {
      finish({ kind: 'compose', text: box.value });
    });
    box.onDidHide(() => {
      finish(undefined);
    });
    box.show();
  });
}

function runnable(context: ProjectContext): WorkflowEntry[] {
  return context.catalog.workflows().entries.filter((entry) => entry.state === 'ok' && !entry.duplicate);
}

async function pickWorkflow(
  context: ProjectContext,
  memento: vscode.Memento,
  title: string,
): Promise<WorkflowEntry | undefined> {
  const entries = runnable(context);
  if (entries.length === 0) {
    void vscode.window.showInformationMessage('This project has no valid workflow to run.');
    return undefined;
  }
  const last = memento.get<string>(`${LAST_WORKFLOW_KEY}.${context.key}`);
  const items = entries
    .map((entry) => ({
      label: entry.id,
      description: entry.title ?? undefined,
      detail: entry.stages.join(' → '),
      entry,
    }))
    .sort((left, right) => Number(right.entry.id === last) - Number(left.entry.id === last));
  const picked = await vscode.window.showQuickPick(items, { title, placeHolder: 'Select a workflow' });
  if (picked !== undefined) await memento.update(`${LAST_WORKFLOW_KEY}.${context.key}`, picked.entry.id);
  return picked?.entry;
}

function titleOf(text: string): string {
  const line = text.split(/\r?\n/).find((candidate) => candidate.trim().length > 0)?.trim() ?? 'Untitled task';
  return line.length > TITLE_MAX_LENGTH ? `${line.slice(0, TITLE_MAX_LENGTH - 1)}…` : line;
}

async function readTask(context: ProjectContext, sessionId: string): Promise<string | undefined> {
  try {
    return await readFile(path.join(sessionDir(context.root, sessionId), TASK_FILENAME), 'utf8');
  } catch {
    return undefined;
  }
}

async function openTask(file: string): Promise<void> {
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  await vscode.window.showTextDocument(document);
}

/** Task entry for a chosen workflow: a one-line task runs now; Compose in editor prepares `task.md`. */
async function runWorkflow(control: ControlService, context: ProjectContext, workflow: WorkflowEntry): Promise<void> {
  const input = await askTask(workflow.id);
  if (input === undefined) return;
  if (input.kind === 'task') {
    await control.runNew(context, workflow.id, input.text);
    return;
  }
  const file = await control.prepare(context, {
    workflowId: workflow.id,
    title: titleOf(input.text),
    taskText: input.text,
  });
  if (file !== undefined) await openTask(file);
}

async function run(control: ControlService, memento: vscode.Memento, registry: CommandHost['registry']): Promise<void> {
  const context = await pickProject(registry);
  if (context === undefined) return;
  const workflow = await pickWorkflow(context, memento, 'Run a workflow');
  if (workflow !== undefined) await runWorkflow(control, context, workflow);
}

/** The project and workflow file of a Workflows row or of the workflow YAML shown in an editor. */
function workflowTarget(host: CommandHost, arg: unknown): { context: ProjectContext; file: string } | undefined {
  if (isMetaFileNode(arg) && arg.kind === 'workflow') {
    const context = host.registry.project(arg.project);
    return context === undefined ? undefined : { context, file: arg.file };
  }
  if (!(arg instanceof vscode.Uri)) return undefined;
  const context = host.registry.projects().find((candidate) => arg.fsPath.startsWith(candidate.root + path.sep));
  return context === undefined ? undefined : { context, file: arg.fsPath };
}

/** Save the workflow document bound to this launch; false (with the editor kept) when it cannot be saved. */
async function saveWorkflow(file: string): Promise<boolean> {
  const document = vscode.workspace.textDocuments.find((open) => open.uri.fsPath === file);
  if (document?.isDirty !== true || (await document.save())) return true;
  void vscode.window.showErrorMessage('The workflow was not saved, so it was not run.');
  return false;
}

/** Run the workflow of a row or YAML editor, skipping the workflow picker. */
interface Deps {
  control: ControlService;
  host: CommandHost;
  memento: vscode.Memento;
}

async function runWorkflowFile({ control, host, memento }: Deps, arg: unknown): Promise<void> {
  const target = workflowTarget(host, arg);
  if (target === undefined) {
    await run(control, memento, host.registry);
    return;
  }
  if (!(await saveWorkflow(target.file))) return;
  // Catalog entries are keyed by file name inside `.migent/workflows`, not by absolute path.
  const name = path.basename(target.file);
  target.context.catalog.reloadWorkflow(name);
  const entry = target.context.catalog.workflows().entries.find((candidate) => candidate.file === name);
  if (entry?.state !== 'ok' || entry.duplicate) {
    void vscode.window.showErrorMessage(entry?.error ?? 'This workflow is not valid, so it cannot be run.');
    return;
  }
  await memento.update(`${LAST_WORKFLOW_KEY}.${target.context.key}`, entry.id);
  await runWorkflow(control, target.context, entry);
}

async function prepare(control: ControlService, memento: vscode.Memento, registry: CommandHost['registry']): Promise<void> {
  const context = await pickProject(registry);
  if (context === undefined) return;
  const workflow = await pickWorkflow(context, memento, 'Prepare a session');
  if (workflow === undefined) return;
  const title = await vscode.window.showInputBox({
    title: `Prepare ${workflow.id}`,
    prompt: 'Session title',
    validateInput: (value) => (value.trim().length === 0 ? 'Enter a title.' : undefined),
  });
  if (title === undefined) return;
  const file = await control.prepare(context, { workflowId: workflow.id, title: title.trim() });
  if (file !== undefined) await openTask(file);
}

interface TaskTarget {
  context: ProjectContext;
  sessionId: string;
  uri?: vscode.Uri;
}

/** The session of an editor-title `task.md`, else the session the caller names or the user picks. */
async function taskTarget(control: ControlService, host: CommandHost, arg: unknown): Promise<TaskTarget | undefined> {
  const uri = arg instanceof vscode.Uri ? arg : vscode.window.activeTextEditor?.document.uri;
  const fromTask = uri === undefined ? undefined : control.sessionOfTask(uri);
  if (fromTask !== undefined) return { ...fromTask, uri };
  const resolved = await resolveWith(host, arg, { title: 'Run which prepared session?', isEligible: isPrepared });
  return resolved === undefined ? undefined : { context: resolved.context, sessionId: resolved.snapshot.sessionId };
}

/** Save a dirty `task.md` and return its text, or undefined after reporting why the run must not start. */
async function savedTask(target: TaskTarget): Promise<string | undefined> {
  const document = vscode.workspace.textDocuments.find((open) => open.uri.fsPath === target.uri?.fsPath);
  if (document?.isDirty === true && !(await document.save())) {
    void vscode.window.showErrorMessage('task.md was not saved, so the session was not started.');
    return undefined;
  }
  const text = document?.getText() ?? (await readTask(target.context, target.sessionId));
  if (text === undefined || text.trim().length === 0) {
    void vscode.window.showErrorMessage('task.md is empty. Write the task, then run again.');
    return undefined;
  }
  return text;
}

async function start(control: ControlService, host: CommandHost, arg: unknown): Promise<void> {
  const target = await taskTarget(control, host, arg);
  if (target === undefined || (await savedTask(target)) === undefined) return;
  // The identity is re-read after the save, so a stale snapshot never starts the wrong state.
  const snapshot = target.context.store.snapshot(target.sessionId);
  const workflowId = snapshot?.manifest?.workflowId;
  if (snapshot === undefined || !isPrepared(snapshot)) {
    void vscode.window.showInformationMessage('This session is no longer prepared.');
  } else if (workflowId === null || workflowId === undefined) {
    void vscode.window.showErrorMessage('The session does not record which workflow to run.');
  } else {
    await control.runPrepared(target.context, snapshot, workflowId);
  }
}

const KEEP = 'Use session version';
const ADOPT = 'Use updated workflow';
const VIEW = 'View changes';

/** Ask which workflow definition to continue with; View changes returns to the same decision. */
export async function chooseWorkflow(
  control: ControlService,
  context: ProjectContext,
  snapshot: SessionSnapshot,
): Promise<WorkflowChoice | undefined> {
  const change = control.workflowChange(context, snapshot);
  if (change === undefined) return 'session';
  const message =
    'The workflow changed since this session started. Continue resets revision counts. ' +
    'Choose which definition to use.';
  for (;;) {
    const picked = await vscode.window.showWarningMessage(message, VIEW, KEEP, ADOPT);
    if (picked === VIEW) {
      await vscode.commands.executeCommand(
        'vscode.diff',
        vscode.Uri.file(change.frozen),
        vscode.Uri.file(change.current),
        'Session workflow ↔ updated workflow',
      );
      continue;
    }
    if (picked === KEEP) return 'session';
    if (picked === ADOPT) return 'updated';
    return undefined;
  }
}

/** Palette, tree and editor-title entry points for the core write commands. */
export function registerControlCommands(
  host: CommandHost,
  control: ControlService,
  memento: vscode.Memento,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('migent.session.run', () => run(control, memento, host.registry)),
    vscode.commands.registerCommand('migent.workflow.run', (arg?: unknown) =>
      runWorkflowFile({ control, host, memento }, arg),
    ),
    vscode.commands.registerCommand('migent.session.prepare', () => prepare(control, memento, host.registry)),
    vscode.commands.registerCommand('migent.session.start', (arg: unknown) => start(control, host, arg)),
    vscode.commands.registerCommand('migent.session.continue', async (arg: unknown) => {
      const resolved = await resolveWith(host, arg, { title: 'Continue which session?', isEligible: isContinuable });
      if (resolved === undefined) return;
      const { context, snapshot } = resolved;
      if (!(await control.ensureWritable(context, snapshot))) return;
      const choice = await chooseWorkflow(control, context, snapshot);
      if (choice !== undefined) await control.continueSession(context, snapshot, choice);
    }),
    vscode.commands.registerCommand('migent.session.cancel', async (arg: unknown) => {
      const resolved = await resolveWith(host, arg, { title: 'Stop which session?', isEligible: isRunning });
      if (resolved !== undefined) await control.cancel(resolved.context, resolved.snapshot);
    }),
  ];
}
