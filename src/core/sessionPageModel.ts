import type { AnswerModel } from './answerModel';
import type { OverviewModel } from './overviewModel';
import type { QuestionAttempt } from './questionHistory';
import type { ResultsModel } from './resultsModel';
import type { SessionMeta } from './sessionMeta';
import type { SessionMetricsModel } from './sessionMetricsModel';
import { truncate } from './sessionPresentation';
import type { SessionWorkflowModel } from './sessionWorkflow';

/**
 * The data the one Session page shows, as plain JSON. The page renders the header once and the body of the
 * tab it is given; each tab keeps the model its own builder produced (overview, metrics, workflow, answers).
 */

export const SESSION_TABS = ['questions', 'overview', 'metrics', 'workflow'] as const;

export type SessionTab = (typeof SESSION_TABS)[number];

/** What the header says, the same on every tab. */
export interface SessionHeader {
  /** `unavailable`: the session is not known (removed, not yet loaded, or hidden by the limit). */
  availability: 'ok' | 'unavailable';
  sessionId: string;
  title: string;
  state: string;
  workflowId: string | null;
  meta: SessionMeta;
  /**
   * Whether the session ever asked a question; the Questions tab is disabled without one. Set by the panel when it
   * posts the model, so the tab builders leave it out.
   */
  hasQuestions?: boolean;
}

/** The batch a Questions tab is bound to. */
export interface SessionBatchRef {
  stageId: string | null;
  executionId: string;
}

export interface SessionQuestionsTab {
  /**
   * The selected attempt, as `answerModel.ts` builds it: a form while it waits for answers, a read-only record
   * once answered or superseded; null when the session never asked a question.
   */
  model: AnswerModel | null;
  /** The selected attempt; null when there is nothing to select. */
  selected: SessionBatchRef | null;
  /** Every attempt that asked questions, in the order they ran; the attempt selector lists them. */
  attempts: QuestionAttempt[];
}

export type SessionPageModel =
  | { tab: 'questions'; header: SessionHeader; questions: SessionQuestionsTab }
  | { tab: 'overview'; header: SessionHeader; overview: OverviewModel }
  | { tab: 'metrics'; header: SessionHeader; metrics: SessionMetricsModel }
  | { tab: 'workflow'; header: SessionHeader; workflow: SessionWorkflowModel };

const UNAVAILABLE_STATE = 'Unavailable';
const TITLE_MAX = 32;

type OverviewHeaderSource = Pick<
  ResultsModel,
  'availability' | 'sessionId' | 'title' | 'state' | 'workflowId' | 'meta'
>;
type MetricsHeaderSource = Pick<
  SessionMetricsModel,
  'availability' | 'sessionId' | 'title' | 'state' | 'workflowId' | 'meta'
>;
type WorkflowHeaderSource = Pick<
  SessionWorkflowModel,
  'sessionId' | 'sessionState' | 'title' | 'workflowId' | 'meta'
>;
type AnswerHeaderSource = Pick<AnswerModel, 'sessionState' | 'title' | 'workflowId' | 'meta'>;

function isUnavailable(state: string): boolean {
  return state === UNAVAILABLE_STATE;
}

export function overviewHeader(model: OverviewHeaderSource): SessionHeader {
  return {
    availability: model.availability,
    sessionId: model.sessionId,
    title: model.title,
    state: model.state,
    workflowId: model.workflowId,
    meta: model.meta,
  };
}

export function metricsHeader(model: MetricsHeaderSource): SessionHeader {
  return overviewHeader(model);
}

export function workflowHeader(model: WorkflowHeaderSource): SessionHeader {
  return {
    availability: isUnavailable(model.sessionState) ? 'unavailable' : 'ok',
    sessionId: model.sessionId,
    title: model.title,
    state: model.sessionState,
    workflowId: model.workflowId,
    meta: model.meta,
  };
}

/** Answers carry no session id of their own, so the host passes the one the panel is bound to. */
export function answerHeader(model: AnswerHeaderSource, sessionId: string): SessionHeader {
  return {
    availability: isUnavailable(model.sessionState) ? 'unavailable' : 'ok',
    sessionId,
    title: model.title,
    state: model.sessionState,
    workflowId: model.workflowId,
    meta: model.meta,
  };
}

/** The editor tab title: the shortened session title, or `Session` while unavailable. */
export function sessionPageTitle(header: SessionHeader): string {
  return header.availability === 'unavailable' ? 'Session' : truncate(header.title, TITLE_MAX);
}
