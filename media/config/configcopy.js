// Text of the Configuration page and its form (configform.js and config.js read it as `text`). Text another page also
// shows lives in MigentCopy. Loads before configform.js. Exposes `MigentConfigCopy`.
(function () {
  'use strict';

  window.MigentConfigCopy = {
    eyebrow: 'Migent configuration',
    loading: 'Loading the configuration…',
    tabsLabel: 'Configuration views',
    tabs: { project: 'Project', local: 'Local', yaml: 'YAML' },
    yaml: {
      open: 'Open the YAML file in the editor',
      noLocal: 'Save the Local configuration first; config.local.yaml does not exist yet',
    },
    menuLabel: 'Configuration actions',
    saveLabel: 'Save configuration',
    notSavedYet: 'Not saved yet',

    notice: {
      invalid: (file, error) => file + ' is not valid YAML: ' + error,
      unreadable: (file, error) => file + ' cannot be read: ' + error,
      unsupported: (file, version) =>
        file + ' uses schema ' + version + '. The form is read-only; migrate it with `migent migrate`.',
      missingProject: 'config.yaml does not exist. Create it with `migent init`.',
      missingLocal: 'config.local.yaml does not exist yet. Saving creates it; it is ignored by Git.',
      changed: 'This file changed on disk. Your edits are kept; Reload discards them and adopts the file.',
      deleted: 'This file was deleted on disk. Your edits are kept; Reload discards them.',
      created: 'This file was created on disk. Your edits are kept; Reload discards them and adopts the file.',
      reload: 'Reload',
      otherFile: (file, message) => file + ': ' + message,
      problems: (count) => count + ' problem' + (count === 1 ? '' : 's') + ' found',
      warnings: (count) => count + ' warning' + (count === 1 ? '' : 's'),
      otherLayer: 'From another file; edit it on its own tab.',
    },

    agents: {
      title: 'Agents',
      note: 'Named agents roles and stages can refer to.',
      localNote: 'Override only what differs from config.yaml; everything else is inherited.',
      empty: 'No agents in this file.',
      add: 'Add agent',
      item: 'agent',
      untitled: (number) => 'untitled agent ' + number,
      name: { label: 'Name', hint: 'The key under agents. Roles refer to it; renaming does not update them.' },
      group: 'Model and client',
      inlineNote: 'Model, effort and client of this agent.',
    },
    roles: {
      title: 'Roles',
      note: 'What each role is for, and the agent that plays it.',
      empty: 'No roles in this file.',
      add: 'Add role',
      item: 'role',
      untitled: (number) => 'untitled role ' + number,
      name: { label: 'Name', hint: 'The key under roles.' },
      description: { label: 'Description', hint: 'One line that says what the role does.' },
      responsibilities: { label: 'Responsibilities', item: 'responsibility', add: 'Add responsibility' },
      agent: {
        label: 'Agent',
        hint: 'The agent that runs this role: a named agent, or a complete inline agent.',
        modes: { absent: 'No agent', inherit: 'Inherit from config.yaml', named: 'Named agent', inline: 'Inline agent' },
        name: { label: 'Named agent', hint: 'An agent from config.yaml or config.local.yaml.' },
        inlineTitle: 'Inline agent',
        inlineNote: 'A complete agent replaces the whole agent of this role.',
        replaces: (value) => 'Replaces the config.yaml agent: ' + value,
        replacesNone: 'config.yaml sets no agent for this role.',
        copy: 'Copy from config.yaml',
        unknown: 'This agent is not in config.yaml or config.local.yaml.',
      },
    },

    project: {
      overridden: 'Overridden',
      overriddenTip: 'config.local.yaml overrides this value. Change it on the Local tab.',
    },

    local: {
      override: 'Override',
      overrideOf: (label) => 'Override ' + label,
      overrides: (count) => count + (count === 1 ? ' override' : ' overrides'),
      model: { label: 'Model', hint: 'Choosing a model also sets the client.', },
      effort: { label: 'Effort', hint: 'A value the client supports; doctor reports an invalid one.' },
      clientType: { label: 'Client', hint: 'The client id, such as claude-code.' },
      options: {
        label: 'Client options',
        item: 'client option',
        add: 'Add option',
        inherited: (key, value) => key + ' = ' + value + ' (from config.yaml)',
        note: 'To remove an inherited option, edit it in the Project tab.',
      },
    },
  };
})();
