import path from 'node:path';

import * as vscode from 'vscode';

import { configPath, MIGENT_DIR, WORKFLOWS_DIRNAME } from '../../core/paths';
import { openFile } from '../openFile';
import { pickProject } from '../pick';
import type { ProjectRegistry } from '../projects';
import { isMetaFileNode } from '../views/projectNodes';
import type { WorkflowEditorPanels } from '../workflowEditor/panels';

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

async function openConfig(registry: ProjectRegistry, arg: unknown): Promise<void> {
  if (isMetaFileNode(arg) && arg.kind === 'config') {
    await openFile(arg.file, 'Project config');
    return;
  }
  const context = await pickProject(registry);
  if (context !== undefined) await openFile(configPath(context.root), 'Project config');
}

function editWorkflow(editor: WorkflowEditorPanels, arg: unknown): void {
  if (!isMetaFileNode(arg) || arg.kind !== 'workflow') return;
  editor.open({ project: arg.project, file: path.basename(arg.file) });
}

export function registerProjectCommands(
  registry: ProjectRegistry,
  editor: WorkflowEditorPanels,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('migent.workflow.edit', (arg?: unknown) => editWorkflow(editor, arg)),
    vscode.commands.registerCommand('migent.workflow.open', (arg?: unknown) => openWorkflow(registry, arg)),
    vscode.commands.registerCommand('migent.openConfig', (arg?: unknown) => openConfig(registry, arg)),
  ];
}
