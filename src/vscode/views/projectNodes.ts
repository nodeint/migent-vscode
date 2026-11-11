import * as vscode from 'vscode';

import type { ProjectChangeKind } from '../../core/model';
import type { RowView } from '../../core/projectPresentation';
import { text } from '../../text';
import type { ProjectKey } from '../changes';
import type { ProjectContext, ProjectRegistry } from '../projects';

interface Base {
  /** `TreeItem.id`: identity only, never state, so selection and expansion survive refreshes. */
  id: string;
  parent?: MetaNode;
}

export interface MetaProjectNode extends Base {
  kind: 'project';
  project: ProjectKey;
}

/** A real file the row opens: a workflow YAML or `config.yaml`. */
export interface MetaFileNode extends Base {
  kind: 'workflow' | 'config';
  project: ProjectKey;
  /** Absolute path: a workflow opens the editor page, `config.yaml` opens in an editor. */
  file: string;
  view: RowView;
}

export interface MetaDiagnosticNode extends Base {
  kind: 'diag';
  project: ProjectKey;
  label: string;
  detail: string | null;
  /** Unreadable directories offer Refresh. */
  isError: boolean;
  contextValue: string;
}

/** Nodes of the Workflows and Project views. */
export type MetaNode = MetaProjectNode | MetaFileNode | MetaDiagnosticNode;

export function isMetaFileNode(value: unknown): value is MetaFileNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    (value.kind === 'workflow' || value.kind === 'config') &&
    'file' in value &&
    typeof value.file === 'string'
  );
}

function icon(id: string, color?: string): vscode.ThemeIcon {
  return new vscode.ThemeIcon(id, color === undefined ? undefined : new vscode.ThemeColor(color));
}

function diagnosticItem(node: MetaDiagnosticNode): vscode.TreeItem {
  const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
  item.description = node.detail ?? undefined;
  item.tooltip = node.detail === null ? node.label : [node.label, node.detail].join('\n');
  item.iconPath = node.isError ? icon('error', 'list.errorForeground') : icon('info');
  item.contextValue = node.contextValue;
  return item;
}

function fileItem(node: MetaFileNode): vscode.TreeItem {
  const { view } = node;
  const item = new vscode.TreeItem(view.label, vscode.TreeItemCollapsibleState.None);
  item.description = view.description;
  item.tooltip = view.tooltip;
  item.iconPath = icon(view.icon, view.color);
  item.contextValue = view.contextValue;
  // A missing config has nothing to open; a workflow row opens its editor, the config row the Configuration page.
  if (view.contextValue !== 'config.missing') {
    const command = node.kind === 'workflow' ? 'migent.workflow.edit' : 'migent.openConfig';
    item.command = { command, title: text('views.open'), arguments: [node] };
  }
  return item;
}

/**
 * Shared behavior of the Workflows and Project views: one project's rows under the root (or under a
 * project node when several projects are open), refreshed only by the matching catalog change. The
 * views render the catalog and never read disk; a change here never reloads sessions. Rows carry
 * `TreeItem.id`, so VS Code keeps selection across the whole-tree refresh.
 */
export abstract class MetaTreeProvider implements vscode.TreeDataProvider<MetaNode>, vscode.Disposable {
  readonly #emitter = new vscode.EventEmitter<MetaNode | undefined>();
  public readonly onDidChangeTreeData = this.#emitter.event;
  readonly #registry: ProjectRegistry;
  readonly #kind: ProjectChangeKind;
  readonly #subscription: vscode.Disposable;
  #flushTimer: ReturnType<typeof setTimeout> | null = null;

  protected constructor(registry: ProjectRegistry, kind: ProjectChangeKind) {
    this.#registry = registry;
    this.#kind = kind;
    this.#subscription = registry.onDidChange((change) => {
      if (change.type === 'projects' || change.type === 'refresh') {
        this.#queue();
      } else if (change.type === 'project' && change.kind === this.#kind) {
        this.#queue();
      }
    });
  }

  /** The rows of one project, parented under `parent` (undefined at the root). */
  protected abstract rows(context: ProjectContext, parent: MetaNode | undefined): MetaNode[];

  public getParent(node: MetaNode): MetaNode | undefined {
    return node.parent;
  }

  public getChildren(node?: MetaNode): MetaNode[] {
    if (node === undefined) {
      const projects = this.#registry.projects();
      const only = projects.length === 1 ? projects.at(0) : undefined;
      if (only !== undefined) return this.rows(only, undefined);
      return projects.map((context): MetaNode => ({ kind: 'project', id: `project:${context.key}`, project: context.key }));
    }
    if (node.kind !== 'project') return [];
    const context = this.#registry.project(node.project);
    return context === undefined ? [] : this.rows(context, node);
  }

  public getTreeItem(node: MetaNode): vscode.TreeItem {
    const item = this.#buildItem(node);
    item.id = node.id;
    return item;
  }

  public dispose(): void {
    if (this.#flushTimer !== null) clearTimeout(this.#flushTimer);
    this.#subscription.dispose();
    this.#emitter.dispose();
  }

  /** Coalesce the changes of one event-loop turn into one refresh of the whole (small) tree. */
  #queue(): void {
    this.#flushTimer ??= setTimeout(() => {
      this.#flushTimer = null;
      this.#emitter.fire(undefined);
    }, 0);
  }

  #buildItem(node: MetaNode): vscode.TreeItem {
    switch (node.kind) {
      case 'project': {
        const name = this.#registry.project(node.project)?.folder.name ?? node.project;
        const item = new vscode.TreeItem(name, vscode.TreeItemCollapsibleState.Expanded);
        item.iconPath = icon('root-folder');
        item.contextValue = 'project';
        return item;
      }
      case 'diag':
        return diagnosticItem(node);
      case 'workflow':
      case 'config':
        return fileItem(node);
    }
  }
}
