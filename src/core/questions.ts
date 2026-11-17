import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { SessionQuestions } from '@nodeint/migent-contracts';

import { text } from '../text';
import { parseExecutionId } from './executions';
import { parseAnswer, type PersistedAnswer, type QuestionAnswer, readAnswerIndex } from './humanInput';
import { EXECUTIONS_DIRNAME, QUESTIONS_FILENAME } from './paths';
import { isRecord } from './record';

export type { QuestionAnswer } from './humanInput';

/** `questions.json` schema versions this extension reads. */
export const SUPPORTED_QUESTIONS_SCHEMA_VERSIONS: readonly number[] = [1];

/** One question of the contract's session `questions.json` (an execution file's is completed from its header). */
export type QuestionItem = SessionQuestions['questions'][number];

/** Where a question stands in the history, once the persisted answers are joined. */
export type QuestionState = 'pending' | 'answered' | 'superseded';

/**
 * One question as read: the contract item, plus what the extension derives next to it (D3d): the state after the
 * persisted answers are joined, the parsed answer and when it was recorded.
 */
export interface QuestionEntry {
  item: QuestionItem;
  status: QuestionState;
  /** Null when absent or not in an observed shape. */
  answer: QuestionAnswer | null;
  answeredAt: string | null;
}

/** An option as shown: the `id` and `label` an option record must carry, and its optional description. */
export interface OptionView {
  id: string;
  label: string;
  description: string | null;
}

export type QuestionsRead =
  | { kind: 'missing' }
  | { kind: 'unreadable'; error: string }
  | { kind: 'invalid'; error: string }
  | { kind: 'unsupported'; schemaVersion: number | null }
  | { kind: 'ok'; questions: QuestionEntry[]; malformed: MalformedRecord[] };

/**
 * A record the readers could not use as written. Kept so a batch with a malformed member is never submitted from
 * the remnants.
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
  questions: QuestionItem[];
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** The options of a question as shown: records without an id and label are left out. */
export function questionOptions(item: QuestionItem): OptionView[] {
  const views: OptionView[] = [];
  for (const entry of item.options ?? []) {
    const id = str(entry.id);
    const label = str(entry.label);
    if (id !== null && label !== null) views.push({ id, label, description: str(entry.description) });
  }
  return views;
}

const STATUSES: readonly string[] = ['pending', 'answered', 'superseded'];

function isQuestionState(value: unknown): value is QuestionState {
  return typeof value === 'string' && STATUSES.includes(value);
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
  if (isStatusRequired && !isQuestionState(entry.status)) return text('states.unrecognizedStatus');
  return optionProblem(entry.options);
}

/** The fields an execution's file gives its questions. */
interface BatchHeader {
  executionId: string;
  stageId: string;
  recipient: string;
}

/** The optional contract fields that have the right type; a wrong-typed one is dropped. */
function optionalFields(entry: Record<string, unknown>): Partial<QuestionItem> {
  const result: Partial<QuestionItem> = {};
  const question = str(entry.question);
  if (question !== null) result.question = question;
  const context = str(entry.context);
  if (context !== null) result.context = context;
  if (entry.selection === 'single' || entry.selection === 'multiple') result.selection = entry.selection;
  if (Array.isArray(entry.options)) result.options = entry.options.filter((option) => isRecord(option));
  if (Array.isArray(entry.recommended)) {
    result.recommended = entry.recommended.filter((value): value is string => typeof value === 'string');
  }
  const answeredAt = str(entry.answered_at);
  if (answeredAt !== null) result.answered_at = answeredAt;
  return result;
}

/** One question record of a session `questions.json`. Null when a required contract field is missing or wrong. */
function parseSessionItem(entry: unknown): QuestionItem | null {
  if (!isRecord(entry)) return null;
  const id = str(entry.id);
  const executionId = str(entry.execution_id);
  const stageId = str(entry.stage_id);
  const recipient = str(entry.recipient);
  const { status, answer } = entry;
  if (id === null || executionId === null || stageId === null || recipient === null) return null;
  if (!isQuestionState(status)) return null;
  if (answer !== null && !isRecord(answer)) return null;
  return {
    ...optionalFields(entry),
    id,
    execution_id: executionId,
    stage_id: stageId,
    recipient,
    status,
    answer,
  };
}

/** One question record of an execution's `questions.json`; the header gives what the contract requires. */
function parseBatchItem(entry: unknown, header: BatchHeader): QuestionItem | null {
  if (!isRecord(entry)) return null;
  const id = str(entry.id);
  if (id === null) return null;
  return {
    ...optionalFields(entry),
    id,
    execution_id: header.executionId,
    stage_id: header.stageId,
    recipient: header.recipient,
    status: 'pending',
    answer: null,
  };
}

/** The answer flow needs the question text, though the contract leaves it optional. */
const hasQuestion = (item: QuestionItem | null): item is QuestionItem => item?.question !== undefined;

function itemEntry(item: QuestionItem): QuestionEntry {
  return { item, status: item.status, answer: parseAnswer(item.answer), answeredAt: item.answered_at ?? null };
}

interface ParsedItems {
  entries: QuestionEntry[];
  malformed: MalformedRecord[];
}

interface ParseSpec {
  parse: (entry: unknown) => QuestionItem | null;
  isStatusRequired: boolean;
  /** Fills the location of a malformed record that does not carry its own. */
  executionId: string | null;
  stageId: string | null;
}

/**
 * Parse the records of one file. A record without a usable item is skipped and reported (B5); a record that is
 * usable but incomplete as documented (context, selection, options) is kept and reported.
 */
function parseItems(records: readonly unknown[], spec: ParseSpec): ParsedItems {
  const entries: QuestionEntry[] = [];
  const malformed: MalformedRecord[] = [];
  for (const [index, record] of records.entries()) {
    const item = spec.parse(record);
    const raw = isRecord(record) ? record : {};
    const where = {
      index,
      executionId: spec.executionId ?? str(raw.execution_id),
      stageId: spec.stageId ?? str(raw.stage_id),
    };
    const problem = recordProblem(record, spec.isStatusRequired);
    if (!hasQuestion(item)) {
      malformed.push({ ...where, reason: problem ?? text('states.missingRequiredField', { field: 'question' }) });
      continue;
    }
    if (problem !== null) malformed.push({ ...where, reason: problem });
    entries.push(itemEntry(item));
  }
  return { entries, malformed };
}

/** Parse session `questions.json` text. A record missing a required contract field is skipped and reported. */
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
  const { entries, malformed } = parseItems(value.questions, {
    parse: parseSessionItem,
    isStatusRequired: true,
    executionId: null,
    stageId: null,
  });
  return { kind: 'ok', questions: entries, malformed };
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
  records: QuestionEntry[];
  malformed: MalformedRecord[];
}

function malformedBatch(executionId: string, reason: string): ExecutionBatch {
  const stageId = parseExecutionId(executionId)?.stageId ?? null;
  return { executionId, stageId, records: [], malformed: [{ index: 0, executionId, stageId, reason }] };
}

/**
 * Parse one `executions/<id>/questions.json` (Migent 0.7 and later): `{schema_version, stage_id, execution_id,
 * recipient, questions[]}` whose questions carry no status or answer. A header missing a required field makes the
 * whole file malformed; its fields complete each question.
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
  const executionId = str(value.execution_id);
  const stageId = str(value.stage_id);
  const recipient = str(value.recipient);
  if (executionId === null) return malformedBatch(dirName, text('states.missingRequiredField', { field: 'execution_id' }));
  if (stageId === null) return malformedBatch(dirName, text('states.missingRequiredField', { field: 'stage_id' }));
  if (recipient === null) return malformedBatch(dirName, text('states.missingRequiredField', { field: 'recipient' }));
  const header = { executionId, stageId, recipient };
  const { entries, malformed } = parseItems(value.questions, {
    parse: (entry) => parseBatchItem(entry, header),
    isStatusRequired: false,
    executionId,
    stageId,
  });
  return { executionId, stageId, records: entries, malformed };
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

/** The entry with its persisted answer applied: first match wins, a stale pending row never hides an answer. */
function withEvidence(
  entry: QuestionEntry,
  context: { persisted: PersistedAnswer | undefined; isLegacy: boolean },
): QuestionEntry {
  if (entry.status === 'answered' || entry.answer !== null) return { ...entry, status: 'answered' };
  const { persisted } = context;
  if (persisted !== undefined) {
    return {
      ...entry,
      status: 'answered',
      answer: persisted.byQuestion.get(entry.item.id) ?? null,
      answeredAt: persisted.at,
    };
  }
  return context.isLegacy ? entry : { ...entry, status: 'superseded' };
}

/**
 * Read the question history of a session on demand, from every source Migent has written: the legacy session
 * `questions.json` (up to 0.7), each execution's `questions.json`, and the persisted answers of `input.json` and
 * the answer events. Definitions come from the legacy file for the executions it lists, otherwise from the
 * execution's own file. No batch is treated as pending (B6): `status.json` no longer carries the pending summary.
 * Nothing is cached.
 */
export function readQuestions(sessionDirPath: string): QuestionsRead {
  const legacy = readLegacy(sessionDirPath);
  if (legacy.kind !== 'ok' && legacy.kind !== 'missing') return legacy;
  const batches = readExecutionBatches(sessionDirPath);
  if (legacy.kind === 'missing' && batches.length === 0) return { kind: 'missing' };

  const legacyEntries = legacy.kind === 'ok' ? legacy.questions : [];
  const legacyExecutions = new Set(legacyEntries.map(({ item }) => `${item.stage_id}${NUL}${item.execution_id}`));
  const own = batches.filter((batch) => !legacyExecutions.has(`${batch.stageId ?? ''}${NUL}${batch.executionId}`));
  const definitions = [...legacyEntries, ...own.flatMap((batch) => batch.records)];
  // Diagnostics come only from the authoritative sources: a batch the legacy file overrides is not read.
  const malformed = [...(legacy.kind === 'ok' ? legacy.malformed : []), ...own.flatMap((batch) => batch.malformed)];

  const undecided = new Set<string>();
  for (const { item, status, answer } of definitions) {
    if (status !== 'answered' && answer === null) undecided.add(item.execution_id);
  }
  const { answers } = readAnswerIndex(sessionDirPath, undecided);
  const legacySet = new Set(legacyEntries);
  const questions = definitions.map((entry) =>
    withEvidence(entry, { persisted: answers.get(entry.item.execution_id), isLegacy: legacySet.has(entry) }),
  );
  return { kind: 'ok', questions, malformed };
}

/** Group pending questions by execution (and stage), in first-seen order. */
export function groupPendingQuestions(questions: readonly QuestionItem[]): QuestionGroup[] {
  const groups = new Map<string, QuestionGroup>();
  for (const question of questions) {
    const key = `${question.stage_id}\u0000${question.execution_id}`;
    let group = groups.get(key);
    if (group === undefined) {
      group = { stageId: question.stage_id, executionId: question.execution_id, questions: [] };
      groups.set(key, group);
    }
    group.questions.push(question);
  }
  return [...groups.values()];
}

/**
 * The question file to open for a session: the legacy session `questions.json`, which then reports as missing when
 * it does not exist. No batch is pending (B6), so there is no execution file to prefer.
 */
export function questionsFileToOpen(sessionDirPath: string): string {
  return path.join(sessionDirPath, QUESTIONS_FILENAME);
}

/** The pending questions of a session. Always empty (B6): `status.json.questions` is not in the contract. */
export function pendingQuestions(): QuestionItem[] {
  return [];
}
