// Copy of the Results tab: every heading, note and message the tab shows, in one place. Loaded before `results.js`
// (see docs/ui.md). Exposes one global, `MigentSessionResultsCopy`.
// Grouped by what the text is about (outputs, next steps, child sessions...). A text with a value in it is a function.
// Text that several pages show lives in `MigentCopy`.
(function () {
  'use strict';

  window.MigentSessionResultsCopy = {
    outputs: {
      title: 'Outputs',
      empty: 'No published outputs.',
      unreadable: (error) => 'Cannot read outputs/ (' + error + ')',
    },

    next: {
      title: 'Next steps',
      none: 'No suggestions in next.json.',
      /** Why next.json cannot be used, by the state the host reports. */
      state: {
        missing: 'No next-step suggestions (next.json not found).',
        unreadable: 'next.json is unreadable',
        invalid: 'next.json is invalid',
        unsupported: 'next.json has an unsupported schema version',
      },
      withDetail: (text, detail) => text + (detail ? ' (' + detail + ')' : ''),
      file: 'next.json',
      openFile: 'Open next.json',
    },

    suggestion: {
      /** A warning under a suggestion whose target workflow cannot be used, by the target state. */
      target: {
        duplicate: 'More than one workflow file has this id.',
        invalid: 'The target workflow file is invalid.',
        'not-found': 'No workflow with this id in the project.',
      },
      declared: {
        unknown: 'Declaration could not be read.',
        yes: 'Declared by the workflow.',
        no: 'Not declared by the workflow.',
      },
      artifactLine: (name, output, path, availability) =>
        name + ' <- output ' + output + ' · ' + path + (availability === 'ok' ? '' : ' (' + availability + ')'),
      openWorkflow: 'Open workflow file',
    },

    children: { title: 'Child sessions' },

    handoff: {
      title: 'Handoff',
      invalid: (reason) => 'Handoff details are not in the expected shape (' + reason + ').',
      openManifest: 'Open manifest',
      artifact: (name, output) => name + ' <- output ' + output + ' · ',
      sha256: (hash) => 'sha256 ' + hash,
      sourcePath: (path) => 'source path ' + path,
    },

    source: {
      title: 'Source session',
      hidden: 'Show more in the Sessions view to load the source.',
      notFound: 'The source session was not found.',
    },
  };
})();
