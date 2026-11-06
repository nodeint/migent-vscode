import * as vscode from 'vscode';

import type { RunOutcome } from '../cli/exitCode';
import { describeFailure } from '../core/failureText';
import { workflowDraftPath } from '../core/paths';
import { hasWorkflowDraft } from './controlHelpers';
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

const OPEN_DRAFT = 'Open workflow.yaml';
const VIEW_LOG = 'View log';

/** Open the session's own `workflow.yaml`; says so when it no longer exists. */
export async function openWorkflowDraft(context: ProjectContext, sessionId: string): Promise<void> {
  if (!hasWorkflowDraft(context.root, sessionId)) {
    void vscode.window.showWarningMessage('This session no longer has a workflow.yaml.');
    return;
  }
  try {
    const file = vscode.Uri.file(workflowDraftPath(context.root, sessionId));
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`Could not open workflow.yaml: ${detail}`);
  }
}

/**
 * After Prepare, offer to open the session's `workflow.yaml`. The action is bound to this session and checks the
 * file again when clicked, because it may have been removed meanwhile.
 */
export function offerWorkflowDraft(context: ProjectContext, prepared: { sessionId: string }): void {
  void vscode.window
    .showInformationMessage('Session prepared. Its workflow can be edited before it runs.', OPEN_DRAFT)
    .then((picked) => (picked === OPEN_DRAFT ? openWorkflowDraft(context, prepared.sessionId) : undefined));
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
  const actions = offersDraft ? [OPEN_DRAFT, VIEW_LOG] : [VIEW_LOG];
  void vscode.window.showErrorMessage(message, ...actions).then((picked) => {
    if (picked === VIEW_LOG) showLog();
    else if (picked === OPEN_DRAFT && sessionId !== undefined) return openWorkflowDraft(context, sessionId);
    return undefined;
  });
}
