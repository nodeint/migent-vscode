import type { MetricsExecution } from './metrics';
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

/** Another attempt, named by its stage and attempt number. */
export interface AttemptRef {
  stage: string;
  attempt: number;
}

/**
 * What an attempt shows beyond its state: the model and effort it ran with, its blocker, its times, and the
 * duration and tokens from `metrics.json`. Every field is null when the source does not say.
 */
export interface AttemptFacts {
  model: string | null;
  effort: string | null;
  blocker: string | null;
  /** The recorded failure reason and error; null when none. */
  error: string | null;
  createdAt: string | null;
  wallSeconds: number | null;
  /** Input plus output tokens; null unless metrics report at least one of them. */
  tokens: number | null;
  /** The earlier attempt this one resumed, when `metrics.json` names one that is in the session. */
  resumes: AttemptRef | null;
  /** The attempt whose decision routed to this one, when `metrics.json` names one that is in the session. */
  routedFrom: AttemptRef | null;
}

/** One attempt of a stage, for the attempt history. */
export interface StageAttempt extends AttemptFacts {
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
export interface ExecutionProgressRow extends AttemptFacts {
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
  /** `metrics.json` executions; absent for an old or running session, which then shows no duration or tokens. */
  metrics?: readonly MetricsExecution[];
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

function sum(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? null : present.reduce((total, value) => total + value, 0);
}

/** The facts of every execution by id, resolving `resumes` and `routed from` to named attempts. */
function factsOf(
  executions: readonly ExecutionSnapshot[],
  metrics: readonly MetricsExecution[],
): (execution: ExecutionSnapshot) => AttemptFacts {
  const byId = new Map(executions.map((execution) => [execution.id, execution]));
  const metricsById = new Map(metrics.map((entry) => [entry.id, entry]));
  const refOf = (id: string | null | undefined): AttemptRef | null => {
    const target = id === null || id === undefined ? undefined : byId.get(id);
    return target === undefined ? null : { stage: target.stage, attempt: target.attempt };
  };
  return (execution) => {
    const measured = metricsById.get(execution.id);
    return {
      model: execution.model,
      effort: execution.effort,
      blocker: execution.blocker,
      error: execution.error,
      createdAt: execution.createdAt,
      wallSeconds: measured?.wallSeconds ?? null,
      tokens: measured === undefined ? null : sum([measured.usage.inputTokens, measured.usage.outputTokens]),
      resumes: refOf(measured?.resumesExecutionId),
      routedFrom: refOf(measured?.routedFrom),
    };
  };
}

interface StageContext {
  facts: (execution: ExecutionSnapshot) => AttemptFacts;
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
        ...context.facts(execution),
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
  const facts = factsOf(executions, input.metrics ?? []);

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
        ...facts(execution),
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
      stageRow(id, { facts, executions, runningStageIds, running })),
  };
}
