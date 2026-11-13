// Copy of the Session page shell: the text of the header menu and the page tabs, in one place. Loaded before
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

    /** The accessible name of the Questions tab while it shows how many questions wait. */
    questionsTab: (count) => 'Questions, ' + count + ' waiting for an answer',

    noQuestions: 'This session has not asked any questions.',
  };
})();
