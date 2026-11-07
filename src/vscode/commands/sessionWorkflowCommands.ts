import * as vscode from 'vscode';

import type { SessionWorkflowPanels } from '../sessionWorkflow/panels';
import { type CommandHost, resolve } from './sessionCommands';

/** Open (or reveal) the Session workflow page of a session. Reachable from the Sessions view only. */
export function registerSessionWorkflowCommands(host: CommandHost, pages: SessionWorkflowPanels): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('migent.session.openWorkflow', async (arg: unknown) => {
      const resolved = await resolve(host, arg, 'Open the workflow of which session?');
      if (resolved === undefined) return;
      pages.open({ project: resolved.context.key, sessionId: resolved.snapshot.sessionId });
    }),
  ];
}
