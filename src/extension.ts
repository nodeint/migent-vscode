import path from 'node:path';

import * as vscode from 'vscode';

import { Liveness } from './core/liveness';
import { AnswerSubmitter } from './vscode/answers';
import { CapabilityService } from './vscode/capability';
import { registerCapabilityCommands } from './vscode/commands/capabilityCommands';
import { registerControlCommands } from './vscode/commands/controlCommands';
import { registerProjectCommands } from './vscode/commands/projectCommands';
import { registerReplyCommands } from './vscode/commands/replyCommands';
import { type CommandHost, registerSessionCommands } from './vscode/commands/sessionCommands';
import { registerSessionPageCommands } from './vscode/commands/sessionPageCommands';
import { registerTimelineCommands } from './vscode/commands/timelineCommands';
import { ConfigPanels } from './vscode/config/panels';
import { ReadOnlyDocsProvider } from './vscode/content/readOnlyDocs';
import { SessionDocsProvider } from './vscode/content/sessionDocs';
import { ContextKeys } from './vscode/contextKeys';
import { ControlService } from './vscode/control';
import { LogChannels } from './vscode/log/channels';
import { NextStepFlow } from './vscode/nextStep/flow';
import { StateNotifier } from './vscode/notifier';
import { ProjectRegistry } from './vscode/projects';
import { QuestionNotifier } from './vscode/questionNotifier';
import { ReplyService } from './vscode/reply';
import { SessionPanels } from './vscode/session/panels';
import { StatusBar } from './vscode/statusBar';
import { TailManager } from './vscode/tails';
import type { TreeNode } from './vscode/views/nodes';
import { ProjectTreeProvider } from './vscode/views/projectTree';
import { SessionsTreeProvider } from './vscode/views/sessionsTree';
import { WorkflowsTreeProvider } from './vscode/views/workflowsTree';
import { WorkflowEditorPanels } from './vscode/workflowEditor/panels';

/** What activation returns; integration tests use it to observe the host. */
export interface MigentApi {
  registry: ProjectRegistry;
  capability: CapabilityService;
  control: ControlService;
  sessionsTree: SessionsTreeProvider;
  sessionsView: vscode.TreeView<TreeNode>;
  workflowsTree: WorkflowsTreeProvider;
  projectTree: ProjectTreeProvider;
  workflowEditor: WorkflowEditorPanels;
  config: ConfigPanels;
  tails: TailManager;
  sessionDocs: SessionDocsProvider;
  logs: LogChannels;
  statusBar: StatusBar;
  session: SessionPanels;
  nextStep: NextStepFlow;
  submitter: AnswerSubmitter;
  replies: ReplyService;
  /** Resolves after the first project load, which runs after `activate()` returned. */
  ready: Promise<void>;
}

/** The Sessions tree and the tree view it is attached to. */
function createSessionsView(
  registry: ProjectRegistry,
  capability: CapabilityService,
): { sessionsTree: SessionsTreeProvider; sessionsView: vscode.TreeView<TreeNode> } {
  const sessionsTree = new SessionsTreeProvider(registry, capability);
  const sessionsView = vscode.window.createTreeView<TreeNode>('migent.sessions', {
    treeDataProvider: sessionsTree,
    showCollapseAll: true,
  });
  sessionsTree.attach(sessionsView);
  return { sessionsTree, sessionsView };
}

/** The Workflows and Project tree providers. */
function createProjectTrees(registry: ProjectRegistry): {
  workflowsTree: WorkflowsTreeProvider;
  projectTree: ProjectTreeProvider;
} {
  return { workflowsTree: new WorkflowsTreeProvider(registry), projectTree: new ProjectTreeProvider(registry) };
}

/** The workflow editor and the Configuration page, which share the capability gate. */
function createWorkflowPages(
  registry: ProjectRegistry,
  capability: CapabilityService,
  extensionUri: vscode.Uri,
): { workflowEditor: WorkflowEditorPanels; config: ConfigPanels } {
  return {
    workflowEditor: new WorkflowEditorPanels(registry, capability, extensionUri),
    config: new ConfigPanels(registry, capability, extensionUri),
  };
}

/** Drive the single liveness timer and the views that follow it. */
function livenessSubscriptions(liveness: Liveness, registry: ProjectRegistry, onTick: () => void): vscode.Disposable[] {
  return [
    {
      dispose: () => {
        liveness.dispose();
      },
    },
    {
      dispose: liveness.onDidTick(onTick),
    },
    registry.onDidChange((change) => {
      // Start or stop the single liveness timer whenever a session may have started or stopped running.
      if (change.type !== 'files' && change.type !== 'capability' && change.type !== 'cliWindow') liveness.update();
    }),
  ];
}

/** The Next step flow, and the Session page action that starts it. */
function createNextStep(
  deps: { registry: ProjectRegistry; control: ControlService; session: SessionPanels },
  context: vscode.ExtensionContext,
): { nextStep: NextStepFlow; host: CommandHost } {
  const { registry, control, session } = deps;
  const nextStep = new NextStepFlow(registry, {
    control,
    memento: context.workspaceState,
    openSession: (project, sessionId) => {
      session.open({ project, sessionId });
    },
  });
  session.setActions({
    openNextStep: (identity, workflow) => {
      void nextStep.start({ ...identity, workflow });
    },
  });
  // Header actions target the session of the Session page in focus.
  const host = { registry, active: { activeTarget: () => session.activeTarget() } };
  return { nextStep, host };
}

/** Unresolved submissions and reply drafts live in extension storage so they survive a reload. */
function createAnswers(
  registry: ProjectRegistry,
  control: ControlService,
  context: vscode.ExtensionContext,
): { submitter: AnswerSubmitter; replies: ReplyService } {
  const base = context.storageUri?.fsPath ?? context.globalStorageUri.fsPath;
  const submitter = new AnswerSubmitter(control, path.join(base, 'answers'));
  return { submitter, replies: new ReplyService(registry, control, base) };
}

/** Discovery and the first load run after activation returns. */
function startRegistryLater(registry: ProjectRegistry): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      registry.start();
      resolve();
    }, 0);
  });
}

export function activate(context: vscode.ExtensionContext): MigentApi {
  const registry = new ProjectRegistry();
  const liveness = new Liveness({ stores: () => registry.projects().map((project) => project.store) });
  const capability = new CapabilityService(registry);
  const control = new ControlService(registry, capability);
  const contextKeys = new ContextKeys(registry, capability);
  const { sessionsTree, sessionsView } = createSessionsView(registry, capability);
  const { workflowsTree, projectTree } = createProjectTrees(registry);
  const pages = createWorkflowPages(registry, capability, context.extensionUri);
  const tails = new TailManager(registry);
  const sessionDocs = new SessionDocsProvider(tails);
  const logs = new LogChannels(registry, tails);
  const statusBar = new StatusBar(registry);
  const { submitter, replies } = createAnswers(registry, control, context);
  const session = new SessionPanels(registry, {
    capability,
    control,
    submitter,
    extensionUri: context.extensionUri,
    memento: context.workspaceState,
  });
  const { nextStep, host } = createNextStep({ registry, control, session }, context);
  context.subscriptions.push(
    registry,
    capability,
    control,
    contextKeys,
    sessionsTree,
    sessionsView,
    workflowsTree,
    projectTree,
    ...Object.values(pages),
    vscode.window.registerTreeDataProvider('migent.workflows', workflowsTree),
    vscode.window.registerTreeDataProvider('migent.project', projectTree),
    tails,
    sessionDocs,
    new ReadOnlyDocsProvider(),
    logs,
    statusBar,
    session,
    new QuestionNotifier(registry),
    new StateNotifier(registry),
    ...livenessSubscriptions(liveness, registry, () => {
      sessionsTree.refreshRunning();
      statusBar.update();
    }),
    vscode.commands.registerCommand('migent.refresh', () => registry.refresh()),
    ...registerSessionCommands(host, control.gate),
    ...registerSessionPageCommands(host, session, nextStep),
    ...registerTimelineCommands(host, logs),
    ...registerCapabilityCommands(capability),
    ...registerProjectCommands({ registry, editor: pages.workflowEditor, capability, config: pages.config }),
    ...registerControlCommands(host, control, context.workspaceState),
    ...registerReplyCommands({ host, control, replies, capability }),
  );
  const ready = startRegistryLater(registry);
  return {
    registry,
    capability,
    control,
    sessionsTree,
    sessionsView,
    workflowsTree,
    projectTree,
    ...pages,
    tails,
    sessionDocs,
    logs,
    statusBar,
    session,
    nextStep,
    submitter,
    replies,
    ready,
  };
}

export function deactivate(): void {}
