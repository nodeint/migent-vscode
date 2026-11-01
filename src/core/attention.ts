import type { SessionSnapshot } from './model';

export type SessionGroup = 'running' | 'attention' | 'recent';

/** Placement in the Sessions tree: each session appears in exactly one group. */
export function groupOf(snapshot: SessionSnapshot): SessionGroup {
  switch (snapshot.displayState.state) {
    case 'running':
      // A running session with pending questions stays here; the questions are an indicator.
      return 'running';
    case 'question':
    case 'blocked':
    case 'failed':
    case 'stopped':
    case 'unknown':
      return 'attention';
    case 'completed':
    case 'cancelled':
    case 'prepared':
      return 'recent';
  }
}

export function pendingQuestionCount(snapshot: SessionSnapshot): number {
  return snapshot.status?.questions.length ?? 0;
}

/**
 * Counted toward the badge and status bar: Blocked, Failed, Question, or pending
 * questions in any state. Unknown is never counted (its status cannot be trusted);
 * Stopped is counted only through pending questions.
 */
export function isCounted(snapshot: SessionSnapshot): boolean {
  const { state } = snapshot.displayState;
  if (state === 'unknown') return false;
  return state === 'blocked' || state === 'failed' || state === 'question' || pendingQuestionCount(snapshot) > 0;
}

/**
 * Never hidden by the session limit: work that is running or needs a person. Applies
 * to Unknown too when it carries pending questions, so a limit cannot bury them.
 */
export function isRetentionExempt(snapshot: SessionSnapshot): boolean {
  const { state } = snapshot.displayState;
  return state === 'running' || state === 'question' || state === 'blocked' || pendingQuestionCount(snapshot) > 0;
}

export interface AttentionSummary {
  running: number;
  /** Unique counted sessions (one session with a blocker and questions counts once). */
  needsAttention: number;
  blocked: number;
  failed: number;
  /** Sessions in the Question state. */
  asking: number;
  /** Total pending question records across counted sessions. */
  pendingQuestions: number;
}

export function summarize(snapshots: readonly SessionSnapshot[]): AttentionSummary {
  const summary: AttentionSummary = {
    running: 0,
    needsAttention: 0,
    blocked: 0,
    failed: 0,
    asking: 0,
    pendingQuestions: 0,
  };
  for (const snapshot of snapshots) {
    const { state } = snapshot.displayState;
    if (state === 'running') summary.running += 1;
    if (!isCounted(snapshot)) continue;
    summary.needsAttention += 1;
    summary.pendingQuestions += pendingQuestionCount(snapshot);
    if (state === 'blocked') summary.blocked += 1;
    if (state === 'failed') summary.failed += 1;
    if (state === 'question') summary.asking += 1;
  }
  return summary;
}
