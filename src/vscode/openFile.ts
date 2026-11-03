import * as vscode from 'vscode';

/** Open a real file in its native editor; a missing file is reported by path and never created. */
export async function openFile(file: string, what: string): Promise<void> {
  const uri = vscode.Uri.file(file);
  try {
    await vscode.workspace.fs.stat(uri);
  } catch {
    void vscode.window.showWarningMessage(`Could not find ${what}: ${file}`);
    return;
  }
  await vscode.commands.executeCommand('vscode.open', uri);
}
