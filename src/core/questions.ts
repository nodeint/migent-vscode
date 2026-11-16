import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { text } from '../text';
import { parseExecutionId } from './executions';
import { parseAnswer, type PersistedAnswer, type QuestionAnswer, readAnswerIndex } from './humanInput';
import type { PendingQuestion, QuestionBase, QuestionOption } from './model';
import { EXECUTIONS_DIRNAME, QUESTIONS_FILENAME } from './paths';
import { isRecord } from './record';

export type { QuestionAnswer } from './humanInput';

/** `questions.json` schema versions this extension reads. */
export const SUPPORTED_QUESTIONS_SCHEMA_VERSIONS: readonly number[] = [1];

/** `superseded` has not been observed in the legacy file; it is accepted leniently and derived for 0.8 records. */
export type QuestionStatus = 'pending' | 'answered' | 'superseded' | 'unrecognized';

export interface QuestionRecord extends QuestionBase {
  status: QuestionStatus;
  /** Null when absent or not in an observed shape. */
  answer: QuestionAnswer | null;
  answeredAt: string | null;
}

export type QuestionsRead =
  | { kind: 'missing' }
  | { kind: 'unreadable'; error: string }
  | { kind: 'invalid'; error: string }
  | { kind: 'unsupported'; schemaVersion: number | null }
  | { kind: 'ok'; questions: QuestionRecord[]; malformed: MalformedRecord[] };

/**
 * A record the lenient readers could not use as written (they drop what they cannot read). Kept so a batch
 * with a malformed member is never submitted from the remnants.
 */
export interface MalformedRecord {
  index: number;
  executionId: string | null;
  stageId: string | null;
  reason: string;
}

export interface QuestionGroup {
  stageId: string | null;
  executionId: string | null;
  questions: PendingQuestion[];
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function parseOptions(value: unknown): QuestionOption[] {
  if (!Array.isArray(value)) return [];
  const options: QuestionOption[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const id = str(entry.id);
    const label = str(entry.label);
    if (id === null || label === null) continue;
    options.push({ id, label, description: str(entry.description) });
  }
  return options;
}

/** Parse the fields shared by status summaries and history records. Null without `id` and `question`. */
export function parseQuestionBase(entry: unknown): QuestionBase | null {
  if (!isRecord(entry)) return null;
  const id = str(entry.id);
  const question = str(entry.question);
  if (id === null || question === null) return null;
  return {
    id,
    question,
    context: str(entry.context),
    selection: str(entry.selection),
    options: parseOptions(entry.options),
    recommended: strings(entry.recommended),
    executionId: str(entry.execution_id),
    stageId: str(entry.stage_id),
    recipient: str(entry.recipient),
  };
}

/** Parse `status.json.questions`. Records without `id` and `question` are skipped. */
export function parsePendingQuestions(value: unknown): PendingQuestion[] {
  if (!Array.isArray(value)) return [];
  const questions: PendingQuestion[] = [];
  for (const entry of value) {
    const base = parseQuestionBase(entry);
    if (base !== null && isRecord(entry)) questions.push({ ...base, file: str(entry.file) });
  }
  return questions;
}

function parseStatus(value: unknown): QuestionStatus {
  return value === 'pending' || value === 'answered' || value === 'superseded' ? value : 'unrecognized';
}

const OPTION_MIN = 2;
const OPTION_MAX = 26;

function optionProblem(options: unknown): string | null {
  if (!Array.isArray(options)) return text('states.optionsNotList');
  if (options.length < OPTION_MIN || options.length > OPTION_MAX) return text('states.optionsCount');
  const isValid = (option: unknown): boolean =>
    isRecord(option) && str(option.id) !== null && str(option.label) !== null;
  return options.every(isValid) ? null : text('states.optionIncomplete');
}

/**
 * Why a raw record is unusable as written, or null. Mirrors the documented question shape. A per-execution
 * record has no `status`, so its caller passes `isStatusRequired: false`.
 */
export function recordProblem(entry: unknown, isStatusRequired = true): string | null {
  if (!isRecord(entry)) return text('states.notObject');
  if (str(entry.id) === null || str(entry.question) === null) return text('states.missingIdOrQuestion');
  if (str(entry.context) === null) return text('states.missingContext');
  if (entry.selection !== 'single' && entry.selection !== 'multiple') return text('states.unsupportedSelection');
  if (isStatusRequired && !['pending', 'answered', 'superseded'].includes(String(entry.status))) {
    return text('states.unrecognizedStatus');
  }
  return optionProblem(entry.options);
}

function parseRecord(entry: unknown): QuestionRecord | null {
  const base = parseQuestionBase(entry);
  if (base === null || !isRecord(entry)) return null;
  const answer = parseAnswer(entry.answer);
  return { ...base, status: parseStatus(entry.status), answer, answeredAt: str(entry.answered_at) };
}

/** Parse session `questions.json` text. Records without `id` and `question` are skipped. */
export function parseQuestionsFile(source: string): QuestionsRead {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    return { kind: 'invalid', error: error instanceof Error ? error.message : text('states.unparsableJson') };
  }
  if (!isRecord(value)) return { kind: 'invalid', error: text('states.notJsonObject') };
  const version = value.schema_version;
  if (typeof version !== 'number' || !SUPPORTED_QUESTIONS_SCHEMA_VERSIONS.includes(version)) {
    return { kind: 'unsupported', schemaVersion: typeof version === 'number' ? version : null };
  }
  if (!Array.isArray(value.questions)) return { kind: 'invalid', error: text('states.questionsNotList') };
  const questions = value.questions.flatMap((entry): QuestionRecord[] => {
    const record = parseRecord(entry);
    return record === null ? [] : [record];
  });
  const malformed = value.questions.flatMap((entry, index): MalformedRecord[] => {
    const problem = recordProblem(entry);
    if (problem === null) return [];
    const raw = isRecord(entry) ? entry : {};
    return [{ index, executionId: str(raw.execution_id), stageId: str(raw.stage_id), reason: problem }];
  });
  return { kind: 'ok', questions, malformed };
}

function readText(file: string): { text: string } | { error: string } {
  try {
    return { text: readFileSync(file, 'utf8') };
  } catch (error) {
    return { error: isRecord(error) && typeof error.code === 'string' ? error.code : 'unknown error' };
  }
}

/** Read the legacy session `questions.json` (Migent up to 0.7). File order is kept. */
function readLegacy(sessionDirPath: string): QuestionsRead {
  const read = readText(path.join(sessionDirPath, QUESTIONS_FILENAME));
  if ('error' in read) return read.error === 'ENOENT' ? { kind: 'missing' } : { kind: 'unreadable', error: read.error };
  return parseQuestionsFile(read.text);
}

interface ExecutionBatch {
  executionId: string;
  stageId: string | null;
  records: QuestionRecord[];
  malformed: MalformedRecord[];
}

function malformedBatch(executionId: string, reason: string): ExecutionBatch {
  const stageId = parseExecutionId(executionId)?.stageId ?? null;
  return { executionId, stageId, records: [], malformed: [{ index: 0, executionId, stageId, reason }] };
}

interface BatchHeader {
  executionId: string;
  stageId: string | null;
  recipient: string | null;
}

/** The records of one execution file; the header fills what a question omits. */
function parseBatchRecords(
  entries: readonly unknown[],
  header: BatchHeader,
): { records: QuestionRecord[]; malformed: MalformedRecord[] } {
  const { executionId, stageId, recipient } = header;
  const records: QuestionRecord[] = [];
  const malformed: MalformedRecord[] = [];
  for (const [index, entry] of entries.entries()) {
    const problem = recordProblem(entry, false);
    if (problem !== null) malformed.push({ index, executionId, stageId, reason: problem });
    const base = parseQuestionBase(entry);
    if (base === null) continue;
    records.push({
      ...base,
      executionId,
      stageId,
      recipient: base.recipient ?? recipient,
      status: 'pending',
      answer: null,
      answeredAt: null,
    });
  }
  return { records, malformed };
}

/**
 * Parse one `executions/<id>/questions.json` (Migent 0.7 and later): `{schema_version, stage_id, execution_id,
 * recipient, questions[]}` whose questions carry no status or answer. The header fills what a question omits.
 */
function parseExecutionQuestions(source: string, dirName: string): ExecutionBatch {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    return malformedBatch(dirName, error instanceof Error ? error.message : text('states.unparsableJson'));
  }
  if (!isRecord(value)) return malformedBatch(dirName, text('states.notJsonObject'));
  const version = value.schema_version;
  if (typeof version !== 'number' || !SUPPORTED_QUESTIONS_SCHEMA_VERSIONS.includes(version)) {
    return malformedBatch(dirName, text('states.historyUnsupported'));
  }
  if (!Array.isArray(value.questions)) return malformedBatch(dirName, text('states.questionsNotList'));
  const executionId = str(value.execution_id) ?? dirName;
  const stageId = str(value.stage_id) ?? parseExecutionId(dirName)?.stageId ?? null;
  const header = { executionId, stageId, recipient: str(value.recipient) };
  return { executionId, stageId, ...parseBatchRecords(value.questions, header) };
}

/** Every execution directory's `questions.json`, in directory order. */
function readExecutionBatches(sessionDirPath: string): ExecutionBatch[] {
  let names: string[];
  try {
    names = readdirSync(path.join(sessionDirPath, EXECUTIONS_DIRNAME), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
  const batches: ExecutionBatch[] = [];
  for (const name of names) {
    const read = readText(path.join(sessionDirPath, EXECUTIONS_DIRNAME, name, QUESTIONS_FILENAME));
    if ('error' in read) {
      if (read.error !== 'ENOENT') batches.push(malformedBatch(name, text('states.historyUnreadable')));
      continue;
    }
    batches.push(parseExecutionQuestions(read.text, name));
  }
  return batches;
}

const NUL = '\u0000';

/** The record with its persisted answer applied: first match wins, a stale pending row never hides an answer. */
function withEvidence(
  record: QuestionRecord,
  context: { persisted: PersistedAnswer | undefined; isListedPending: boolean; isLegacy: boolean },
): QuestionRecord {
  if (record.status === 'answered' || record.answer !== null) return { ...record, status: 'answered' };
  const { persisted } = context;
  if (persisted !== undefined) {
    return {
      ...record,
      status: 'answered',
      answer: persisted.byQuestion.get(record.id) ?? null,
      answeredAt: persisted.at,
    };
  }
  if (context.isListedPending) return { ...record, status: 'pending' };
  return context.isLegacy ? record : { ...record, status: 'superseded' };
}

/**
 * Read the question history of a session on demand, from every source Migent has written: the legacy session
 * `questions.json` (up to 0.7), each execution's `questions.json`, and the persisted answers of `input.json` and
 * the answer events. Definitions come from the legacy file for the executions it lists, otherwise from the
 * execution's own file. `pending` is `status.json.questions`. Nothing is cached.
 */
export function readQuestions(sessionDirPath: string, pending: readonly PendingQuestion[] = []): QuestionsRead {
  const legacy = readLegacy(sessionDirPath);
  if (legacy.kind !== 'ok' && legacy.kind !== 'missing') return legacy;
  const batches = readExecutionBatches(sessionDirPath);
  if (legacy.kind === 'missing' && batches.length === 0) return { kind: 'missing' };

  const legacyRecords = legacy.kind === 'ok' ? legacy.questions : [];
  const legacyExecutions = new Set(legacyRecords.map((record) => `${record.stageId ?? ''}${NUL}${record.executionId ?? ''}`));
  const own = batches.filter((batch) => !legacyExecutions.has(`${batch.stageId ?? ''}${NUL}${batch.executionId}`));
  const definitions = [...legacyRecords, ...own.flatMap((batch) => batch.records)];
  // Diagnostics come only from the authoritative sources: a batch the legacy file overrides is not read.
  const malformed = [...(legacy.kind === 'ok' ? legacy.malformed : []), ...own.flatMap((batch) => batch.malformed)];

  const undecided = new Set<string>();
  for (const record of definitions) {
    if (record.executionId !== null && record.status !== 'answered' && record.answer === null) {
      undecided.add(record.executionId);
    }
  }
  const { answers } = readAnswerIndex(sessionDirPath, undecided);
  const listed = new Set(pending.map((question) => `${question.executionId ?? ''}${NUL}${question.id}`));
  const legacySet = new Set(legacyRecords);
  const questions = definitions.map((record) =>
    withEvidence(record, {
      persisted: record.executionId === null ? undefined : answers.get(record.executionId),
      isListedPending: listed.has(`${record.executionId ?? ''}${NUL}${record.id}`),
      isLegacy: legacySet.has(record),
    }),
  );
  return { kind: 'ok', questions, malformed };
}

/** Group pending questions by execution (and stage), in first-seen order. */
export function groupPendingQuestions(questions: readonly PendingQuestion[]): QuestionGroup[] {
  const groups = new Map<string, QuestionGroup>();
  for (const question of questions) {
    const key = `${question.stageId ?? ''}\u0000${question.executionId ?? ''}`;
    let group = groups.get(key);
    if (group === undefined) {
      group = { stageId: question.stageId, executionId: question.executionId, questions: [] };
      groups.set(key, group);
    }
    group.questions.push(question);
  }
  return [...groups.values()];
}

/**
 * The question file to open for a session: the legacy session `questions.json` when it exists, otherwise the
 * `file` of a pending batch (`executions/<id>/questions.json`), confined to the session directory. Falls back
 * to the legacy path, which then reports as missing.
 */
export function questionsFileToOpen(sessionDirPath: string, pending: readonly PendingQuestion[] = []): string {
  const legacy = path.join(sessionDirPath, QUESTIONS_FILENAME);
  if (existsSync(legacy)) return legacy;
  for (const question of pending) {
    if (question.file === null) continue;
    const candidate = path.resolve(sessionDirPath, question.file);
    const relative = path.relative(sessionDirPath, candidate);
    if (!relative.startsWith('..') && !path.isAbsolute(relative) && existsSync(candidate)) return candidate;
  }
  return legacy;
}
