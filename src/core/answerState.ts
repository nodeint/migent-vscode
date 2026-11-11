import { text } from '../text';
import type { AnswerState } from './answerModel';
import { parseExecutionId } from './executions';
import type { PendingQuestion } from './model';
import { batchFingerprint } from './questionAnswers';
import type { QuestionRecord } from './questions';

/** Pure transitions an open answer panel makes when persisted state changes (plans/03a §6, §8). */

export interface BatchStateInput {
  state: AnswerState;
  /** Fingerprint of the batch the panel shows. */
  fingerprint: string;
  /** Pending records now stored for the panel's `(stage, execution)`. */
  current: readonly PendingQuestion[];
  history: readonly QuestionRecord[] | null;
  target: { executionId: string; stageId: string | null };
  /** Executions of the whole session, including running ones: only this stage's later ones count. */
  executions: readonly { id: string; stage: string }[];
}

export interface StateUpdate {
  state: AnswerState;
  message: string | null;
}

const FROZEN: ReadonlySet<AnswerState> = new Set(['continuing', 'sending', 'unconfirmed']);

/** A later execution of the answered stage. A lock or another branch's execution is not evidence. */
function hasContinued(input: BatchStateInput): boolean {
  const base = parseExecutionId(input.target.executionId);
  if (base === null) return false;
  return input.executions.some((execution) => {
    const parsed = parseExecutionId(execution.id);
    const isStage = input.target.stageId === null || execution.stage === input.target.stageId;
    return parsed !== null && parsed.order > base.order && isStage;
  });
}

function continuation(input: BatchStateInput): StateUpdate {
  return hasContinued(input)
    ? { state: 'continuing', message: text('states.answersSent') }
    : { state: 'recorded-waiting', message: text('states.answersSaved') };
}

function noLongerPending(input: BatchStateInput): StateUpdate {
  const { executionId, stageId } = input.target;
  const isAnswered = (input.history ?? []).some(
    (record) => record.executionId === executionId && record.stageId === stageId && record.status === 'answered',
  );
  return isAnswered
    ? { state: 'answered-elsewhere', message: text('states.answeredElsewhere') }
    : { state: 'unavailable', message: text('states.noLongerWaiting') };
}

/**
 * The state after a background change, or null when nothing moves. Answers are never carried to a changed
 * batch: a changed fingerprint is stale, a vanished batch is answered elsewhere only on recorded evidence.
 */
export function refreshBatchState(input: BatchStateInput): StateUpdate | null {
  if (input.state === 'recorded' || input.state === 'recorded-waiting') return continuation(input);
  if (FROZEN.has(input.state)) return null;
  if (input.current.length === 0) return noLongerPending(input);
  if (batchFingerprint(input.current) !== input.fingerprint) {
    return { state: 'stale', message: text('states.questionsChangedKept') };
  }
  const isRecoverable = input.state === 'stale' || input.state === 'unavailable';
  return isRecoverable ? { state: 'editing', message: null } : null;
}
