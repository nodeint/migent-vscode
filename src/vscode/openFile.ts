import * as vscode from 'vscode';

import { readOnlyDocUri } from './content/readOnlyDocs';
import { notify } from './notices';

/** Open a real file in its native editor; a missing file is reported by path and never created. */
export async function openFile(file: string, what: string): Promise<void> {
  const uri = vscode.Uri.file(file);
  try {
    await vscode.workspace.fs.stat(uri);
  } catch {
    notify('file.notFound', { what, file });
    return;
  }
  await vscode.commands.executeCommand('vscode.open', uri);
}

/** Open a real file as a read-only document; a missing file is reported by path and never created. */
export async function openReadOnly(file: string, what: string): Promise<void> {
  try {
    await vscode.workspace.fs.stat(vscode.Uri.file(file));
  } catch {
    notify('file.notFound', { what, file });
    return;
  }
  const document = await vscode.workspace.openTextDocument(readOnlyDocUri(file));
  await vscode.window.showTextDocument(document, { preview: false });
}
