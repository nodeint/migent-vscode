import path from 'node:path';

import type { DirectoryState } from './model';
import {
  CANCEL_REQUEST_FILENAME,
  CONFIG_FILENAME,
  CONFIG_LOCAL_FILENAME,
  DIAGNOSTICS_FILENAME,
  EVENTS_FILENAME,
  EXECUTIONS_DIRNAME,
  FAILURE_REPORT_FILENAME,
  FROZEN_WORKFLOW_FILENAME,
  LOCK_FILENAME,
  MANIFEST_FILENAME,
  METRICS_FILENAME,
  MIGENT_DIR,
  NEXT_FILENAME,
  OUTPUTS_DIRNAME,
  QUESTIONS_FILENAME,
  SESSIONS_DIRNAME,
  STATUS_FILENAME,
  WORKFLOWS_DIRNAME,
} from './paths';
import { isWorkflowFile } from './workflows';

/**
 * One non-recursive watcher: a folder and a pattern without path separators, matching
 * the folder's direct children only. `id` is the folder path; a folder has one watcher.
 */
export interface WatchSpec {
  id: string;
  folder: string;
  pattern: string;
}

interface ExecutionTarget {
  kind: 'execution';
  sessionId: string;
  executionId: string;
}

/** What a consumer keeps watched beyond the session-level files. */
export type WatchTarget = { kind: 'executions'; sessionId: string } | ExecutionTarget | { kind: 'outputs'; sessionId: string };

export function watchTargetKey(target: WatchTarget): string {
  switch (target.kind) {
    case 'execution':
      return `execution:${target.sessionId}/${target.executionId}`;
    case 'executions':
    case 'outputs':
      return `${target.kind}:${target.sessionId}`;
  }
}

const SNAPSHOT_FILES = [MANIFEST_FILENAME, STATUS_FILENAME, LOCK_FILENAME, CANCEL_REQUEST_FILENAME] as const;

const SESSION_PATTERN = `{${[
  ...SNAPSHOT_FILES,
  QUESTIONS_FILENAME,
  NEXT_FILENAME,
  FROZEN_WORKFLOW_FILENAME,
  METRICS_FILENAME,
  EVENTS_FILENAME,
  EXECUTIONS_DIRNAME,
  OUTPUTS_DIRNAME,
].join(',')}}`;

const EXECUTION_PATTERN = `{execution.json,conversation.json,questions.json,prompt.md,task.md,response.md,${FAILURE_REPORT_FILENAME},${DIAGNOSTICS_FILENAME},stream.jsonl,artifacts,turns}`;

/** The anchor watcher on a workspace folder root: `.migent` created or deleted. Owned by the registry. */
export function anchorWatch(workspaceRoot: string): WatchSpec {
  return { id: workspaceRoot, folder: workspaceRoot, pattern: MIGENT_DIR };
}

export interface WatchPlanInput {
  projectRoot: string;
  /** `.migent/` exists. Without it nothing below is watched. */
  migentExists: boolean;
  /** Last scan outcomes; `missing` means the folder has no watcher. */
  sessionsState: DirectoryState;
  workflowsState: DirectoryState;
  /** Every child directory of `sessions/`: eligible, hidden and pending. */
  discoveredSessions: readonly string[];
  /** Detail targets some consumer has retained. */
  retained: readonly WatchTarget[];
  /** Turn directory names the watcher found per retained execution, keyed `<sessionId>/<executionId>`. */
  turns: Readonly<Record<string, readonly string[]>>;
  /** Whether a detail folder exists now (detail folders are watched only while they exist). */
  dirExists: (absolutePath: string) => boolean;
}

function spec(folder: string, pattern: string): WatchSpec {
  return { id: folder, folder, pattern };
}

function executionWatches(input: WatchPlanInput, target: ExecutionTarget): WatchSpec[] {
  const { sessionId, executionId } = target;
  const sessionFolder = path.join(input.projectRoot, MIGENT_DIR, SESSIONS_DIRNAME, sessionId);
  const folder = path.join(sessionFolder, EXECUTIONS_DIRNAME, executionId);
  if (!input.dirExists(folder)) return [];
  const watches = [spec(folder, EXECUTION_PATTERN)];
  for (const child of ['artifacts', 'turns']) {
    if (input.dirExists(path.join(folder, child))) watches.push(spec(path.join(folder, child), '*'));
  }
  for (const turn of input.turns[`${sessionId}/${executionId}`] ?? []) {
    watches.push(spec(path.join(folder, 'turns', turn), 'verify.md'));
  }
  return watches;
}

function detailWatches(input: WatchPlanInput, discovered: ReadonlySet<string>): WatchSpec[] {
  const watches: WatchSpec[] = [];
  const sessionsFolder = path.join(input.projectRoot, MIGENT_DIR, SESSIONS_DIRNAME);
  for (const target of input.retained) {
    if (!discovered.has(target.sessionId)) continue;
    if (target.kind === 'execution') {
      watches.push(...executionWatches(input, target));
      continue;
    }
    const sessionFolder = path.join(sessionsFolder, target.sessionId);
    const detailDir = target.kind === 'executions' ? EXECUTIONS_DIRNAME : OUTPUTS_DIRNAME;
    const folder = path.join(sessionFolder, detailDir);
    if (input.dirExists(folder)) watches.push(spec(folder, '*'));
  }
  return watches;
}

/**
 * The project's desired watcher set, without the anchor. Pure: the same input gives the
 * same set, sorted by folder, with one entry per folder. The host diffs it against its
 * live watchers (`diffWatches`).
 */
export function desiredWatches(input: WatchPlanInput): WatchSpec[] {
  if (!input.migentExists) return [];
  const migent = path.join(input.projectRoot, MIGENT_DIR);
  const watches = [spec(migent, `{${CONFIG_FILENAME},${CONFIG_LOCAL_FILENAME},${SESSIONS_DIRNAME},${WORKFLOWS_DIRNAME}}`)];
  if (input.workflowsState !== 'missing') watches.push(spec(path.join(migent, WORKFLOWS_DIRNAME), '*.{yaml,yml}'));
  if (input.sessionsState !== 'missing') {
    const sessions = path.join(migent, SESSIONS_DIRNAME);
    watches.push(spec(sessions, '*'));
    for (const sessionId of input.discoveredSessions) {
      watches.push(spec(path.join(sessions, sessionId), SESSION_PATTERN));
    }
    watches.push(...detailWatches(input, new Set(input.discoveredSessions)));
  }
  const unique = new Map(watches.map((watch) => [watch.id, watch]));
  return [...unique.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export interface WatchDiff {
  add: WatchSpec[];
  /** Ids of live watchers to dispose: no longer desired, or desired with a different pattern. */
  remove: string[];
}

/** Compare the desired set with live watchers (`id → pattern`). */
export function diffWatches(desired: readonly WatchSpec[], live: ReadonlyMap<string, string>): WatchDiff {
  const wanted = new Map(desired.map((watch) => [watch.id, watch]));
  const remove = [...live].filter(([id, pattern]) => wanted.get(id)?.pattern !== pattern).map(([id]) => id);
  const add = desired.filter((watch) => live.get(watch.id) !== watch.pattern);
  return { add, remove };
}

/** A file change the host reports without reading data (`MigentChange` of type `files`). */
export type FileTarget =
  | { kind: 'questions' | 'next' | 'outputs' | 'executions' | 'events' | 'metrics' }
  | { kind: 'execution'; executionId: string };

export type ClassifiedPath =
  | { kind: 'migent-dir' }
  | { kind: 'config' }
  | { kind: 'sessions-dir' }
  | { kind: 'workflows-dir' }
  | { kind: 'workflow'; file: string }
  | { kind: 'session-dir'; sessionId: string }
  | { kind: 'session-snapshot'; sessionId: string }
  | { kind: 'session-files'; sessionId: string; target: FileTarget };

const SESSION_FILE_TARGETS: Readonly<Record<string, FileTarget>> = {
  [QUESTIONS_FILENAME]: { kind: 'questions' },
  [NEXT_FILENAME]: { kind: 'next' },
  [FROZEN_WORKFLOW_FILENAME]: { kind: 'next' },
  [METRICS_FILENAME]: { kind: 'metrics' },
  [EVENTS_FILENAME]: { kind: 'events' },
  [EXECUTIONS_DIRNAME]: { kind: 'executions' },
  [OUTPUTS_DIRNAME]: { kind: 'outputs' },
};

/** Path segments before the area (`.migent`, area) and inside `executions/` (`<id>`, then a child). */
const AREA_DEPTH = 2;
const EXECUTION_DIR_DEPTH = 2;

function at(list: readonly string[], index: number): string | undefined {
  return list[index];
}

function classifySessionChild(sessionId: string, rest: readonly string[]): ClassifiedPath | null {
  const name = at(rest, 0);
  const second = at(rest, 1);
  if (name === undefined) return { kind: 'session-dir', sessionId };
  if ((SNAPSHOT_FILES as readonly string[]).includes(name)) {
    return second === undefined ? { kind: 'session-snapshot', sessionId } : null;
  }
  if (name === OUTPUTS_DIRNAME) return { kind: 'session-files', sessionId, target: { kind: 'outputs' } };
  if (name === EXECUTIONS_DIRNAME) {
    // The execution directory itself (create/delete) is a change of the executions list;
    // anything inside it belongs to that execution.
    const target: FileTarget =
      second === undefined || rest.length === EXECUTION_DIR_DEPTH ? { kind: 'executions' } : { kind: 'execution', executionId: second };
    return { kind: 'session-files', sessionId, target };
  }
  const target = second === undefined ? SESSION_FILE_TARGETS[name] : undefined;
  return target === undefined ? null : { kind: 'session-files', sessionId, target };
}

/**
 * Classify a changed absolute path into a routing target. Null for paths nobody
 * displays; those are ignored without disk reads. Uses platform path rules, so
 * Windows drive-letter case and separators compare correctly.
 */
export function classifyPath(projectRoot: string, changedPath: string): ClassifiedPath | null {
  const relative = path.relative(projectRoot, changedPath);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  const segments = relative.split(path.sep);
  if (at(segments, 0) !== MIGENT_DIR) return null;
  const area = at(segments, 1);
  if (area === undefined) return { kind: 'migent-dir' };
  const rest = segments.slice(AREA_DEPTH);
  if (area === CONFIG_FILENAME || area === CONFIG_LOCAL_FILENAME) return rest.length === 0 ? { kind: 'config' } : null;
  if (area === WORKFLOWS_DIRNAME) {
    const file = at(rest, 0);
    if (file === undefined) return { kind: 'workflows-dir' };
    return rest.length === 1 && isWorkflowFile(file) ? { kind: 'workflow', file } : null;
  }
  if (area !== SESSIONS_DIRNAME) return null;
  const sessionId = at(rest, 0);
  if (sessionId === undefined) return { kind: 'sessions-dir' };
  return classifySessionChild(sessionId, rest.slice(1));
}

export interface SessionRouting {
  /** A snapshot file changed: the host calls `store.refreshSession`. */
  shouldRefreshSnapshot: boolean;
  /** Distinct file targets to report, in first-seen order. */
  targets: FileTarget[];
}

/** Reduce the classified changes of one session, collected by the coalescer, into a flush plan. */
export function routeSessionChanges(changes: readonly ClassifiedPath[]): SessionRouting {
  const targets = new Map<string, FileTarget>();
  let shouldRefreshSnapshot = false;
  for (const change of changes) {
    if (change.kind === 'session-snapshot') shouldRefreshSnapshot = true;
    if (change.kind !== 'session-files') continue;
    const { target } = change;
    targets.set(target.kind === 'execution' ? `execution:${target.executionId}` : target.kind, target);
  }
  return { shouldRefreshSnapshot, targets: [...targets.values()] };
}
