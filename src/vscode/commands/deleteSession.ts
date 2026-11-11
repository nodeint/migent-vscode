import * as vscode from 'vscode';

import type { SessionSnapshot } from '../../core/model';
import type { OperationGate } from '../../core/operationGate';
import { sessionDir } from '../../core/paths';
import { sessionLabel } from '../../core/sessionPresentation';
import { confirm, notify } from '../notices';
import type { ProjectContext, ProjectRegistry } from '../projects';
import { isTreeNode } from '../views/nodes';

/** The error notices a delete can report; the seam passes the id and params and never writes text. */
export type DeleteError =
  | { id: 'deleteSession.busy' | 'deleteSession.running' }
  | { id: 'deleteSession.failed'; params: { detail: string } };

export interface DeleteUI {
  confirm: (label: string) => Promise<boolean>;
  remove: (uri: vscode.Uri) => Thenable<void>;
  error: (error: DeleteError) => void;
}

const defaultUI: DeleteUI = {
  confirm: (label) => confirm('deleteSession.confirm', { label }),
  remove: (uri) => vscode.workspace.fs.delete(uri, { recursive: true, useTrash: true }),
  error: (error) => {
    if (error.id === 'deleteSession.failed') notify(error.id, error.params);
    else notify(error.id);
  },
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
    ui.error({ id: 'deleteSession.busy' });
    return;
  }
  try {
    if (registry.project(project) !== context) return;
    context.store.refreshSession(sessionId);
    const current = context.store.snapshot(sessionId);
    if (current === undefined) return;
    if (current.lock.kind === 'alive' || current.displayState.state === 'running') {
      ui.error({ id: 'deleteSession.running' });
      return;
    }
    await ui.remove(vscode.Uri.file(sessionDir(context.root, sessionId)));
    context.store.load();
  } catch (error) {
    ui.error({
      id: 'deleteSession.failed',
      params: { detail: error instanceof Error ? error.message : String(error) },
    });
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
