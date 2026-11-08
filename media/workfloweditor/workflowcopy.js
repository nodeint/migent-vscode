// Copy of the workflow form: every label, hint, placeholder, note and message the form shows, in one place, so a
// wording is read and changed here and not in the code that builds the controls. Loaded before `workflowform.js`
// (see docs/ui.md). Exposes one global, `MigentWorkflowCopy`.
// Grouped by what the text is about (the workflow, a stage, an artifact...), not by where it is drawn. A text with a
// value in it is a function. Text that several pages show lives in `MigentCopy`.
(function () {
  'use strict';

  const plural = (count, noun) => count + ' ' + noun + (count === 1 ? '' : 's');

  window.MigentWorkflowCopy = {
    plural,

    /** The workflow's own settings. */
    basics: {
      title: 'Basics',
      note: 'Workflow identity and the rules every stage follows.',
      id: {
        label: 'ID',
        placeholder: 'workflow-id',
        hint: 'Used by session run and by other workflows. New files are named after it.',
      },
      concurrency: {
        label: 'Concurrency',
        placeholder: '1',
        hint: 'How many stages may run at the same time.',
      },
      constraints: {
        label: 'Constraints',
        placeholder: 'A rule every stage must respect',
        add: 'Add constraint',
        item: 'constraint',
      },
    },

    /** The stage list and one stage. */
    stages: {
      title: 'Stages',
      note: 'Open a stage to edit its identity, agent, dependencies, instructions and decisions.',
      add: 'Add stage',
      empty: 'No stages yet. A workflow needs at least one stage.',
      untitled: (number) => 'untitled stage ' + number,
      move: (item, number, direction) => 'Move ' + item + ' ' + number + ' ' + direction,
      duplicateId: 'duplicate id',
      problems: (count) => plural(count, 'problem'),
      summary: {
        verifyOnly: 'verify only',
        needs: (ids) => 'needs ' + ids,
        decisions: (count) => plural(count, 'decision'),
        agentNamed: (name) => 'agent ' + (name || '?'),
        agentInline: 'inline agent',
        agentRole: 'role agent',
      },
      advancedFacts: {
        verifyCommands: (count) => count + (count === 1 ? ' verify command' : ' verify commands'),
        pathFilters: (count) => count + (count === 1 ? ' path filter' : ' path filters'),
      },
    },

    /** The Identity group of a stage. */
    identity: {
      title: 'Identity',
      note: 'Name, description and how the stage runs.',
      id: { label: 'ID', placeholder: 'stage-id', hint: 'Other stages and decisions refer to this id.' },
      description: { label: 'Description', placeholder: 'What this stage covers' },
      role: { label: 'Role', hint: 'The role supplies the agent unless it is overridden.' },
      agent: {
        label: 'Agent',
        hint: 'Use the role agent, a named agent, or a complete inline agent.',
        modes: { role: "Role's agent", named: 'Named agent', inline: 'Inline agent' },
      },
      agentName: { label: 'Agent name', hint: 'An agent from config.yaml.' },
      ask: {
        label: 'Ask',
        hint: 'Ask a human before the stage runs.',
        options: { none: 'No questions', human: 'Ask a human' },
      },
      maxRevisions: { label: 'Max revisions', hint: 'Only valid when a decision routes back to this stage.' },
    },

    /** The inline agent group of a stage. */
    inlineAgent: {
      title: 'Inline agent',
      note: 'A complete agent replaces the role agent entirely.',
      model: { label: 'Model', placeholder: 'Choose a model' },
      effort: {
        label: 'Effort',
        placeholder: 'high',
        hint: 'A value the client supports; doctor reports an invalid one.',
      },
      clientOptions: { label: 'Client options', item: 'client options', add: 'Add option' },
      modelHint: {
        noClients: 'Client list is not available yet; Reload to try again.',
        unknown: 'Not in the client list; pick a listed model or edit the workflow file to change it.',
        known: 'Every client and model migent get models reports.',
      },
    },

    /** Dependencies and the session to resume. */
    dependencies: {
      title: 'Dependencies',
      note: 'What must finish first, and an optional session to resume.',
      dependsOn: {
        label: 'Depends on',
        hintNoOthers: 'A stage can depend on another stage once one exists.',
        unknown: (id) => id + ' is not defined in this workflow',
      },
      resumeFrom: {
        label: 'Resume from',
        hint: 'A completed role stage in Depends on; client, model and options must match.',
      },
    },

    /** The artifacts a stage writes. */
    stageArtifacts: {
      title: 'Artifacts',
      note: 'Registry artifacts this stage writes each time it completes.',
      empty: 'Add artifacts to the registry first, then pick the ones this stage writes.',
      writes: 'Writes artifacts',
    },

    instructions: {
      title: 'Instructions',
      note: 'One behavior per row; the agent receives them in order.',
      placeholder: 'What this stage must do',
      add: 'Add instruction',
      item: 'instruction',
    },

    /** Decisions: where a stage routes the workflow. */
    decisions: {
      title: 'Decisions',
      note: 'Route the workflow from this stage; without one it completes when it finishes.',
      add: 'Add decision',
      heading: (number) => 'Decision ' + number,
      decision: { label: 'Decision', placeholder: 'approved' },
      when: { label: 'Choose when', placeholder: 'The work meets the task' },
      navigate: {
        label: 'Navigate to',
        choose: 'Choose a destination',
        needsOne: 'A decision needs one destination.',
        allowed: 'Route to complete or one other stage.',
        option: {
          self: (value) => value + ' (this stage)',
          several: (value) => value + ' (several destinations)',
          unknown: (value) => value + ' (not a stage in this workflow)',
        },
        problem: {
          self: 'This file routes back to this stage; choose one destination.',
          several: 'This file routes to several stages; choose one destination.',
          unknown: 'This file routes to a stage that is not in this workflow; choose one destination.',
        },
      },
      artifacts: {
        label: 'Route artifacts',
        hint: 'Artifacts only this decision writes.',
        none: 'None',
        registry: 'Registry artifacts',
        local: 'Decision-local artifacts',
        writes: 'Writes artifacts',
        heading: (number) => 'Artifact ' + number,
        add: 'Add decision artifact',
      },
    },

    /** Verify commands and path filters, under Advanced settings. */
    advanced: {
      title: 'Advanced settings',
      verifyTimeout: { label: 'Verify timeout', placeholder: 'seconds', hint: 'Requires at least one verify command.' },
      maxVerify: { label: 'Max verify runs', placeholder: '3', hint: 'Requires at least one verify command.' },
      verifyCommands: { label: 'Verify commands', placeholder: 'pnpm test', add: 'Add command', item: 'verify command' },
      runWhenPaths: {
        label: 'Run only when these paths changed',
        placeholder: 'docs/**/*',
        add: 'Add path',
        item: 'path',
      },
    },

    /** The artifact registry of the workflow. */
    artifacts: {
      title: 'Artifacts',
      note: 'Files the workflow publishes. Stages and decisions list the ids they write.',
      add: 'Add artifact',
      empty: 'No artifacts declared.',
      heading: (number) => 'Artifact ' + number,
      id: { label: 'ID', placeholder: 'plan', hint: 'Stages, decisions and downstream workflows refer to this id.' },
      file: {
        label: 'File',
        placeholder: 'plan.md',
        hint: 'File name inside the stage output; unique, and not verify.md.',
      },
      required: {
        label: 'Required',
        hint: 'Left at Default, the key is not written.',
        options: { default: 'Default', required: 'Required', optional: 'Optional' },
      },
      description: { label: 'Description', placeholder: 'What this file holds' },
      summary: { required: 'required', optional: 'optional' },
    },

    /** The artifacts of an item written by a decision or a route: a file with an id and a description. */
    artifactFields: {
      id: { label: 'ID', placeholder: 'review' },
      file: { label: 'File', placeholder: 'review.md' },
      description: { label: 'Description', placeholder: 'What this file holds' },
    },

    /** The workflows offered after this one completes. */
    downstream: {
      title: 'Downstream',
      note: 'Workflows the reader is offered after this one completes.',
      add: 'Add suggestion',
      empty: 'No downstream suggestions.',
      heading: (number) => 'Suggestion ' + number,
      removeItem: 'suggestion',
      workflow: { label: 'Workflow' },
      task: { label: 'Task', placeholder: 'Implement the approved draft.' },
      mapping: {
        label: 'Artifact mapping',
        hint: 'Omitted, the key is not written.',
        all: 'Pass every published artifact under its own id',
        map: 'Map artifacts explicitly',
      },
      artifacts: {
        label: 'Artifacts',
        item: 'artifacts',
        keyPlaceholder: 'destination key',
        valuePlaceholder: 'artifact id',
        add: 'Add artifact',
      },
      summary: { all: 'all artifacts', mapped: (count) => count + ' mapped' },
    },
  };
})();
