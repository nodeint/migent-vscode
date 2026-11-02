import * as vscode from 'vscode';

import { Liveness } from './core/liveness';
import { CapabilityService } from './vscode/capability';
import { registerCapabilityCommands } from './vscode/commands/capabilityCommands';
import { registerProjectCommands } from './vscode/commands/projectCommands';
import { registerResultsCommands } from './vscode/commands/resultsCommands';
import { registerSessionCommands } from './vscode/commands/sessionCommands';
import { registerTimelineCommands } from './vscode/commands/timelineCommands';
import { SessionDocsProvider } from './vscode/content/sessionDocs';
import { ContextKeys } from './vscode/contextKeys';
import { LogChannels } from './vscode/log/channels';
import { ProjectRegistry } from './vscode/projects';
import { ResultsPanels } from './vscode/results/panels';
import { StatusBar } from './vscode/statusBar';
import { TailManager } from './vscode/tails';
import type { TreeNode } from './vscode/views/nodes';
import { ProjectTreeProvider } from './vscode/views/projectTree';
import { SessionsTreeProvider } from './vscode/views/sessionsTree';
import { WorkflowsTreeProvider } from './vscode/views/workflowsTree';

/** What activation returns; integration tests use it to observe the host. */
export interface MigentApi {
  registry: ProjectRegistry;
  capability: CapabilityService;
  sessionsTree: SessionsTreeProvider;
  sessionsView: vscode.TreeView<TreeNode>;
  workflowsTree: WorkflowsTreeProvider;
  projectTree: ProjectTreeProvider;
  tails: TailManager;
  sessionDocs: SessionDocsProvider;
  logs: LogChannels;
  statusBar: StatusBar;
  results: ResultsPanels;
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
  const workflowsTree = new WorkflowsTreeProvider(registry);
  const projectTree = new ProjectTreeProvider(registry);
  const tails = new TailManager(registry);
  const sessionDocs = new SessionDocsProvider(tails);
  const logs = new LogChannels(registry, tails);
  const statusBar = new StatusBar(registry);
  const results = new ResultsPanels(registry, context.extensionUri);
  const host = { registry, active: results };
  context.subscriptions.push(
    registry,
    capability,
    contextKeys,
    sessionsTree,
    sessionsView,
    workflowsTree,
    projectTree,
    vscode.window.registerTreeDataProvider('migent.workflows', workflowsTree),
    vscode.window.registerTreeDataProvider('migent.project', projectTree),
    tails,
    sessionDocs,
    logs,
    statusBar,
    results,
    {
      dispose: () => {
        liveness.dispose();
      },
    },
    {
      dispose: liveness.onDidTick(() => {
        sessionsTree.refreshRunning();
        statusBar.update();
      }),
    },
    registry.onDidChange((change) => {
      // Start or stop the single liveness timer whenever a session may have started or stopped running.
      if (change.type !== 'files' && change.type !== 'capability') liveness.update();
    }),
    vscode.commands.registerCommand('migent.refresh', () => {
      registry.refresh();
    }),
    ...registerSessionCommands(host),
    ...registerResultsCommands(host, results),
    ...registerTimelineCommands(host, logs),
    ...registerCapabilityCommands(capability),
    ...registerProjectCommands(registry),
  );
  // Discovery and the first load run after activation returns.
  const ready = new Promise<void>((resolve) => {
    setTimeout(() => {
      registry.start();
      resolve();
    }, 0);
  });
  return {
    registry,
    capability,
    sessionsTree,
    sessionsView,
    workflowsTree,
    projectTree,
    tails,
    sessionDocs,
    logs,
    statusBar,
    results,
    ready,
  };
}

export function deactivate(): void {}
