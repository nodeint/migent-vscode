import * as vscode from 'vscode';

import { Liveness } from './core/liveness';
import { ContextKeys } from './vscode/contextKeys';
import { ProjectRegistry } from './vscode/projects';

/** What activation returns; integration tests use it to observe the host. */
export interface MigentApi {
  registry: ProjectRegistry;
  /** Resolves after the first project load, which runs after `activate()` returned. */
  ready: Promise<void>;
}

export function activate(context: vscode.ExtensionContext): MigentApi {
  const registry = new ProjectRegistry();
  const liveness = new Liveness({ stores: () => registry.projects().map((project) => project.store) });
  const contextKeys = new ContextKeys(registry);
  context.subscriptions.push(
    registry,
    contextKeys,
    { dispose: () => { liveness.dispose(); } },
    registry.onDidChange((change) => {
      // Start or stop the single liveness timer whenever a session may have started or stopped running.
      if (change.type !== 'files' && change.type !== 'capability') liveness.update();
    }),
    vscode.commands.registerCommand('migent.refresh', () => {
      registry.refresh();
    }),
  );
  // Discovery and the first load run after activation returns.
  const ready = new Promise<void>((resolve) => {
    setTimeout(() => {
      registry.start();
      resolve();
    }, 0);
  });
  return { registry, ready };
}

export function deactivate(): void {}
