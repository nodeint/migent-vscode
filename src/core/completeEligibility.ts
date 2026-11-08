import type { SessionSnapshot } from './model';

/** States `session complete` accepts: active (stopped or failed), blocked, question and cancelled. */
const COMPLETABLE_STATES: ReadonlySet<string> = new Set(['stopped', 'failed', 'blocked', 'question', 'cancelled']);

/** Whether `session complete` applies: a stopped workflow session. The CLI rejects role sessions. */
export function isCompletable(snapshot: SessionSnapshot): boolean {
  return COMPLETABLE_STATES.has(snapshot.displayState.state) && (snapshot.manifest?.role ?? null) === null;
}
