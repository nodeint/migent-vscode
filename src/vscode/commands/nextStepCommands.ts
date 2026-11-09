import * as vscode from 'vscode';

import { readNext } from '../../core/nextWorkflows';
import { sessionDir } from '../../core/paths';
import { isNextStepIdentity, type NextStepFlow, type NextStepIdentity } from '../nextStep/flow';
import { type CommandHost, resolveWith } from './sessionCommands';

const INFO_MESSAGE_MS = 5000;

async function pickIdentity(host: CommandHost, arg: unknown): Promise<NextStepIdentity | undefined> {
  if (isNextStepIdentity(arg)) return arg;
  const resolved = await resolveWith(host, arg, {
    title: 'Next step of which session?',
    isEligible: (snapshot) => snapshot.displayState.state === 'completed',
  });
  if (resolved === undefined) return undefined;
  const { context, snapshot } = resolved;
  const next = readNext(sessionDir(context.root, snapshot.sessionId));
  const workflows = next.kind === 'ok' ? [...new Set(next.suggestions.map((suggestion) => suggestion.workflow))] : [];
  if (workflows.length === 0) {
    vscode.window.setStatusBarMessage('This session has no next-step suggestions.', INFO_MESSAGE_MS);
    return undefined;
  }
  const workflow =
    workflows.length === 1
      ? workflows[0]
      : await vscode.window.showQuickPick(workflows, { title: 'Next workflow' });
  return workflow === undefined ? undefined : { project: context.key, sessionId: snapshot.sessionId, workflow };
}

/** The Next step flow for a Completed session's suggestion: pick the workflow, enter the task, then Run or Prepare. */
export function registerNextStepCommands(host: CommandHost, flow: NextStepFlow): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('migent.session.openNextStep', async (arg?: unknown) => {
      const identity = await pickIdentity(host, arg);
      if (identity !== undefined) await flow.start(identity);
    }),
  ];
}
