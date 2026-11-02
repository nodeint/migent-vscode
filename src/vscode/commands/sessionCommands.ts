import path from 'node:path';

import * as vscode from 'vscode';

import { listOutputs } from '../../core/outputs';
import { EXECUTIONS_DIRNAME, QUESTIONS_FILENAME, sessionDir, TASK_FILENAME } from '../../core/paths';
import { sessionLabel } from '../../core/sessionPresentation';
import { DEFAULT_SESSION_LIMIT } from '../../core/store';
import { type PickedSession,pickSession } from '../pick';
import type { ProjectRegistry } from '../projects';
import { isTreeNode } from '../views/nodes';

const STATUS_MESSAGE_MS = 2000;

/** Command arguments are typed tree nodes; an absent or foreign argument means "ask the user". */
interface Target {
  project: string;
  sessionId: string;
  executionId?: string;
  outputUri?: vscode.Uri;
}

function targetOf(arg: unknown): Target | undefined {
  if (!isTreeNode(arg)) return undefined;
  switch (arg.kind) {
    case 'session':
    case 'outputs':
    case 'questions':
    case 'history':
    case 'questionGroup':
      return { project: arg.project, sessionId: arg.sessionId };
    case 'execution':
      return { project: arg.project, sessionId: arg.sessionId, executionId: arg.executionId };
    case 'leaf':
      if (arg.sessionId === undefined) return undefined;
      return {
        project: arg.project,
        sessionId: arg.sessionId,
        executionId: arg.executionId,
        outputUri: arg.view.contextValue === 'file.output' ? arg.view.uri : undefined,
      };
    default:
      return undefined;
  }
}

export type Resolved = PickedSession & { target?: Target };

export async function resolve(registry: ProjectRegistry, arg: unknown, title: string): Promise<Resolved | undefined> {
  const target = targetOf(arg);
  const context = target === undefined ? undefined : registry.project(target.project);
  const snapshot = target === undefined ? undefined : context?.store.snapshot(target.sessionId);
  if (context !== undefined && snapshot !== undefined) return { context, snapshot, target };
  return pickSession(registry, title);
}

/** Open a real file in its native editor; a missing file is reported by path and never created. */
async function openFile(file: string, what: string): Promise<void> {
  const uri = vscode.Uri.file(file);
  try {
    await vscode.workspace.fs.stat(uri);
  } catch {
    void vscode.window.showWarningMessage(`${what} not found: ${file}`);
    return;
  }
  await vscode.commands.executeCommand('vscode.open', uri);
}

async function openOutput(registry: ProjectRegistry, arg: unknown): Promise<void> {
  const resolved = await resolve(registry, arg, 'Open output of which session?');
  if (resolved === undefined) return;
  if (resolved.target?.outputUri !== undefined) {
    await vscode.commands.executeCommand('vscode.open', resolved.target.outputUri);
    return;
  }
  const { context, snapshot } = resolved;
  const rows = listOutputs(sessionDir(context.root, snapshot.sessionId), snapshot.status?.outputs ?? []).rows.filter(
    (row) => row.state === 'ok' && row.absolutePath !== null,
  );
  if (rows.length === 0) {
    void vscode.window.showInformationMessage(`${sessionLabel(snapshot)} has no output files.`);
    return;
  }
  const picked =
    rows.length === 1
      ? rows[0]
      : (await vscode.window.showQuickPick(
          rows.map((row) => ({ label: row.name ?? path.posix.basename(row.path), description: row.path, row })),
          { title: 'Open output' },
        ))?.row;
  if (picked?.absolutePath !== undefined && picked.absolutePath !== null) {
    await openFile(picked.absolutePath, 'Output');
  }
}

async function openExecutionFile(registry: ProjectRegistry, arg: unknown, file: string): Promise<void> {
  const resolved = await resolve(registry, arg, `Open ${file} of which session?`);
  if (resolved === undefined) return;
  const executionId = resolved.target?.executionId ?? resolved.snapshot.status?.latestExecutionId ?? null;
  if (executionId === null) {
    void vscode.window.showInformationMessage(`${sessionLabel(resolved.snapshot)} has no execution yet.`);
    return;
  }
  await openFile(
    path.join(sessionDir(resolved.context.root, resolved.snapshot.sessionId), EXECUTIONS_DIRNAME, executionId, file),
    file,
  );
}

async function openSessionFile(registry: ProjectRegistry, arg: unknown, file: string): Promise<void> {
  const resolved = await resolve(registry, arg, `Open ${file} of which session?`);
  if (resolved === undefined) return;
  await openFile(path.join(sessionDir(resolved.context.root, resolved.snapshot.sessionId), file), file);
}

function showMore(registry: ProjectRegistry, arg: unknown): void {
  const project = typeof arg === 'object' && arg !== null && 'project' in arg ? String(arg.project) : undefined;
  const context = project === undefined ? undefined : registry.project(project);
  if (context === undefined) return;
  const step = vscode.workspace
    .getConfiguration('migent', context.folder.uri)
    .get<number>('sessions.limit', DEFAULT_SESSION_LIMIT);
  context.store.setLimit(context.store.limit + step);
}

/** Read-only session commands: open files, copy the id, reveal the folder, show more. */
export function registerSessionCommands(registry: ProjectRegistry): vscode.Disposable[] {
  const register = (id: string, run: (arg: unknown) => Promise<void> | void): vscode.Disposable =>
    vscode.commands.registerCommand(id, run);
  return [
    register('migent.session.openTask', (arg) => openSessionFile(registry, arg, TASK_FILENAME)),
    register('migent.session.openPrompt', (arg) => openExecutionFile(registry, arg, 'prompt.md')),
    register('migent.session.openResponse', (arg) => openExecutionFile(registry, arg, 'response.md')),
    register('migent.session.openOutput', (arg) => openOutput(registry, arg)),
    register('migent.session.openQuestions', (arg) => openSessionFile(registry, arg, QUESTIONS_FILENAME)),
    register('migent.session.copyId', async (arg) => {
      const resolved = await resolve(registry, arg, 'Copy the id of which session?');
      if (resolved === undefined) return;
      await vscode.env.clipboard.writeText(resolved.snapshot.sessionId);
      vscode.window.setStatusBarMessage(`Copied session id ${resolved.snapshot.sessionId}`, STATUS_MESSAGE_MS);
    }),
    register('migent.session.revealInExplorer', async (arg) => {
      const resolved = await resolve(registry, arg, 'Reveal which session?');
      if (resolved === undefined) return;
      const uri = vscode.Uri.file(sessionDir(resolved.context.root, resolved.snapshot.sessionId));
      await vscode.commands.executeCommand('revealFileInOS', uri);
    }),
    register('migent.sessions.showMore', (arg) => {
      showMore(registry, arg);
    }),
  ];
}
