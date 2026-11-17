import type { LifecycleEventV2, SessionManifest, SessionStatusFile } from '@nodeint/migent-contracts';

/**
 * Types shared by the `core/` modules. Nothing here may import `vscode`.
 * Field shapes mirror migent's documented file formats (docs/sessions.md).
 */

/** Highest event envelope version this extension understands (events.jsonl `v`). */
export const KNOWN_EVENT_VERSION: LifecycleEventV2['v'] = 2;

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
  /** `manifest.yaml` as the contract declares it; null when missing, invalid or of an unsupported schema. */
  manifest: SessionManifest | null;
  /** The `schema_version` of a manifest this extension does not know (D3d: not a contract value); null otherwise. */
  unsupportedManifestVersion: number | null;
  status: SessionStatusFile | null;
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
