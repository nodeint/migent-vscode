import type { PendingQuestion, QuestionOption } from './model';
import {
  ambiguousTextQuestions,
  type AnswerDraft,
  answeredCount,
  type BatchDraft,
  type QuestionIssue,
  validateBatch,
} from './questionAnswers';
import type { QuestionRecord } from './questions';
import { isRecord } from './record';
import { SESSION_ACTIONS, type SessionAction } from './resultsIntent';
import type { SessionMeta } from './sessionMeta';

/**
 * The inert data an answer panel renders, and the validated messages it may send
 * (plans/03a-human-input.md §5, §9). The page never receives paths, argv or file handles.
 */

/** Where a submission stands. Acceptance and continuation are separate states (§8). */
export type AnswerState =
  | 'editing'
  | 'sending'
  | 'recorded'
  | 'continuing'
  | 'recorded-waiting'
  | 'rejected'
  | 'unconfirmed'
  | 'stale'
  | 'answered-elsewhere'
  | 'unavailable';

export interface QuestionView {
  id: string;
  question: string;
  context: string | null;
  selection: 'single' | 'multiple';
  options: QuestionOption[];
  recommended: string[];
}

export interface AnswerModel {
  /** Panel-local, increases with each post; the page ignores an older one. */
  revision: number;
  /** Increases when the host replaces the draft (reload, discard); an edit from an older one is dropped. */
  generation: number;
  fingerprint: string;
  title: string;
  /** The session's workflow id, shown beside the status badge. */
  workflowId: string | null;
  /** The session's display state as the other session pages show it (`Question`, `Running`, ...). */
  sessionState: string;
  /** What the header says about the session, the same on every session page. */
  meta: SessionMeta;
  state: AnswerState;
  message: string | null;
  questions: QuestionView[];
  draft: BatchDraft;
  issues: { questionId: string; issue: QuestionIssue | null }[];
  answered: number;
  /** The form accepts edits. False for stale, recorded and unavailable batches. */
  editable: boolean;
  canSubmit: boolean;
  /** Why Send is unavailable although every question may be answered; null when it is not blocked. */
  blockReason: string | null;
  /** Question ids whose free text equals an option id: the CLI would read it as that option. */
  ambiguous: string[];
  /** Normalized stored answers by question id, shown read-only once recorded elsewhere or here. */
  recorded: Record<string, string> | null;
  /** An older batch and draft kept read-only after Load current questions. */
  archived: ArchivedView[] | null;
}

export interface ArchivedView {
  id: string;
  question: string;
  answer: string;
}

export interface AnswerModelInput {
  revision: number;
  generation: number;
  fingerprint: string;
  title: string;
  /** The session's workflow id, shown beside the status badge. */
  workflowId: string | null;
  /** The session's display state as the other session pages show it (`Question`, `Running`, ...). */
  sessionState: string;
  /** What the header says about the session, the same on every session page. */
  meta: SessionMeta;
  state: AnswerState;
  message: string | null;
  questions: readonly PendingQuestion[];
  draft: BatchDraft;
  /** Reasons the batch cannot be sent right now (CLI, lock, pending operation, batch problem). */
  blockReason: string | null;
  records: readonly QuestionRecord[] | null;
  archive: { questions: readonly PendingQuestion[]; draft: BatchDraft } | null;
}

function isSingleOrMultiple(value: string | null): value is 'single' | 'multiple' {
  return value === 'single' || value === 'multiple';
}

/** One-line display of a stored answer: option labels by letter, or the free text. */
function optionLabel(record: QuestionRecord, id: string): string {
  const option = record.options.find((candidate) => candidate.id === id);
  return option === undefined ? id : `${id}. ${option.label}`;
}

export function describeAnswer(record: QuestionRecord): string {
  const { answer } = record;
  if (answer === null) return '';
  if (answer.selected.length === 0) return answer.text ?? '';
  return answer.selected.map((id) => optionLabel(record, id)).join('; ');
}

function recordedAnswers(records: readonly QuestionRecord[] | null): Record<string, string> | null {
  const answered = (records ?? []).filter((record) => record.answer !== null);
  if (answered.length === 0) return null;
  return Object.fromEntries(answered.map((record) => [record.id, describeAnswer(record)]));
}

/** The active mode of a draft as one line (option ids with labels, or the text). */
export function describeDraft(question: PendingQuestion, draft: AnswerDraft | undefined): string {
  if (draft === undefined) return '';
  if (draft.mode === 'text') return draft.text;
  const chosen = question.options.filter((option) => draft.selected.includes(option.id));
  return chosen.map((option) => `${option.id}. ${option.label}`).join('; ');
}

function archiveView(archive: AnswerModelInput['archive']): ArchivedView[] | null {
  if (archive === null) return null;
  return archive.questions.map((question) => ({
    id: question.id,
    question: question.question,
    answer: describeDraft(question, archive.draft[question.id]),
  }));
}

export function buildAnswerModel(input: AnswerModelInput): AnswerModel {
  const questions: QuestionView[] = input.questions.flatMap((question) =>
    isSingleOrMultiple(question.selection)
      ? [
          {
            id: question.id,
            question: question.question,
            context: question.context,
            selection: question.selection,
            options: question.options,
            recommended: question.recommended,
          },
        ]
      : [],
  );
  const issues = validateBatch(input.questions, input.draft);
  const answered = answeredCount(issues);
  const isEditable = input.state === 'editing' || input.state === 'rejected' || input.state === 'unconfirmed';
  const isComplete = answered === input.questions.length && questions.length === input.questions.length && answered > 0;
  const recorded = recordedAnswers(input.records);
  return {
    revision: input.revision,
    generation: input.generation,
    fingerprint: input.fingerprint,
    title: input.title,
    workflowId: input.workflowId,
    sessionState: input.sessionState,
    meta: input.meta,
    state: input.state,
    message: input.message,
    questions,
    draft: input.draft,
    issues,
    answered,
    editable: isEditable,
    canSubmit: input.state === 'editing' || input.state === 'rejected' ? isComplete && input.blockReason === null : false,
    blockReason: input.blockReason,
    ambiguous: ambiguousTextQuestions(input.questions, input.draft),
    recorded,
    archived: archiveView(input.archive),
  };
}

export type AnswerMessage =
  | { type: 'ready' }
  | { type: 'edit'; generation: number; fingerprint: string; questionId: string; draft: AnswerDraft }
  | { type: 'submit'; revision: number; fingerprint: string }
  | { type: 'reload' }
  | { type: 'discard' }
  | { type: 'recheck' }
  | { type: 'openQuestions' }
  | { type: 'later' }
  | { type: 'continue' }
  | { type: 'viewLog' }
  | { type: 'openOverview' }
  | { type: 'openMetrics' }
  | { type: 'sessionAction'; action: SessionAction };

const SIMPLE_MESSAGES = new Map<string, AnswerMessage>(
  (['ready', 'reload', 'discard', 'recheck', 'openQuestions', 'later', 'continue', 'viewLog', 'openOverview', 'openMetrics'] as const).map(
    (type) => [type, { type }],
  ),
);
/** Free text beyond this is refused instead of persisted. */
export const MAX_TEXT_LENGTH = 100_000;

function parseDraft(value: unknown): AnswerDraft | null {
  if (!isRecord(value)) return null;
  const { mode, selected, text } = value;
  if (mode !== 'choice' && mode !== 'text') return null;
  if (typeof text !== 'string' || text.length > MAX_TEXT_LENGTH) return null;
  if (!Array.isArray(selected) || !selected.every((item): item is string => typeof item === 'string')) return null;
  return { mode, selected, text };
}

/**
 * Parse a page message. The page supplies only edits and intent; target, paths and commands are the
 * host's. Anything malformed is dropped.
 */
export function parseAnswerMessage(raw: unknown): AnswerMessage | null {
  if (!isRecord(raw) || typeof raw.type !== 'string') return null;
  const simple = SIMPLE_MESSAGES.get(raw.type);
  if (simple !== undefined) return simple;
  if (raw.type === 'sessionAction') {
    const action = SESSION_ACTIONS.find((candidate) => candidate === raw.action);
    return action === undefined ? null : { type: 'sessionAction', action };
  }
  if (typeof raw.fingerprint !== 'string') return null;
  if (raw.type === 'submit') {
    return typeof raw.revision === 'number' ? { type: 'submit', revision: raw.revision, fingerprint: raw.fingerprint } : null;
  }
  if (raw.type === 'edit') {
    const draft = parseDraft(raw.draft);
    if (draft === null || typeof raw.questionId !== 'string') return null;
    if (typeof raw.generation !== 'number') return null;
    return { type: 'edit', generation: raw.generation, fingerprint: raw.fingerprint, questionId: raw.questionId, draft };
  }
  return null;
}
