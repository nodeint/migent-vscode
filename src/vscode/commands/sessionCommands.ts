import path from 'node:path';

import * as vscode from 'vscode';

import type { SessionSnapshot } from '../../core/model';
import type { OperationGate } from '../../core/operationGate';
import { listOutputs } from '../../core/outputs';
import { EXECUTIONS_DIRNAME, FAILURE_REPORT_FILENAME, QUESTIONS_FILENAME, sessionDir, TASK_FILENAME } from '../../core/paths';
import { sessionLabel } from '../../core/sessionPresentation';
import { DEFAULT_SESSION_LIMIT } from '../../core/store';
import { openFile, openReadOnly } from '../openFile';
import { type PickedSession,pickSession } from '../pick';
import type { ProjectRegistry } from '../projects';
import type { ActiveTarget } from '../results/panels';
import { isTreeNode } from '../views/nodes';
import { deleteSession } from './deleteSession';

const INFO_MESSAGE_MS = 5000;

const STATUS_MESSAGE_MS = 2000;

/** Command arguments are typed tree nodes; an absent or foreign argument means "ask the user". */
interface Target {
  project: string;
  sessionId: string;
  executionId?: string;
  outputUri?: vscode.Uri;
}

/** A notification names its session explicitly: `{ project, sessionId }` without a tree node's `kind`. */
function explicitTarget(arg: unknown): Target | undefined {
  if (typeof arg !== 'object' || arg === null || !('project' in arg) || !('sessionId' in arg)) return undefined;
  const { project, sessionId } = arg;
  if (typeof project !== 'string' || typeof sessionId !== 'string') return undefined;
  const executionId = 'executionId' in arg && typeof arg.executionId === 'string' ? arg.executionId : undefined;
  return { project, sessionId, executionId };
}

function targetOf(arg: unknown): Target | undefined {
  if (!isTreeNode(arg)) return explicitTarget(arg);
  switch (arg.kind) {
    case 'session':
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

/** What a command needs to find its session: the projects and the active Results panel. */
export interface CommandHost {
  registry: ProjectRegistry;
  active: ActiveTarget;
}

export type Resolved = PickedSession & { target?: Target };

/**
 * The target is the tree node passed in, else the session of the active Results panel, else the user's pick.
 * A stale tree selection is never an implicit target.
 */
export interface ResolveQuery {
  title: string;
  /** Limits the Quick Pick; a clicked or panel target is returned as is and judged by the command. */
  isEligible?: (snapshot: SessionSnapshot) => boolean;
}

export async function resolveWith(host: CommandHost, arg: unknown, query: ResolveQuery): Promise<Resolved | undefined> {
  const { registry } = host;
  const target = targetOf(arg) ?? host.active.activeTarget();
  const context = target === undefined ? undefined : registry.project(target.project);
  const snapshot = target === undefined ? undefined : context?.store.snapshot(target.sessionId);
  if (context !== undefined && snapshot !== undefined) return { context, snapshot, target };
  // A notification names its session explicitly: if that session is gone, say so instead of picking another.
  if (explicitTarget(arg) !== undefined) {
    vscode.window.setStatusBarMessage('That session is no longer available. Refresh the Sessions view.', INFO_MESSAGE_MS);
    return undefined;
  }
  return pickSession(registry, query.title, query.isEligible);
}

export function resolve(host: CommandHost, arg: unknown, title: string): Promise<Resolved | undefined> {
  return resolveWith(host, arg, { title });
}

async function openOutput(host: CommandHost, arg: unknown): Promise<void> {
  const resolved = await resolve(host, arg, 'Open output of which session?');
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
    vscode.window.setStatusBarMessage(`Session ${sessionLabel(snapshot)} has no output files.`, INFO_MESSAGE_MS);
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

/** The file path of the selected execution, or undefined after reporting why it cannot be opened. */
async function executionFilePath(host: CommandHost, arg: unknown, file: string): Promise<string | undefined> {
  const resolved = await resolve(host, arg, `Open ${file} of which session?`);
  if (resolved === undefined) return undefined;
  const executionId = resolved.target?.executionId ?? resolved.snapshot.status?.latestExecutionId ?? null;
  if (executionId === null) {
    vscode.window.setStatusBarMessage(`Session ${sessionLabel(resolved.snapshot)} has no execution yet.`, INFO_MESSAGE_MS);
    return undefined;
  }
  const dir = sessionDir(resolved.context.root, resolved.snapshot.sessionId);
  return path.join(dir, EXECUTIONS_DIRNAME, executionId, file);
}

async function openExecutionFile(host: CommandHost, arg: unknown, file: string): Promise<void> {
  const target = await executionFilePath(host, arg, file);
  if (target !== undefined) await openFile(target, file);
}

async function openSessionFile(host: CommandHost, arg: unknown, file: string): Promise<void> {
  const resolved = await resolve(host, arg, `Open ${file} of which session?`);
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
export function registerSessionCommands(host: CommandHost, gate: OperationGate): vscode.Disposable[] {
  const { registry } = host;
  const register = (id: string, run: (arg: unknown) => Promise<void> | void): vscode.Disposable =>
    vscode.commands.registerCommand(id, run);
  return [
    register('migent.session.delete', (arg) => deleteSession({ registry, gate }, arg)),
    register('migent.session.openTask', (arg) => openSessionFile(host, arg, TASK_FILENAME)),
    register('migent.session.openPrompt', (arg) => openExecutionFile(host, arg, 'prompt.md')),
    register('migent.session.openResponse', (arg) => openExecutionFile(host, arg, 'response.md')),
    register('migent.session.openFailure', async (arg) => {
      const target = await executionFilePath(host, arg, FAILURE_REPORT_FILENAME);
      if (target !== undefined) await openReadOnly(target, FAILURE_REPORT_FILENAME);
    }),
    register('migent.session.openOutput', (arg) => openOutput(host, arg)),
    register('migent.session.openQuestions', (arg) => openSessionFile(host, arg, QUESTIONS_FILENAME)),
    register('migent.session.copyId', async (arg) => {
      const resolved = await resolve(host, arg, 'Copy the id of which session?');
      if (resolved === undefined) return;
      await vscode.env.clipboard.writeText(resolved.snapshot.sessionId);
      vscode.window.setStatusBarMessage(`Copied session id ${resolved.snapshot.sessionId}`, STATUS_MESSAGE_MS);
    }),
    register('migent.session.revealInExplorer', async (arg) => {
      const resolved = await resolve(host, arg, 'Reveal which session?');
      if (resolved === undefined) return;
      const uri = vscode.Uri.file(sessionDir(resolved.context.root, resolved.snapshot.sessionId));
      await vscode.commands.executeCommand('revealFileInOS', uri);
    }),
    register('migent.sessions.showMore', (arg) => {
      showMore(registry, arg);
    }),
  ];
}
