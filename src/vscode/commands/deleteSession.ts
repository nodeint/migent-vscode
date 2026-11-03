import * as vscode from 'vscode';

import type { SessionSnapshot } from '../../core/model';
import type { OperationGate } from '../../core/operationGate';
import { sessionDir } from '../../core/paths';
import { sessionLabel } from '../../core/sessionPresentation';
import type { ProjectContext, ProjectRegistry } from '../projects';
import { isTreeNode } from '../views/nodes';

interface DeleteUI {
  confirm: (label: string) => Promise<boolean>;
  remove: (uri: vscode.Uri) => Thenable<void>;
  error: (message: string) => void;
}

const defaultUI: DeleteUI = {
  confirm: async (label) => (await vscode.window.showWarningMessage(
    `Delete session ${label}?`,
    { modal: true, detail: 'The session folder and its contents will be deleted. VS Code uses the trash when available.' },
    'Delete',
  )) === 'Delete',
  remove: (uri) => vscode.workspace.fs.delete(uri, { recursive: true, useTrash: true }),
  error: (message) => { void vscode.window.showErrorMessage(message); },
};

interface DeleteHost {
  registry: ProjectRegistry;
  gate: OperationGate;
}

interface DeleteTarget {
  project: string;
  sessionId: string;
  context: ProjectContext;
  snapshot: SessionSnapshot;
}

function resolveTarget(registry: ProjectRegistry, arg: unknown): DeleteTarget | undefined {
  if (!isTreeNode(arg) || arg.kind !== 'session') return;
  const { project, sessionId } = arg;
  if (sessionId === '.' || sessionId === '..' || /[/\\]/.test(sessionId)) return;
  const context = registry.project(project);
  const snapshot = context?.store.snapshot(sessionId);
  if (context === undefined || snapshot === undefined) return;
  return { project, sessionId, context, snapshot };
}

async function removeTarget(host: DeleteHost, target: DeleteTarget, ui: DeleteUI): Promise<void> {
  const { registry, gate } = host;
  const { project, sessionId, context } = target;
  const handle = gate.tryAcquire({ kind: 'session', project, sessionId }, 'Deleting');
  if (handle === null) {
    ui.error('Cannot delete a session while an operation is in progress.');
    return;
  }
  try {
    if (registry.project(project) !== context) return;
    context.store.refreshSession(sessionId);
    const current = context.store.snapshot(sessionId);
    if (current === undefined) return;
    if (current.lock.kind === 'alive' || current.displayState.state === 'running') {
      ui.error('Cannot delete a running session. Stop it first.');
      return;
    }
    await ui.remove(vscode.Uri.file(sessionDir(context.root, sessionId)));
    context.store.load();
  } catch (error) {
    ui.error(`Could not delete session: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    handle.release();
  }
}

/** Delete only an explicitly selected session, never a fallback selection. */
export async function deleteSession(host: DeleteHost, arg: unknown, ui: DeleteUI = defaultUI): Promise<void> {
  const target = resolveTarget(host.registry, arg);
  if (target === undefined || !await ui.confirm(sessionLabel(target.snapshot))) return;
  await removeTarget(host, target, ui);
}
