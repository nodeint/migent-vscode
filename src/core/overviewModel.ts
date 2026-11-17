import type { EventEntry } from './eventTail';
import type { ExecutionEntry } from './executions';
import type { HumanInputFact } from './humanInput';
import type { MetricsExecution } from './metrics';
import { type OverviewActions,overviewActions } from './overviewActions';
import { buildResultsModel, type ResultsInput, type ResultsModel,type ResultsNext } from './resultsModel';
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
  /** What to do after a Completed session; null for any other state or an unusable `next.json`. */
  nextStep: NextStepAction | null;
};

export type NextStepAction =
  | { kind: 'run'; workflow: string }
  | { kind: 'choose'; count: number }
  | { kind: 'blocked'; count: number }
  | { kind: 'done' };

/**
 * The next action of a Completed session, from the per-suggestion launch states. Only suggestions that can launch
 * and have no child yet count as actionable; blocked ones never raise a count or turn `run` into `choose`.
 */
export function nextStepAction(state: string, next: ResultsNext): NextStepAction | null {
  if (state !== 'completed') return null;
  if (next.state === 'missing') return { kind: 'done' };
  if (next.state !== 'ok') return null;
  const notRun = next.suggestions.filter((suggestion) => suggestion.children.length === 0);
  const actionable = notRun.filter((suggestion) => suggestion.launch.state === 'ready');
  if (actionable.length === 1) return { kind: 'run', workflow: actionable[0].workflow };
  if (actionable.length > 1) return { kind: 'choose', count: actionable.length };
  if (notRun.length > 0) return { kind: 'blocked', count: notRun.length };
  return { kind: 'done' };
}

export interface OverviewInput extends ResultsInput {
  executions: readonly ExecutionEntry[];
  plan: SessionStagePlan;
  /** `metrics.json` executions when the file is readable; the host passes none otherwise. */
  metrics?: readonly MetricsExecution[];
  /** `metrics.json` `totals.wall_seconds`: the elapsed time of the session. */
  wallSeconds?: number | null;
  /** The human input each execution opened with; the host reads it for any session state. */
  inputs?: ReadonlyMap<string, HumanInputFact>;
  /** Already-read recent events; the host passes none unless the session is Running. */
  events: readonly EventEntry[];
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
      nextStep: null,
    };
  }

  const summary = buildSummary(snapshot, input.executions);
  return {
    ...base,
    summary,
    progress: buildProgress({
      executions: input.executions,
      plan: input.plan,
      runningStageIds: [],
      latestExecutionId: snapshot.status?.latest_execution_id ?? null,
      metrics: input.metrics,
      wallSeconds: input.wallSeconds,
      inputs: input.inputs,
    }),
    activity: summary.isRunning ? buildActivity(input.events) : { visible: false },
    actions: overviewActions(snapshot, summary.latestExecution),
    nextStep: nextStepAction(snapshot.displayState.state, base.next),
  };
}
