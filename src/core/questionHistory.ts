import { parseExecutionId } from './executions';
import type { PendingQuestion } from './model';
import type { QuestionRecord } from './questions';

/**
 * The Questions tab's history: every attempt (execution) that asked questions, from the session `questions.json`
 * and the pending questions in `status.json`, in the order the attempts ran.
 */

/**
 * `pending` while `status.json` lists a question of the attempt as waiting; `answered` once one was answered;
 * otherwise `superseded` (the session moved on without an answer).
 */
export type AttemptQuestionStatus = 'pending' | 'answered' | 'superseded';

export interface QuestionAttempt {
  stageId: string | null;
  executionId: string;
  /** The attempt number from the execution id; null when the id has another shape. */
  attempt: number | null;
  /** Questions the attempt asked. */
  count: number;
  status: AttemptQuestionStatus;
}

interface Group {
  stageId: string | null;
  executionId: string;
  ids: Set<string>;
  isPending: boolean;
  isAnswered: boolean;
  seen: number;
}

const keyOf = (stageId: string | null, executionId: string): string => `${stageId ?? ''}\u0000${executionId}`;

function statusOf(group: Group): AttemptQuestionStatus {
  if (group.isPending) return 'pending';
  return group.isAnswered ? 'answered' : 'superseded';
}

/** Execution order, then attempt; an id of another shape keeps its first-seen place after the parsed ones. */
function compare(left: Group, right: Group): number {
  const a = parseExecutionId(left.executionId);
  const b = parseExecutionId(right.executionId);
  if (a !== null && b !== null) return a.order - b.order || a.attempt - b.attempt || left.seen - right.seen;
  if (a !== null) return -1;
  if (b !== null) return 1;
  return left.seen - right.seen;
}

/** Group the history and the pending questions by attempt. A question without an execution id has no attempt. */
export function questionAttempts(
  records: readonly QuestionRecord[],
  pending: readonly PendingQuestion[],
): QuestionAttempt[] {
  const groups = new Map<string, Group>();
  const groupOf = (stageId: string | null, executionId: string): Group => {
    const key = keyOf(stageId, executionId);
    let group = groups.get(key);
    if (group === undefined) {
      group = { stageId, executionId, ids: new Set(), isPending: false, isAnswered: false, seen: groups.size };
      groups.set(key, group);
    }
    return group;
  };
  for (const record of records) {
    if (record.executionId === null) continue;
    const group = groupOf(record.stageId, record.executionId);
    group.ids.add(record.id);
    if (record.answer !== null || record.status === 'answered') group.isAnswered = true;
  }
  for (const question of pending) {
    if (question.executionId === null) continue;
    const group = groupOf(question.stageId, question.executionId);
    group.ids.add(question.id);
    group.isPending = true;
  }
  return [...groups.values()].sort(compare).map((group) => ({
    stageId: group.stageId,
    executionId: group.executionId,
    attempt: parseExecutionId(group.executionId)?.attempt ?? null,
    count: group.ids.size,
    status: statusOf(group),
  }));
}

/** The attempt to show first: the latest one still waiting for answers, else the latest one. */
export function defaultAttempt(attempts: readonly QuestionAttempt[]): QuestionAttempt | undefined {
  const waiting = attempts.filter((attempt) => attempt.status === 'pending');
  return waiting.at(-1) ?? attempts.at(-1);
}

/** The records of one attempt, in stored order. */
export function attemptRecords(
  records: readonly QuestionRecord[],
  ref: { stageId: string | null; executionId: string },
): QuestionRecord[] {
  return records.filter((record) => record.executionId === ref.executionId && record.stageId === ref.stageId);
}

/** The attempt a selection names, if the session still lists it. */
export function findAttempt(
  attempts: readonly QuestionAttempt[],
  ref: { stageId: string | null; executionId: string } | null,
): QuestionAttempt | undefined {
  if (ref === null) return undefined;
  return attempts.find((attempt) => attempt.executionId === ref.executionId && attempt.stageId === ref.stageId);
}
