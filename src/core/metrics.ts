import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { SealedMetricsHistorical, Static } from '@nodeint/migent-contracts';

import { text as describe } from '../text';
import { type Declared, declaredOf } from './contractRead';
import { METRICS_FILENAME } from './paths';
import { isRecord } from './record';

/**
 * `metrics.json` of a completed workflow session, reduced to what the Session Metrics page shows.
 * Documented nulls stay null; a missing value is never replaced by 0. Machine-specific fields
 * (`argv`, `agent_id`, `cli_version`, `git_head`, `git_dirty`) are deliberately not part of these types.
 */

/**
 * The opt-in historical shape (every field optional) is the upper bound of what is read: each reader below takes its
 * field names from it, so an upstream rename fails typecheck. Values stay `unknown`; it is a drift signal, not a gate.
 */
type HistoricalMetrics = Static<typeof SealedMetricsHistorical>;
type TotalsWire = NonNullable<HistoricalMetrics['totals']>;
type StageWire = NonNullable<HistoricalMetrics['stages']>[string];
type ExecutionWire = NonNullable<HistoricalMetrics['executions']>[number];
type UsageWire = NonNullable<TotalsWire['usage']>;
type VerifyWire = NonNullable<ExecutionWire['verify']>;

/** Token and cost values; null when the client did not report the field. */
export interface MetricsUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  costUsd: number | null;
}

/** Per field, how many turns did not report it. A count of turns, not money. */
export type MetricsUsageMissing = MetricsUsage;

export interface MetricsTotals {
  executions: number | null;
  skipped: number | null;
  wallSeconds: number | null;
  activeSeconds: number | null;
  verifySeconds: number | null;
  turns: number | null;
  uncapturedTurns: number | null;
  usage: MetricsUsage;
  usageMissing: MetricsUsageMissing;
  /** True when some executions reported a cost and others did not: `usage.costUsd` understates the session. */
  costPartial: boolean | null;
  failedExecutions: number | null;
  blocked: number | null;
  cancelled: number | null;
  verifyRed: number | null;
  revisions: number | null;
}

export interface MetricsStage {
  id: string;
  executions: number | null;
  skipped: number | null;
  revisions: number | null;
  failed: number | null;
  blocked: number | null;
}

export interface MetricsVerify {
  runs: number | null;
  red: number | null;
  firstPass: boolean | null;
  failedCommands: string[];
}

export interface MetricsExecution {
  id: string;
  order: number;
  stageId: string;
  attempt: number | null;
  role: string | null;
  client: string | null;
  model: string | null;
  status: string;
  decision: string | null;
  createdAt: string | null;
  completedAt: string | null;
  wallSeconds: number | null;
  verifySeconds: number | null;
  turns: number | null;
  usage: MetricsUsage;
  usageMissing: MetricsUsageMissing;
  verify: MetricsVerify | null;
  /** Reason of a `run_when` skip; null on every other row, or when the skip record names none. */
  skipReason: string | null;
  resumesExecutionId: string | null;
  routedFrom: string | null;
}

export interface SessionMetrics {
  totals: MetricsTotals;
  /** In the file's JSON order. */
  stages: MetricsStage[];
  executions: MetricsExecution[];
}

export type MetricsRead =
  | { kind: 'ok'; metrics: SessionMetrics }
  | { kind: 'missing' }
  | { kind: 'unreadable'; error: string }
  | { kind: 'invalid'; error: string };

function errorCode(error: unknown): string {
  return isRecord(error) && typeof error.code === 'string' ? error.code : 'unknown error';
}

function num(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function str(value: string | null | undefined): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function bool(value: boolean | null | undefined): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function usageOf(value: unknown): MetricsUsage {
  const source: Declared<UsageWire> = declaredOf<UsageWire>(value) ?? {};
  return {
    inputTokens: num(source.input_tokens),
    outputTokens: num(source.output_tokens),
    reasoningTokens: num(source.reasoning_tokens),
    cacheReadTokens: num(source.cache_read_tokens),
    cacheWriteTokens: num(source.cache_write_tokens),
    costUsd: num(source.cost_usd),
  };
}

function totalsOf(totals: Declared<TotalsWire>): MetricsTotals {
  return {
    executions: num(totals.executions),
    skipped: num(totals.skipped),
    wallSeconds: num(totals.wall_seconds),
    activeSeconds: num(totals.active_seconds),
    verifySeconds: num(totals.verify_seconds),
    turns: num(totals.turns),
    uncapturedTurns: num(totals.uncaptured_turns),
    usage: usageOf(totals.usage),
    usageMissing: usageOf(totals.usage_missing),
    costPartial: bool(totals.cost_partial),
    failedExecutions: num(totals.failed_executions),
    blocked: num(totals.blocked),
    cancelled: num(totals.cancelled),
    verifyRed: num(totals.verify_red),
    revisions: num(totals.revisions),
  };
}

function stageOf(id: string, value: Declared<StageWire>): MetricsStage {
  return {
    id,
    executions: num(value.executions),
    skipped: num(value.skipped),
    revisions: num(value.revisions),
    failed: num(value.failed),
    blocked: num(value.blocked),
  };
}

function verifyOf(raw: unknown): MetricsVerify | null {
  const value = declaredOf<VerifyWire>(raw);
  if (value === null) return null;
  const commands = Array.isArray(value.failed_commands) ? value.failed_commands : [];
  return {
    runs: num(value.runs),
    red: num(value.red),
    firstPass: bool(value.first_pass),
    failedCommands: commands.filter((command): command is string => typeof command === 'string'),
  };
}

/** `reason` of a skip record; the contract types `skip` as an open record, so the value is checked here. */
function skipReasonOf(skip: unknown): string | null {
  const reason = isRecord(skip) ? skip.reason : null;
  return str(typeof reason === 'string' ? reason : null);
}

function executionOf(raw: unknown): MetricsExecution | null {
  const value = declaredOf<ExecutionWire>(raw);
  if (value === null) return null;
  const id = str(value.execution_id);
  const order = num(value.execution_order);
  const stageId = str(value.stage_id);
  const status = str(value.status);
  if (id === null || order === null || stageId === null || status === null) return null;
  return {
    id,
    order,
    stageId,
    attempt: num(value.stage_attempt),
    role: str(value.role),
    client: str(value.client),
    model: str(value.model),
    status,
    decision: str(value.decision),
    createdAt: str(value.created_at),
    completedAt: str(value.completed_at),
    wallSeconds: num(value.wall_seconds),
    verifySeconds: num(value.verify_seconds),
    turns: num(value.turns),
    usage: usageOf(value.usage),
    usageMissing: usageOf(value.usage_missing),
    verify: verifyOf(value.verify),
    skipReason: skipReasonOf(value.skip),
    resumesExecutionId: str(value.resumes_execution_id),
    routedFrom: str(value.routed_from),
  };
}

/** Validate the top-level shapes the page consumes and reduce the file to {@link SessionMetrics}. */
export function parseMetrics(raw: unknown): MetricsRead {
  const value = declaredOf<HistoricalMetrics>(raw);
  if (value === null) return { kind: 'invalid', error: describe('states.notJsonObject') };
  const totals = declaredOf<TotalsWire>(value.totals);
  if (totals === null) return { kind: 'invalid', error: describe('states.totalsNotObject') };
  if (!isRecord(value.stages)) return { kind: 'invalid', error: describe('states.stagesNotObject') };
  if (!Array.isArray(value.executions)) return { kind: 'invalid', error: describe('states.executionsNotList') };
  const stages: MetricsStage[] = [];
  for (const [id, stage] of Object.entries(value.stages)) {
    const stageWire = declaredOf<StageWire>(stage);
    if (stageWire === null) return { kind: 'invalid', error: describe('states.stageNotObject') };
    stages.push(stageOf(id, stageWire));
  }
  const executions: MetricsExecution[] = [];
  for (const [index, entry] of value.executions.entries()) {
    const execution = executionOf(entry);
    if (execution === null) return { kind: 'invalid', error: `execution ${index + 1} is malformed` };
    executions.push(execution);
  }
  return { kind: 'ok', metrics: { totals: totalsOf(totals), stages, executions } };
}

/** Read `metrics.json` of one session on demand. Nothing is cached. */
export function readMetrics(sessionDirPath: string): MetricsRead {
  let text: string;
  try {
    text = readFileSync(path.join(sessionDirPath, METRICS_FILENAME), 'utf8');
  } catch (error) {
    const code = errorCode(error);
    return code === 'ENOENT' || code === 'ENOTDIR' ? { kind: 'missing' } : { kind: 'unreadable', error: code };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    // The parser's message can quote the file, which may hold fields that must not leave core.
    return { kind: 'invalid', error: describe('states.notValidJson') };
  }
  return parseMetrics(value);
}
