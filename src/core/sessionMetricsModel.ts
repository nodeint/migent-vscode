import {
  readMetrics,
  type SanitizedExecution,
  type SanitizedUsage,
  type SanitizedVerify,
  type SessionMetrics,
} from './metrics';
import type { SessionSnapshot } from './model';
import { titleCase } from './resultsModel';
import { buildSessionMeta, NO_SESSION_META, type SessionMeta } from './sessionMeta';
import { sessionTitle, truncate } from './sessionPresentation';

/**
 * The data the Session Metrics page shows, as plain JSON. Every string is inert text rendered with
 * `textContent`. It is built only from the sanitized projection of `metrics.json`, so `argv` and other
 * machine-specific fields never get this far (see `metrics.ts`). A value the file does not report is null, never 0.
 */

type CamelCase<S extends string> = S extends `${infer Head}_${infer Tail}` ? `${Head}${Capitalize<CamelCase<Tail>>}` : S;

/**
 * A record of the sanitized projection as the page shows it. Key names and value types come from the contract through
 * the projection: keys are camelCase, every key is present, and a value the file did not report is null.
 */
type Shown<T> = { [Key in keyof T & string as CamelCase<Key>]-?: NonNullable<T[Key]> | null };

type ExecutionShownKey =
  | 'role'
  | 'client'
  | 'model'
  | 'decision'
  | 'created_at'
  | 'completed_at'
  | 'wall_seconds'
  | 'verify_seconds'
  | 'turns'
  | 'resumes_execution_id'
  | 'routed_from';

/** Token and cost values; null when the client did not report the field. */
export type UsageView = Shown<SanitizedUsage>;

export type TotalsView = Shown<Omit<SessionMetrics['totals'], 'usage' | 'usage_missing'>> & {
  usage: UsageView;
  /** Per field, how many turns did not report it. A count of turns, not money. */
  usageMissing: UsageView;
};

export type StageView = Shown<SessionMetrics['stages'][string]> & { id: string };

export type VerifyView = Shown<Omit<SanitizedVerify, 'failed_commands'>> & {
  failedCommands: NonNullable<SanitizedVerify['failed_commands']>;
};

export type ExecutionView = Shown<Pick<SanitizedExecution, ExecutionShownKey>> & {
  id: SanitizedExecution['execution_id'];
  order: SanitizedExecution['execution_order'];
  stageId: SanitizedExecution['stage_id'];
  status: SanitizedExecution['status'];
  attempt: NonNullable<SanitizedExecution['stage_attempt']> | null;
  usage: UsageView;
  usageMissing: UsageView;
  verify: VerifyView | null;
  /** Reason of a `run_when` skip; null on every other row, or when the skip record names none. */
  skipReason: string | null;
};

function numberOrNull(value: number | null = null): number | null {
  return value;
}

function textOrNull(value: string | null | undefined): string | null {
  return value === undefined || value === null || value === '' ? null : value;
}

function usageView(usage: SanitizedUsage = {}): UsageView {
  return {
    inputTokens: numberOrNull(usage.input_tokens),
    outputTokens: numberOrNull(usage.output_tokens),
    reasoningTokens: numberOrNull(usage.reasoning_tokens),
    cacheReadTokens: numberOrNull(usage.cache_read_tokens),
    cacheWriteTokens: numberOrNull(usage.cache_write_tokens),
    costUsd: numberOrNull(usage.cost_usd),
  };
}

function totalsView(totals: SessionMetrics['totals']): TotalsView {
  return {
    executions: numberOrNull(totals.executions),
    skipped: numberOrNull(totals.skipped),
    wallSeconds: numberOrNull(totals.wall_seconds),
    activeSeconds: numberOrNull(totals.active_seconds),
    verifySeconds: numberOrNull(totals.verify_seconds),
    turns: numberOrNull(totals.turns),
    uncapturedTurns: numberOrNull(totals.uncaptured_turns),
    usage: usageView(totals.usage),
    usageMissing: usageView(totals.usage_missing),
    costPartial: totals.cost_partial ?? null,
    failedExecutions: numberOrNull(totals.failed_executions),
    blocked: numberOrNull(totals.blocked),
    cancelled: numberOrNull(totals.cancelled),
    verifyRed: numberOrNull(totals.verify_red),
    revisions: numberOrNull(totals.revisions),
  };
}

function stageViews(stages: SessionMetrics['stages']): StageView[] {
  return Object.entries(stages).map(([id, stage]) => ({
    id,
    executions: numberOrNull(stage.executions),
    skipped: numberOrNull(stage.skipped),
    revisions: numberOrNull(stage.revisions),
    failed: numberOrNull(stage.failed),
    blocked: numberOrNull(stage.blocked),
  }));
}

function skipReasonOf(skip: SanitizedExecution['skip']): string | null {
  const reason = skip?.reason;
  return textOrNull(typeof reason === 'string' ? reason : null);
}

/** The page value of one execution of the sanitized projection. */
export function executionView(execution: SanitizedExecution): ExecutionView {
  const { verify } = execution;
  return {
    id: execution.execution_id,
    order: execution.execution_order,
    stageId: execution.stage_id,
    attempt: numberOrNull(execution.stage_attempt),
    role: textOrNull(execution.role),
    client: textOrNull(execution.client),
    model: textOrNull(execution.model),
    status: execution.status,
    decision: textOrNull(execution.decision),
    createdAt: textOrNull(execution.created_at),
    completedAt: textOrNull(execution.completed_at),
    wallSeconds: numberOrNull(execution.wall_seconds),
    verifySeconds: numberOrNull(execution.verify_seconds),
    turns: numberOrNull(execution.turns),
    usage: usageView(execution.usage),
    usageMissing: usageView(execution.usage_missing),
    verify:
      verify === undefined || verify === null
        ? null
        : {
            runs: numberOrNull(verify.runs),
            red: numberOrNull(verify.red),
            firstPass: verify.first_pass ?? null,
            failedCommands: verify.failed_commands ?? [],
          },
    skipReason: skipReasonOf(execution.skip),
    resumesExecutionId: textOrNull(execution.resumes_execution_id),
    routedFrom: textOrNull(execution.routed_from),
  };
}

export type SessionMetricsView =
  | { kind: 'ok'; totals: TotalsView; stages: StageView[]; executions: ExecutionView[] }
  | { kind: 'missing' }
  | { kind: 'unreadable'; error: string }
  | { kind: 'invalid'; error: string };

export interface SessionMetricsModel {
  /** `unavailable`: the session is not known (removed, not yet loaded, or hidden by the limit). */
  availability: 'ok' | 'unavailable';
  sessionId: string;
  title: string;
  state: string;
  workflowId: string | null;
  completedAt: string | null;
  /** What the header says about the session, the same on every session page. */
  meta: SessionMeta;
  metrics: SessionMetricsView;
}

export interface SessionMetricsInput {
  sessionId: string;
  sessionDirPath: string;
  /** Retained snapshots of the project. */
  snapshots: readonly SessionSnapshot[];
}

const TITLE_MAX = 32;

/** The editor tab title: the shortened session title, or `Metrics` when unavailable. The tab icon names the page. */
export function sessionMetricsPanelTitle(model: SessionMetricsModel): string {
  return model.availability === 'unavailable' ? 'Metrics' : truncate(model.title, TITLE_MAX);
}

function unavailable(sessionId: string): SessionMetricsModel {
  return {
    availability: 'unavailable',
    sessionId,
    title: sessionId,
    state: 'Unavailable',
    workflowId: null,
    completedAt: null,
    meta: NO_SESSION_META,
    metrics: { kind: 'missing' },
  };
}

/** Build the page data for one session. Reads `metrics.json` on demand; nothing is cached. */
export function buildSessionMetricsModel(input: SessionMetricsInput): SessionMetricsModel {
  const snapshot = input.snapshots.find((candidate) => candidate.sessionId === input.sessionId);
  if (snapshot === undefined) return unavailable(input.sessionId);
  const read = readMetrics(input.sessionDirPath);
  let metrics: SessionMetricsView;
  switch (read.kind) {
    case 'ok':
      metrics = {
        kind: 'ok',
        totals: totalsView(read.metrics.totals),
        stages: stageViews(read.metrics.stages),
        executions: read.metrics.executions.map(executionView),
      };
      break;
    case 'missing':
      metrics = { kind: 'missing' };
      break;
    case 'unreadable':
    case 'invalid':
      metrics = { kind: read.kind, error: read.error };
      break;
  }
  return {
    availability: 'ok',
    sessionId: snapshot.sessionId,
    title: sessionTitle(snapshot),
    state: titleCase(snapshot.displayState.state),
    workflowId: snapshot.status?.workflow_id ?? snapshot.manifest?.workflow_id ?? null,
    completedAt: snapshot.displayState.state === 'completed' ? (snapshot.status?.updated_at ?? null) : null,
    meta: buildSessionMeta(snapshot),
    metrics,
  };
}
