import { readFileSync, statSync } from 'node:fs';

import * as vscode from 'vscode';

export const READ_ONLY_DOC_SCHEME = 'migent-readonly';

const NOT_WRITABLE = 'This document is read-only.';

/** `migent-readonly:/<real path>`: the same file, shown without letting the editor write it back. */
export function readOnlyDocUri(file: string): vscode.Uri {
  return vscode.Uri.file(file).with({ scheme: READ_ONLY_DOC_SCHEME });
}

/**
 * Serves a persisted file as a read-only document. Registering the provider with `isReadonly`
 * makes VS Code mark its editors read-only, so the report can be read but not edited or saved.
 */
export class ReadOnlyDocsProvider implements vscode.FileSystemProvider, vscode.Disposable {
  readonly #registration: vscode.Disposable;
  readonly #changes = new vscode.EventEmitter<vscode.FileChangeEvent[]>();

  public readonly onDidChangeFile = this.#changes.event;

  constructor() {
    this.#registration = vscode.workspace.registerFileSystemProvider(READ_ONLY_DOC_SCHEME, this, {
      isCaseSensitive: process.platform !== 'win32',
      isReadonly: true,
    });
  }

  public watch(): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }

  public stat(uri: vscode.Uri): vscode.FileStat {
    const stat = statSync(uri.fsPath);
    return {
      type: vscode.FileType.File,
      ctime: stat.ctimeMs,
      mtime: stat.mtimeMs,
      size: stat.size,
      permissions: vscode.FilePermission.Readonly,
    };
  }

  public readFile(uri: vscode.Uri): Uint8Array {
    return readFileSync(uri.fsPath);
  }

  public readDirectory(): [string, vscode.FileType][] {
    return [];
  }

  public createDirectory(): void {
    throw vscode.FileSystemError.NoPermissions(NOT_WRITABLE);
  }

  public writeFile(): void {
    throw vscode.FileSystemError.NoPermissions(NOT_WRITABLE);
  }

  public delete(): void {
    throw vscode.FileSystemError.NoPermissions(NOT_WRITABLE);
  }

  public rename(): void {
    throw vscode.FileSystemError.NoPermissions(NOT_WRITABLE);
  }

  public dispose(): void {
    this.#changes.dispose();
    this.#registration.dispose();
  }
}
