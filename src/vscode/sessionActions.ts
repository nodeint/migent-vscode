import type { SessionAction } from '../core/resultsIntent';

/**
 * Header actions and the existing session command each one runs. The command always receives the page's own
 * `{ project, sessionId }`, so it never falls back to the active panel or a picker.
 *
 * Actions that only move between tabs of the Session page are absent: the page handles them in place.
 */
export const SESSION_ACTION_COMMANDS: Partial<Record<SessionAction, string>> = {
  openTask: 'migent.session.openTask',
  showLog: 'migent.session.showLog',
  copyId: 'migent.session.copyId',
  revealInExplorer: 'migent.session.revealInExplorer',
  openQuestions: 'migent.session.openQuestions',
  completeSession: 'migent.session.complete',
  reply: 'migent.session.reply',
};
