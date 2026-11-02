import * as vscode from 'vscode';

import type { WatchSpec } from '../core/watchPlan';

export type WatchEventKind = 'create' | 'change' | 'delete';

export interface Releasable {
  dispose: () => void;
}

/**
 * The one seam through which watchers are created. The S0 spike validated VS Code's own
 * non-recursive watchers; a `node:fs.watch` backend would replace this file only.
 */
export interface WatchBackend {
  create: (spec: WatchSpec, onEvent: (kind: WatchEventKind, fsPath: string) => void) => Releasable;
}

/** Non-recursive `RelativePattern` watchers: the base folder's direct children only. */
export const vscodeWatchBackend: WatchBackend = {
  create: (spec, onEvent) => {
    const pattern = new vscode.RelativePattern(vscode.Uri.file(spec.folder), spec.pattern);
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const subscriptions = [
      watcher.onDidCreate((uri) => {
        onEvent('create', uri.fsPath);
      }),
      watcher.onDidChange((uri) => {
        onEvent('change', uri.fsPath);
      }),
      watcher.onDidDelete((uri) => {
        onEvent('delete', uri.fsPath);
      }),
    ];
    return {
      dispose: () => {
        for (const subscription of subscriptions) subscription.dispose();
        watcher.dispose();
      },
    };
  },
};
