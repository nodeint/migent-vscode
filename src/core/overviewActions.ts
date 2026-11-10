import type { ExecutionSnapshot, SessionSnapshot } from './model';
import type { SessionAction } from './resultsIntent';
import { buildSessionMeta } from './sessionMeta';

/**
 * The one primary action and the ordered secondary actions for a session state.
 * Danger is a rendering property of `stop`, not a separate action or command.
 */
export interface OverviewActions {
  primary: SessionAction | null;
  secondary: SessionAction[];
}

/**
 * The Overview action table. Eligibility comes from the session's own facts
 * (`replyTargets`, `isCompletable`) and the latest execution's failure report;
 * write blocking (a foreign lock, a pending operation) stays with the commands.
 */
export function overviewActions(
  snapshot: SessionSnapshot,
  latestExecution: ExecutionSnapshot | null,
): OverviewActions {
  const meta = buildSessionMeta(snapshot);
  switch (snapshot.displayState.state) {
    case 'question':
      return { primary: 'answerQuestions', secondary: [] };
    case 'blocked':
      return {
        primary: meta.canReply ? 'reply' : null,
        secondary: ['showLog'],
      };
    case 'running':
      return { primary: 'showLog', secondary: ['stop'] };
    case 'failed':
      return {
        primary: 'continue',
        secondary: latestExecution?.hasFailureReport === true
          ? ['openFailure', 'showLog']
          : ['showLog'],
      };
    case 'stopped':
    case 'cancelled':
      return {
        primary: 'continue',
        secondary: [
          ...(meta.canReply ? ['reply' as const] : []),
          ...(meta.canComplete ? ['completeSession' as const] : []),
          'showLog',
        ],
      };
    case 'prepared':
      return { primary: 'start', secondary: ['openTask'] };
    case 'completed':
      return { primary: null, secondary: meta.canReply ? ['reply'] : [] };
    default:
      return { primary: null, secondary: [] };
  }
}
