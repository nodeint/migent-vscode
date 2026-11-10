// Shared agent form: the inline agent editor (model picker, effort, client options), the helpers that read the client
// list, and the "named agent or inline" selector. Pages with an agent (workflow stages, config agents and roles)
// render it over the flat shape { model, effort, clientType, clientOptions } and keep their own draft.
// Every string is set with textContent. Builds on the kit (`MigentUi`) and copy.js, which load first (see docs/ui.md).
(function () {
  'use strict';

  const ui = window.MigentUi;
  const copy = window.MigentCopy;
  const text = copy.agent;

  // Effort is a suggestion only: the client reads report models and option keys, not effort values,
  // so it stays free text. Doctor reports an invalid effort for a client and model.
  const EFFORT_SUGGESTIONS = ['low', 'medium', 'high', 'xhigh', 'max'];
  const EFFORT_LIST_ID = 'wf-efforts';

  function clientChoices(model) {
    return (model && model.clients) || [];
  }

  function clientChoice(model, name) {
    return clientChoices(model).find((choice) => choice.id === name);
  }

  function optionKeySuggestions(model, clientName) {
    const choice = clientChoice(model, clientName);
    return choice && Array.isArray(choice.optionKeys) ? choice.optionKeys : [];
  }

  function isKnownModel(model, clientName, modelName) {
    const choice = clientChoice(model, clientName);
    return Boolean(choice && modelName !== '' && (choice.models || []).includes(modelName));
  }

  /** The picker's value: both halves when known, and the missing half named otherwise. */
  function agentModelLabel(agent) {
    const client = agent.clientType || '';
    const model = agent.model || '';
    if (client !== '' && model !== '') return client + ' · ' + model;
    if (model !== '') return model + ' (no client)';
    if (client !== '') return client + ' (no model)';
    return '';
  }

  /**
   * The group of an inline agent. Not a complete agent yet is fine: the CLI reports the missing client or model
   * after Save.
   *
   * options.agent          { model, effort, clientType, clientOptions } the controls edit in place
   * options.path           data-path prefix of its controls (`<path>.model`, `.effort`, `.clientOptions`)
   * options.title, note    the group head
   * options.model          the page model (it carries `clients`)
   * options.issueOf(path)  validation message of a path
   * options.disabled       the whole group is read-only
   * options.onPick()       asks the host's model picker for this agent
   * options.onEdit()       a value or row changed, no rebuild needed
   * options.repaint(path)  a structural change; the page rebuilds and refocuses `path`
   * options.unknownHint    hint for a pair the list does not know (defaults to the shared wording)
   * options.optionKeysId   datalist id of the option keys; the page renders it with `datalists`
   * options.actions        per-unit nodes (`model`, `effort`, `clientOptions`) at the end of the label row
   */
  function inlineEditor(options) {
    const { agent, path, issueOf, disabled } = options;
    const actions = options.actions || {};
    const known = isKnownModel(options.model, agent.clientType, agent.model);
    const hasModel = agent.clientType !== '' || agent.model !== '';
    let hint = text.modelHint.known;
    if (clientChoices(options.model).length === 0) hint = text.modelHint.noClients;
    else if (hasModel && !known) hint = options.unknownHint || text.modelHint.unknown;
    return ui.group(options.title, {
      note: options.note,
      children: [
        ui.grid([
          ui.field({
            label: text.model.label,
            control: ui.picker({
              value: agentModelLabel(agent),
              path: path + '.model',
              placeholder: text.model.placeholder,
              disabled,
              onPick: () => {
                if (typeof options.onPick === 'function') options.onPick();
              },
            }),
            path: path + '.model',
            hint,
            action: actions.model,
            issue: issueOf(path + '.model'),
          }),
          ui.field({
            label: text.effort.label,
            control: ui.text({
              value: agent.effort,
              path: path + '.effort',
              placeholder: text.effort.placeholder,
              list: EFFORT_LIST_ID,
              disabled,
              onInput: (next) => {
                agent.effort = next;
              },
            }),
            path: path + '.effort',
            hint: text.effort.hint,
            action: actions.effort,
            issue: issueOf(path + '.effort'),
          }),
        ]),
        ui.pairList({
          pairs: agent.clientOptions,
          path: path + '.clientOptions',
          label: text.clientOptions.label,
          action: actions.clientOptions,
          itemLabel: text.clientOptions.item,
          keyPlaceholder: 'key',
          valuePlaceholder: 'value',
          keyList: options.optionKeysId,
          addLabel: text.clientOptions.add,
          disabled,
          onEdit: options.onEdit,
          onRestructure: options.repaint,
        }),
      ],
    });
  }

  /** The datalists the editor refers to: the effort values and one list of option keys. */
  function datalists(model, entries) {
    const nodes = [ui.datalist({ id: EFFORT_LIST_ID, values: EFFORT_SUGGESTIONS })];
    for (const entry of entries) nodes.push(ui.datalist({ id: entry.id, values: optionKeySuggestions(model, entry.clientType) }));
    return nodes;
  }

  /**
   * The select that chooses how something names its agent. `modes` is the allowed `[{ value, label }]` list, so a
   * workflow stage (role, named, inline) and a config role (named, inline) share one control.
   */
  function selector(options) {
    return ui.field({
      label: options.label,
      control: ui.select({
        value: options.value,
        path: options.path,
        options: options.modes,
        disabled: options.disabled,
        onInput: options.onInput,
      }),
      path: options.path,
      hint: options.hint,
      action: options.action,
      issue: options.issue,
    });
  }

  /** The agent a named-agent select offers: the names, a choose entry, and an unknown value kept and flagged. */
  function namedOptions(names, current) {
    const options = [{ value: '', label: names.length === 0 ? text.named.none : text.named.choose }];
    for (const name of names) options.push({ value: name, label: name });
    if (current && !names.includes(current)) options.push({ value: current, label: current + text.named.unknown });
    return options;
  }

  window.MigentAgentForm = {
    EFFORT_SUGGESTIONS,
    EFFORT_LIST_ID,
    clientChoices,
    optionKeySuggestions,
    isKnownModel,
    agentModelLabel,
    inlineEditor,
    datalists,
    selector,
    namedOptions,
  };
})();
