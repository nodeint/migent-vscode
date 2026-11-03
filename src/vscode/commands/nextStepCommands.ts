import * as vscode from 'vscode';

import { readNext } from '../../core/nextWorkflows';
import { sessionDir } from '../../core/paths';
import { isNextStepIdentity, type LaunchMode, type NextStepIdentity, type NextStepPanels } from '../nextStep/panels';
import { type CommandHost, resolveWith } from './sessionCommands';

const INFO_MESSAGE_MS = 5000;

async function pickIdentity(
  host: CommandHost,
  panels: NextStepPanels,
  arg: unknown,
): Promise<NextStepIdentity | undefined> {
  if (isNextStepIdentity(arg)) return arg;
  const active = panels.activeIdentity();
  if (active !== undefined) return active;
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

/** The Next step page and its Run and Prepare actions for a Completed session's suggestion. */
export function registerNextStepCommands(host: CommandHost, panels: NextStepPanels): vscode.Disposable[] {
  const launch = (mode: LaunchMode) => async (arg?: unknown) => {
    const identity = await pickIdentity(host, panels, arg);
    if (identity === undefined) return;
    panels.open(identity);
    await panels.launch(identity, mode);
  };
  return [
    vscode.commands.registerCommand('migent.session.openNextStep', async (arg?: unknown) => {
      const identity = await pickIdentity(host, panels, arg);
      if (identity !== undefined) panels.open(identity);
    }),
    vscode.commands.registerCommand('migent.session.runDownstream', launch('run')),
    vscode.commands.registerCommand('migent.session.prepareDownstream', launch('prepare')),
  ];
}
