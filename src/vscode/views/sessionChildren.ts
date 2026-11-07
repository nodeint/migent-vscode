import { describeCapability } from '../../cli/capabilityText';
import { groupOf, type SessionGroup } from '../../core/attention';
import { listExecutions } from '../../core/executions';
import { sessionDir } from '../../core/paths';
import { RECENT_PERIODS,recentPeriod } from '../../core/recentPeriod';
import {
  nodeIds,
  sessionsDiagnostic,
} from '../../core/sessionPresentation';
import type { WatchTarget } from '../../core/watchPlan';
import type { CapabilityService } from '../capability';
import type { ProjectContext, ProjectRegistry } from '../projects';
import type {
  ExecutionNode,
  GroupNode,
  LeafNode,
  LeafView,
  RecentPeriodNode,
  SessionNode,
  TreeNode,
} from './nodes';

export const GROUP_ORDER: readonly SessionGroup[] = ['running', 'attention', 'prepared', 'recent'];

/** What the child builders need from the provider. */
export interface ChildHost {
  registry: ProjectRegistry;
  capability: CapabilityService;
  now: () => number;
  /** Return the existing node with this id (updated) or register this one; sets its parent. */
  intern: <T extends TreeNode>(node: T, parent: TreeNode | undefined) => T;
  /** Keep a detail target watched until the owning node collapses. Idempotent. Call before reading. */
  retain: (project: string, target: WatchTarget) => void;
  /** Remember the group a session was listed under, to tell group moves from in-place updates. */
  noteGroup: (sessionNodeId: string, group: SessionGroup) => void;
}

interface LeafHead {
  id: string;
  parent: TreeNode | undefined;
  project: string;
  sessionId?: string;
  executionId?: string;
}

function leaf(host: ChildHost, head: LeafHead, view: LeafView): LeafNode {
  const { parent, ...identity } = head;
  return host.intern({ kind: 'leaf', ...identity, view }, parent);
}

/** Children of the tree root, or of a project node: diagnostics, groups, Show more. */
export function projectContents(host: ChildHost, context: ProjectContext, parent: TreeNode | undefined): TreeNode[] {
  const { key, store } = context;
  const nodes: TreeNode[] = [];
  const cli = describeCapability(host.capability.state(key));
  if (cli !== null) {
    nodes.push(
      leaf(host, { id: nodeIds.diagnostic(key, 'cli'), parent: parent, project: key }, {
        label: cli.label,
        icon: 'warning',
        color: 'list.warningForeground',
        contextValue: 'diag.cli',
        tooltip: cli.tooltip,
        command: { command: 'migent.cli.recheck', title: 'Recheck CLI', arguments: [] },
      }),
    );
  }
  const diagnostic = sessionsDiagnostic(store.scanOutcome);
  if (diagnostic !== null) {
    const detail = diagnostic.detail === null ? '' : ` (${diagnostic.detail})`;
    const view: LeafView =
      diagnostic.code === 'scan-unreadable'
        ? {
            label: `${diagnostic.label}${detail}`,
            icon: 'error',
            color: 'list.errorForeground',
            contextValue: `diag.${diagnostic.code}`,
            command: { command: 'migent.refresh', title: 'Refresh', arguments: [] },
            tooltip: 'Select to refresh',
          }
        : { label: diagnostic.label, icon: 'info', contextValue: `diag.${diagnostic.code}` };
    nodes.push(leaf(host, { id: nodeIds.diagnostic(key, diagnostic.code), parent: parent, project: key }, view));
  }
  const snapshots = store.all();
  for (const group of GROUP_ORDER) {
    if (!snapshots.some((snapshot) => groupOf(snapshot) === group)) continue;
    nodes.push(host.intern<GroupNode>({ kind: 'group', id: nodeIds.group(key, group), project: key, group }, parent));
  }
  if (store.hiddenCount > 0) {
    const label = `Show more (${store.hiddenCount} hidden)`;
    nodes.push(
      leaf(host, { id: nodeIds.more(key), parent: parent, project: key }, {
        label,
        icon: 'chevron-down',
        contextValue: 'more',
        command: { command: 'migent.sessions.showMore', title: 'Show more', arguments: [{ project: key }] },
        tooltip: 'Show older sessions',
      }),
    );
  }
  return nodes;
}

export function groupSessions(
  host: ChildHost, context: ProjectContext, node: GroupNode | RecentPeriodNode,
): TreeNode[] {
  if (node.kind === 'group' && node.group === 'recent') {
    const snapshots = context.store.all().filter((snapshot) => groupOf(snapshot) === 'recent');
    const now = host.now();
    const periods = new Set(snapshots.map((snapshot) => recentPeriod(snapshot, now)));
    return RECENT_PERIODS.filter((period) => periods.has(period)).map((period) =>
      host.intern<RecentPeriodNode>({ kind: 'recentPeriod', id: `${node.id}/${period}`, project: context.key, period }, node),
    );
  }
  const group = node.kind === 'recentPeriod' ? 'recent' : node.group;
  const now = host.now();
  return context.store
    .all()
    .filter((snapshot) => groupOf(snapshot) === group && (node.kind !== 'recentPeriod' || recentPeriod(snapshot, now) === node.period))
    .map((snapshot) => {
      const session = host.intern<SessionNode>(
        {
          kind: 'session',
          id: nodeIds.session(context.key, snapshot.sessionId),
          project: context.key,
          sessionId: snapshot.sessionId,
        },
        node,
      );
      host.noteGroup(session.id, group);
      return session;
    });
}

/** Files, then the stage attempts. Retains `executions/` before reading. */
export function sessionChildren(host: ChildHost, context: ProjectContext, node: SessionNode): TreeNode[] {
  const snapshot = context.store.snapshot(node.sessionId);
  if (snapshot === undefined) return [];
  host.retain(context.key, { kind: 'executions', sessionId: node.sessionId });
  const dir = sessionDir(context.root, node.sessionId);
  const children: TreeNode[] = listExecutions(dir).map((execution) =>
    host.intern<ExecutionNode>(
      {
        kind: 'execution',
        id: nodeIds.execution(context.key, node.sessionId, execution.id),
        project: context.key,
        sessionId: node.sessionId,
        executionId: execution.id,
        execution,
      },
      node,
    ),
  );
  children.unshift(host.intern({
    kind: 'directory', id: `${node.id}/files`, project: context.key, sessionId: node.sessionId, relativePath: '',
  }, node));
  return children;
}
