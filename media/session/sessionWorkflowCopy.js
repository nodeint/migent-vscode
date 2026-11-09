// Copy of the Workflow tab of the Session page: the notices around the shared workflow form, in one place. Loaded before
// `workflow.js` (see docs/ui.md). Exposes one global, `MigentSessionWorkflowCopy`. The labels of the form itself live in
// `MigentWorkflowCopy`; text that several pages show lives in `MigentCopy`.
(function () {
  'use strict';

  const unknownError = 'unknown error';

  window.MigentSessionWorkflowCopy = {
    invalid: (error) => 'workflow.yaml is not valid YAML: ' + (error || unknownError),
    unreadable: (error) => 'workflow.yaml cannot be read: ' + (error || unknownError),
    unsupported: (schemaVersion) =>
      'This workflow uses schema ' + (schemaVersion === null ? 'unknown' : schemaVersion) + '. The form is read-only.',
    locked: {
      title: 'This workflow is locked',
      body: (stages) =>
        (stages.length === 1 ? 'Stage ' : 'Stages ') +
        stages.join(', ') +
        ' already ran, so the workflow can no longer be changed.',
    },
  };
})();
