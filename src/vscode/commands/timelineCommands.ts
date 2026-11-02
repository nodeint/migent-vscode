import * as vscode from 'vscode';

import { timelineUri } from '../content/sessionDocs';
import type { LogChannels } from '../log/channels';
import type { ProjectRegistry } from '../projects';
import { resolve } from './sessionCommands';

/** Open the event timeline document or the log channel of a session. */
export function registerTimelineCommands(registry: ProjectRegistry, logs: LogChannels): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('migent.session.showTimeline', async (arg: unknown) => {
      const resolved = await resolve(registry, arg, 'Show the timeline of which session?');
      if (resolved === undefined) return;
      const uri = timelineUri(resolved.context.key, resolved.snapshot.sessionId);
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document, { preview: false });
    }),
    vscode.commands.registerCommand('migent.session.showLog', async (arg: unknown) => {
      const resolved = await resolve(registry, arg, 'Show the log of which session?');
      if (resolved === undefined) return;
      logs.show(resolved.context.key, resolved.snapshot);
    }),
  ];
}
