import { createHash } from 'node:crypto';

import type { PendingQuestion, QuestionBase, QuestionOption } from './model';
import type { QuestionRecord, QuestionsRead } from './questions';

/**
 * Pure draft validation, JSON reply-file serialization, batch fingerprints and reconciliation for
 * human questions (plans/03a-human-input.md §5-§8). No `vscode` import and no file access.
 */

/** Documented option count per question. */
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 26;
const FINGERPRINT_LENGTH = 16;
const JSON_INDENT = 2;

export type InputMode = 'choice' | 'text';

/** One question's local draft. Inactive values are kept so the user can switch modes back. */
export interface AnswerDraft {
  mode: InputMode;
  /** Selected option ids; one at most for a `single` question. */
  selected: string[];
  text: string;
}

/** Drafts keyed by question id. */
export type BatchDraft = Partial<Record<string, AnswerDraft>>;

export const emptyDraft = (): AnswerDraft => ({ mode: 'choice', selected: [], text: '' });

/** The wire format of the reply file: question id to option id, option ids, or free text. */
export type ReplyMap = Partial<Record<string, string | string[]>>;

export type QuestionMode = 'single' | 'multiple';

export interface BatchTarget {
  stageId: string | null;
  executionId: string;
}

export type BatchProblem =
  | { kind: 'empty' }
  | { kind: 'mixed-batch'; detail: string }
  | { kind: 'unsupported-mode'; questionId: string }
  | { kind: 'bad-options'; questionId: string }
  | { kind: 'duplicate-id'; questionId: string };

function modeOf(question: QuestionBase): QuestionMode | null {
  return question.selection === 'single' || question.selection === 'multiple' ? question.selection : null;
}

/**
 * Whether the pending records form one submittable batch: one stage, one execution, a supported mode,
 * 2-26 distinct options and unique ids. Any problem disables submission for that batch.
 */
export function checkBatch(questions: readonly QuestionBase[]): BatchProblem | null {
  const [first] = questions;
  if (questions.length === 0) return { kind: 'empty' };
  const ids = new Set<string>();
  for (const question of questions) {
    if (question.stageId !== first.stageId || question.executionId !== first.executionId) {
      return { kind: 'mixed-batch', detail: 'questions belong to different stages or executions' };
    }
    // A standalone role session has no stage; the execution still identifies the batch.
    if (question.executionId === null) return { kind: 'mixed-batch', detail: 'a question has no execution' };
    if (ids.has(question.id)) return { kind: 'duplicate-id', questionId: question.id };
    ids.add(question.id);
    if (modeOf(question) === null) return { kind: 'unsupported-mode', questionId: question.id };
    const optionIds = new Set(question.options.map((option) => option.id));
    const count = question.options.length;
    if (count < MIN_OPTIONS || count > MAX_OPTIONS || optionIds.size !== count) {
      return { kind: 'bad-options', questionId: question.id };
    }
  }
  return null;
}

/**
 * Identity of a batch's content: ids, text, context, mode, options and recommendations in stored order.
 * A changed fingerprint makes a draft stale.
 */
const optionTuple = (option: QuestionOption): (string | null)[] => [option.id, option.label, option.description];

export function batchFingerprint(questions: readonly QuestionBase[]): string {
  const canonical = questions.map((question) => [
    question.id,
    question.question,
    question.context,
    question.selection,
    question.options.map(optionTuple),
    question.recommended,
  ]);
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, FINGERPRINT_LENGTH);
}

export type QuestionIssue = 'unanswered' | 'empty-text' | 'unknown-option' | 'duplicate-option' | 'too-many';

export interface QuestionValidation {
  questionId: string;
  /** Null when this question's active mode is complete. */
  issue: QuestionIssue | null;
}

function validateOne(question: PendingQuestion, draft: AnswerDraft | undefined): QuestionIssue | null {
  const value = draft ?? emptyDraft();
  if (value.mode === 'text') return value.text.trim().length === 0 ? 'empty-text' : null;
  if (value.selected.length === 0) return 'unanswered';
  const known = new Set(question.options.map((option) => option.id));
  if (new Set(value.selected).size !== value.selected.length) return 'duplicate-option';
  if (!value.selected.every((id) => known.has(id))) return 'unknown-option';
  if (modeOf(question) === 'single' && value.selected.length > 1) return 'too-many';
  return null;
}

/** Validate only each question's active mode. */
export function validateBatch(
  questions: readonly PendingQuestion[],
  draft: Readonly<BatchDraft>,
): QuestionValidation[] {
  return questions.map((question) => ({ questionId: question.id, issue: validateOne(question, draft[question.id]) }));
}

export function answeredCount(validation: readonly QuestionValidation[]): number {
  return validation.filter((item) => item.issue === null).length;
}

/**
 * Serialize the active modes into the documented reply map. Returns null unless every question is valid.
 * Multiple choices are emitted in option order, a single choice as one id, free text verbatim.
 */
export function serializeAnswers(questions: readonly PendingQuestion[], draft: Readonly<BatchDraft>): ReplyMap | null {
  const reply: ReplyMap = {};
  for (const question of questions) {
    const value = draft[question.id] ?? emptyDraft();
    if (validateOne(question, value) !== null) return null;
    if (value.mode === 'text') {
      reply[question.id] = value.text;
    } else if (modeOf(question) === 'single') {
      reply[question.id] = value.selected[0] ?? '';
    } else {
      const chosen = new Set(value.selected);
      reply[question.id] = question.options.filter((option) => chosen.has(option.id)).map((option) => option.id);
    }
  }
  return reply;
}

/** Reply-file text. JSON escaping keeps multiline and Unicode text intact. */
export function replyFileText(reply: ReplyMap): string {
  return `${JSON.stringify(reply, null, JSON_INDENT)}\n`;
}

/**
 * Free text the current CLI reader would take for an option id (a JSON string "A" selects option A even
 * after the user chose Other). Reported, never rewritten: the plan has no explicit free-text transport.
 */
const hasOption = (question: PendingQuestion, id: string): boolean =>
  question.options.some((option) => option.id === id);

export function ambiguousTextQuestions(
  questions: readonly PendingQuestion[],
  draft: Readonly<BatchDraft>,
): string[] {
  const ambiguous: string[] = [];
  for (const question of questions) {
    const value = draft[question.id];
    if (value?.mode === 'text' && hasOption(question, value.text.trim())) ambiguous.push(question.id);
  }
  return ambiguous;
}

export type Reconciliation =
  /** Every record of the batch is answered, and the stored answers equal the submitted ones. */
  | { kind: 'recorded' }
  /** Answered, but not with the submitted values (another client answered). */
  | { kind: 'answered-elsewhere' }
  /** Every record is still pending. */
  | { kind: 'pending' }
  /** Records are gone, superseded, partially answered or otherwise not decidable. */
  | { kind: 'unconfirmed' };

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && [...left].sort().join('\u0000') === [...right].sort().join('\u0000');
}

/** Whether the stored answer for `question` equals the reply value (option ids, or free text). */
function answerMatches(record: QuestionRecord, value: string | string[]): boolean {
  const { answer } = record;
  if (answer === null) return false;
  if (Array.isArray(value)) return answer.text === null && sameSet(answer.selected, value);
  const isOption = record.options.some((option) => option.id === value);
  // The CLI reads a string equal to an option id as that option.
  return isOption ? sameSet(answer.selected, [value]) : answer.selected.length === 0 && answer.text === value;
}

function matchesReply(record: QuestionRecord, reply: Readonly<ReplyMap>): boolean {
  const value = reply[record.id];
  return value !== undefined && answerMatches(record, value);
}

/**
 * Compare the session history with a submitted reply by the original `(execution_id, id)` records,
 * independent of the session's overall state. Superseded or missing records are never evidence of acceptance.
 */
export function reconcileSubmission(
  history: readonly QuestionRecord[],
  target: Pick<BatchTarget, 'executionId' | 'stageId'>,
  reply: Readonly<ReplyMap>,
): Reconciliation {
  const found: QuestionRecord[] = [];
  for (const id of Object.keys(reply)) {
    const record = history.find(
      (item) => item.executionId === target.executionId && item.stageId === target.stageId && item.id === id,
    );
    if (record === undefined) return { kind: 'unconfirmed' };
    found.push(record);
  }
  if (found.every((record) => record.status === 'pending')) return { kind: 'pending' };
  if (!found.every((record) => record.status === 'answered')) return { kind: 'unconfirmed' };
  const isSame = found.every((record) => matchesReply(record, reply));
  return { kind: isSame ? 'recorded' : 'answered-elsewhere' };
}

/** The recipient value of questions addressed to a person. */
const HUMAN_RECIPIENT = 'human';

export interface VerifyInput {
  /** `status.json.questions`, the lightweight summary. */
  summary: readonly PendingQuestion[];
  /** The session `questions.json` read: the authoritative records. */
  history: QuestionsRead;
  target: Pick<BatchTarget, 'executionId' | 'stageId'>;
  /** Fingerprint of the batch the user answered. */
  fingerprint: string;
}

export type Verified =
  | { kind: 'ok'; questions: QuestionBase[] }
  /** The batch is absent or differs from what the user saw. */
  | { kind: 'changed'; reason: string }
  /** The batch cannot be submitted from here; monitoring and raw files stay available. */
  | { kind: 'unsupported'; reason: string };

const HISTORY_PROBLEMS: Readonly<Record<string, string>> = {
  missing: 'No structured question history (questions.json) is available for this session.',
  unreadable: 'questions.json could not be read.',
  invalid: 'questions.json is malformed.',
  unsupported: 'questions.json uses an unsupported schema version.',
};

function sameIds(left: readonly { id: string }[], right: readonly { id: string }[]): boolean {
  return left.length === right.length && left.every((item, index) => item.id === right[index]?.id);
}

/**
 * Validate the whole batch against the authoritative question file before anything is sent: a supported,
 * readable file, the same membership as the status summary, human recipients, a valid shape and the exact
 * content the user answered. Never infers a batch from `response.md` or the summary alone.
 */
export function verifyBatch(input: VerifyInput): Verified {
  const { history, target } = input;
  if (history.kind !== 'ok') return { kind: 'unsupported', reason: HISTORY_PROBLEMS[history.kind] ?? 'questions.json is unusable.' };
  const isTarget = (item: { executionId: string | null; stageId: string | null }): boolean =>
    item.executionId === target.executionId && item.stageId === target.stageId;
  // A malformed record of this batch (or one that names no execution) is never validated by its remnants.
  const broken = history.malformed.find((item) => item.executionId === null || isTarget(item));
  if (broken !== undefined) {
    return { kind: 'unsupported', reason: `questions.json has a malformed record (${broken.reason}).` };
  }
  const summary = input.summary.filter(isTarget);
  const records = history.questions.filter((record) => isTarget(record) && record.status === 'pending');
  if (summary.length === 0 || records.length === 0) return { kind: 'changed', reason: 'These questions are no longer pending.' };
  if (!sameIds(summary, records)) {
    return { kind: 'unsupported', reason: 'status.json and questions.json disagree about this batch.' };
  }
  if (records.some((record) => record.recipient !== HUMAN_RECIPIENT)) {
    return { kind: 'unsupported', reason: 'These questions are not addressed to a person.' };
  }
  const problem = checkBatch(records);
  if (problem !== null) return { kind: 'unsupported', reason: describeBatchProblem(problem) };
  if (batchFingerprint(records) !== input.fingerprint) {
    return { kind: 'changed', reason: 'The questions changed after you opened them.' };
  }
  return { kind: 'ok', questions: records };
}

export function describeBatchProblem(problem: BatchProblem): string {
  switch (problem.kind) {
    case 'empty':
      return 'There are no pending questions.';
    case 'mixed-batch':
      return `These questions cannot be sent together (${problem.detail}).`;
    case 'unsupported-mode':
      return `Question ${problem.questionId} has an unsupported selection mode.`;
    case 'bad-options':
      return `Question ${problem.questionId} does not have 2-26 distinct options.`;
    case 'duplicate-id':
      return `Question ${problem.questionId} appears twice in the batch.`;
  }
}
