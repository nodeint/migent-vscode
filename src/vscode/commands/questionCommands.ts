import * as vscode from 'vscode';

import type { SessionSnapshot } from '../../core/model';
import { groupPendingQuestions,type QuestionGroup } from '../../core/questions';
import { sessionLabel } from '../../core/sessionPresentation';
import { type BatchIdentity, isBatchIdentity } from '../questions/entry';
import type { AnswerPanels } from '../questions/panels';
import { isTreeNode } from '../views/nodes';
import { type CommandHost, resolveWith } from './sessionCommands';

const hasPending = (snapshot: SessionSnapshot): boolean => (snapshot.status?.questions.length ?? 0) > 0;

/** A group is addressable only with an execution; the identity of a batch is `(execution, stage)`. */
const isAddressable = (group: QuestionGroup): boolean => group.executionId !== null;

async function pickGroup(groups: QuestionGroup[]): Promise<QuestionGroup | undefined> {
  const [only] = groups;
  if (groups.length === 1) return only;
  const picked = await vscode.window.showQuickPick(
    groups.map((group) => ({
      label: group.stageId ?? 'Role session',
      description: `${group.questions.length} pending`,
      detail: group.executionId ?? undefined,
      group,
    })),
    { title: 'Answer which stage?' },
  );
  return picked?.group;
}

async function resolveBatch(host: CommandHost, arg: unknown): Promise<BatchIdentity | undefined> {
  // A notification passes the exact batch it announced.
  if (isBatchIdentity(arg)) return arg;
  if (isTreeNode(arg) && arg.kind === 'questionGroup' && arg.executionId !== null) {
    return { project: arg.project, sessionId: arg.sessionId, stageId: arg.stageId, executionId: arg.executionId };
  }
  const resolved = await resolveWith(host, arg, { title: 'Answer questions for which session?', isEligible: hasPending });
  if (resolved === undefined) return undefined;
  const { context, snapshot } = resolved;
  const groups = groupPendingQuestions(snapshot.status?.questions ?? []).filter(isAddressable);
  if (groups.length === 0) {
    void vscode.window.showInformationMessage(`${sessionLabel(snapshot)} has no pending questions.`);
    return undefined;
  }
  const group = await pickGroup(groups);
  if (group?.executionId === null || group === undefined) return undefined;
  const { stageId, executionId } = group;
  return { project: context.key, sessionId: snapshot.sessionId, stageId, executionId };
}

/** `migent.session.answerQuestions`: opens the exact batch of a node, else asks the user which. */
export function registerQuestionCommands(host: CommandHost, panels: AnswerPanels): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('migent.session.answerQuestions', async (arg: unknown) => {
      const identity = await resolveBatch(host, arg);
      if (identity !== undefined) panels.open(identity);
    }),
  ];
}
