// Copy of the Overview tab's results blocks: every heading, note and message they show, in one place. Loaded before `results.js`
// (see docs/ui.md). Exposes one global, `MigentSessionResultsCopy`.
// Grouped by what the text is about (outputs, next steps, child sessions...). A text with a value in it is a function.
// Text that several pages show lives in `MigentCopy`.
(function () {
  'use strict';

  window.MigentSessionResultsCopy = {
    outputs: {
      title: 'Outputs',
      note: 'Files this session published.',
      empty: 'No published outputs.',
      unreadable: (error) => 'Cannot read outputs/ (' + error + ')',
      /** Which execution published an output. */
      publishedBy: (stage, attempt) => stage + ' · attempt ' + attempt,
      /** A warning chip on an output whose file cannot be opened. */
      state: {
        missing: 'missing',
        rejected: 'outside session',
      },
    },

    next: {
      title: 'Next steps',
      note: 'Workflows this session suggests running next.',
      /** Why next.json cannot be used, by the state the host reports. */
      state: {
        missing: 'No next-step suggestions.',
        unreadable: 'Next steps cannot be read',
        invalid: 'Next steps are invalid',
        unsupported: 'Next steps use an unsupported schema version',
      },
      withDetail: (text, detail) => text + (detail ? ' (' + detail + ')' : ''),
      openFile: 'Open next.json',
    },

    suggestion: {
      /** A warning chip with the reason a suggestion cannot launch, by the reason the host reports. */
      block: {
        sourceNotCompleted: 'source not completed',
        notDeclared: 'not declared',
        declarationUnreadable: 'declaration unreadable',
        targetNotFound: 'target not found',
        targetInvalid: 'target invalid',
        targetDuplicate: 'target duplicate',
      },
      /** The newest child session that already ran the step. */
      ran: (child) => 'Ran → ' + child,
    },

    children: {
      title: 'Child sessions',
      note: 'Sessions started from this one.',
    },

    fromSession: {
      hidden: 'Show more in the Sessions view to load the source.',
      notFound: 'The source session was not found.',
      untitled: 'Untitled source session',
      invalid: (reason) => 'Handoff details are not in the expected shape (' + reason + ').',
      openManifest: 'Open manifest',
      details: 'Details',
      upstream: 'upstream',
      /** A warning chip on an artifact whose local copy cannot be opened. */
      state: {
        missing: 'local copy missing',
        rejected: 'local copy outside session',
      },
    },
  };
})();
