import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { PendingQuestion, QuestionBase, QuestionOption } from './model';
import { QUESTIONS_FILENAME } from './paths';
import { isRecord } from './record';

/** `questions.json` schema versions this extension reads. */
export const SUPPORTED_QUESTIONS_SCHEMA_VERSIONS: readonly number[] = [1];

/** `superseded` has not been observed in migent output; it is accepted leniently. */
export type QuestionStatus = 'pending' | 'answered' | 'superseded' | 'unrecognized';

/** An answer in an observed shape: `{question_id, selected[]}` plus optional `text`. */
export interface QuestionAnswer {
  selected: string[];
  text: string | null;
}

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

function parseAnswer(value: unknown): QuestionAnswer | null {
  if (!isRecord(value) || !Array.isArray(value.selected)) return null;
  if (!value.selected.every((item) => typeof item === 'string')) return null;
  if (value.text !== undefined && typeof value.text !== 'string') return null;
  return { selected: value.selected, text: typeof value.text === 'string' ? value.text : null };
}

function parseStatus(value: unknown): QuestionStatus {
  return value === 'pending' || value === 'answered' || value === 'superseded' ? value : 'unrecognized';
}

const OPTION_MIN = 2;
const OPTION_MAX = 26;

function optionProblem(options: unknown): string | null {
  if (!Array.isArray(options)) return 'options is not a list';
  if (options.length < OPTION_MIN || options.length > OPTION_MAX) return 'options must number 2-26';
  const isValid = (option: unknown): boolean =>
    isRecord(option) && str(option.id) !== null && str(option.label) !== null;
  return options.every(isValid) ? null : 'an option has no id or label';
}

/** Why a raw record is unusable as written, or null. Mirrors the documented question shape. */
export function recordProblem(entry: unknown): string | null {
  if (!isRecord(entry)) return 'not an object';
  if (str(entry.id) === null || str(entry.question) === null) return 'missing id or question';
  if (str(entry.context) === null) return 'missing context';
  if (entry.selection !== 'single' && entry.selection !== 'multiple') return 'unsupported selection';
  if (!['pending', 'answered', 'superseded'].includes(String(entry.status))) return 'unrecognized status';
  return optionProblem(entry.options);
}

function parseRecord(entry: unknown): QuestionRecord | null {
  const base = parseQuestionBase(entry);
  if (base === null || !isRecord(entry)) return null;
  const answer = parseAnswer(entry.answer);
  return { ...base, status: parseStatus(entry.status), answer, answeredAt: str(entry.answered_at) };
}

/** Parse session `questions.json` text. Records without `id` and `question` are skipped. */
export function parseQuestionsFile(text: string): QuestionsRead {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { kind: 'invalid', error: error instanceof Error ? error.message : 'unparsable JSON' };
  }
  if (!isRecord(value)) return { kind: 'invalid', error: 'not a JSON object' };
  const version = value.schema_version;
  if (typeof version !== 'number' || !SUPPORTED_QUESTIONS_SCHEMA_VERSIONS.includes(version)) {
    return { kind: 'unsupported', schemaVersion: typeof version === 'number' ? version : null };
  }
  if (!Array.isArray(value.questions)) return { kind: 'invalid', error: 'questions is not a list' };
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

/** Read the session `questions.json` history on demand. Nothing is cached. File order is kept. */
export function readQuestions(sessionDirPath: string): QuestionsRead {
  let text: string;
  try {
    text = readFileSync(path.join(sessionDirPath, QUESTIONS_FILENAME), 'utf8');
  } catch (error) {
    const code = isRecord(error) && typeof error.code === 'string' ? error.code : 'unknown error';
    return code === 'ENOENT' ? { kind: 'missing' } : { kind: 'unreadable', error: code };
  }
  return parseQuestionsFile(text);
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
