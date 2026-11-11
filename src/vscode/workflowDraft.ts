import * as vscode from 'vscode';

import type { RunOutcome } from '../cli/exitCode';
import { describeFailure } from '../core/failureText';
import { workflowDraftPath } from '../core/paths';
import { hasWorkflowDraft } from './controlHelpers';
import { notify, show } from './notices';
import type { ProjectContext } from './projects';

/** A session that `session prepare` created, with the files the user edits. */
export interface PreparedSession {
  sessionId: string;
  taskFile: string;
  /** The session's editable `workflow.yaml`, which every supported CLI writes at prepare time. */
  workflowFile: string;
}

export function preparedSession(context: ProjectContext, sessionId: string, taskFile: string): PreparedSession {
  return { sessionId, taskFile, workflowFile: workflowDraftPath(context.root, sessionId) };
}

/** Open the session's own `workflow.yaml`; says so when it no longer exists. */
export async function openWorkflowDraft(context: ProjectContext, sessionId: string): Promise<void> {
  if (!hasWorkflowDraft(context.root, sessionId)) {
    notify('draft.missing');
    return;
  }
  try {
    const file = vscode.Uri.file(workflowDraftPath(context.root, sessionId));
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    notify('draft.openFailed', { detail });
  }
}

/**
 * After Prepare, offer to open the session's `workflow.yaml`. The action is bound to this session and checks the
 * file again when clicked, because it may have been removed meanwhile.
 */
export function offerWorkflowDraft(context: ProjectContext, prepared: { sessionId: string }): void {
  void show('draft.prepared', undefined).then((picked) =>
    picked === 'openDraft' ? openWorkflowDraft(context, prepared.sessionId) : undefined,
  );
}

/**
 * Tell the user a command failed. A drafted session gets its `workflow.yaml` as an action, and the text names the
 * draft only when the CLI's own diagnostic does (see `describeFailure`).
 */
export function reportFailure(
  { context, sessionId }: { context: ProjectContext; sessionId: string | undefined },
  result: { outcome: RunOutcome; exitCode: number | null; stderrTail: readonly string[] },
  showLog: () => void,
): void {
  const { message, offersDraft } = describeFailure({
    outcome: result.outcome,
    exitCode: result.exitCode,
    last: result.stderrTail.at(-1),
    isDrafted: sessionId !== undefined && hasWorkflowDraft(context.root, sessionId),
  });
  const actions = offersDraft ? (['openDraft', 'viewLog'] as const) : (['viewLog'] as const);
  void show('command.failed', { message }, actions).then((picked) => {
    if (picked === 'viewLog') showLog();
    else if (picked === 'openDraft' && sessionId !== undefined) return openWorkflowDraft(context, sessionId);
    return undefined;
  });
}
