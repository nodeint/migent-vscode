// Copy of the Metrics tab: every label, note and message the tab shows, in one place. Loaded before `metrics.js`
// (see docs/ui.md). Exposes one global, `MigentSessionMetricsCopy`.
// Grouped by what the text is about (the totals, the stages, one execution...). A text with a value in it is a
// function. Text that several pages show lives in `MigentCopy`.
(function () {
  'use strict';

  const withDecision = (text, decision) => text + (decision ? ' · ' + decision : '');

  window.MigentSessionMetricsCopy = {
    notRecorded: 'not recorded',
    openFile: 'Open metrics.json',

    /** The banner shown instead of the page when metrics.json cannot be shown. */
    unavailable: {
      missingTitle: 'No metrics recorded for this session.',
      missingBody:
        'Migent writes metrics.json when a workflow session completes. Sessions completed before metrics existed, or agent sessions, have none.',
      unreadable: 'metrics.json cannot be read.',
      unusable: 'metrics.json cannot be used.',
      stays: 'The file stays on disk. The session state above comes from status.json.',
    },

    costWarning: {
      title: 'Cost is partial.',
      /** `total` is the number of executions, or null when the record has none. */
      detail: (missing, total, clients, cost) =>
        missing +
        (total === null ? '' : ' of ' + total) +
        ' executions did not report a cost' +
        (clients.length > 0 ? ' (' + clients.join(', ') + ')' : '') +
        ', so ' +
        cost +
        ' understates this session.',
      uncaptured: (count) => count + ' turn(s) captured no usage at all.',
    },

    /** The totals grid. */
    stats: {
      wallTime: 'Wall time',
      wallNote: 'first start to last finish',
      activeTime: 'Active time',
      activeShare: (percent) => percent + '% of wall',
      executions: 'Executions',
      skippedNone: 'no skips',
      skipped: (count) => count + ' skipped',
      turns: 'Turns',
      uncapturedNone: 'all captured',
      uncaptured: (count) => count + ' uncaptured',
      revisions: 'Revisions',
      revisionsNote: 'route backs, not retries',
      verify: 'Verify',
      redRunsNone: 'no red runs',
      redRuns: (count) => count + ' red run(s)',
      knownCost: 'Known cost',
      costPartial: (missing) => 'partial — ' + missing + ' executions missing',
      costComplete: 'reported by every execution',
      costNone: 'no execution reported a cost',
      failures: 'Failures',
      failuresNote: (blocked, cancelled) => blocked + ' blocked · ' + cancelled + ' cancelled',
    },

    stages: {
      title: 'Stages',
      empty: 'No stages recorded.',
      executions: (count) => count + ' executions',
      skipped: (count) => count + ' skipped',
      revisions: (count) => count + ' revisions',
      failed: (count) => count + ' failed',
      blocked: (count) => count + ' blocked',
      note: 'Bar length is the wall time spent in that stage across all its attempts. Skipped rows add no time.',
    },

    usage: {
      title: 'Usage',
      /** The label of each token counter, by the field the record carries. */
      tokens: {
        inputTokens: 'Input',
        outputTokens: 'Output',
        reasoningTokens: 'Reasoning',
        cacheReadTokens: 'Cache read',
        cacheWriteTokens: 'Cache write',
      },
      note: 'Input excludes cache reads. Reasoning is reported beside output, not added to it.',
      providers: 'Providers',
      noProviders: 'No execution ran.',
      noRole: 'No role',
      provider: {
        executions: (count) => count + ' executions',
        noCost: (executions) => executions + ' · no cost reported',
        cost: (executions, cost) => executions + ' · ' + cost,
        costWithMissing: (executions, cost, missing) => executions + ' · ' + cost + ' known · ' + missing + ' missing',
      },
    },

    executions: {
      title: 'Executions',
      empty: 'No executions recorded.',
      hint: 'In execution order. Expand a row for timings, tokens and verify results.',
      status: {
        failed: 'Failed',
        cancelled: 'Cancelled',
        skipped: 'Skipped',
        completed: (decision) => withDecision('Completed', decision),
      },
      heading: (order, stageId, attempt) => '#' + order + ' ' + stageId + (attempt === null ? '' : ' · attempt ' + attempt),
      didNotRun: 'did not run',
      noRole: 'no role',
      noCost: 'no cost',
    },

    /** The expanded body of one execution. */
    execution: {
      timing: 'Timing and state',
      status: 'Status',
      withDecision,
      skipReason: 'Skip reason',
      noSkipReason: 'No reason recorded',
      client: 'Client',
      noRoleClient: 'No role; Migent runs the verify list',
      started: 'Started',
      finished: 'Finished',
      wallVerify: 'Wall / verify',
      turns: 'Turns',
      cost: 'Cost',
      resumes: 'Resumes',
      routedFrom: 'Routed from',
      tokens: 'Tokens',
      costFact: {
        notRecorded: 'Not recorded',
        notReported: (missing) => 'Not reported (' + missing + ' turn(s) missing)',
        none: 'None (no billable turn)',
        partial: (cost, missing) => cost + ' (partial: ' + missing + ' turn(s) missing)',
      },
    },

    verify: {
      title: 'Verify',
      runs: 'Runs',
      redRuns: 'Red runs',
      firstPass: 'First pass',
      yes: 'yes',
      no: 'no',
      failedCommands: 'Failed commands',
    },

    /** The Details card at the foot of the tab. */
    details: {
      session: 'Session',
      workflow: 'Workflow',
      completed: 'Completed',
      record: 'Record',
      recordNote: 'Written by Migent when the session completed; it does not change afterwards.',
    },
  };
})();
