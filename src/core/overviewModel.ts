import type { TailEvent } from './eventTail';
import type { ExecutionSnapshot, SessionSnapshot } from './model';
import { type OverviewActions,overviewActions } from './overviewActions';
import { buildResultsModel, type ResultsInput, type ResultsModel } from './resultsModel';
import { buildActivity, type SessionActivity } from './sessionActivity';
import { buildProgress, type SessionProgress } from './sessionProgress';
import { buildSummary, NO_SESSION_SUMMARY, type SessionSummary } from './sessionSummary';
import type { SessionStagePlan } from './workflowStages';

/**
 * The Overview page data: the existing results blocks plus the Status, Progress,
 * Latest activity and action fields. The host reads executions, the stage plan
 * and recent events; this builder never touches disk.
 */
export type OverviewModel = ResultsModel & {
  summary: SessionSummary;
  progress: SessionProgress;
  activity: SessionActivity;
  actions: OverviewActions;
};

export interface OverviewInput extends ResultsInput {
  executions: readonly ExecutionSnapshot[];
  plan: SessionStagePlan;
  /** Already-read recent events; the host passes none unless the session is Running. */
  events: readonly TailEvent[];
}

/** The stage ids the status reports as running now. */
function runningStageIdsOf(snapshot: SessionSnapshot): string[] {
  const ids: string[] = [];
  for (const stage of snapshot.status?.runningStages ?? []) {
    if (stage.stageId !== null) ids.push(stage.stageId);
  }
  return ids;
}

export function buildOverviewModel(input: OverviewInput): OverviewModel {
  const base = buildResultsModel(input);
  const snapshot = input.snapshots.find((candidate) => candidate.sessionId === input.sessionId);
  if (snapshot === undefined) {
    return {
      ...base,
      summary: NO_SESSION_SUMMARY,
      progress: { kind: 'empty' },
      activity: { visible: false },
      actions: { primary: null, secondary: [] },
    };
  }

  const summary = buildSummary(snapshot, input.executions);
  return {
    ...base,
    summary,
    progress: buildProgress({
      executions: input.executions,
      plan: input.plan,
      runningStageIds: runningStageIdsOf(snapshot),
      latestExecutionId: snapshot.status?.latestExecutionId ?? null,
    }),
    activity: summary.isRunning ? buildActivity(input.events) : { visible: false },
    actions: overviewActions(snapshot, summary.latestExecution),
  };
}
