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
      /** A warning chip on an output whose file cannot be opened. */
      state: {
        missing: 'missing',
        rejected: 'outside session',
      },
    },

    next: {
      title: 'Next steps',
      note: 'Workflows this session suggests running next.',
      none: 'This session suggested no next steps.',
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
      /** A warning chip on a suggestion whose target workflow cannot be used, by the target state. */
      target: {
        duplicate: 'duplicate target',
        invalid: 'invalid target',
        'not-found': 'target not found',
      },
      declared: {
        label: 'Declared by workflow',
        unknown: 'Unknown',
        yes: 'Yes',
        no: 'No',
      },
      inputs: 'Inputs',
      artifactLine: (name, output) => name + ' ← output ' + output,
      open: 'Open',
      openWorkflow: 'Open workflow file',
    },

    children: {
      title: 'Child sessions',
      note: 'Sessions started from this one.',
      copyId: 'Copy session ID',
    },

    handoff: {
      title: 'Handoff',
      note: 'Artifacts handed over from the source session.',
      invalid: (reason) => 'Handoff details are not in the expected shape (' + reason + ').',
      openManifest: 'Open manifest',
      fromOutput: (output) => '← output ' + output,
      localCopy: 'Local copy',
      sha256: 'SHA-256',
      sourcePath: 'Source path',
      copyHash: 'Copy SHA-256',
      copySourcePath: 'Copy source path',
      openLocal: 'Open local copy',
      /** A warning chip on an artifact whose local copy cannot be opened. */
      state: {
        missing: 'local copy missing',
        rejected: 'local copy outside session',
      },
    },

    source: {
      title: 'Source session',
      note: 'The session this one continues from.',
      hidden: 'Show more in the Sessions view to load the source.',
      notFound: 'The source session was not found.',
      untitled: 'Untitled source session',
      copyId: 'Copy session ID',
    },
  };
})();
