import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { SealedMetricsHistorical, Static } from '@nodeint/migent-contracts';

import { text as describe } from '../text';
import { type Declared, declaredOf } from './contractRead';
import { METRICS_FILENAME } from './paths';
import { isRecord } from './record';

/**
 * `metrics.json` of a completed workflow session, reduced to what the Session Metrics page shows.
 *
 * The result is a projection of the contract's `SealedMetricsHistorical`, limited to `totals`, `stages` and
 * `executions`. Field names and value types come from the contract; documented nulls stay null and a missing value
 * is never replaced by 0. The machine-specific execution fields in {@link EXCLUDED_EXECUTION_KEYS} are a data
 * exposure boundary: the reader copies fields one by one from an allow-list, so neither those keys nor any unknown
 * key ever leaves this module. Display values are computed in `sessionMetricsModel.ts`.
 */

/**
 * The opt-in historical shape (every field optional) is the upper bound of what is read: each reader below takes its
 * field names from it, so an upstream rename fails typecheck. Values stay `unknown` until checked.
 */
type HistoricalMetrics = Static<typeof SealedMetricsHistorical>;
type TotalsWire = NonNullable<HistoricalMetrics['totals']>;
type StageWire = NonNullable<HistoricalMetrics['stages']>[string];
type ExecutionWire = NonNullable<HistoricalMetrics['executions']>[number];
type UsageWire = NonNullable<TotalsWire['usage']>;
type UsageMissingWire = NonNullable<TotalsWire['usage_missing']>;
type VerifyWire = NonNullable<ExecutionWire['verify']>;

/** Execution fields that identify the machine or the run. They are never copied out of this module. */
export const EXCLUDED_EXECUTION_KEYS = [
  'argv',
  'agent_id',
  'cli_version',
  'git_head',
  'git_dirty',
] as const satisfies readonly (keyof ExecutionWire)[];

/** An object of the contract with only the fields the file reported; an absent field is never filled in. */
type Reported<T> = { [Key in keyof T]?: T[Key] };

type IdentityKey = 'execution_id' | 'execution_order' | 'stage_id' | 'status';

export type SanitizedUsage = Reported<UsageWire>;
export type SanitizedUsageMissing = Reported<UsageMissingWire>;
export type SanitizedVerify = Reported<NonNullable<VerifyWire>>;

/** The execution fields the page uses. None of them is an excluded key (checked in `contractBinding.test.ts`). */
type KeptExecutionKey =
  | 'stage_attempt'
  | 'role'
  | 'client'
  | 'model'
  | 'decision'
  | 'created_at'
  | 'completed_at'
  | 'wall_seconds'
  | 'verify_seconds'
  | 'turns'
  | 'skip'
  | 'resumes_execution_id'
  | 'routed_from';

/** One execution of the projection. The reader guarantees the four identity fields. */
export type SanitizedExecution = Pick<ExecutionWire, KeptExecutionKey> &
  { [Key in IdentityKey]-?: NonNullable<ExecutionWire[Key]> } & {
    usage?: SanitizedUsage;
    usage_missing?: SanitizedUsageMissing;
    verify?: SanitizedVerify | null;
  };

type KeptTotalsKey =
  | 'executions'
  | 'skipped'
  | 'wall_seconds'
  | 'active_seconds'
  | 'verify_seconds'
  | 'turns'
  | 'uncaptured_turns'
  | 'cost_partial'
  | 'failed_executions'
  | 'blocked'
  | 'cancelled'
  | 'verify_red'
  | 'revisions';

/** `metrics.json` reduced to `totals`, `stages` and `executions`. Stages keep the file's JSON order. */
export interface SessionMetrics {
  totals: Pick<TotalsWire, KeptTotalsKey> & {
    usage?: SanitizedUsage;
    usage_missing?: SanitizedUsageMissing;
  };
  stages: Record<string, Pick<StageWire, 'executions' | 'skipped' | 'revisions' | 'failed' | 'blocked'>>;
  executions: SanitizedExecution[];
}

export type MetricsRead =
  | { kind: 'ok'; metrics: SessionMetrics }
  | { kind: 'missing' }
  | { kind: 'unreadable'; error: string }
  | { kind: 'invalid'; error: string };

function errorCode(error: unknown): string {
  return isRecord(error) && typeof error.code === 'string' ? error.code : 'unknown error';
}

/** A finite number, else absent. */
function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** A finite number or a documented null, else absent. */
function numOrNull(value: unknown): number | null | undefined {
  return value === null ? null : num(value);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function strOrNull(value: unknown): string | null | undefined {
  return value === null ? null : str(value);
}

function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function usageOf(value: unknown): Reported<UsageWire> | undefined {
  const source = declaredOf<UsageWire>(value);
  if (source === null) return undefined;
  return {
    input_tokens: numOrNull(source.input_tokens),
    output_tokens: numOrNull(source.output_tokens),
    reasoning_tokens: numOrNull(source.reasoning_tokens),
    cache_read_tokens: numOrNull(source.cache_read_tokens),
    cache_write_tokens: numOrNull(source.cache_write_tokens),
    cost_usd: numOrNull(source.cost_usd),
  };
}

function usageMissingOf(value: unknown): Reported<UsageMissingWire> | undefined {
  const source = declaredOf<UsageMissingWire>(value);
  if (source === null) return undefined;
  return {
    input_tokens: num(source.input_tokens),
    output_tokens: num(source.output_tokens),
    reasoning_tokens: num(source.reasoning_tokens),
    cache_read_tokens: num(source.cache_read_tokens),
    cache_write_tokens: num(source.cache_write_tokens),
    cost_usd: num(source.cost_usd),
  };
}

function totalsOf(totals: Declared<TotalsWire>): SessionMetrics['totals'] {
  return {
    executions: num(totals.executions),
    skipped: num(totals.skipped),
    wall_seconds: numOrNull(totals.wall_seconds),
    active_seconds: num(totals.active_seconds),
    verify_seconds: num(totals.verify_seconds),
    turns: num(totals.turns),
    uncaptured_turns: num(totals.uncaptured_turns),
    usage: usageOf(totals.usage),
    usage_missing: usageMissingOf(totals.usage_missing),
    cost_partial: bool(totals.cost_partial),
    failed_executions: num(totals.failed_executions),
    blocked: num(totals.blocked),
    cancelled: num(totals.cancelled),
    verify_red: num(totals.verify_red),
    revisions: numOrNull(totals.revisions),
  };
}

function stageOf(value: Declared<StageWire>): SessionMetrics['stages'][string] {
  return {
    executions: num(value.executions),
    skipped: num(value.skipped),
    revisions: numOrNull(value.revisions),
    failed: num(value.failed),
    blocked: num(value.blocked),
  };
}

/** The verify summary; a field of the wrong type is left out, and only string commands are kept. */
function verifyOf(raw: unknown): SanitizedExecution['verify'] {
  if (raw === null) return null;
  const value = declaredOf<NonNullable<VerifyWire>>(raw);
  if (value === null) return undefined;
  const commands = Array.isArray(value.failed_commands) ? value.failed_commands : [];
  return {
    runs: num(value.runs),
    red: num(value.red),
    first_pass: bool(value.first_pass),
    failed_commands: commands.filter((command): command is string => typeof command === 'string'),
  };
}

/** The skip record reduced to its `reason`; the contract types `skip` as an open record, so nothing else is kept. */
function skipOf(skip: unknown): ExecutionWire['skip'] {
  if (skip === null) return null;
  if (!isRecord(skip)) return undefined;
  return typeof skip.reason === 'string' ? { reason: skip.reason } : {};
}

function executionOf(raw: unknown): SanitizedExecution | null {
  const value = declaredOf<ExecutionWire>(raw);
  if (value === null) return null;
  const id = str(value.execution_id);
  const order = num(value.execution_order);
  const stageId = str(value.stage_id);
  const status = str(value.status);
  if (id === undefined || id === '' || order === undefined) return null;
  if (stageId === undefined || stageId === '' || status === undefined || status === '') return null;
  return {
    execution_id: id,
    execution_order: order,
    stage_id: stageId,
    status,
    stage_attempt: numOrNull(value.stage_attempt),
    role: strOrNull(value.role),
    client: strOrNull(value.client),
    model: strOrNull(value.model),
    decision: strOrNull(value.decision),
    created_at: strOrNull(value.created_at),
    completed_at: strOrNull(value.completed_at),
    wall_seconds: numOrNull(value.wall_seconds),
    verify_seconds: num(value.verify_seconds),
    turns: num(value.turns),
    usage: usageOf(value.usage),
    usage_missing: usageMissingOf(value.usage_missing),
    verify: verifyOf(value.verify),
    skip: skipOf(value.skip),
    resumes_execution_id: strOrNull(value.resumes_execution_id),
    routed_from: strOrNull(value.routed_from),
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
  const stagePairs: [string, SessionMetrics['stages'][string]][] = [];
  for (const [id, stage] of Object.entries(value.stages)) {
    const stageWire = declaredOf<StageWire>(stage);
    if (stageWire === null) return { kind: 'invalid', error: describe('states.stageNotObject') };
    stagePairs.push([id, stageOf(stageWire)]);
  }
  // `Object.fromEntries` creates own properties, so a stage id such as `__proto__` is kept.
  const stages: SessionMetrics['stages'] = Object.fromEntries(stagePairs);
  const executions: SanitizedExecution[] = [];
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
