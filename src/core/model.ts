import type { LifecycleEventV2 } from '@nodeint/migent-contracts';

/**
 * Types shared by the `core/` modules. Nothing here may import `vscode`.
 * Field shapes mirror migent's documented file formats (docs/sessions.md).
 */

/** Highest event envelope version this extension understands (events.jsonl `v`). */
export const KNOWN_EVENT_VERSION: LifecycleEventV2['v'] = 2;

/**
 * Manifest `schema_version` values this extension understands. Independent of the
 * event envelope version: each file format versions on its own.
 */
export const CURRENT_MANIFEST_SCHEMA_VERSION = 2;
export const SUPPORTED_MANIFEST_SCHEMA_VERSIONS: readonly number[] = [1, CURRENT_MANIFEST_SCHEMA_VERSION];

/** A parsed `manifest.yaml`. Missing fields stay null instead of guessed. */
export interface SessionManifest {
  sessionId: string | null;
  title: string | null;
  workflowId: string | null;
  workflowPath: string | null;
  createdAt: string | null;
  priorSessionId: string | null;
  role: string | null;
  /** Raw `schema_version`; null when absent (older migent). */
  schemaVersion: number | null;
  /** True when `schemaVersion` is null or in SUPPORTED_MANIFEST_SCHEMA_VERSIONS. */
  schemaSupported: boolean;
  raw: Record<string, unknown>;
}

/** A parsed `status.json`. Written atomically by migent, so reads are complete. */
export interface SessionStatus {
  /** Raw `status` value; null when the field is missing. */
  status: string | null;
  workflowId: string | null;
  title: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  latestExecutionId: string | null;
  latestExecutionStatus: string | null;
  latestStageId: string | null;
  latestDecision: string | null;
  blockedByExecutionIds: string[];
  runningStages: RunningStage[];
  /** Pending human questions (`status.json.questions`); empty once answered. */
  questions: PendingQuestion[];
  /** Published outputs (`status.json.outputs`), in file order. */
  outputs: PublishedOutput[];
  /** Small scalar fields of `latest_provider_event`; the full object is never retained. */
  latestProviderEvent: ProviderEventSummary | null;
  /** The parsed `status.json` without `latest_provider_event`. */
  raw: Record<string, unknown>;
}

export interface QuestionOption {
  id: string;
  label: string;
  description: string | null;
}

/** Fields shared by the status summary and `questions.json` records. */
export interface QuestionBase {
  id: string;
  question: string;
  context: string | null;
  selection: string | null;
  options: QuestionOption[];
  recommended: string[];
  executionId: string | null;
  stageId: string | null;
  recipient: string | null;
}

/** A pending question as summarized by `status.json.questions`. */
export interface PendingQuestion extends QuestionBase {
  /** Session-relative path of the execution `questions.json`, as reported by migent. */
  file: string | null;
}

export interface PublishedOutput {
  name: string;
  /** Session-relative path as written by migent; not yet confined to the session. */
  path: string;
  sourceExecutionId: string | null;
  publishedByExecutionId: string | null;
}

export interface ProviderEventSummary {
  event: string | null;
  summary: string | null;
  stageId: string | null;
  executionId: string | null;
  client: string | null;
  timestamp: string | null;
  /** `details.retry_at` of a `provider.quota` event; null when absent or empty. */
  retryAt: string | null;
}

export interface RunningStage {
  executionId: string | null;
  stageId: string | null;
  client: string | null;
  event: string | null;
  summary: string | null;
  updatedAt: string | null;
}

/** Result of probing `session.lock`. Derived by `lockProbe.ts`, consumed by `displayState.ts`. */
export type LockProbe =
  | { kind: 'none' }
  | { kind: 'alive'; pid: number | null; host: string | null; heartbeatAt: string | null; foreignHost: boolean }
  | { kind: 'stale'; reason: 'dead-pid' | 'heartbeat' | 'unparsable' };

export type DisplayStateName =
  | 'prepared'
  | 'running'
  | 'blocked'
  | 'question'
  | 'failed'
  | 'stopped'
  | 'cancelled'
  | 'completed'
  | 'unknown';

/** Why a session is shown as Unknown. Present only when the state is `unknown`. */
export type UnknownReason =
  | 'missing-status'
  | 'unreadable-status'
  | 'invalid-status'
  | 'unsupported-schema'
  | 'invalid-manifest'
  | 'unrecognized-status';

export interface DisplayState {
  state: DisplayStateName;
  icon: string;
  /** Set when `state` is `unknown`; absent otherwise. */
  unknownReason?: UnknownReason;
  /**
   * False only while another host holds a live lock: the pid cannot be checked
   * from here, so write operations are disabled. Running on this host stays writable.
   */
  writable: boolean;
}

/** Lightweight execution summary for the tree. Read on demand by `listExecutions`; not held by the store. */
export interface ExecutionSnapshot {
  id: string;
  order: number;
  stage: string;
  attempt: number;
  status: string | null;
  decision: string | null;
  /** `outcome.blocker` recorded by the CLI when the execution blocked; null otherwise. */
  blocker: string | null;
  /** The failure reason and error the CLI recorded in `execution.json` (clipped); null when it recorded none. */
  error: string | null;
  client: string | null;
  model: string | null;
  /** `execution.json` `options.effort`; null when absent. */
  effort: string | null;
  /** Whether the execution wrote `failure.md` (CLI 0.3.6 and later); old sessions have none. */
  hasFailureReport: boolean;
  /** `execution.json` `kind`; `verify` marks a verify-only run, which has no agent to reply to. */
  kind: string | null;
  /** `execution.json` `created_at`; null when absent. */
  createdAt: string | null;
  /** `execution.json` `completed_at`; null while running or when absent. */
  completedAt: string | null;
}

/** What a reply answers: a blocker, an interrupted stage, or the next turn of a role session. */
export type ReplyTargetKind = 'blocker' | 'cancelled' | 'roleTurn';

/** One execution a reply can be sent to. `stageId` is null for a role session (the CLI target has no stage). */
export interface ReplyTarget {
  executionId: string;
  stageId: string | null;
  attempt: number;
  kind: ReplyTargetKind;
}

export interface SessionSnapshot {
  sessionId: string;
  manifest: SessionManifest | null;
  status: SessionStatus | null;
  /** True when status.json exists but did not parse after retries. */
  statusError: boolean;
  lock: LockProbe;
  /** Title from the CLI's `title.json` overlay; null when absent or invalid. Wins over every other title. */
  titleOverride: string | null;
  displayState: DisplayState;
  /** Executions a reply can answer now, computed by the store with the snapshot; empty when none. */
  replyTargets: readonly ReplyTarget[];
}

export type SessionChangeKind = 'added' | 'updated' | 'removed';

export interface SessionChangeEvent {
  project: string;
  sessionId: string;
  kind: SessionChangeKind;
}

/** Outcome of scanning a directory whose absence, emptiness and unreadability differ. */
export type DirectoryState = 'ok' | 'empty' | 'missing' | 'unreadable';

/**
 * Result of scanning `.migent/sessions`. `discovered` is every child directory;
 * `eligible` those with a `manifest.yaml` or `status.json`; `pending` the rest
 * (a directory whose marker has not been written yet).
 */
export interface ScanOutcome {
  state: DirectoryState;
  /** Error code or message when `state` is `unreadable`. */
  error: string | null;
  discovered: string[];
  eligible: string[];
  pending: string[];
}

export type ProjectChangeKind = 'scan' | 'workflows' | 'config';

export interface ProjectChangeEvent {
  project: string;
  kind: ProjectChangeKind;
}
