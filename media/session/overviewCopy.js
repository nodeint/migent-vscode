// Copy of the Overview tab: the Status block's words and the action labels, in one place. Loaded before
// `overview.js` (see docs/ui.md). Exposes one global, `MigentSessionOverviewCopy`.
// Text that several pages show lives in `MigentCopy`; every value with a number or name is a function.
(function () {
  'use strict';

  window.MigentSessionOverviewCopy = {
    status: {
      title: 'Status',
      /** The state badge's label, by the display state the host reports. */
      state: {
        prepared: 'Prepared',
        running: 'Running',
        blocked: 'Blocked',
        question: 'Question',
        failed: 'Failed',
        stopped: 'Stopped',
        cancelled: 'Cancelled',
        completed: 'Completed',
        unknown: 'Unknown',
      },
      /** The sentence under the badge, by state. */
      reason: {
        prepared: 'The session is ready to start.',
        running: 'The session is running.',
        blocked: 'The session waits on an external blocker.',
        question: 'The session waits for an answer.',
        failed: 'The last execution failed.',
        stopped: 'The session was stopped.',
        cancelled: 'The session was cancelled.',
        completed: 'The session completed.',
        unknown: 'The session state cannot be read.',
      },
      /** Why the state is Unknown, by the reason the host reports. */
      unknown: {
        'missing-status': 'status.json is missing.',
        'unreadable-status': 'status.json cannot be read.',
        'invalid-status': 'status.json is invalid.',
        'unsupported-schema': 'status.json uses an unsupported schema version.',
        'invalid-manifest': 'manifest.yaml is invalid.',
        'unrecognized-status': 'status.json names an unrecognized state.',
      },
      runningStage: (stage) => 'Running stage ' + stage + '.',
      update: (summary) => 'Latest update: ' + summary,
      blockedAt: (stage, attempt) => 'Blocked in ' + stage + ' · attempt ' + attempt,
      blocker: (blocker) => 'Blocker: ' + blocker,
      quotaReset: (time) => 'Client quota resets at ' + time + ' UTC.',
      pending: (count) => count + (count === 1 ? ' question pending.' : ' questions pending.'),
      latest: (stage, attempt, status) => 'Latest execution: ' + stage + ' · attempt ' + attempt + ' ' + status + '.',
      decision: (decision) => 'Decision: ' + decision + '.',
      unknownExecution: 'unknown',
    },

    /** The Progress block: one row per workflow stage, or per execution for a role session. */
    progress: {
      title: 'Progress',
      empty: 'No stages or executions to list.',
      attempt: (count) => 'attempt ' + count,
      decision: (decision) => 'decision ' + decision,
      /** The state of a stage or execution row. */
      state: {
        'not-run': 'Not run',
        running: 'Running',
        blocked: 'Blocked',
        failed: 'Failed',
        stopped: 'Stopped',
        cancelled: 'Cancelled',
        completed: 'Completed',
        skipped: 'Skipped',
        unknown: 'Unknown',
      },
    },

    /** The Latest activity block; the host shows it only while the session is Running. */
    activity: {
      title: 'Latest activity',
      empty: 'No activity recorded yet.',
    },

    /** The label of an action the shared copy does not name. */
    actions: {
      answerQuestions: 'Answer questions',
      reply: 'Reply…',
      stop: 'Stop',
      continue: 'Continue',
      openFailure: 'Open failure report',
      start: 'Start',
      openTask: 'Open task',
    },

    /** A short tooltip for an action whose effect is not obvious from its label. */
    actionHints: {
      stop: 'Stop the running execution.',
    },
  };
})();
