import { cpSync, mkdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { SessionExecution } from '@nodeint/migent-contracts';

import { deriveDisplayState } from './displayState';
import type { EventEntry } from './eventTail';
import { type ExecutionEntry, listExecutions, parseExecutionId } from './executions';
import { manifestFacts, readManifest } from './manifest';
import type { LockProbe, SessionSnapshot } from './model';
import type { QuestionAnswer, QuestionEntry, QuestionItem, QuestionState } from './questions';
import { replyNeedsExecutions, replyTargets } from './replyFlow';
import { readTitleOverride } from './sessionTitle';
import { readStatus } from './statusReader';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

/**
 * Copy the redacted fixtures into a throwaway project layout
 * (<tmp>/.migent/sessions/...) so tests can mutate locks and status files freely.
 */
export function makeProject(): string {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'migent-vscode-test-'));
  mkdirSync(path.join(projectRoot, '.migent'), { recursive: true });
  cpSync(path.join(fixturesDir, 'sessions'), path.join(projectRoot, '.migent', 'sessions'), {
    recursive: true,
  });
  cpSync(path.join(fixturesDir, 'workflows'), path.join(projectRoot, '.migent', 'workflows'), {
    recursive: true,
  });
  return projectRoot;
}

/** A session directory in the captured migent 0.3.1 samples, read in place. */
export function capturedDir(name: string): string {
  return path.join(fixturesDir, 'captured', name);
}

/** A hand-written fixture for a shape no captured sample covers (see `fixtures/synthetic/README.md`). */
export function syntheticDir(name: string): string {
  return path.join(fixturesDir, 'synthetic', name);
}

export function workflowsFixtureDir(): string {
  return path.join(fixturesDir, 'workflows');
}

/** Build a snapshot from the manifest and status files in a fixture directory, with the given lock. */
export function snapshotFromDir(dir: string, lock: LockProbe = { kind: 'none' }): SessionSnapshot {
  const { manifest, unsupportedManifestVersion, state: manifestState } = manifestFacts(readManifest(path.join(dir, 'manifest.yaml')));
  const read = readStatus(path.join(dir, 'status.json'));
  const status = read.kind === 'ok' ? read.status : null;
  const body = {
    sessionId: path.basename(dir),
    manifest,
    unsupportedManifestVersion,
    status,
    statusError: read.kind === 'error',
    lock,
    titleOverride: readTitleOverride(path.join(dir, 'title.json')),
    displayState: deriveDisplayState(
      { status, statusError: read.kind === 'error' ? read.reason : null, manifest: manifestState },
      lock,
    ),
  };
  return { ...body, replyTargets: replyTargets(body, replyNeedsExecutions(body) ? listExecutions(dir) : []) };
}

/** The flat fields tests give to `executionEntry`; each maps to a field of the contract's `SessionExecution`. */
export interface ExecutionFixture {
  id: string;
  order?: number;
  stage: string;
  attempt?: number;
  /** `null` stands for a status the display does not know (stored as `unknown`). */
  status?: string | null;
  decision?: string | null;
  blocker?: string | null;
  client?: string | null;
  model?: string | null;
  effort?: string | null;
  turnKind?: string | null;
  outcomeStatus?: string | null;
  error?: string | null;
  hasFailureReport?: boolean;
  kind?: string | null;
  createdAt?: string | null;
  completedAt?: string | null;
}

const ORDER_DIGITS = 4;
const FIXTURE_CREATED_AT = '2026-11-01T10:00:00.000Z';

/** `{ [key]: value }` when the value is set, else nothing. */
function field(key: string, value: unknown): Record<string, unknown> {
  return value === undefined || value === null ? {} : { [key]: value };
}

/** An `ExecutionEntry` built from flat fields, with the contract record's required fields filled in. */
export function executionEntry(fields: ExecutionFixture): ExecutionEntry {
  const order = fields.order ?? Number(fields.id.slice(0, ORDER_DIGITS));
  const attempt = fields.attempt ?? 1;
  const outcome = {
    ...field('decision', fields.decision),
    ...field('blocker', fields.blocker),
    ...field('status', fields.outcomeStatus),
  };
  const execution: SessionExecution = {
    session_id: 's',
    execution_id: fields.id,
    execution_order: order,
    stage_id: fields.stage,
    stage_attempt: attempt,
    status: fields.status ?? 'unknown',
    created_at: fields.createdAt ?? FIXTURE_CREATED_AT,
    ...field('completed_at', fields.completedAt),
    ...field('client', fields.client),
    ...field('model', fields.model),
    ...field('kind', fields.kind),
    ...field('turn_kind', fields.turnKind),
    ...field('error', fields.error),
    ...field('options', fields.effort === undefined || fields.effort === null ? null : { effort: fields.effort }),
    ...(Object.keys(outcome).length === 0 ? {} : { outcome }),
  };
  return { execution, id: fields.id, order, attempt, hasFailureReport: fields.hasFailureReport ?? false };
}

/** A complete `execution.json` record for `id` (`0002-plan--attempt-02`); `extra` overrides or adds fields. */
export function executionJson(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const parsed = parseExecutionId(id);
  return {
    session_id: 's',
    execution_id: id,
    execution_order: parsed?.order ?? 1,
    stage_id: parsed?.stageId ?? 'plan',
    stage_attempt: parsed?.attempt ?? 1,
    status: 'completed',
    created_at: '2026-11-01T10:00:00.000Z',
    ...extra,
  };
}

/** A complete contract question item; `overrides` replace any field. */
export function questionItem(id: string, overrides: Partial<QuestionItem> = {}): QuestionItem {
  return {
    id,
    question: `Question ${id}?`,
    context: 'ctx',
    selection: 'single',
    options: [
      { id: 'A', label: 'One' },
      { id: 'B', label: 'Two' },
      { id: 'C', label: 'Three' },
    ],
    recommended: ['A'],
    execution_id: 'e1',
    stage_id: 'plan',
    recipient: 'human',
    status: 'pending',
    answer: null,
    ...overrides,
  };
}

/** A history entry for `item`: its state and answer are those the item holds unless `extra` says otherwise. */
export function questionEntry(
  item: QuestionItem,
  extra: { status?: QuestionState; answer?: QuestionAnswer | null; answeredAt?: string | null } = {},
): QuestionEntry {
  return {
    item,
    status: extra.status ?? item.status,
    answer: extra.answer ?? null,
    answeredAt: extra.answeredAt ?? null,
  };
}

/** The fields a test sets on an event entry; `event` is the contract event name. Everything else has a default. */
export interface EventFixture extends Partial<Omit<EventEntry, 'event'>> {
  event?: string | null;
}

/** An event entry: a contract v2 record built from the fields, or a raw line when `event` is null. */
export function eventEntry(fields: EventFixture = {}): EventEntry {
  const { event = 'note', ...rest } = fields;
  const entry = {
    seq: null,
    timestamp: '',
    executionId: null,
    stageId: null,
    summary: null,
    data: {},
    rawLine: null,
    isUnknownVersion: false,
    ...rest,
  };
  if (event === null || entry.rawLine !== null) return { ...entry, event: null };
  return { ...entry, event: { v: 2, seq: entry.seq ?? 0, event, timestamp: entry.timestamp, data: entry.data } };
}
