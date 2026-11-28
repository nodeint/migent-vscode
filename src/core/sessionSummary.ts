import { executionBlocker, type ExecutionEntry } from './executions';
import type { DisplayStateName, SessionSnapshot, UnknownReason } from './model';
import { blockedTargets, quotaFailure } from './replyFlow';
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
  /**
   * The running stage the header does not show, from the provider event; null unless Running and the status
   * names no stage.
   */
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

/**
 * The stage only the provider event knows. When the status names a stage the page header already shows it, so the
 * card stage is null; otherwise it is the latest provider event's stage.
 */
function runningStageOf(snapshot: SessionSnapshot): string | null {
  return stageOf(snapshot) === null ? providerEventField(snapshot.status, 'stage_id') : null;
}

/** The blocked execution of an ordinary blocker with its recorded blocker text; a blank record counts as none. */
function blockedFacts(
  snapshot: SessionSnapshot,
  executions: readonly ExecutionEntry[],
): BlockedExecutionFact[] {
  const facts: BlockedExecutionFact[] = [];
  for (const target of blockedTargets(snapshot)) {
    const entry = executions.find((execution) => execution.id === target.executionId);
    const recorded = entry === undefined ? null : executionBlocker(entry.execution);
    facts.push({
      executionId: target.executionId,
      stageId: target.stageId ?? '',
      attempt: target.attempt,
      blocker: recorded !== null && recorded.trim() !== '' ? recorded : null,
    });
  }
  return facts;
}

/** Collect the Status facts from a snapshot and its execution summaries. */
export function buildSummary(
  snapshot: SessionSnapshot,
  executions: readonly ExecutionEntry[],
  pending = 0,
): SessionSummary {
  const { state } = snapshot.displayState;
  const isRunning = state === 'running';
  return {
    state,
    unknownReason: snapshot.displayState.unknownReason ?? null,
    runningStage: isRunning ? runningStageOf(snapshot) : null,
    runningSummary: isRunning ? providerEventField(snapshot.status, 'summary') : null,
    blocked: blockedFacts(snapshot, executions),
    quotaResetAt: quotaFailure(snapshot)?.retryAt ?? null,
    pendingQuestions: pending,
    latestExecution: latestExecutionOf(snapshot, executions),
    isRunning,
  };
}
