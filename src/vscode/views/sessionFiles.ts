import path from 'node:path';

import * as vscode from 'vscode';

import { EXECUTIONS_DIRNAME, sessionDir } from '../../core/paths';
import { listSessionDirectory } from '../../core/sessionDirectory';
import { text } from '../../text';
import type { ProjectContext } from '../projects';
import type { Releasable } from '../watchBackend';
import type { DirectoryNode, ExecutionNode, TreeNode } from './nodes';

type FileContainerNode = DirectoryNode | ExecutionNode;

/** Watches only directories whose rows have been expanded. */
export class SessionFiles implements vscode.Disposable {
  readonly #watches = new Map<string, { node: FileContainerNode; handle: Releasable }>();
  readonly #refresh: (node: TreeNode) => void;
  readonly #intern: <T extends TreeNode>(node: T, parent: TreeNode | undefined) => T;

  constructor(
    refresh: (node: TreeNode) => void, intern: <T extends TreeNode>(node: T, parent: TreeNode | undefined) => T,
  ) {
    this.#refresh = refresh;
    this.#intern = intern;
  }

  public children(context: ProjectContext, node: FileContainerNode): TreeNode[] {
    const containerPath = node.kind === 'execution'
      ? path.join(EXECUTIONS_DIRNAME, node.executionId) : node.relativePath;
    const folder = path.join(sessionDir(context.root, node.sessionId), containerPath);
    if (!this.#watches.has(node.id)) {
      const handle = context.watcher.watchDirectory(folder, () => { this.#refresh(node); });
      this.#watches.set(node.id, { node, handle });
    }
    try {
      return listSessionDirectory(folder).map((entry) => {
        const relativePath = path.join(containerPath, entry.name);
        const id = `${node.id}/${encodeURIComponent(entry.name)}`;
        if (entry.isDirectory) {
          return this.#intern<DirectoryNode>({
            kind: 'directory', id, project: node.project, sessionId: node.sessionId, relativePath,
          }, node);
        }
        return this.#intern({
          kind: 'leaf', id, project: node.project, sessionId: node.sessionId,
          view: { label: entry.name, icon: 'file', contextValue: 'file.session', uri: vscode.Uri.file(path.join(folder, entry.name)) },
        }, node);
      });
    } catch {
      return [this.#intern({
        kind: 'leaf', id: `${node.id}/error`, project: node.project, sessionId: node.sessionId,
        view: { label: text('views.cannotReadFolder'), icon: 'error', contextValue: 'diag.directory-unreadable' },
      }, node)];
    }
  }

  public item(context: ProjectContext | undefined, node: DirectoryNode): vscode.TreeItem {
    const label = node.relativePath === '' ? text('views.files') : path.basename(node.relativePath);
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed);
    if (context !== undefined) {
      item.resourceUri = vscode.Uri.file(path.join(sessionDir(context.root, node.sessionId), node.relativePath));
    }
    item.iconPath = vscode.ThemeIcon.Folder;
    item.contextValue = 'sessionDirectory';
    return item;
  }

  public collapse(node: DirectoryNode): void {
    this.release((candidate) => candidate.id === node.id || candidate.id.startsWith(`${node.id}/`));
  }

  public release(isMatch: (node: FileContainerNode) => boolean): void {
    for (const [id, entry] of this.#watches) {
      if (!isMatch(entry.node)) continue;
      entry.handle.dispose();
      this.#watches.delete(id);
    }
  }

  public dispose(): void { this.release(() => true); }
}
