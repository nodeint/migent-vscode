import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('migent.refresh', () => {}),
  );
}

export function deactivate(): void {}
