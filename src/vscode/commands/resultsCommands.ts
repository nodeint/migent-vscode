import * as vscode from 'vscode';

import type { NextStepPanels } from '../nextStep/panels';
import type { ResultsPanels } from '../results/panels';
import { registerNextStepCommands } from './nextStepCommands';
import { type CommandHost, resolve } from './sessionCommands';

/** Open (or reveal) the Results overview of a session. */
export function registerResultsCommands(
  host: CommandHost,
  results: ResultsPanels,
  nextStep: NextStepPanels,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('migent.session.openResult', async (arg: unknown) => {
      const resolved = await resolve(host, arg, 'Open the result of which session?');
      if (resolved === undefined) return;
      results.open({ project: resolved.context.key, sessionId: resolved.snapshot.sessionId });
    }),
    ...registerNextStepCommands(host, nextStep),
  ];
}
