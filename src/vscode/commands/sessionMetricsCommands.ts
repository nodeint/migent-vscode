import * as vscode from 'vscode';

import type { SessionMetricsPanels } from '../sessionMetrics/panels';
import { type CommandHost, resolve } from './sessionCommands';

/** Open (or reveal) the Session Metrics page of a session. Reachable from Results and the Sessions view only. */
export function registerSessionMetricsCommands(host: CommandHost, metrics: SessionMetricsPanels): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('migent.session.openMetrics', async (arg: unknown) => {
      const resolved = await resolve(host, arg, 'Open the metrics of which session?');
      if (resolved === undefined) return;
      metrics.open({ project: resolved.context.key, sessionId: resolved.snapshot.sessionId });
    }),
  ];
}
