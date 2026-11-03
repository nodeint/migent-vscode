import type * as vscode from 'vscode';

import type { SessionGroup } from '../../core/attention';
import type { ExecutionSnapshot } from '../../core/model';
import type { RecentPeriod } from '../../core/recentPeriod';
import type { ProjectKey } from '../changes';

/** How a leaf row looks and what a click does. Built when the parent's children are listed. */
export interface LeafView {
  label: string;
  description?: string;
  tooltip?: string;
  /** Codicon id, optionally with a `~spin` modifier. */
  icon: string;
  /** Theme color id for the icon. */
  color?: string;
  contextValue: string;
  /** A real file the row opens with `vscode.open`. */
  uri?: vscode.Uri;
  /** Command for a leaf that is not a file (for example Show more). */
  command?: { command: string; title: string; arguments: unknown[] };
}

interface Base {
  /** `TreeItem.id`: identity only, never state, so selection and expansion survive refreshes. */
  id: string;
  parent?: TreeNode;
}

export interface ProjectNode extends Base {
  kind: 'project';
  project: ProjectKey;
}

export interface GroupNode extends Base {
  kind: 'group';
  project: ProjectKey;
  group: SessionGroup;
}

export interface RecentPeriodNode extends Base {
  kind: 'recentPeriod';
  project: ProjectKey;
  period: RecentPeriod;
}

export interface SessionNode extends Base {
  kind: 'session';
  project: ProjectKey;
  sessionId: string;
}

export interface ExecutionNode extends Base {
  kind: 'execution';
  project: ProjectKey;
  sessionId: string;
  executionId: string;
  /** The summary read when the session's children were listed. */
  execution: ExecutionSnapshot;
}

export interface ContainerNode extends Base {
  kind: 'outputs' | 'questions' | 'history';
  project: ProjectKey;
  sessionId: string;
}

export interface QuestionGroupNode extends Base {
  kind: 'questionGroup';
  project: ProjectKey;
  sessionId: string;
  stageId: string | null;
  executionId: string | null;
  count: number;
}

export interface DirectoryNode extends Base {
  kind: 'directory';
  project: ProjectKey;
  sessionId: string;
  relativePath: string;
}

export interface LeafNode extends Base {
  kind: 'leaf';
  project: ProjectKey;
  sessionId?: string;
  /** Set for files of an execution (prompt, response, ...). */
  executionId?: string;
  view: LeafView;
}

export type TreeNode =
  | ProjectNode
  | GroupNode
  | RecentPeriodNode
  | SessionNode
  | ExecutionNode
  | ContainerNode
  | QuestionGroupNode
  | DirectoryNode
  | LeafNode;

/** Nodes that carry a session identity, for commands. */
export type SessionScopedNode = Exclude<TreeNode, ProjectNode | GroupNode | RecentPeriodNode> & { sessionId?: string };

export function isTreeNode(value: unknown): value is TreeNode {
  return typeof value === 'object' && value !== null && 'kind' in value && 'id' in value && 'project' in value;
}
