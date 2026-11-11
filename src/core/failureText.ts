import type { RunOutcome } from '../cli/exitCode';
import { text } from '../text';

/** What the user is told about a finished command that did not succeed, and whether to offer the draft. */
export interface FailureText {
  message: string;
  offersDraft: boolean;
}

/**
 * The CLI names `workflow.yaml` in its rejection of a session draft (for example "Do not change id in
 * workflow.yaml"). `workflow.frozen.yaml` does not match, and exit 2 alone proves nothing about the cause.
 */
const DRAFT_DIAGNOSTIC = /\bworkflow\.yaml\b/i;

/**
 * CLI 0.3.6 runs the `doctor --session` checks before a session starts and ends them with "Preflight failed: ..."
 * (exit 2, nothing written). The problems are listed above that line, so the line alone says nothing about the cause.
 */
const PREFLIGHT_FAILED = /^preflight failed\b/i;

export function describeFailure({ outcome, exitCode, last, isDrafted }: {
  outcome: RunOutcome;
  exitCode: number | null;
  /** The last stderr line, when there is one. */
  last: string | undefined;
  /** The session has its own `workflow.yaml` (CLI 0.3.5 and later). */
  isDrafted: boolean;
}): FailureText {
  if (outcome !== 'ConfigError') {
    const exited = typeof exitCode === 'number' ? text('states.exitCode', { code: exitCode }) : text('states.exitCodeUnknown');
    return { message: append(exited, last), offersDraft: false };
  }
  if (last !== undefined && PREFLIGHT_FAILED.test(last)) {
    return { message: text('states.preflightFailed'), offersDraft: isDrafted };
  }
  const neutral = append(text('states.configError'), last);
  if (!isDrafted) return { message: neutral, offersDraft: false };
  if (last !== undefined && DRAFT_DIAGNOSTIC.test(last)) {
    return { message: text('states.draftRejected', { last }), offersDraft: true };
  }
  return { message: text('states.checkDraft', { neutral }), offersDraft: true };
}

function append(body: string, last: string | undefined): string {
  return last === undefined ? body : text('states.appendLast', { text: body, last });
}
