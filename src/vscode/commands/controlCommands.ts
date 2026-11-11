import { readFile } from 'node:fs/promises';
import path from 'node:path';

import * as vscode from 'vscode';

import type { SessionSnapshot } from '../../core/model';
import { sessionDir, TASK_FILENAME, workflowDraftPath } from '../../core/paths';
import type { WorkflowEntry } from '../../core/workflows';
import type { ControlService, WorkflowChoice } from '../control';
import { askTask, askTitle, LAUNCH_MODE_ITEMS, titleOf } from '../launchPrompts';
import { notify, show } from '../notices';
import { pickProject } from '../pick';
import type { ProjectContext } from '../projects';
import { isMetaFileNode } from '../views/projectNodes';
import { type CommandHost, resolveWith } from './sessionCommands';

const INFO_MESSAGE_MS = 5000;

const LAST_WORKFLOW_KEY = 'migent.lastWorkflow';

const isPrepared = (snapshot: SessionSnapshot): boolean => snapshot.displayState.state === 'prepared';
const isRunning = (snapshot: SessionSnapshot): boolean => snapshot.displayState.state === 'running';
export const CONTINUABLE = new Set(['stopped', 'cancelled', 'failed']);
const isContinuable = (snapshot: SessionSnapshot): boolean => CONTINUABLE.has(snapshot.displayState.state);

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
    vscode.window.setStatusBarMessage('This project has no valid workflow to run.', INFO_MESSAGE_MS);
    return undefined;
  }
  const last = memento.get<string>(`${LAST_WORKFLOW_KEY}.${context.key}`);
  const items = entries
    .map((entry) => ({
      label: entry.id,
      description: entry.title ?? undefined,
      entry,
    }))
    .sort((left, right) => Number(right.entry.id === last) - Number(left.entry.id === last));
  const picked = await vscode.window.showQuickPick(items, { title, placeHolder: 'Select a workflow' });
  if (picked !== undefined) await memento.update(`${LAST_WORKFLOW_KEY}.${context.key}`, picked.entry.id);
  return picked?.entry;
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
  const input = await askTask(`Run ${workflow.id}`);
  if (input === undefined) return;
  if (input.kind === 'task') {
    await control.runNew(context, workflow.id, input.text);
    return;
  }
  const prepared = await control.prepare(context, {
    workflowId: workflow.id,
    title: titleOf(input.text),
    taskText: input.text,
  });
  if (prepared === undefined) return;
  await openTask(prepared.taskFile);
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
  notify('control.workflowNotSaved');
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
    notify('control.workflowInvalid', { error: entry?.error ?? null });
    return;
  }
  await memento.update(`${LAST_WORKFLOW_KEY}.${target.context.key}`, entry.id);
  await launchWorkflow(control, target.context, entry);
}

/** Title entry for a chosen workflow; prepares the session and opens its `task.md`. */
async function prepareWorkflow(
  control: ControlService,
  context: ProjectContext,
  workflow: WorkflowEntry,
): Promise<void> {
  const title = await askTitle(`Prepare ${workflow.id}`);
  if (title === undefined) return;
  const prepared = await control.prepare(context, { workflowId: workflow.id, title });
  if (prepared === undefined) return;
  await openTask(prepared.taskFile);
}

async function prepare(control: ControlService, memento: vscode.Memento, registry: CommandHost['registry']): Promise<void> {
  const context = await pickProject(registry);
  if (context === undefined) return;
  const workflow = await pickWorkflow(context, memento, 'Prepare a session');
  if (workflow !== undefined) await prepareWorkflow(control, context, workflow);
}

/** Ask whether to run the chosen workflow now or prepare a session for it. */
async function launchWorkflow(
  control: ControlService,
  context: ProjectContext,
  workflow: WorkflowEntry,
): Promise<void> {
  const mode = await vscode.window.showQuickPick(
    LAUNCH_MODE_ITEMS,
    { title: `New session · ${workflow.id}`, placeHolder: 'Run now or prepare' },
  );
  if (mode?.mode === 'run') await runWorkflow(control, context, workflow);
  else if (mode?.mode === 'prepare') await prepareWorkflow(control, context, workflow);
}

/** Sessions view entry: project, workflow, then Run now or Prepare, reusing the choices made. */
async function newSession(control: ControlService, memento: vscode.Memento, registry: CommandHost['registry']): Promise<void> {
  const context = await pickProject(registry);
  if (context === undefined) return;
  const workflow = await pickWorkflow(context, memento, 'New session');
  if (workflow === undefined) return;
  await launchWorkflow(control, context, workflow);
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
    notify('control.noTaskSaved');
    return undefined;
  }
  const text = document?.getText() ?? (await readTask(target.context, target.sessionId));
  if (text === undefined || text.trim().length === 0) {
    notify('control.taskEmpty');
    return undefined;
  }
  return text;
}

/**
 * Save & Run saves `task.md` only. The CLI reads `workflow.yaml` from disk and freezes it, so unsaved edits would
 * be silently ignored; the run is refused instead of saving a file the user did not ask to save.
 */
function hasUnsavedDraft(target: TaskTarget): boolean {
  const file = workflowDraftPath(target.context.root, target.sessionId);
  return vscode.workspace.textDocuments.some((open) => open.uri.fsPath === file && open.isDirty);
}

async function start(control: ControlService, host: CommandHost, arg: unknown): Promise<void> {
  const target = await taskTarget(control, host, arg);
  if (target === undefined || (await savedTask(target)) === undefined) return;
  if (hasUnsavedDraft(target)) {
    notify('control.draftUnsaved');
    return;
  }
  // The identity is re-read after the save, so a stale snapshot never starts the wrong state.
  const snapshot = target.context.store.snapshot(target.sessionId);
  const workflowId = snapshot?.manifest?.workflowId;
  if (snapshot === undefined || !isPrepared(snapshot)) {
    vscode.window.setStatusBarMessage('This session is no longer prepared.', INFO_MESSAGE_MS);
  } else if (workflowId === null || workflowId === undefined) {
    notify('control.noWorkflowRecorded');
  } else {
    await control.runPrepared(target.context, snapshot, workflowId);
  }
}


/** Ask which workflow definition to continue with; View changes returns to the same decision. */
export async function chooseWorkflow(
  control: ControlService,
  context: ProjectContext,
  snapshot: SessionSnapshot,
): Promise<WorkflowChoice | undefined> {
  const change = control.workflowChange(context, snapshot);
  if (change === undefined) return 'session';
  for (;;) {
    const picked = await show('control.workflowChanged', undefined);
    if (picked === 'viewChanges') {
      await vscode.commands.executeCommand(
        'vscode.diff',
        vscode.Uri.file(change.frozen),
        vscode.Uri.file(change.current),
        'Session workflow ↔ updated workflow',
      );
      continue;
    }
    if (picked === 'keepSession') return 'session';
    if (picked === 'adoptUpdated') return 'updated';
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
    vscode.commands.registerCommand('migent.session.new', () => newSession(control, memento, host.registry)),
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
