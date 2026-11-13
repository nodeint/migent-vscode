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
      /** The next action of a Completed session, by what the host found launchable. */
      nextStep: {
        choose: (count) => count + ' next steps can run. Pick one under Next steps.',
        blocked: 'The next steps are blocked. See Next steps for each reason.',
        done: 'Nothing left to run.',
      },
      /** Shown when the state offers no action at all. */
      noAction: 'No action is available.',
      /** The labels of the Status key-value grid. */
      labels: {
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
      note: 'Every attempt, in the order it ran.',
      roleNote: 'Executions of this role session.',
      empty: 'No stages or executions to list.',
      attempt: (count) => 'attempt ' + count,
      /** The short attempt number of a timeline entry. */
      attemptNumber: (count) => '#' + count,
      /** The count in the section head. */
      attempts: (count) => count + (count === 1 ? ' attempt' : ' attempts'),
      /** Why an attempt ran; the labels follow the data (`turn_kind`, `routed_from`), never a guess. */
      afterAnswer: '← after your answer',
      reviseFrom: (stage, attempt) => '← revise from ' + stage + ' #' + attempt,
      routedFrom: (stage, attempt) => '← routed from ' + stage + ' #' + attempt,
      /** The tooltip of the reason label, when `metrics.json` names the attempt this one resumed. */
      resumes: (stage, attempt) => 'resumes ' + stage + ' #' + attempt,
      /** The badge of an attempt that ended by asking a question. */
      asked: 'asked',
      /** The usage cluster: units, and the tooltips that explain the abbreviations. */
      usage: {
        input: (count) => count + ' in',
        output: (count) => count + ' out',
        cacheWrite: (count) => count + ' cw',
        cacheRead: (count) => count + ' cr',
        cost: (amount) => amount + '$',
        costPartial: (amount) => amount + '$+',
        cacheWriteTip: 'Cache write',
        cacheReadTip: 'Cache read',
        outputTip: 'Output',
        outputTipReasoning: (count) => 'Output · ' + count + ' reasoning',
        costMissingTip: (count) => count + (count === 1 ? ' attempt has' : ' attempts have') + ' no cost',
      },
      /** The section head: the time agents ran, and the elapsed time of the session. */
      active: (time) => 'active ' + time,
      wall: (time) => 'wall ' + time,
      /** The marker's tooltip: the state, then the absolute times that are known. */
      started: (time) => 'started ' + time,
      finished: (time) => 'finished ' + time,
      /** The tooltip of a decision badge. */
      decision: (decision) => 'decision ' + decision,
      /** The state of a stage or execution row. */
      state: {
        question: 'Asked a question',
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
