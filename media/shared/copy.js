// Shared copy for Migent webview pages: the text that more than one page shows, in one place, so one wording is
// changed once. Loaded before `page.js` (see docs/ui.md). Exposes one global, `MigentCopy`.
// Only text that is shared lives here. A page keeps its own text in its own file until a second page needs it.
(function () {
  'use strict';

  const copy = {
    /** The page tabs of the session header, by page key. */
    tab: {
      questions: 'Questions',
      results: 'Results',
      metrics: 'Metrics',
      workflow: 'Workflow',
      task: 'Task',
    },
    tabsLabel: 'Session pages',

    /** The more menu of a session page, and the actions several pages add to it. */
    menu: {
      label: 'More actions',
      viewLog: 'View log',
      copySessionId: 'Copy session ID',
      revealInExplorer: 'Reveal in Explorer',
      reloadFromDisk: 'Reload from disk',
    },

    /** A suffix after a file path whose file cannot be opened. */
    file: {
      missing: ' (file missing)',
      outsideSession: ' (path outside the session)',
    },

    /** What a page shows for a session it cannot find; `sessionId` follows the sentence. */
    sessionUnavailable: {
      title: 'Session unavailable',
      body: (sessionId) => 'This session is not loaded, was removed, or is hidden by the session limit. ' + sessionId,
    },

    loadingWorkflow: 'Loading the workflow…',
    unsavedChanges: 'Unsaved changes',
    details: 'Details',

    /** The accessible name of a remove button: `remove('stage', 2)` is "Remove stage 2". */
    remove: (item, number) => 'Remove ' + item + ' ' + number,
  };

  window.MigentCopy = copy;
})();
