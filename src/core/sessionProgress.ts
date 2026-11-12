import type { ExecutionSnapshot } from './model';
import type { SessionStagePlan } from './workflowStages';

/**
 * State of one stage or execution row. `unknown` keeps a status this extension
 * does not recognize visible instead of silently dropping it.
 */
export type ProgressState =
  | 'not-run'
  | 'running'
  | 'blocked'
  | 'failed'
  | 'stopped'
  | 'cancelled'
  | 'completed'
  | 'skipped'
  | 'unknown';

/** One attempt of a stage, for the attempt history. */
export interface StageAttempt {
  /** The execution order in the session, so attempts of every stage sort in the order they ran. */
  order: number;
  attempt: number;
  state: ProgressState;
  decision: string | null;
  completedAt: string | null;
}

/** One workflow stage. `attempts` is the latest run's attempt, null until it runs. */
export interface StageProgressRow {
  id: string;
  state: ProgressState;
  attempts: number | null;
  decision: string | null;
  /** Every non-skipped attempt, oldest first. The last one is the latest. */
  history: StageAttempt[];
  /** When the latest attempt completed; null while it runs or when unknown. */
  completedAt: string | null;
  isCurrent: boolean;
}

/** One execution, used for role sessions and workflows whose plan is unknown. */
export interface ExecutionProgressRow {
  executionId: string;
  stage: string;
  attempt: number;
  state: ProgressState;
  decision: string | null;
  completedAt: string | null;
  isCurrent: boolean;
}

/** `empty` is reserved for a session that is not available to the page. */
export type SessionProgress =
  | { kind: 'stages'; rows: StageProgressRow[] }
  | { kind: 'executions'; rows: ExecutionProgressRow[] }
  | { kind: 'empty' };

export interface ProgressInput {
  executions: readonly ExecutionSnapshot[];
  plan: SessionStagePlan;
  /** Stage ids the session status reports as running now. */
  runningStageIds: readonly string[];
  /** `status.json` `latest_execution_id`, used to find the latest running execution. */
  latestExecutionId: string | null;
}

function stateOf(status: string | null): ProgressState {
  switch (status) {
    case 'running':
    case 'blocked':
    case 'failed':
    case 'stopped':
    case 'cancelled':
    case 'completed':
    case 'skipped':
      return status;
    default:
      return 'unknown';
  }
}

function lastMatching<T>(items: readonly T[], isMatch: (item: T) => boolean): T | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item !== undefined && isMatch(item)) return item;
  }
  return null;
}

/** The latest execution that is running: the status's latest one when it says so, else the last one. */
function latestRunning(
  executions: readonly ExecutionSnapshot[],
  latestExecutionId: string | null,
): ExecutionSnapshot | null {
  const latest = executions.find((execution) => execution.id === latestExecutionId);
  if (latest?.status === 'running') return latest;
  return lastMatching(executions, (execution) => execution.status === 'running');
}

interface StageContext {
  executions: readonly ExecutionSnapshot[];
  runningStageIds: ReadonlySet<string>;
  running: ExecutionSnapshot | null;
}

function stageRow(id: string, context: StageContext): StageProgressRow {
  const stageExecutions = context.executions.filter((execution) => execution.stage === id);
  const chosen =
    lastMatching(stageExecutions, (execution) => execution.status !== 'skipped') ??
    stageExecutions.at(-1) ??
    null;
  return {
    id,
    state: chosen === null ? 'not-run' : stateOf(chosen.status),
    attempts: chosen?.attempt ?? null,
    decision: chosen?.decision ?? null,
    history: stageExecutions
      .filter((execution) => execution.status !== 'skipped')
      .map((execution) => ({
        order: execution.order,
        attempt: execution.attempt,
        state: stateOf(execution.status),
        decision: execution.decision,
        completedAt: execution.completedAt,
      })),
    completedAt: chosen?.completedAt ?? null,
    isCurrent:
      context.runningStageIds.has(id) ||
      (context.runningStageIds.size === 0 && context.running?.stage === id),
  };
}

/**
 * Build the Progress rows: one per declared stage when the session's workflow is
 * readable, else one per execution. Stage ids that have executions but are no
 * longer declared are appended in execution order, so a workflow edit never hides
 * work that already ran. Pure: the caller reads executions, the plan and status.
 */
export function buildProgress(input: ProgressInput): SessionProgress {
  const executions = [...input.executions].sort(
    (left, right) => left.order - right.order || (left.id < right.id ? -1 : 1),
  );
  const running = latestRunning(executions, input.latestExecutionId);

  if (input.plan.kind !== 'ok' || input.plan.stages.length === 0) {
    return {
      kind: 'executions',
      rows: executions.map((execution) => ({
        executionId: execution.id,
        stage: execution.stage,
        attempt: execution.attempt,
        state: stateOf(execution.status),
        decision: execution.decision,
        completedAt: execution.completedAt,
        isCurrent: execution.id === running?.id,
      })),
    };
  }

  const runningStageIds = new Set(input.runningStageIds);
  const planned = new Set(input.plan.stages);
  const extraStages: string[] = [];
  for (const execution of executions) {
    const { stage } = execution;
    if (stage === '' || planned.has(stage) || extraStages.includes(stage)) continue;
    extraStages.push(stage);
  }
  return {
    kind: 'stages',
    rows: [...input.plan.stages, ...extraStages].map((id) =>
      stageRow(id, { executions, runningStageIds, running })),
  };
}
