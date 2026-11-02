import * as vscode from 'vscode';

import { Liveness } from './core/liveness';
import { CapabilityService } from './vscode/capability';
import { registerCapabilityCommands } from './vscode/commands/capabilityCommands';
import { registerSessionCommands } from './vscode/commands/sessionCommands';
import { ContextKeys } from './vscode/contextKeys';
import { ProjectRegistry } from './vscode/projects';
import type { TreeNode } from './vscode/views/nodes';
import { SessionsTreeProvider } from './vscode/views/sessionsTree';

/** What activation returns; integration tests use it to observe the host. */
export interface MigentApi {
  registry: ProjectRegistry;
  capability: CapabilityService;
  sessionsTree: SessionsTreeProvider;
  sessionsView: vscode.TreeView<TreeNode>;
  /** Resolves after the first project load, which runs after `activate()` returned. */
  ready: Promise<void>;
}

export function activate(context: vscode.ExtensionContext): MigentApi {
  const registry = new ProjectRegistry();
  const liveness = new Liveness({ stores: () => registry.projects().map((project) => project.store) });
  const capability = new CapabilityService(registry);
  const contextKeys = new ContextKeys(registry, capability);
  const sessionsTree = new SessionsTreeProvider(registry, capability);
  const sessionsView = vscode.window.createTreeView<TreeNode>('migent.sessions', {
    treeDataProvider: sessionsTree,
    showCollapseAll: true,
  });
  sessionsTree.attach(sessionsView);
  context.subscriptions.push(
    registry,
    capability,
    contextKeys,
    sessionsTree,
    sessionsView,
    {
      dispose: () => {
        liveness.dispose();
      },
    },
    {
      dispose: liveness.onDidTick(() => {
        sessionsTree.refreshRunning();
      }),
    },
    registry.onDidChange((change) => {
      // Start or stop the single liveness timer whenever a session may have started or stopped running.
      if (change.type !== 'files' && change.type !== 'capability') liveness.update();
    }),
    vscode.commands.registerCommand('migent.refresh', () => {
      registry.refresh();
    }),
    ...registerSessionCommands(registry),
    ...registerCapabilityCommands(capability),
  );
  // Discovery and the first load run after activation returns.
  const ready = new Promise<void>((resolve) => {
    setTimeout(() => {
      registry.start();
      resolve();
    }, 0);
  });
  return { registry, capability, sessionsTree, sessionsView, ready };
}

export function deactivate(): void {}
