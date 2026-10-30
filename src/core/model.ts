/**
 * Types shared by the `core/` modules. Nothing here may import `vscode`.
 * Field shapes mirror migent's documented file formats (docs/sessions.md).
 */

/** Highest event envelope version this extension understands (events.jsonl `v`). */
export const KNOWN_EVENT_VERSION = 2;

/** Manifest `schema_version` values this extension understands. */
export const SUPPORTED_MANIFEST_SCHEMA_VERSIONS = [1, 2];

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
  raw: Record<string, unknown>;
}

export interface RunningStage {
  executionId: string | null;
  stageId: string | null;
  provider: string | null;
  event: string | null;
  summary: string | null;
  updatedAt: string | null;
}

/** Result of probing `session.lock`. Derived by `lockProbe.ts`, consumed by `displayState.ts`. */
export type LockProbe =
  | { kind: "none" }
  | { kind: "alive"; pid: number | null; host: string | null; heartbeatAt: string | null; foreignHost: boolean }
  | { kind: "stale"; reason: "dead-pid" | "heartbeat" | "unparsable" };

export type DisplayStateName =
  | "prepared"
  | "running"
  | "blocked"
  | "failed"
  | "stopped"
  | "cancelled"
  | "completed"
  | "unknown";

export interface DisplayState {
  state: DisplayStateName;
  icon: string;
  /**
   * False only while another host holds a live lock: the pid cannot be checked
   * from here, so write operations are disabled. Running on this host stays writable.
   */
  writable: boolean;
}

/** Lightweight execution summary for the tree. Details are read on demand (phase 2+). */
export interface ExecutionSnapshot {
  id: string;
  order: number;
  stage: string;
  attempt: number;
  status: string | null;
  decision: string | null;
  provider: string | null;
  model: string | null;
}

export interface SessionSnapshot {
  sessionId: string;
  manifest: SessionManifest | null;
  status: SessionStatus | null;
  /** True when status.json exists but did not parse after retries. */
  statusError: boolean;
  lock: LockProbe;
  displayState: DisplayState;
  /** Read lazily: only when the session node is expanded or the session is running. */
  executions: ExecutionSnapshot[];
  /** Highest `seq` consumed from events.jsonl; used for de-duplication. */
  lastEventSeq: number;
}

export type SessionChangeKind =
  | "added"
  | "updated"
  | "removed"
  | "executions"
  | "events";

export interface SessionChangeEvent {
  project: string;
  sessionId: string;
  kind: SessionChangeKind;
}
