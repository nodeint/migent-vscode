import type { DisplayState, DisplayStateName, LockProbe, SessionStatus, UnknownReason } from './model';

export const DISPLAY_STATE_ICONS: Readonly<Record<DisplayStateName, string>> = {
  prepared: 'circle-outline',
  running: 'sync~spin',
  blocked: 'warning',
  question: 'comment-discussion',
  failed: 'error',
  stopped: 'debug-pause',
  cancelled: 'circle-slash',
  completed: 'pass',
  unknown: 'question',
};

/** The tone of each state: the color of its icon in the Sessions view, the badge and the editor tab. */
export type StateTone = 'info' | 'ok' | 'warn' | 'error' | 'muted';

export const DISPLAY_STATE_TONES: Readonly<Record<DisplayStateName, StateTone>> = {
  prepared: 'muted',
  running: 'info',
  blocked: 'warn',
  question: 'warn',
  failed: 'error',
  stopped: 'muted',
  cancelled: 'muted',
  completed: 'ok',
  unknown: 'muted',
};

/** The tone of a state by name in any letter case; anything that is not a display state is `muted`. */
export function stateTone(state: string): StateTone {
  const key = state.toLowerCase();
  return Object.entries(DISPLAY_STATE_TONES).find(([name]) => name === key)?.[1] ?? 'muted';
}

export interface DisplayStatusInput {
  /** Parsed status.json, or null when missing or unreadable. */
  status: SessionStatus | null;
  /** Why status.json could not be read, or null when it read cleanly or is absent. */
  statusError: 'unreadable' | 'invalid' | null;
  /**
   * `invalid` when manifest.yaml is missing or does not parse; `unsupported` when it
   * carries a schema_version this extension does not know.
   */
  manifest: 'ok' | 'invalid' | 'unsupported';
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
  const decision = decide(input, lock);
  const result: DisplayState = {
    state: decision.state,
    icon: DISPLAY_STATE_ICONS[decision.state],
    writable: !(lock.kind === 'alive' && lock.foreignHost),
  };
  if (decision.state === 'unknown') result.unknownReason = decision.reason;
  return result;
}

type Decision =
  | { state: Exclude<DisplayStateName, 'unknown'> }
  | { state: 'unknown'; reason: UnknownReason };

const unknown = (reason: UnknownReason): Decision => ({ state: 'unknown', reason });

function decide(input: DisplayStatusInput, lock: LockProbe): Decision {
  const { status, statusError, manifest } = input;
  if (manifest === 'invalid') return unknown('invalid-manifest');
  if (manifest === 'unsupported') return unknown('unsupported-schema');
  if (statusError !== null) return unknown(`${statusError}-status`);
  if (status === null) return unknown('missing-status');
  const sessionStatus = status.status ?? 'unknown';

  if (sessionStatus === 'prepared') return { state: 'prepared' };
  if (lock.kind === 'alive') return { state: 'running' };
  if (sessionStatus === 'blocked') return { state: 'blocked' };
  if (sessionStatus === 'question') return { state: 'question' };
  if (sessionStatus === 'active') {
    return { state: status.latestExecutionStatus === 'failed' ? 'failed' : 'stopped' };
  }
  if (sessionStatus === 'cancelled') return { state: 'cancelled' };
  if (sessionStatus === 'completed') return { state: 'completed' };
  return unknown('unrecognized-status');
}
