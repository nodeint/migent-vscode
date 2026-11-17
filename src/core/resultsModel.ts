import { statSync } from 'node:fs';
import path from 'node:path';

import { text } from '../text';
import type { ExecutionEntry } from './executions';
import { childrenForWorkflow, childrenOf, type HandoffArtifact, readHandoff } from './handoff';
import { manifestPriorSessionId } from './manifest';
import type { SessionSnapshot } from './model';
import { classifyLaunch, type LaunchEligibility, targetState, type TargetWorkflowState } from './nextStepEligibility';
import { type ArtifactAvailability, markDeclared, type NextEntry, readFrozenDownstream, readNext } from './nextWorkflows';
import { listOutputs, type OutputFileState, type OutputRow, publishedOutputs } from './outputs';
import { buildSessionMeta, NO_SESSION_META, type SessionMeta } from './sessionMeta';
import { sessionTitle, stageOf } from './sessionPresentation';
import { readSessionTask } from './sessionTask';
import type { WorkflowEntry } from './workflows';

/**
 * The data the Overview page's results blocks show, as plain JSON. Every string is inert text for the page: it is
 * rendered with `textContent` and never interpreted as HTML, a path or a command. Rows carry
 * a `key` the page sends back as an intent; the host resolves it against fresh data.
 */

export interface ResultsOutput {
  /** Intent key: `name:<published name>` or `path:<session-relative path>` for an unnamed file. */
  key: string;
  label: string;
  path: string;
  state: OutputFileState;
  /** The stage that published it; null when status names no execution or it is not listed. */
  stage: string | null;
  attempt: number | null;
  /** When the publishing execution completed; null when unknown. */
  publishedAt: string | null;
}

export interface ResultsSuggestion {
  workflow: string;
  task: string | null;
  /** True when the frozen workflow declares it; null when the declaration could not be read. */
  declared: boolean | null;
  target: TargetWorkflowState;
  /** Whether the Next step flow would let this suggestion launch; the same policy as `launchBlockOf`. */
  launch: LaunchEligibility;
  /** Sessions started from this one that run the suggestion's workflow, newest first. */
  children: ResultsSuggestionChild[];
  artifacts: ResultsSuggestionArtifact[];
}

/** One artifact of a suggestion, as the page shows it. */
export interface ResultsSuggestionArtifact {
  /** Input name in the target workflow. */
  name: string;
  /** Name of the source session's output that feeds it. */
  output: string;
  /** Session-relative path as written in `next.json`. */
  path: string;
  availability: ArtifactAvailability;
}

export interface ResultsSuggestionChild {
  sessionId: string;
  title: string;
  state: string;
  createdAt: string | null;
}

export interface ResultsNext {
  /** `ok`, or the reason no suggestions are shown. Never affects the session state. */
  state: 'ok' | 'missing' | 'unreadable' | 'invalid' | 'unsupported';
  detail: string | null;
  suggestions: ResultsSuggestion[];
}

export interface ResultsProvenanceArtifact {
  name: string;
  output: string;
  /** Session-relative path (`handoff/<n>/<file>`) in this session. */
  path: string;
  /** Whether the local copy can be opened. */
  localState: OutputFileState;
  sha256: string;
  /** Machine-specific path in the source session. Plain text only. */
  sourcePath: string | null;
}

export type ResultsProvenance =
  | { state: 'none' }
  | { state: 'invalid'; reason: string }
  | { state: 'ok'; artifacts: ResultsProvenanceArtifact[] };

/** `retained`: shown in the Sessions view. `hidden`: on disk but beyond the limit. `missing`: not found. */
export type SourceAvailability = 'retained' | 'hidden' | 'missing';

export interface ResultsSource {
  sessionId: string;
  title: string | null;
  availability: SourceAvailability;
  provenance: ResultsProvenance;
}

export interface ResultsChild {
  sessionId: string;
  title: string;
  state: string;
  /** Full text of the child's `task.md`, trimmed of surrounding whitespace; null when missing, unreadable or blank. */
  task: string | null;
  workflowId: string | null;
  stageId: string | null;
  createdAt: string | null;
}

export interface ResultsModel {
  /** `unavailable`: the session is not known (removed, not yet loaded, or hidden by the limit). */
  availability: 'ok' | 'unavailable';
  sessionId: string;
  title: string;
  state: string;
  workflowId: string | null;
  /** What the header says about the session, the same on every session page. */
  meta: SessionMeta;
  outputs: { rows: ResultsOutput[]; directoryError: string | null };
  next: ResultsNext;
  source: ResultsSource | null;
  children: ResultsChild[];
}

export interface ResultsInput {
  sessionId: string;
  sessionDirPath: string;
  /** Retained snapshots of the project. */
  snapshots: readonly SessionSnapshot[];
  /** Every eligible session id of the project, retained or hidden. */
  eligibleIds: readonly string[];
  workflows: readonly WorkflowEntry[];
  /** The session's executions, oldest first; they resolve who published an output. Empty when not read. */
  executions?: readonly ExecutionEntry[];
}

/** Published names and unnamed paths live in separate namespaces, so one can never select the other's file. */
function outputKey(row: { name: string | null; path: string }): string {
  return row.name === null ? `path:${row.path}` : `name:${row.name}`;
}

function suggestionArtifacts(
  entry: NextEntry,
  availability: Record<string, ArtifactAvailability> = {},
): ResultsSuggestionArtifact[] {
  return Object.entries(entry.artifacts).map(([name, artifact]) => ({
    name,
    output: artifact.output,
    path: artifact.path,
    availability: availability[name] ?? 'missing',
  }));
}

export function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function isFile(absolute: string | null): boolean {
  if (absolute === null) return false;
  try {
    return statSync(absolute).isFile();
  } catch {
    return false;
  }
}

function newestFirst<T extends { createdAt: string | null }>(items: T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (b.item.createdAt ?? '').localeCompare(a.item.createdAt ?? '') || b.index - a.index)
    .map(({ item }) => item);
}

function childCreatedAt(child: SessionSnapshot): string | null {
  return child.manifest?.created_at ?? child.status?.created_at ?? null;
}

function suggestionChild(child: SessionSnapshot): ResultsSuggestionChild {
  return {
    sessionId: child.sessionId,
    title: sessionTitle(child),
    state: titleCase(child.displayState.state),
    createdAt: childCreatedAt(child),
  };
}

function outputRow(row: OutputRow, executions: readonly ExecutionEntry[]): ResultsOutput {
  const publisherId = row.publishedByExecutionId ?? row.sourceExecutionId;
  const publisher = executions.find((execution) => execution.id === publisherId);
  return {
    key: outputKey(row),
    label: row.name ?? path.posix.basename(row.path),
    path: row.path,
    state: row.state,
    stage: publisher?.execution.stage_id ?? null,
    attempt: publisher?.attempt ?? null,
    publishedAt: publisher?.execution.completed_at ?? null,
  };
}

function childRow(child: SessionSnapshot, input: ResultsInput): ResultsChild {
  return {
    sessionId: child.sessionId,
    title: sessionTitle(child),
    state: titleCase(child.displayState.state),
    task: readSessionTask(path.join(path.dirname(input.sessionDirPath), child.sessionId)),
    workflowId: child.manifest?.workflow_id ?? child.status?.workflow_id ?? null,
    stageId: stageOf(child),
    createdAt: childCreatedAt(child),
  };
}

function nextModel(input: ResultsInput, sourceState: string): ResultsNext {
  const status = input.snapshots.find((snapshot) => snapshot.sessionId === input.sessionId)?.status;
  const published = status === undefined || status === null ? null : publishedOutputs(status).map(([name]) => name);
  const read = readNext(input.sessionDirPath);
  const frozen = readFrozenDownstream(input.sessionDirPath);
  const base = { suggestions: [] };
  switch (read.kind) {
    case 'missing':
      return { ...base, state: 'missing', detail: null };
    case 'unreadable':
      return { ...base, state: 'unreadable', detail: read.error };
    case 'invalid':
      return { ...base, state: 'invalid', detail: read.error };
    case 'unsupported':
      return {
        ...base,
        state: 'unsupported',
        detail: read.schemaVersion === null ? text('states.schemaMissing') : text('states.schemaVersion', { version: String(read.schemaVersion) }),
      };
    case 'ok': {
      const declaredFlags = markDeclared(read, frozen, published);
      return {
        ...base,
        state: 'ok',
        detail: null,
        suggestions: read.next.next.map((entry, index) => {
          const target = targetState(entry.workflow, input.workflows);
          const declared = declaredFlags[index] ?? null;
          return {
            workflow: entry.workflow,
            task: entry.task,
            declared,
            target,
            launch: classifyLaunch({ sourceState, declared, target }),
            children: newestFirst(
              childrenForWorkflow(input.snapshots, input.sessionId, entry.workflow).map(suggestionChild),
            ),
            // `argv` and `command` are dropped on purpose: they are never shown or run.
            artifacts: suggestionArtifacts(entry, read.availability[index]),
          };
        }),
      };
    }
  }
}

function provenanceArtifact(artifact: HandoffArtifact): ResultsProvenanceArtifact {
  let localState: OutputFileState = 'rejected';
  if (artifact.localPath !== null) localState = isFile(artifact.localPath) ? 'ok' : 'missing';
  return {
    name: artifact.name,
    output: artifact.output,
    path: artifact.path,
    localState,
    sha256: artifact.sha256,
    sourcePath: artifact.sourcePath,
  };
}

function sourceModel(input: ResultsInput, snapshot: SessionSnapshot): ResultsSource | null {
  const handoff = readHandoff(snapshot.manifest, input.sessionDirPath);
  const sourceId = manifestPriorSessionId(snapshot.manifest) ?? (handoff.kind === 'ok' ? handoff.sourceSessionId : null);
  if (sourceId === null) return null;
  const retained = input.snapshots.find((candidate) => candidate.sessionId === sourceId);
  let availability: SourceAvailability = 'missing';
  if (retained !== undefined) availability = 'retained';
  else if (input.eligibleIds.includes(sourceId)) availability = 'hidden';
  let provenance: ResultsProvenance = { state: 'none' };
  if (handoff.kind === 'invalid') provenance = { state: 'invalid', reason: handoff.reason };
  else if (handoff.kind === 'ok') provenance = { state: 'ok', artifacts: handoff.artifacts.map(provenanceArtifact) };
  return {
    sessionId: sourceId,
    title: retained === undefined ? null : sessionTitle(retained),
    availability,
    provenance,
  };
}

function unavailable(sessionId: string): ResultsModel {
  return {
    availability: 'unavailable',
    sessionId,
    title: sessionId,
    state: 'Unavailable',
    workflowId: null,
    meta: NO_SESSION_META,
    outputs: { rows: [], directoryError: null },
    next: { state: 'missing', detail: null, suggestions: [] },
    source: null,
    children: [],
  };
}

/** Build the page data for one session. Reads the detail files on demand; nothing is cached. */
export function buildResultsModel(input: ResultsInput): ResultsModel {
  const snapshot = input.snapshots.find((candidate) => candidate.sessionId === input.sessionId);
  if (snapshot === undefined) return unavailable(input.sessionId);
  const listing = listOutputs(input.sessionDirPath, publishedOutputs(snapshot.status));
  const executions = input.executions ?? [];
  return {
    availability: 'ok',
    sessionId: snapshot.sessionId,
    title: sessionTitle(snapshot),
    state: titleCase(snapshot.displayState.state),
    workflowId: snapshot.status?.workflow_id ?? snapshot.manifest?.workflow_id ?? null,
    meta: buildSessionMeta(snapshot),
    outputs: {
      rows: listing.rows.map((row) => outputRow(row, executions)),
      directoryError: listing.directoryError,
    },
    next: nextModel(input, snapshot.displayState.state),
    source: sourceModel(input, snapshot),
    children: childrenOf(input.snapshots, snapshot.sessionId).map((child) => childRow(child, input)),
  };
}

/** The output row an intent key names, resolved against a fresh listing. Null when it no longer exists. */
export function resolveOutputPath(input: ResultsInput, key: string): string | null {
  const snapshot = input.snapshots.find((candidate) => candidate.sessionId === input.sessionId);
  const listing = listOutputs(input.sessionDirPath, publishedOutputs(snapshot?.status));
  const row = listing.rows.find((candidate) => outputKey(candidate) === key);
  return row?.state === 'ok' ? row.absolutePath : null;
}

/** The local copy of a handoff artifact an intent names. Null when absent or outside the session. */
export function resolveHandoffPath(input: ResultsInput, name: string): string | null {
  const snapshot = input.snapshots.find((candidate) => candidate.sessionId === input.sessionId);
  const handoff = readHandoff(snapshot?.manifest ?? null, input.sessionDirPath);
  if (handoff.kind !== 'ok') return null;
  const artifact = handoff.artifacts.find((candidate) => candidate.name === name);
  return artifact?.localPath !== undefined && isFile(artifact.localPath) ? artifact.localPath : null;
}

/** A copyable value of a handoff artifact: its hash or the source path it was copied from. */
export function resolveHandoffValue(
  input: ResultsInput,
  name: string,
  kind: 'hash' | 'sourcePath',
): string | null {
  const snapshot = input.snapshots.find((candidate) => candidate.sessionId === input.sessionId);
  const handoff = readHandoff(snapshot?.manifest ?? null, input.sessionDirPath);
  if (handoff.kind !== 'ok') return null;
  const artifact = handoff.artifacts.find((candidate) => candidate.name === name);
  if (artifact === undefined) return null;
  return kind === 'hash' ? artifact.sha256 : artifact.sourcePath;
}
