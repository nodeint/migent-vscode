import type { DisplayState, LockProbe, SessionStatus } from "./model";

export const DISPLAY_STATE_ICONS: Readonly<Record<DisplayState["state"], string>> = {
  prepared: "circle-outline",
  running: "sync~spin",
  blocked: "warning",
  failed: "error",
  stopped: "debug-pause",
  cancelled: "circle-slash",
  completed: "pass",
  unknown: "question",
};

export interface DisplayStatusInput {
  /** Raw status.json content, or null when missing / unparsable / unknown schema. */
  status: SessionStatus | null;
  /** True when status.json exists but could not be read. */
  statusError: boolean;
  /** False when the manifest carries a schema_version this extension does not know. */
  schemaSupported: boolean;
}

/**
 * Derive the displayed state from status.json plus the lock probe. Pure function;
 * the table in plans/01-core.md section 1 is its test suite.
 *
 * `status = active` alone is not enough: an active session with no lock is just
 * "stopped, can be resumed". Only a live lock means Running.
 */
export function deriveDisplayState(
  input: DisplayStatusInput,
  lock: LockProbe,
): DisplayState {
  const state = decide(input, lock);
  return {
    state,
    icon: DISPLAY_STATE_ICONS[state],
    writable: !(lock.kind === "alive" && lock.foreignHost),
  };
}

function decide(input: DisplayStatusInput, lock: LockProbe): DisplayState["state"] {
  const { status, statusError, schemaSupported } = input;
  if (statusError || status === null || !schemaSupported) return "unknown";
  const sessionStatus = status.status ?? "unknown";

  if (sessionStatus === "prepared") return "prepared";
  if (lock.kind === "alive") return "running";
  if (sessionStatus === "blocked") return "blocked";
  if (sessionStatus === "active") {
    return status.latestExecutionStatus === "failed" ? "failed" : "stopped";
  }
  if (sessionStatus === "cancelled") return "cancelled";
  if (sessionStatus === "completed") return "completed";
  return "unknown";
}
