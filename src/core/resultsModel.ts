import { statSync } from 'node:fs';
import path from 'node:path';

import { childrenOf, type HandoffArtifact, readHandoff } from './handoff';
import type { SessionSnapshot } from './model';
import { markDeclared, readFrozenDownstream, readNext, type SuggestionArtifact } from './nextWorkflows';
import { listOutputs, type OutputFileState } from './outputs';
import { sessionTitle } from './sessionPresentation';
import type { WorkflowEntry } from './workflows';

/**
 * The data a Results page shows, as plain JSON. Every string is inert text for the page: it is
 * rendered with `textContent` and never interpreted as HTML, a path or a command. Rows carry
 * a `key` the page sends back as an intent; the host resolves it against fresh data.
 */

export interface ResultsOutput {
  /** Intent key: `name:<published name>` or `path:<session-relative path>` for an unnamed file. */
  key: string;
  label: string;
  path: string;
  state: OutputFileState;
}

export type TargetWorkflowState = 'available' | 'duplicate' | 'invalid' | 'not-found';

export interface ResultsSuggestion {
  workflow: string;
  task: string | null;
  /** True when the frozen workflow declares it; null when the declaration could not be read. */
  declared: boolean | null;
  target: TargetWorkflowState;
  artifacts: SuggestionArtifact[];
}

export interface ResultsNext {
  /** `ok`, or the reason no suggestions are shown. Never affects the session state. */
  state: 'ok' | 'missing' | 'unreadable' | 'invalid' | 'unsupported';
  detail: string | null;
  frozen: 'ok' | 'absent' | 'unreadable' | 'invalid';
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
}

export interface ResultsModel {
  /** `unavailable`: the session is not known (removed, not yet loaded, or hidden by the limit). */
  availability: 'ok' | 'unavailable';
  sessionId: string;
  title: string;
  state: string;
  workflowId: string | null;
  completedAt: string | null;
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
}

/** Published names and unnamed paths live in separate namespaces, so one can never select the other's file. */
function outputKey(row: { name: string | null; path: string }): string {
  return row.name === null ? `path:${row.path}` : `name:${row.name}`;
}

function titleCase(value: string): string {
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

function targetState(workflow: string, workflows: readonly WorkflowEntry[]): TargetWorkflowState {
  const matches = workflows.filter((entry) => entry.id === workflow);
  if (matches.length === 0) return 'not-found';
  if (matches.length > 1) return 'duplicate';
  return matches[0]?.state === 'ok' ? 'available' : 'invalid';
}

function nextModel(input: ResultsInput): ResultsNext {
  const read = readNext(input.sessionDirPath);
  const frozen = readFrozenDownstream(input.sessionDirPath);
  const frozenState = frozen.kind;
  const base = { frozen: frozenState, suggestions: [] };
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
        detail: read.schemaVersion === null ? 'schema_version is missing' : `schema_version ${read.schemaVersion}`,
      };
    case 'ok':
      return {
        ...base,
        state: 'ok',
        detail: null,
        suggestions: markDeclared(read.suggestions, frozen).map((suggestion) => ({
          workflow: suggestion.workflow,
          task: suggestion.task,
          declared: suggestion.declared,
          target: targetState(suggestion.workflow, input.workflows),
          // `argv` is dropped on purpose: it is never shown or run.
          artifacts: suggestion.artifacts,
        })),
      };
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
  const sourceId = snapshot.manifest?.priorSessionId ?? (handoff.kind === 'ok' ? handoff.sourceSessionId : null);
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
    completedAt: null,
    outputs: { rows: [], directoryError: null },
    next: { state: 'missing', detail: null, frozen: 'absent', suggestions: [] },
    source: null,
    children: [],
  };
}

/** Build the page data for one session. Reads the detail files on demand; nothing is cached. */
export function buildResultsModel(input: ResultsInput): ResultsModel {
  const snapshot = input.snapshots.find((candidate) => candidate.sessionId === input.sessionId);
  if (snapshot === undefined) return unavailable(input.sessionId);
  const listing = listOutputs(input.sessionDirPath, snapshot.status?.outputs ?? []);
  const isCompleted = snapshot.displayState.state === 'completed';
  return {
    availability: 'ok',
    sessionId: snapshot.sessionId,
    title: sessionTitle(snapshot),
    state: titleCase(snapshot.displayState.state),
    workflowId: snapshot.status?.workflowId ?? snapshot.manifest?.workflowId ?? null,
    completedAt: isCompleted ? (snapshot.status?.updatedAt ?? null) : null,
    outputs: {
      rows: listing.rows.map((row) => ({
        key: outputKey(row),
        label: row.name ?? path.posix.basename(row.path),
        path: row.path,
        state: row.state,
      })),
      directoryError: listing.directoryError,
    },
    next: nextModel(input),
    source: sourceModel(input, snapshot),
    children: childrenOf(input.snapshots, snapshot.sessionId).map((child) => ({
      sessionId: child.sessionId,
      title: sessionTitle(child),
      state: titleCase(child.displayState.state),
    })),
  };
}

/** The output row an intent key names, resolved against a fresh listing. Null when it no longer exists. */
export function resolveOutputPath(input: ResultsInput, key: string): string | null {
  const snapshot = input.snapshots.find((candidate) => candidate.sessionId === input.sessionId);
  const listing = listOutputs(input.sessionDirPath, snapshot?.status?.outputs ?? []);
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
