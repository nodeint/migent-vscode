import path from 'node:path';

import * as vscode from 'vscode';

import { Liveness } from './core/liveness';
import { AnswerSubmitter } from './vscode/answers';
import { CapabilityService } from './vscode/capability';
import { registerCapabilityCommands } from './vscode/commands/capabilityCommands';
import { registerControlCommands } from './vscode/commands/controlCommands';
import { registerProjectCommands } from './vscode/commands/projectCommands';
import { registerQuestionCommands } from './vscode/commands/questionCommands';
import { registerReplyCommands } from './vscode/commands/replyCommands';
import { registerResultsCommands } from './vscode/commands/resultsCommands';
import { type CommandHost, registerSessionCommands } from './vscode/commands/sessionCommands';
import { registerSessionMetricsCommands } from './vscode/commands/sessionMetricsCommands';
import { registerTimelineCommands } from './vscode/commands/timelineCommands';
import { SessionDocsProvider } from './vscode/content/sessionDocs';
import { ContextKeys } from './vscode/contextKeys';
import { ControlService } from './vscode/control';
import { LogChannels } from './vscode/log/channels';
import { NextStepPanels } from './vscode/nextStep/panels';
import { StateNotifier } from './vscode/notifier';
import { ProjectRegistry } from './vscode/projects';
import { QuestionNotifier } from './vscode/questionNotifier';
import { AnswerPanels } from './vscode/questions/panels';
import { ReplyService } from './vscode/reply';
import { ResultsPanels } from './vscode/results/panels';
import { SessionMetricsPanels } from './vscode/sessionMetrics/panels';
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
  control: ControlService;
  sessionsTree: SessionsTreeProvider;
  sessionsView: vscode.TreeView<TreeNode>;
  workflowsTree: WorkflowsTreeProvider;
  projectTree: ProjectTreeProvider;
  tails: TailManager;
  sessionDocs: SessionDocsProvider;
  logs: LogChannels;
  statusBar: StatusBar;
  results: ResultsPanels;
  sessionMetrics: SessionMetricsPanels;
  nextStep: NextStepPanels;
  answers: AnswerPanels;
  submitter: AnswerSubmitter;
  replies: ReplyService;
  /** Resolves after the first project load, which runs after `activate()` returned. */
  ready: Promise<void>;
}

/** The Results overview and the Session Metrics page: two read-only pages of one session. */
function createResultsPages(
  registry: ProjectRegistry,
  extensionUri: vscode.Uri,
): { results: ResultsPanels; sessionMetrics: SessionMetricsPanels } {
  return {
    results: new ResultsPanels(registry, extensionUri),
    sessionMetrics: new SessionMetricsPanels(registry, extensionUri),
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
      if (change.type !== 'files' && change.type !== 'capability') liveness.update();
    }),
  ];
}

/** Next step pages, and the Results actions that open them. */
function createNextStep(
  deps: { registry: ProjectRegistry; control: ControlService; results: ResultsPanels },
  context: vscode.ExtensionContext,
): { nextStep: NextStepPanels; host: CommandHost } {
  const { registry, control, results } = deps;
  const nextStep = new NextStepPanels(
    registry,
    { control, results, memento: context.workspaceState },
    context.extensionUri,
  );
  results.setActions({
    openNextStep: (identity, workflow) => {
      nextStep.open({ ...identity, workflow });
    },
    reloadSuggestions: async (project, snapshot) => {
      await control.regenerateNext(project, snapshot);
    },
  });
  // Header actions keep targeting the source session from a Results panel or a Next step page.
  const host = { registry, active: { activeTarget: () => results.activeTarget() ?? nextStep.activeTarget() } };
  return { nextStep, host };
}

/** Unresolved submissions and reply drafts live in extension storage so they survive a reload. */
function createAnswers(
  registry: ProjectRegistry,
  control: ControlService,
  context: vscode.ExtensionContext,
): { answers: AnswerPanels; submitter: AnswerSubmitter; replies: ReplyService } {
  const base = context.storageUri?.fsPath ?? context.globalStorageUri.fsPath;
  const submitter = new AnswerSubmitter(control, path.join(base, 'answers'));
  const answers = new AnswerPanels(registry, { control, submitter }, context);
  return { answers, submitter, replies: new ReplyService(registry, control, base) };
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
  const { results, sessionMetrics } = createResultsPages(registry, context.extensionUri);
  const { answers, submitter, replies } = createAnswers(registry, control, context);
  const { nextStep, host } = createNextStep({ registry, control, results }, context);
  context.subscriptions.push(
    registry,
    capability,
    control,
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
    sessionMetrics,
    nextStep,
    answers,
    new QuestionNotifier(registry),
    new StateNotifier(registry, context.workspaceState),
    ...livenessSubscriptions(liveness, registry, () => {
      sessionsTree.refreshRunning();
      statusBar.update();
    }),
    vscode.commands.registerCommand('migent.refresh', () => registry.refresh()),
    ...registerSessionCommands(host, control.gate),
    ...registerResultsCommands(host, results, nextStep),
    ...registerSessionMetricsCommands(host, sessionMetrics),
    ...registerQuestionCommands(host, answers),
    ...registerTimelineCommands(host, logs),
    ...registerCapabilityCommands(capability),
    ...registerProjectCommands(registry),
    ...registerControlCommands(host, control, context.workspaceState),
    ...registerReplyCommands({ host, control, replies }),
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
    tails,
    sessionDocs,
    logs,
    statusBar,
    results,
    sessionMetrics,
    nextStep,
    answers,
    submitter,
    replies,
    ready,
  };
}

export function deactivate(): void {}
