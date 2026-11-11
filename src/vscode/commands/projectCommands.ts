import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import * as vscode from 'vscode';

import { configPath, MIGENT_DIR, WORKFLOWS_DIRNAME, workflowsDir } from '../../core/paths';
import { duplicateWorkflowText, workflowFileName, workflowIdProblem } from '../../core/workflowDraft';
import type { CapabilityService } from '../capability';
import type { ConfigPanels } from '../config/panels';
import { confirm, notify } from '../notices';
import { openFile } from '../openFile';
import { pickProject } from '../pick';
import type { ProjectContext, ProjectRegistry } from '../projects';
import { isMetaFileNode } from '../views/projectNodes';
import type { WorkflowEditorPanels } from '../workflowEditor/panels';
import { createWorkflowCopy } from './workflowCopy';

const INFO_MESSAGE_MS = 5000;

/**
 * Open a workflow file. The target is the tree node passed in, else the user's pick: a stale tree
 * selection is never an implicit target. Opens the real file; a missing file is reported, not created.
 */
async function openWorkflow(registry: ProjectRegistry, arg: unknown): Promise<void> {
  if (isMetaFileNode(arg) && arg.kind === 'workflow') {
    await openFile(arg.file, 'Workflow');
    return;
  }
  const context = await pickProject(registry);
  if (context === undefined) return;
  const { entries } = context.catalog.workflows();
  if (entries.length === 0) {
    vscode.window.setStatusBarMessage('This project has no workflow files.', INFO_MESSAGE_MS);
    return;
  }
  const picked = await vscode.window.showQuickPick(
    entries.map((entry) => ({
      label: entry.state === 'ok' ? entry.id : entry.file,
      description: entry.state === 'ok' ? entry.file : `${entry.state} · ${entry.file}`,
      entry,
    })),
    { title: 'Open workflow', matchOnDescription: true },
  );
  if (picked === undefined) return;
  await openFile(path.join(context.root, MIGENT_DIR, WORKFLOWS_DIRNAME, picked.entry.file), 'Workflow');
}

async function openConfigFile(registry: ProjectRegistry, arg: unknown): Promise<void> {
  if (isMetaFileNode(arg) && arg.kind === 'config') {
    await openFile(arg.file, 'Project config');
    return;
  }
  const context = await pickProject(registry);
  if (context !== undefined) await openFile(configPath(context.root), 'Project config');
}

async function openConfig(registry: ProjectRegistry, config: ConfigPanels, arg: unknown): Promise<void> {
  if (isMetaFileNode(arg) && arg.kind === 'config') {
    config.open(arg.project);
    return;
  }
  const context = await pickProject(registry);
  if (context !== undefined) config.open(context.key);
}

function editWorkflow(editor: WorkflowEditorPanels, arg: unknown): void {
  if (!isMetaFileNode(arg) || arg.kind !== 'workflow') return;
  editor.open({ project: arg.project, file: path.basename(arg.file) });
}

/** Ask for a workflow id that is path-safe and not used by an existing file; undefined when cancelled. */
async function askWorkflowId(root: string, title: string, value: string): Promise<string | undefined> {
  const id = await vscode.window.showInputBox({
    title,
    value,
    prompt: 'The id is also the file name (<id>.yaml).',
    validateInput: (text) => {
      const problem = workflowIdProblem(text.trim());
      if (problem !== null) return problem;
      const file = workflowFileName(text.trim());
      return existsSync(path.join(workflowsDir(root), file)) || existsSync(path.join(workflowsDir(root), `${text.trim()}.yml`))
        ? `.migent/workflows/${file} already exists.`
        : undefined;
    },
  });
  return id?.trim();
}

/** Resolve the project and workflow file a command targets: the tree node, else a pick. */
async function targetWorkflow(
  registry: ProjectRegistry,
  arg: unknown,
  title: string,
): Promise<{ context: ProjectContext; file: string } | undefined> {
  if (isMetaFileNode(arg) && arg.kind === 'workflow') {
    const context = registry.project(arg.project);
    return context === undefined ? undefined : { context, file: path.basename(arg.file) };
  }
  const context = await pickProject(registry);
  if (context === undefined) return undefined;
  const { entries } = context.catalog.workflows();
  if (entries.length === 0) {
    vscode.window.setStatusBarMessage('This project has no workflow files.', INFO_MESSAGE_MS);
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    entries.map((entry) => ({ label: entry.state === 'ok' ? entry.id : entry.file, description: entry.file, entry })),
    { title },
  );
  return picked === undefined ? undefined : { context, file: picked.entry.file };
}

/** Open an unsaved starter draft; the file is written only when the user saves. */
async function newWorkflow(registry: ProjectRegistry, editor: WorkflowEditorPanels, arg: unknown): Promise<void> {
  const context = isMetaFileNode(arg) ? registry.project(arg.project) : await pickProject(registry);
  if (context === undefined) return;
  const id = await askWorkflowId(context.root, 'New workflow', '');
  if (id === undefined) return;
  editor.open({ project: context.key, file: workflowFileName(id) }, { isNew: true });
}

interface DuplicateDeps {
  registry: ProjectRegistry;
  capability: CapabilityService;
  editor: WorkflowEditorPanels;
}

function fail(message: string): void {
  notify('workflow.duplicateFailed', { message });
}

async function createCopy(
  capability: CapabilityService,
  context: ProjectContext,
  draft: { file: string; text: string },
): Promise<string | null> {
  let state = capability.state(context.key);
  if (state.kind === 'checking') state = await capability.windowReady();
  if (state.kind !== 'ok' || state.launch === undefined) return 'Duplicating needs a usable Migent CLI.';
  return createWorkflowCopy(state.launch, context.root, draft);
}

/** Copy the saved file under a new id. */
async function duplicateWorkflow(deps: DuplicateDeps, arg: unknown): Promise<void> {
  const target = await targetWorkflow(deps.registry, arg, 'Duplicate workflow');
  if (target === undefined) return;
  const { context, file } = target;
  let text: string;
  try {
    text = readFileSync(path.join(workflowsDir(context.root), file), 'utf8');
  } catch (error) {
    fail(error instanceof Error ? error.message : 'The file cannot be read.');
    return;
  }
  const id = await askWorkflowId(context.root, `Duplicate ${file}`, `${path.basename(file, path.extname(file))}-copy`);
  if (id === undefined) return;
  const copy = duplicateWorkflowText(text, id);
  const newFile = workflowFileName(id);
  const problem =
    copy === null
      ? 'The file is not a workflow mapping.'
      : await createCopy(deps.capability, context, { file: newFile, text: copy });
  if (problem !== null) {
    fail(problem);
    return;
  }
  context.catalog.reloadWorkflow(newFile);
  deps.editor.open({ project: context.key, file: newFile });
}

/** Move the workflow file to the Trash after a modal confirmation, then close its page. */
async function deleteWorkflow(registry: ProjectRegistry, editor: WorkflowEditorPanels, arg: unknown): Promise<void> {
  const target = await targetWorkflow(registry, arg, 'Delete workflow');
  if (target === undefined) return;
  const { context, file } = target;
  if (!(await confirm('workflow.deleteConfirm', { file }))) return;
  try {
    await vscode.workspace.fs.delete(vscode.Uri.file(path.join(workflowsDir(context.root), file)), { useTrash: true });
  } catch (error) {
    notify('workflow.deleteFailed', { detail: error instanceof Error ? error.message : 'unknown error' });
    return;
  }
  editor.close({ project: context.key, file });
  context.catalog.reloadWorkflow(file);
}

export interface ProjectCommandHost {
  registry: ProjectRegistry;
  editor: WorkflowEditorPanels;
  capability: CapabilityService;
  config: ConfigPanels;
}

export function registerProjectCommands(host: ProjectCommandHost): vscode.Disposable[] {
  const { registry, editor, capability, config } = host;
  return [
    vscode.commands.registerCommand('migent.workflow.new', (arg?: unknown) => newWorkflow(registry, editor, arg)),
    vscode.commands.registerCommand('migent.workflow.duplicate', (arg?: unknown) =>
      duplicateWorkflow({ registry, capability, editor }, arg),
    ),
    vscode.commands.registerCommand('migent.workflow.delete', (arg?: unknown) => deleteWorkflow(registry, editor, arg)),
    vscode.commands.registerCommand('migent.workflow.edit', (arg?: unknown) => editWorkflow(editor, arg)),
    vscode.commands.registerCommand('migent.workflow.open', (arg?: unknown) => openWorkflow(registry, arg)),
    vscode.commands.registerCommand('migent.openConfig', (arg?: unknown) => openConfig(registry, config, arg)),
    vscode.commands.registerCommand('migent.openConfigFile', (arg?: unknown) => openConfigFile(registry, arg)),
  ];
}
