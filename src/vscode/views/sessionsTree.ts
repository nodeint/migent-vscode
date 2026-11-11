import path from 'node:path';

import * as vscode from 'vscode';

import { groupOf, type SessionGroup, summarize } from '../../core/attention';
import { readExecutionSummary } from '../../core/executions';
import type { DisplayStateName, ExecutionSnapshot } from '../../core/model';
import { EXECUTIONS_DIRNAME, sessionDir } from '../../core/paths';
import { RECENT_PERIOD_TEXT } from '../../core/recentPeriod';
import {
  executionContextValue,
  executionDescription,
  executionIcon,
  executionLabel,
  nodeIds,
  sessionContextValue,
  sessionDescription,
  sessionIcon,
  sessionLabel,
  sessionTooltip,
} from '../../core/sessionPresentation';
import { type WatchTarget, watchTargetKey } from '../../core/watchPlan';
import { text, type TextId } from '../../text';
import type { CapabilityService } from '../capability';
import type { MigentChange } from '../changes';
import type { ProjectContext, ProjectRegistry } from '../projects';
import type { Releasable } from '../watchBackend';
import type { LeafNode, SessionNode, TreeNode } from './nodes';
import {
  type ChildHost,
  groupSessions,
  projectContents,
  sessionChildren,
} from './sessionChildren';
import { SessionFiles } from './sessionFiles';

const GROUP_TEXT = {
  running: 'views.groupRunning',
  attention: 'views.groupAttention',
  prepared: 'views.groupPrepared',
  recent: 'views.groupRecent',
} as const satisfies Record<SessionGroup, TextId>;

const STATE_COLORS: Readonly<Partial<Record<DisplayStateName, string>>> = {
  running: 'charts.blue',
  failed: 'list.errorForeground',
  blocked: 'list.warningForeground',
  question: 'list.warningForeground',
  completed: 'testing.iconPassed',
};

interface Retained {
  project: string;
  sessionId: string;
  handle: Releasable;
}

function isKind<T extends TreeNode>(node: TreeNode, kind: T['kind']): node is T {
  return node.kind === kind;
}

function icon(id: string, color?: string): vscode.ThemeIcon {
  return new vscode.ThemeIcon(id, color === undefined ? undefined : new vscode.ThemeColor(color));
}

/**
 * Sessions view. Rows are identity-only nodes; every `TreeItem` is built from the live store,
 * and detail data is read by core readers when a node is expanded. Refreshes are narrow and
 * batched per event-loop turn, and nothing here selects, reveals or focuses anything.
 */
export class SessionsTreeProvider implements vscode.TreeDataProvider<TreeNode>, vscode.Disposable {
  readonly #emitter = new vscode.EventEmitter<TreeNode | TreeNode[] | undefined>();
  public readonly onDidChangeTreeData = this.#emitter.event;
  readonly #registry: ProjectRegistry;
  readonly #now: () => number;
  readonly #nodes = new Map<string, TreeNode>();
  readonly #retained = new Map<string, Retained>();
  readonly #lastGroup = new Map<string, SessionGroup>();
  readonly #pending = new Set<TreeNode | undefined>();
  readonly #subscriptions: vscode.Disposable[] = [];
  readonly #host: ChildHost;
  readonly #files = new SessionFiles((node) => { this.#queue(node); }, (node, parent) => this.#intern(node, parent));
  #flushTimer: ReturnType<typeof setTimeout> | null = null;
  #view: vscode.TreeView<TreeNode> | null = null;
  #dayTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(registry: ProjectRegistry, capability: CapabilityService, now: () => number = Date.now) {
    this.#registry = registry;
    this.#now = now;
    this.#host = {
      registry,
      capability,
      now,
      intern: (node, parent) => this.#intern(node, parent),
      retain: (project, target) => {
        this.#retain(project, target);
      },
      noteGroup: (sessionNodeId, group) => {
        this.#lastGroup.set(sessionNodeId, group);
      },
    };
    this.#scheduleDayRefresh();
    this.#subscriptions.push(registry.onDidChange((change) => {
      this.#onChange(change);
    }));
  }

  /** Number of detail targets kept watched for expanded nodes (for tests). */
  public get retainedCount(): number {
    return this.#retained.size;
  }

  public attach(view: vscode.TreeView<TreeNode>): void {
    this.#view = view;
    this.#subscriptions.push(
      view,
      view.onDidCollapseElement((event) => {
        this.collapse(event.element);
      }),
    );
    this.#updateBadge();
  }

  /** Release the watch targets held for a node that collapsed (descendants included). */
  public collapse(node: TreeNode): void {
    if (node.kind === 'session') {
      this.#files.release((candidate) => candidate.project === node.project && candidate.sessionId === node.sessionId);
      this.#releaseWhere((entry) => entry.project === node.project && entry.sessionId === node.sessionId);
    } else if (node.kind === 'directory') {
      this.#files.collapse(node);
    } else if (node.kind === 'execution') {
      this.#files.release((candidate) => candidate.id === node.id || candidate.id.startsWith(`${node.id}/`));
      this.#releaseKey(node.project, { kind: 'execution', sessionId: node.sessionId, executionId: node.executionId });
    }
  }

  /** Refresh the time-dependent text of Running rows (called on each liveness tick). */
  public refreshRunning(): void {
    for (const context of this.#registry.projects()) {
      for (const snapshot of context.store.all()) {
        if (snapshot.displayState.state !== 'running') continue;
        const node = this.#nodes.get(nodeIds.session(context.key, snapshot.sessionId));
        if (node !== undefined) this.#queue(node);
      }
    }
  }

  public getParent(node: TreeNode): TreeNode | undefined {
    return node.parent;
  }

  public getChildren(node?: TreeNode): TreeNode[] {
    if (node === undefined) return this.#rootChildren();
    const context = this.#registry.project(node.project);
    if (context === undefined) return [];
    switch (node.kind) {
      case 'project':
        return projectContents(this.#host, context, node);
      case 'group':
      case 'recentPeriod':
        return groupSessions(this.#host, context, node);
      case 'session':
        return sessionChildren(this.#host, context, node);
      case 'directory':
        return this.#files.children(context, node);
      case 'execution':
        this.#retain(node.project, { kind: 'execution', sessionId: node.sessionId, executionId: node.executionId });
        return this.#files.children(context, node);
      case 'leaf':
        return [];
    }
  }

  public getTreeItem(node: TreeNode): vscode.TreeItem {
    const context = this.#registry.project(node.project);
    const item = this.#buildItem(node, context);
    item.id = node.id;
    return item;
  }

  public dispose(): void {
    this.#files.dispose();
    if (this.#flushTimer !== null) clearTimeout(this.#flushTimer);
    if (this.#dayTimer !== null) clearTimeout(this.#dayTimer);
    this.#releaseWhere(() => true);
    for (const subscription of this.#subscriptions.splice(0)) subscription.dispose();
    this.#emitter.dispose();
  }

  #scheduleDayRefresh(): void {
    const now = new Date(this.#now());
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    this.#dayTimer = setTimeout(() => {
      this.#queue(undefined);
      this.#scheduleDayRefresh();
    }, Math.max(1, tomorrow.getTime() - now.getTime()));
  }

  #rootChildren(): TreeNode[] {
    // Without the CLI (or while installing it) the view is empty, so the welcome onboarding shows even in a project.
    const { capability } = this.#host;
    if (capability.isInstalling || capability.aggregate() === 'missing') return [];
    const projects = this.#registry.projects();
    const only = projects.length === 1 ? projects.at(0) : undefined;
    if (only !== undefined) return projectContents(this.#host, only, undefined);
    return projects.map((context) => this.#projectNode(context.key));
  }

  #projectNode(key: string): TreeNode {
    return this.#intern({ kind: 'project', id: nodeIds.project(key), project: key }, undefined);
  }

  #intern<T extends TreeNode>(node: T, parent: TreeNode | undefined): T {
    const existing = this.#nodes.get(node.id);
    if (existing === undefined || !isKind<T>(existing, node.kind)) {
      Object.assign(node, { parent });
      this.#nodes.set(node.id, node);
      return node;
    }
    // Same identity, fresh data (a leaf's view, an execution's summary, a group's count).
    Object.assign(existing, node, { parent });
    return existing;
  }

  #retain(project: string, target: WatchTarget): void {
    const key = `${project}|${watchTargetKey(target)}`;
    if (this.#retained.has(key)) return;
    const context = this.#registry.project(project);
    if (context === undefined) return;
    this.#retained.set(key, { project, sessionId: target.sessionId, handle: context.watcher.retain(target) });
  }

  #releaseKey(project: string, target: WatchTarget): void {
    const key = `${project}|${watchTargetKey(target)}`;
    this.#retained.get(key)?.handle.dispose();
    this.#retained.delete(key);
  }

  #releaseWhere(isMatch: (entry: Retained) => boolean): void {
    for (const [key, entry] of this.#retained) {
      if (!isMatch(entry)) continue;
      entry.handle.dispose();
      this.#retained.delete(key);
    }
  }

  #forget(isMatch: (node: TreeNode) => boolean): void {
    for (const [id, node] of this.#nodes) {
      if (isMatch(node)) this.#nodes.delete(id);
    }
  }

  #onChange(change: MigentChange): void {
    switch (change.type) {
      case 'projects':
      case 'refresh': {
        const keys = new Set(this.#registry.projects().map((context) => context.key));
        this.#files.release((node) => !keys.has(node.project));
        this.#releaseWhere((entry) => !keys.has(entry.project));
        this.#forget((node) => !keys.has(node.project));
        this.#queue(undefined);
        return;
      }
      case 'project':
        if (change.kind === 'scan') this.#queue(this.#projectElement(change.project));
        return;
      case 'session':
        this.#onSession(change.project, change.sessionId, change.kind);
        return;
      case 'files':
        this.#onFiles(change.project, change.sessionId, change.targets);
        return;
      case 'capability':
        this.#queue(undefined);
        return;
      case 'cliWindow':
        this.#queue(undefined);
        return;
    }
  }

  /** The element whose children are the project's groups: the project node, or the root for a single project. */
  #projectElement(project: string): TreeNode | undefined {
    return this.#registry.projects().length > 1 ? this.#projectNode(project) : undefined;
  }

  #onSession(project: string, sessionId: string, kind: 'added' | 'updated' | 'removed'): void {
    const sessionNodeId = nodeIds.session(project, sessionId);
    if (kind === 'removed') {
      this.#files.release((node) => node.project === project && node.sessionId === sessionId);
      this.#releaseWhere((entry) => entry.project === project && entry.sessionId === sessionId);
      this.#forget((node) => node.project === project && 'sessionId' in node && node.sessionId === sessionId);
      this.#lastGroup.delete(sessionNodeId);
      this.#queue(this.#projectElement(project));
      return;
    }
    const snapshot = this.#registry.project(project)?.store.snapshot(sessionId);
    const node = this.#nodes.get(sessionNodeId);
    // A group move changes the parent's children; an in-place update only changes the row.
    const hasMoved =
      kind === 'added' ||
      snapshot === undefined ||
      node === undefined ||
      this.#lastGroup.get(sessionNodeId) !== groupOf(snapshot) ||
      groupOf(snapshot) === 'recent';
    this.#queue(hasMoved ? this.#projectElement(project) : node);
  }

  #onFiles(project: string, sessionId: string, targets: readonly { kind: string; executionId?: string }[]): void {
    const session = this.#nodes.get(nodeIds.session(project, sessionId));
    for (const target of targets) {
      const execution =
        target.kind === 'execution' && target.executionId !== undefined
          ? this.#nodes.get(nodeIds.execution(project, sessionId, target.executionId))
          : undefined;
      if (execution?.kind === 'execution' && target.executionId !== undefined) {
        // Re-read the summary so the row reflects a written or deleted file such as failure.md.
        const summary = this.#executionSummary(project, sessionId, target.executionId);
        if (summary !== null) execution.execution = summary;
      }
      const isSessionLevel = target.kind === 'executions';
      const element = execution ?? (isSessionLevel || target.kind === 'execution' ? session : undefined);
      if (element !== undefined) this.#queue(element);
    }
  }

  /** Fresh summary of one execution for a targeted row refresh; null when it cannot be read. */
  #executionSummary(project: string, sessionId: string, executionId: string): ExecutionSnapshot | null {
    const context = this.#registry.project(project);
    if (context === undefined) return null;
    return readExecutionSummary(path.join(sessionDir(context.root, sessionId), EXECUTIONS_DIRNAME, executionId));
  }

  #queue(element: TreeNode | undefined): void {
    this.#pending.add(element);
    this.#flushTimer ??= setTimeout(() => {
      this.#flushTimer = null;
      this.#flush();
    }, 0);
  }

  #flush(): void {
    const pending = [...this.#pending];
    this.#pending.clear();
    this.#updateBadge();
    if (pending.length === 0) return;
    if (pending.includes(undefined)) this.#emitter.fire(undefined);
    else this.#emitter.fire(pending.filter((element): element is TreeNode => element !== undefined));
  }

  #updateBadge(): void {
    if (this.#view === null) return;
    const snapshots = this.#registry.projects().flatMap((context) => context.store.all());
    const summary = summarize(snapshots);
    if (summary.needsAttention === 0) {
      this.#view.badge = undefined;
      return;
    }
    const lines = [text('views.needAttention', { count: summary.needsAttention })];
    if (summary.asking + summary.pendingQuestions > 0) lines.push(text('views.pendingQuestions', { count: summary.pendingQuestions }));
    if (summary.blocked > 0) lines.push(text('views.blocked', { count: summary.blocked }));
    if (summary.failed > 0) lines.push(text('views.failed', { count: summary.failed }));
    this.#view.badge = { value: summary.needsAttention, tooltip: lines.join('\n') };
  }

  #buildItem(node: TreeNode, context: ProjectContext | undefined): vscode.TreeItem {
    switch (node.kind) {
      case 'project': {
        const label = context?.folder.name ?? node.project;
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Expanded);
        item.iconPath = icon('root-folder');
        item.contextValue = 'project';
        return item;
      }
      case 'group':
        return this.#groupItem(node.group, node.project, context);
      case 'recentPeriod': {
        const label = text(RECENT_PERIOD_TEXT[node.period]);
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Expanded);
        item.contextValue = 'recentPeriod';
        return item;
      }
      case 'session':
        return this.#sessionItem(node, context);
      case 'directory':
        return this.#files.item(context, node);
      case 'execution':
        return this.#executionItem(node.execution);
      case 'leaf':
        return this.#leafItem(node);
    }
  }

  #groupItem(group: SessionGroup, project: string, context: ProjectContext | undefined): vscode.TreeItem {
    const item = new vscode.TreeItem(text(GROUP_TEXT[group]), vscode.TreeItemCollapsibleState.Expanded);
    item.description = String(context?.store.all().filter((snapshot) => groupOf(snapshot) === group).length ?? 0);
    item.contextValue = `group.${group}`;
    item.tooltip = text('views.groupTooltip', { group: text(GROUP_TEXT[group]), project });
    return item;
  }

  #sessionItem(node: SessionNode, context: ProjectContext | undefined): vscode.TreeItem {
    const snapshot = context?.store.snapshot(node.sessionId);
    if (snapshot === undefined) return new vscode.TreeItem(node.sessionId, vscode.TreeItemCollapsibleState.None);
    const now = this.#now();
    const item = new vscode.TreeItem(sessionLabel(snapshot), vscode.TreeItemCollapsibleState.Collapsed);
    item.description = sessionDescription(snapshot, now);
    item.tooltip = sessionTooltip(snapshot, now);
    item.iconPath = icon(sessionIcon(snapshot), STATE_COLORS[snapshot.displayState.state]);
    item.contextValue = sessionContextValue(snapshot);
    // Every row opens its Session page on click and stays expandable.
    item.command = { command: 'migent.session.open', title: text('views.openSession'), arguments: [node] };
    return item;
  }

  #executionItem(execution: ExecutionSnapshot): vscode.TreeItem {
    const item = new vscode.TreeItem(executionLabel(execution), vscode.TreeItemCollapsibleState.Collapsed);
    item.description = executionDescription(execution);
    item.iconPath = icon(executionIcon(execution));
    item.contextValue = executionContextValue(execution);
    item.tooltip = execution.id;
    return item;
  }

  #leafItem(node: LeafNode): vscode.TreeItem {
    const { view } = node;
    const item = new vscode.TreeItem(view.label, vscode.TreeItemCollapsibleState.None);
    item.description = view.description;
    item.tooltip = view.tooltip;
    item.iconPath = view.uri === undefined ? icon(view.icon, view.color) : vscode.ThemeIcon.File;
    item.contextValue = view.contextValue;
    if (view.uri !== undefined) {
      item.resourceUri = view.uri;
      item.command = { command: 'vscode.open', title: text('views.open'), arguments: [view.uri] };
    } else if (view.command !== undefined) {
      item.command = view.command;
    }
    return item;
  }
}
