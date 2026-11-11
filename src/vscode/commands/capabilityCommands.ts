import { existsSync } from 'node:fs';

import * as vscode from 'vscode';

import { describeInstallOutcome, INSTALL_CLI_COMMAND, type InstallOutcome } from '../../cli/capabilityText';
import { type InstallEnd, InstallWait } from '../../cli/installWait';
import { migentDir } from '../../core/paths';
import { text } from '../../text';
import type { CapabilityService } from '../capability';
import { notify, show } from '../notices';

const STATUS_MESSAGE_MS = 2000;

function hasUninitializedFolder(): boolean {
  return (vscode.workspace.workspaceFolders ?? []).some(
    (folder) => folder.uri.scheme === 'file' && !existsSync(migentDir(folder.uri.fsPath)),
  );
}

/**
 * Sends the install command and resolves when that very execution ended (exit code from shell integration) or when
 * its terminal closed. Without shell integration only the close (or the manual button) ends the wait.
 */
async function waitForInstall(terminal: vscode.Terminal): Promise<InstallEnd> {
  const wait = new InstallWait<vscode.TerminalShellExecution, vscode.Terminal>();
  const subscriptions = [
    vscode.window.onDidCloseTerminal((closed) => wait.terminalClosed(closed, terminal)),
    vscode.window.onDidEndTerminalShellExecution((event) => wait.executionEnded(event.execution, event.exitCode)),
  ];
  try {
    if (terminal.shellIntegration === undefined) terminal.sendText(INSTALL_CLI_COMMAND);
    else wait.track(terminal.shellIntegration.executeCommand(INSTALL_CLI_COMMAND));
    return await wait.promise;
  } finally {
    for (const subscription of subscriptions) subscription.dispose();
  }
}

/** Shell integration may be unavailable, so the user can also end the wait by hand. */
async function waitForManualRecheck(): Promise<InstallEnd> {
  const picked = await show('install.waiting', undefined);
  if (picked === 'recheck') return { exitCode: undefined };
  return new Promise<InstallEnd>(() => {});
}

const POLL_MS = 3000;

/** Resolves once the CLI works, so an install typed or finished by hand also ends the wait. Stops when `isStopped`. */
async function waitForCli(capability: CapabilityService, isStopped: () => boolean): Promise<InstallEnd> {
  while (!isStopped()) {
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_MS));
    if (isStopped()) break;
    await capability.recheck();
    if (capability.aggregate() === 'ok') return { exitCode: undefined };
  }
  return new Promise<InstallEnd>(() => {});
}

async function runInstall(capability: CapabilityService): Promise<InstallEnd> {
  const existing = vscode.window.terminals.find((candidate) => candidate.name === text('shell.installTerminal'));
  const terminal: vscode.Terminal = existing ?? vscode.window.createTerminal({ name: text('shell.installTerminal') });
  terminal.show();
  let isDone = false;
  try {
    return await Promise.race([waitForInstall(terminal), waitForManualRecheck(), waitForCli(capability, () => isDone)]);
  } finally {
    isDone = true;
  }
}

async function notifyInstall(outcome: InstallOutcome): Promise<void> {
  if (outcome.kind === 'ready') {
    const buttons = hasUninitializedFolder() ? (['initializeProject'] as const) : [];
    const picked = await show('install.ready', { message: outcome.message }, buttons);
    if (picked !== undefined) await vscode.commands.executeCommand('migent.init');
    return;
  }
  if (outcome.kind === 'failed') {
    notify('install.failed', { message: outcome.message });
    return;
  }
  const picked = await show('install.notReady', { message: outcome.message });
  if (picked === 'recheck') await vscode.commands.executeCommand('migent.cli.recheck');
}

/** Recheck and install or update of the CLI. */
export function registerCapabilityCommands(capability: CapabilityService): vscode.Disposable[] {
  let isInstalling = false;
  return [
    vscode.commands.registerCommand('migent.cli.recheck', async () => {
      await capability.recheck();
      vscode.window.setStatusBarMessage(text('prompts.cliRechecked'), STATUS_MESSAGE_MS);
    }),
    vscode.commands.registerCommand('migent.cli.install', async () => {
      if (isInstalling) {
        vscode.window.setStatusBarMessage(text('prompts.installRunning'), STATUS_MESSAGE_MS);
        return;
      }
      isInstalling = true;
      capability.setInstalling(true);
      let outcome: InstallOutcome;
      try {
        const { exitCode } = await runInstall(capability);
        await capability.recheck();
        outcome = describeInstallOutcome(await capability.windowReady(), exitCode);
      } finally {
        // Released before any notification is awaited, so an open message never blocks a new install.
        isInstalling = false;
        capability.setInstalling(false);
      }
      await notifyInstall(outcome);
    }),
  ];
}
