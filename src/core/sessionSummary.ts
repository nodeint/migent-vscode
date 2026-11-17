import type { ExecutionEntry } from './executions';
import type { DisplayStateName, SessionSnapshot, UnknownReason } from './model';
import { pendingQuestions } from './questions';
import { quotaFailure } from './replyFlow';
import { stageOf } from './sessionPresentation';
import { providerEventField } from './statusReader';

/** One blocked execution the Status block explains. */
export interface BlockedExecutionFact {
  executionId: string;
  stageId: string;
  attempt: number;
  /** `execution.json` `outcome.blocker`; null when the CLI recorded none. */
  blocker: string | null;
}

/**
 * The facts the Status block explains, before the page picks words. Pure: the
 * caller supplies the session snapshot and its execution summaries.
 */
export interface SessionSummary {
  state: DisplayStateName;
  /** Set only when `state` is `unknown`; the page owns the wording. */
  unknownReason: UnknownReason | null;
  /** The stage running now; null unless the session is Running. */
  runningStage: string | null;
  /** The latest provider event's summary; null unless the session is Running. */
  runningSummary: string | null;
  blocked: BlockedExecutionFact[];
  /** Epoch ms of a quota reset, when the failure was a client quota failure. */
  quotaResetAt: number | null;
  pendingQuestions: number;
  /** The execution `status.json` names, else the highest-order summary. */
  latestExecution: ExecutionEntry | null;
  isRunning: boolean;
}

/** The summary of a session that is not available to the page; the page shows its explanation instead. */
export const NO_SESSION_SUMMARY: SessionSummary = {
  state: 'unknown',
  unknownReason: null,
  runningStage: null,
  runningSummary: null,
  blocked: [],
  quotaResetAt: null,
  pendingQuestions: 0,
  latestExecution: null,
  isRunning: false,
};

function latestExecutionOf(
  snapshot: SessionSnapshot,
  executions: readonly ExecutionEntry[],
): ExecutionEntry | null {
  const id = snapshot.status?.latest_execution_id ?? null;
  const named = id === null ? undefined : executions.find((execution) => execution.id === id);
  if (named !== undefined) return named;
  let latest: ExecutionEntry | null = null;
  for (const execution of executions) {
    if (latest === null || execution.order >= latest.order) latest = execution;
  }
  return latest;
}

/** Running stage from the status's latest stage, then its latest provider event. */
function runningStageOf(snapshot: SessionSnapshot): string | null {
  return stageOf(snapshot) ?? providerEventField(snapshot.status, 'stage_id');
}

/** Collect the Status facts from a snapshot and its execution summaries. */
export function buildSummary(
  snapshot: SessionSnapshot,
  executions: readonly ExecutionEntry[],
): SessionSummary {
  const { state } = snapshot.displayState;
  const isRunning = state === 'running';
  return {
    state,
    unknownReason: snapshot.displayState.unknownReason ?? null,
    runningStage: isRunning ? runningStageOf(snapshot) : null,
    runningSummary: isRunning ? providerEventField(snapshot.status, 'summary') : null,
    blocked: [],
    quotaResetAt: quotaFailure(snapshot)?.retryAt ?? null,
    pendingQuestions: pendingQuestions().length,
    latestExecution: latestExecutionOf(snapshot, executions),
    isRunning,
  };
}
