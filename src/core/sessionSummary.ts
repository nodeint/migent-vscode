import { parseExecutionId } from './executions';
import type {
  DisplayStateName,
  ExecutionSnapshot,
  SessionSnapshot,
  UnknownReason,
} from './model';
import { quotaFailure } from './replyFlow';
import { stageOf } from './sessionPresentation';

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
  latestExecution: ExecutionSnapshot | null;
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
  executions: readonly ExecutionSnapshot[],
): ExecutionSnapshot | null {
  const id = snapshot.status?.latestExecutionId ?? null;
  const named = id === null ? undefined : executions.find((execution) => execution.id === id);
  if (named !== undefined) return named;
  let latest: ExecutionSnapshot | null = null;
  for (const execution of executions) {
    if (latest === null || execution.order >= latest.order) latest = execution;
  }
  return latest;
}

function blockedFacts(
  snapshot: SessionSnapshot,
  executions: readonly ExecutionSnapshot[],
): BlockedExecutionFact[] {
  const facts: BlockedExecutionFact[] = [];
  for (const executionId of snapshot.status?.blockedByExecutionIds ?? []) {
    const parsed = parseExecutionId(executionId);
    if (parsed === null) continue;
    const execution = executions.find((item) => item.id === executionId);
    facts.push({
      executionId,
      stageId: parsed.stageId,
      attempt: parsed.attempt,
      blocker: execution?.blocker ?? null,
    });
  }
  return facts;
}

/** Running stage from the status's running stages, then its latest provider event, then the latest stage. */
function runningStageOf(snapshot: SessionSnapshot): string | null {
  const event = snapshot.status?.latestProviderEvent ?? null;
  return snapshot.status?.runningStages[0]?.stageId ?? event?.stageId ?? stageOf(snapshot);
}

/** Collect the Status facts from a snapshot and its execution summaries. */
export function buildSummary(
  snapshot: SessionSnapshot,
  executions: readonly ExecutionSnapshot[],
): SessionSummary {
  const { state } = snapshot.displayState;
  const isRunning = state === 'running';
  const event = snapshot.status?.latestProviderEvent ?? null;
  return {
    state,
    unknownReason: snapshot.displayState.unknownReason ?? null,
    runningStage: isRunning ? runningStageOf(snapshot) : null,
    runningSummary: isRunning ? event?.summary ?? null : null,
    blocked: blockedFacts(snapshot, executions),
    quotaResetAt: quotaFailure(snapshot)?.retryAt ?? null,
    pendingQuestions: snapshot.status?.questions.length ?? 0,
    latestExecution: latestExecutionOf(snapshot, executions),
    isRunning,
  };
}
