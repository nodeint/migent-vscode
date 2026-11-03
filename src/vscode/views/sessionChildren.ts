import path from 'node:path';

import * as vscode from 'vscode';

import { describeCapability } from '../../cli/capabilityText';
import { groupOf, type SessionGroup } from '../../core/attention';
import { listExecutionFiles } from '../../core/executionFiles';
import { listExecutions } from '../../core/executions';
import type { QuestionOption } from '../../core/model';
import { listOutputs } from '../../core/outputs';
import { EXECUTIONS_DIRNAME, sessionDir } from '../../core/paths';
import { groupPendingQuestions, type QuestionRecord, readQuestions } from '../../core/questions';
import { RECENT_PERIODS,recentPeriod } from '../../core/recentPeriod';
import {
  executionFileLabel,
  nodeIds,
  pendingQuestionTotal,
  sessionsDiagnostic,
  truncate,
} from '../../core/sessionPresentation';
import type { WatchTarget } from '../../core/watchPlan';
import type { CapabilityService } from '../capability';
import type { ProjectContext, ProjectRegistry } from '../projects';
import type {
  ContainerNode,
  ExecutionNode,
  GroupNode,
  LeafNode,
  LeafView,
  QuestionGroupNode,
  RecentPeriodNode,
  SessionNode,
  TreeNode,
} from './nodes';

export const GROUP_ORDER: readonly SessionGroup[] = ['running', 'attention', 'recent'];

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
        command: { command: 'migent.openSettings', title: 'Open Settings', arguments: [] },
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

function hasQuestionsFile(read: ReturnType<typeof readQuestions>): boolean {
  return read.kind !== 'missing';
}

/** Executions, then Outputs and Questions when they have content. Retains `executions/` before reading. */
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
  const outputs = listOutputs(dir, snapshot.status?.outputs ?? []);
  if (outputs.rows.length > 0 || outputs.directoryError !== null) {
    children.push(
      host.intern<ContainerNode>(
        { kind: 'outputs', id: nodeIds.container('outputs', context.key, node.sessionId), project: context.key, sessionId: node.sessionId },
        node,
      ),
    );
  }
  if (pendingQuestionTotal(snapshot) > 0 || hasQuestionsFile(readQuestions(dir))) {
    children.push(
      host.intern<ContainerNode>(
        { kind: 'questions', id: nodeIds.container('questions', context.key, node.sessionId), project: context.key, sessionId: node.sessionId },
        node,
      ),
    );
  }
  return children;
}

/** Files of one execution. Retains its directory before reading. */
export function executionChildren(host: ChildHost, context: ProjectContext, node: ExecutionNode): TreeNode[] {
  host.retain(context.key, { kind: 'execution', sessionId: node.sessionId, executionId: node.executionId });
  const dir = path.join(sessionDir(context.root, node.sessionId), EXECUTIONS_DIRNAME, node.executionId);
  const listing = listExecutionFiles(dir);
  const fields = { project: context.key, sessionId: node.sessionId, executionId: node.executionId };
  if (listing.state !== 'ok') {
    const view: LeafView = {
      label: listing.state === 'missing' ? 'Execution folder not found' : 'Execution folder unreadable',
      icon: 'error',
      color: 'list.errorForeground',
      contextValue: `diag.execution-${listing.state}`,
    };
    return [leaf(host, { id: `${node.id}/diag`, parent: node, ...fields }, view)];
  }
  const rows = listing.files.map((file) => {
    const uri = vscode.Uri.file(file.absolutePath);
    return leaf(host, { id: nodeIds.file(uri.toString()), parent: node, ...fields }, {
      label: executionFileLabel(file),
      icon: file.kind === 'artifact' ? 'file-binary' : 'file',
      contextValue: `file.${file.kind}`,
      tooltip: file.relativePath,
      uri,
    });
  });
  if (listing.artifactsError !== null) {
    rows.push(
      leaf(host, { id: `${node.id}/artifacts-error`, parent: node, ...fields }, {
        label: `Cannot read artifacts/ (${listing.artifactsError})`,
        icon: 'error',
        color: 'list.errorForeground',
        contextValue: 'diag.artifacts-unreadable',
      }),
    );
  }
  return rows;
}

export function outputChildren(host: ChildHost, context: ProjectContext, node: ContainerNode): TreeNode[] {
  const snapshot = context.store.snapshot(node.sessionId);
  host.retain(context.key, { kind: 'outputs', sessionId: node.sessionId });
  const listing = listOutputs(sessionDir(context.root, node.sessionId), snapshot?.status?.outputs ?? []);
  const fields = { project: context.key, sessionId: node.sessionId };
  const rows = listing.rows.map((row) => {
    const isOpenable = row.state === 'ok' && row.absolutePath !== null;
    const uri = isOpenable && row.absolutePath !== null ? vscode.Uri.file(row.absolutePath) : undefined;
    const id = uri === undefined ? `${node.id}/${row.path}` : nodeIds.file(uri.toString());
    const stateText = row.state === 'ok' ? '' : ` (${row.state === 'missing' ? 'file missing' : 'path outside the session'})`;
    return leaf(host, { id: id, parent: node, ...fields }, {
      label: row.name ?? path.posix.basename(row.path),
      description: `${row.path}${stateText}`,
      icon: row.state === 'ok' ? 'package' : 'warning',
      contextValue: row.state === 'ok' ? 'file.output' : 'file.output-unavailable',
      tooltip: row.path,
      uri,
    });
  });
  if (listing.directoryError !== null) {
    rows.push(
      leaf(host, { id: `${node.id}/dir-error`, parent: node, ...fields }, {
        label: `Cannot read outputs/ (${listing.directoryError})`,
        icon: 'error',
        color: 'list.errorForeground',
        contextValue: 'diag.outputs-unreadable',
      }),
    );
  }
  return rows;
}

/** Pending groups, then History, then the questions file. */
export function questionsChildren(host: ChildHost, context: ProjectContext, node: ContainerNode): TreeNode[] {
  const snapshot = context.store.snapshot(node.sessionId);
  const dir = sessionDir(context.root, node.sessionId);
  const children: TreeNode[] = groupPendingQuestions(snapshot?.status?.questions ?? []).map((group) =>
    host.intern<QuestionGroupNode>(
      {
        kind: 'questionGroup',
        id: `qgroup:${context.key}#${node.sessionId}/${group.executionId ?? group.stageId ?? ''}`,
        project: context.key,
        sessionId: node.sessionId,
        stageId: group.stageId,
        executionId: group.executionId,
        count: group.questions.length,
      },
      node,
    ),
  );
  children.push(
    host.intern<ContainerNode>(
      { kind: 'history', id: nodeIds.container('history', context.key, node.sessionId), project: context.key, sessionId: node.sessionId },
      node,
    ),
  );
  if (hasQuestionsFile(readQuestions(dir))) {
    const uri = vscode.Uri.file(path.join(dir, 'questions.json'));
    children.push(
      leaf(host, { id: nodeIds.file(uri.toString()), parent: node, project: context.key, sessionId: node.sessionId }, {
        label: 'questions.json',
        icon: 'file',
        contextValue: 'file.questions',
        uri,
      }),
    );
  }
  return children;
}

function optionTooltip(options: readonly QuestionOption[], context: string | null): string {
  const lines = options.map((option) => `${option.id}. ${option.label}${option.description === null ? '' : ` — ${option.description}`}`);
  return [context, ...lines].filter((line): line is string => line !== null && line !== '').join('\n');
}

export function questionGroupChildren(host: ChildHost, context: ProjectContext, node: QuestionGroupNode): TreeNode[] {
  const snapshot = context.store.snapshot(node.sessionId);
  const questions = (snapshot?.status?.questions ?? []).filter(
    (question) => question.stageId === node.stageId && question.executionId === node.executionId,
  );
  return questions.map((question) =>
    leaf(host, { id: `${node.id}/q${question.id}`, parent: node, project: context.key, sessionId: node.sessionId }, {
      label: truncate(question.question),
      description: `${question.id} · ${question.selection ?? 'selection unknown'}`,
      icon: 'comment',
      contextValue: 'question.pending',
      tooltip: optionTooltip(question.options, question.context),
    }),
  );
}

const ANSWER_TEXT_MAX = 40;

function optionLabel(options: readonly QuestionOption[], id: string): string {
  return options.find((option) => option.id === id)?.label ?? id;
}

function answerText(record: QuestionRecord): string {
  const { answer } = record;
  if (answer === null) return record.status;
  const labels = answer.selected.map((id) => optionLabel(record.options, id));
  const parts = [...labels, answer.text === null ? null : `"${truncate(answer.text, ANSWER_TEXT_MAX)}"`];
  return `${record.status} · ${parts.filter((part): part is string => part !== null).join(', ')}`;
}

/** The structured history, loaded when the History node expands. */
export function historyChildren(host: ChildHost, context: ProjectContext, node: ContainerNode): TreeNode[] {
  const read = readQuestions(sessionDir(context.root, node.sessionId));
  const fields = { project: context.key, sessionId: node.sessionId };
  const uri = vscode.Uri.file(path.join(sessionDir(context.root, node.sessionId), 'questions.json'));
  if (read.kind === 'ok') {
    return read.questions.map((record) =>
      leaf(host, { id: `${node.id}/q${record.id}-${record.executionId ?? ''}`, parent: node, ...fields }, {
        label: truncate(record.question),
        description: answerText(record),
        icon: record.status === 'answered' ? 'pass' : 'comment',
        contextValue: `question.${record.status}`,
        tooltip: optionTooltip(record.options, record.context),
      }),
    );
  }
  const text: Record<string, string> = {
    missing: 'No structured history',
    unreadable: 'questions.json unreadable',
    invalid: 'questions.json invalid',
    unsupported: 'questions.json has an unsupported schema version',
  };
  const isMissing = read.kind === 'missing';
  return [
    leaf(host, { id: `${node.id}/diag`, parent: node, ...fields }, {
      label: text[read.kind] ?? 'No structured history',
      icon: isMissing ? 'info' : 'warning',
      contextValue: `diag.questions-${read.kind}`,
      uri: isMissing ? undefined : uri,
      tooltip: isMissing ? undefined : 'Open questions.json',
    }),
  ];
}
