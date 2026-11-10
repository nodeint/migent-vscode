import { isCompletable } from './completeEligibility';
import type { SessionSnapshot } from './model';
import { stageOf } from './sessionPresentation';

/**
 * What every session page's header says about the session, whatever the page: the same on Overview, Metrics and
 * Questions. The page turns the timestamps into a duration and an age, so the model stays free of the clock.
 */
export interface SessionMeta {
  /** The running stage, else the latest one. */
  stageId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** A running session's duration runs to now; any other one's ends at `updatedAt`. */
  isRunning: boolean;
  pendingQuestions: number;
  /** Whether `session complete` applies (a stopped workflow session); decided by the host, not the page. */
  canComplete: boolean;
  /** Whether a reply can be sent now (the store's `replyTargets`); decided by the host, not the page. */
  canReply: boolean;
}

export const NO_SESSION_META: SessionMeta = {
  stageId: null,
  createdAt: null,
  updatedAt: null,
  isRunning: false,
  pendingQuestions: 0,
  canComplete: false,
  canReply: false,
};

export function buildSessionMeta(snapshot: SessionSnapshot | undefined): SessionMeta {
  if (snapshot === undefined) return NO_SESSION_META;
  return {
    stageId: stageOf(snapshot),
    createdAt: snapshot.status?.createdAt ?? snapshot.manifest?.createdAt ?? null,
    updatedAt: snapshot.status?.updatedAt ?? null,
    isRunning: snapshot.displayState.state === 'running',
    pendingQuestions: snapshot.status?.questions.length ?? 0,
    canComplete: isCompletable(snapshot),
    canReply: snapshot.replyTargets.length > 0,
  };
}
