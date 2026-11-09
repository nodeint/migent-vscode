// Copy of the Session page shell: the text of the header menu and of the batch selector, in one place. Loaded before
// `session.js` (see docs/ui.md). Exposes one global, `MigentSessionCopy`.
// Each tab keeps its own copy file (`resultsCopy.js`, `metricsCopy.js`, `sessionWorkflowCopy.js`, `questionsCopy.js`).
// Text that several pages show lives in `MigentCopy`.
(function () {
  'use strict';

  window.MigentSessionCopy = {
    /** The extra items of the more menu, by the tab that adds them. */
    menu: {
      openQuestions: 'Open questions',
      openMetricsFile: 'Open metrics.json',
      openWorkflowFile: 'Open workflow.yaml',
    },

    /** The chip row that picks one pending batch of questions. */
    batches: {
      label: 'Pending question batches',
      roleSession: 'Role session',
      chip: (name, count) => name + ' · ' + count,
    },

    noQuestions: 'No questions are pending for this session.',
  };
})();
