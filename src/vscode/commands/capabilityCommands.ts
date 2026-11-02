import * as vscode from 'vscode';

import type { CapabilityService } from '../capability';

const STATUS_MESSAGE_MS = 2000;

/** Open Settings filtered to the CLI settings, and Recheck of the CLI capability. */
export function registerCapabilityCommands(capability: CapabilityService): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('migent.openSettings', () =>
      vscode.commands.executeCommand('workbench.action.openSettings', 'migent.cli'),
    ),
    vscode.commands.registerCommand('migent.cli.recheck', async () => {
      await capability.recheck();
      vscode.window.setStatusBarMessage('Migent CLI rechecked', STATUS_MESSAGE_MS);
    }),
  ];
}
