// Copy of the Overview tab: the Status block's words and the action labels, in one place. Loaded before
// `overview.js` (see docs/ui.md). Exposes one global, `MigentSessionOverviewCopy`.
// Text that several pages show lives in `MigentCopy`; every value with a number or name is a function.
(function () {
  'use strict';

  window.MigentSessionOverviewCopy = {
    status: {
      title: 'Status',
      note: 'Where the session stands and what you can do.',
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
      pending: (count) => count + (count === 1 ? ' question pending.' : ' questions pending.'),
      /** `HH:MM` in UTC, prefixed with the day, so the page names one clock. */
      quotaReset: (time) => time + ' UTC',
      /** A stage and attempt, as a quiet value in the key-value grid. */
      execution: (stage, attempt) => stage + ' · attempt ' + attempt,
      /** The labels of the Status key-value grid. */
      labels: {
        latestExecution: 'Latest execution',
        decision: 'Decision',
        blockedIn: 'Blocked in',
        blocker: 'Blocker',
        quotaResets: 'Quota resets',
        latestUpdate: 'Latest update',
      },
      unknownExecution: 'unknown',
    },

    /** The Progress block: one row per workflow stage, or per execution for a role session. */
    progress: {
      title: 'Progress',
      note: 'Stages in workflow order and their latest attempt.',
      roleNote: 'Executions of this role session.',
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
      note: 'Newest events while the session runs.',
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
