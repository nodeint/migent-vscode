// Workflow form: the Design view's controls, separated from the editor page so another page can reuse them.
// It owns the form's data shape (empty, normalize) and renders sections of controls over a draft it does not own.
// The host page supplies the model, the draft, validation issues and two callbacks (see `create`).
// Every string is set with textContent. Needs media/shared/page.js and media/shared/form.js loaded first (see docs/ui.md).
(function () {
  'use strict';

  const { el, details } = window.MigentPage;
  const ui = window.MigentForm;

  const ASK_OPTIONS = [
    { value: '', label: 'No questions' },
    { value: 'human', label: 'Ask a human' },
  ];

  const AGENT_MODES = [
    { value: 'role', label: "Role's agent" },
    { value: 'named', label: 'Named agent' },
    { value: 'inline', label: 'Inline agent' },
  ];

  // Effort is a suggestion only: the client reads report models and option keys, not effort values,
  // so it stays free text. Doctor reports an invalid effort for a client and model.
  const EFFORT_SUGGESTIONS = ['low', 'medium', 'high', 'xhigh', 'max'];

  // ---------- plain data ----------

  function emptyAgent() {
    return { model: '', effort: '', clientType: '', clientOptions: [] };
  }

  function emptyStage() {
    return {
      id: '',
      description: '',
      role: '',
      ask: '',
      agentMode: 'role',
      agentName: '',
      agent: emptyAgent(),
      dependsOn: [],
      maxRevisions: null,
      instructions: [],
      producesArtifact: '',
      sessionResumeFrom: '',
      verify: [],
      verifyTimeout: null,
      maxVerify: null,
      runWhenPaths: [],
      decision: [],
    };
  }

  function emptyForm() {
    return { id: '', concurrency: null, constraints: [], stages: [], outputs: [], downstream: [] };
  }

  function normalizePairs(values) {
    return (Array.isArray(values) ? values : []).map((pair) => ({ key: '', value: '', ...(pair || {}) }));
  }

  function normalizeStage(input) {
    const stage = { ...emptyStage(), ...(input || {}) };
    const agent = stage.agent && typeof stage.agent === 'object' ? stage.agent : {};
    stage.agentMode = stage.agentMode === 'named' || stage.agentMode === 'inline' ? stage.agentMode : 'role';
    stage.agentName = typeof stage.agentName === 'string' ? stage.agentName : '';
    stage.agent = {
      model: typeof agent.model === 'string' ? agent.model : '',
      effort: typeof agent.effort === 'string' ? agent.effort : '',
      clientType: typeof agent.clientType === 'string' ? agent.clientType : '',
      clientOptions: normalizePairs(agent.clientOptions),
    };
    stage.dependsOn = Array.isArray(stage.dependsOn) ? stage.dependsOn : [];
    stage.instructions = Array.isArray(stage.instructions) ? stage.instructions : [];
    stage.verify = Array.isArray(stage.verify) ? stage.verify : [];
    stage.runWhenPaths = Array.isArray(stage.runWhenPaths) ? stage.runWhenPaths : [];
    stage.decision = (Array.isArray(stage.decision) ? stage.decision : []).map((route) => ({
      value: '',
      when: '',
      navigate: '',
      ...(route || {}),
    }));
    return stage;
  }

  function normalizeForm(input) {
    const next = { ...emptyForm(), ...(input || {}) };
    next.constraints = Array.isArray(next.constraints) ? next.constraints : [];
    next.stages = (Array.isArray(next.stages) ? next.stages : []).map(normalizeStage);
    next.outputs = (Array.isArray(next.outputs) ? next.outputs : []).map((output) => ({
      name: '',
      fromStage: '',
      artifact: '',
      ...(output || {}),
    }));
    next.downstream = (Array.isArray(next.downstream) ? next.downstream : []).map((target) => ({
      workflow: '',
      task: '',
      ...(target || {}),
      artifacts: normalizePairs(target && target.artifacts),
    }));
    return next;
  }

  /**
   * Create a form renderer.
   *
   * host.getModel()        the editor model (roles, agents, isSupported, state)
   * host.getForm()         the draft the controls edit in place
   * host.issues(kind)      validation issues for 'errors' or 'warnings'
   * host.onEdit()          called after a value changed and no rebuild is needed
   * host.repaint(path)     called after a structural change; the host rebuilds and refocuses `path`
   * host.pickModel(index)  asks the host to open its model picker for one inline stage
   */
  function create(host) {
    const { getModel, getForm, issues, onEdit, repaint, pickModel } = host;

    /** A structural edit: drop stale diagnostics through `onEdit`, then rebuild and refocus. */
    function edited(path) {
      onEdit();
      repaint(path);
    }

    function isFormReadOnly() {
      const model = getModel();
      return model.isLocked === true || !model.isSupported || model.state === 'invalid' || model.state === 'unreadable';
    }

    /** The first issue that belongs to a field path, its own or a child's. */
    function issueFor(path) {
      const all = [...issues('errors'), ...issues('warnings')];
      return all.find((issue) => issue.path === path || issue.path.startsWith(path + '.') || path.startsWith(issue.path + '.'));
    }

    /** The issue in the shape the shared form kit renders, or null. */
    function issueOf(path) {
      const issue = issueFor(path);
      if (!issue) return null;
      return { message: issue.message, warning: issues('warnings').includes(issue) };
    }

    // ---------- form controls ----------

    function action(label, kind, onClick, isDisabled) {
      return ui.button(label, { kind, onClick, disabled: Boolean(isDisabled) });
    }

    function textControl(value, path, onInput, options) {
      const settings = options || {};
      return ui.text({
        value,
        path,
        type: settings.type,
        placeholder: settings.placeholder,
        list: settings.list,
        disabled: isFormReadOnly(),
        onInput,
      });
    }

    function textareaControl(value, path, onInput, placeholder) {
      return ui.textarea({
        value,
        path,
        placeholder,
        rows: 3,
        disabled: isFormReadOnly(),
        onInput,
      });
    }

    function numberControl(value, path, onInput, placeholder) {
      return ui.number({
        value,
        path,
        placeholder,
        disabled: isFormReadOnly(),
        onInput,
      });
    }

    function selectControl(value, path, options, onInput) {
      return ui.select({
        value,
        path,
        options,
        disabled: isFormReadOnly(),
        onInput,
      });
    }

    function field(labelText, control, path, hint, wide) {
      return ui.field({ label: labelText, control, path, hint, wide, issue: issueOf(path) });
    }

    function textList(values, options) {
      return ui.stringList({
        values,
        path: options.path,
        label: options.label,
        placeholder: options.placeholder,
        multiline: options.multiline,
        addLabel: options.addLabel,
        itemLabel: options.itemLabel || options.label.toLowerCase(),
        disabled: isFormReadOnly(),
        onEdit,
        onRestructure: repaint,
      });
    }

    function checkList(available, selected, path, onToggle, unknownValues) {
      const items = available.map((value) => ({
        value,
        label: value,
        unknown: Boolean(unknownValues && unknownValues.includes(value)),
        title: unknownValues && unknownValues.includes(value) ? value + ' is not a stage in this workflow' : '',
      }));
      return ui.checkboxList({
        items,
        selected,
        path,
        disabled: isFormReadOnly(),
        onChange: onToggle,
        onEdit,
        onRestructure: repaint,
      });
    }

    function pairList(pairs, path, label, keyPlaceholder, valuePlaceholder, valueOptions, keyList, addLabel) {
      return ui.pairList({
        pairs,
        path,
        label,
        keyPlaceholder,
        valuePlaceholder,
        keyList,
        valueOptions,
        addLabel,
        itemLabel: label.toLowerCase(),
        disabled: isFormReadOnly(),
        onEdit,
        onRestructure: repaint,
      });
    }

    // ---------- sections ----------

    function renderBasics() {
      const form = getForm();
      return ui.section('Basics', {
        note: 'Workflow identity and the rules every stage follows.',
        surface: true,
        children: [
          ui.grid([
            field(
              'ID',
              textControl(form.id, 'id', (next) => {
                form.id = next;
              }, { placeholder: 'workflow-id' }),
              'id',
              'Used by session run and by other workflows. New files are named after it.',
            ),
            field(
              'Concurrency',
              numberControl(form.concurrency, 'concurrency', (next) => {
                form.concurrency = next;
              }, '1'),
              'concurrency',
              'How many stages may run at the same time.',
            ),
          ]),
          textList(form.constraints, {
            path: 'constraints',
            label: 'Constraints',
            placeholder: 'A rule every stage must respect',
            addLabel: 'Add constraint',
            itemLabel: 'constraint',
          }),
        ],
      });
    }

    function stageLabel(stage, index) {
      return stage.id ? stage.id : 'untitled stage ' + (index + 1);
    }

    function renderStages() {
      const form = getForm();
      const count = form.stages.length + (form.stages.length === 1 ? ' stage' : ' stages');
      const children = [];
      if (form.stages.length === 0) {
        children.push(el('p', 'No stages yet. A workflow needs at least one stage.', 'mg-empty'));
      }
      form.stages.forEach((stage, index) => children.push(renderStage(stage, index)));
      return ui.section('Stages', {
        note: 'Open a stage to edit its identity, agent, dependencies, instructions and decisions.',
        count,
        actions: [
          action('Add stage', 'secondary', () => {
            form.stages.push(emptyStage());
            edited('stages.' + (form.stages.length - 1) + '.id');
          }, isFormReadOnly()),
        ],
        children,
      });
    }

    function moveStage(index, delta) {
      const form = getForm();
      const target = index + delta;
      if (target < 0 || target >= form.stages.length) return;
      const [stage] = form.stages.splice(index, 1);
      form.stages.splice(target, 0, stage);
      edited('stages.' + target + '.id');
    }

    function removeStage(index) {
      getForm().stages.splice(index, 1);
      edited('stages.' + Math.max(0, index - 1) + '.id');
    }

    function stagePath(index, key) {
      return 'stages.' + index + '.' + key;
    }

    /** Keep every in-file reference in step when a stage id changes. */
    function renameStageReferences(oldId, newId) {
      if (oldId === '' || newId === '' || oldId === newId) return;
      const form = getForm();
      let changed = false;
      for (const stage of form.stages) {
        stage.dependsOn = stage.dependsOn.map((id) => {
          if (id !== oldId) return id;
          changed = true;
          return newId;
        });
        if (stage.sessionResumeFrom === oldId) {
          stage.sessionResumeFrom = newId;
          changed = true;
        }
        for (const route of stage.decision || []) {
          const parts = route.navigate
            .split(',')
            .map((part) => part.trim())
            .filter((part) => part !== '')
            .map((part) => (part === oldId ? newId : part));
          const next = parts.join(', ');
          if (next !== route.navigate) {
            route.navigate = next;
            changed = true;
          }
        }
      }
      for (const output of form.outputs) {
        if (output.fromStage === oldId) {
          output.fromStage = newId;
          changed = true;
        }
      }
      if (changed) onEdit();
    }

    function roleOptions(current) {
      const roles = getModel().roles || [];
      const options = [{ value: '', label: 'No role (verify only)' }];
      for (const role of roles) options.push({ value: role, label: role });
      if (current && !roles.includes(current)) options.push({ value: current, label: current + ' (not in config)' });
      return options;
    }

    function uniqueValues(values) {
      const unique = [];
      for (const value of values) {
        if (value !== '' && !unique.includes(value)) unique.push(value);
      }
      return unique;
    }

    function stageIds() {
      return uniqueValues(getForm().stages.map((stage) => stage.id));
    }

    function artifactBaseName(artifact) {
      const base = String(artifact).split('/').pop() || String(artifact);
      return base.replace(/\.[^.]+$/, '') || base;
    }

    function agentNameOptions(current) {
      const agents = getModel().agents || [];
      const options = [{ value: '', label: agents.length === 0 ? 'No agents in config' : 'Choose an agent' }];
      for (const agent of agents) options.push({ value: agent, label: agent });
      if (current && !agents.includes(current)) options.push({ value: current, label: current + ' (not in config)' });
      return options;
    }

    function clientChoices() {
      return getModel().clients || [];
    }

    function clientChoice(name) {
      return clientChoices().find((choice) => choice.id === name);
    }

    function optionKeySuggestions(clientName) {
      const choice = clientChoice(clientName);
      return choice && Array.isArray(choice.optionKeys) ? choice.optionKeys : [];
    }

    function isKnownModel(clientName, modelName) {
      const choice = clientChoice(clientName);
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

    function resumeOptions(stage, current) {
      const form = getForm();
      const options = [{ value: '', label: 'No resumed session' }];
      const listed = [];
      for (const id of uniqueValues(stage.dependsOn)) {
        const dependency = form.stages.find((candidate) => candidate.id === id);
        if (dependency && dependency.role === '') continue;
        options.push({ value: id, label: id });
        listed.push(id);
      }
      if (current && !listed.includes(current)) {
        const suffix = stage.dependsOn.includes(current) ? ' (no role)' : ' (not a dependency)';
        options.push({ value: current, label: current + suffix });
      }
      return options;
    }

    function outputStageOptions(current) {
      const options = [{ value: '', label: 'Choose a stage' }];
      const seen = [];
      for (const stage of getForm().stages) {
        if (stage.id === '' || seen.includes(stage.id)) continue;
        if (stage.producesArtifact === '' && stage.id !== current) continue;
        seen.push(stage.id);
        const suffix = stage.producesArtifact === '' ? ' (no artifact)' : ' → ' + stage.producesArtifact;
        options.push({ value: stage.id, label: stage.id + suffix });
      }
      if (current && !seen.includes(current)) options.push({ value: current, label: current + ' (not a stage)' });
      return options;
    }

    function outputArtifactOptions(output) {
      const options = [{ value: '', label: output.fromStage === '' ? 'Choose a stage first' : 'Choose an artifact' }];
      const stage = getForm().stages.find((candidate) => candidate.id === output.fromStage);
      if (stage && stage.producesArtifact !== '') {
        options.push({ value: stage.producesArtifact, label: stage.producesArtifact });
      }
      if (output.artifact !== '' && !options.some((option) => option.value === output.artifact)) {
        options.push({ value: output.artifact, label: output.artifact + ' (does not match)' });
      }
      return options;
    }

    function outputNameOptions(current) {
      const options = [{ value: '', label: 'Choose an output' }];
      const names = uniqueValues(getForm().outputs.map((output) => output.name));
      for (const name of names) options.push({ value: name, label: name });
      if (current && !names.includes(current)) options.push({ value: current, label: current + ' (not an output)' });
      return options;
    }

    function workflowOptions(current) {
      const workflows = getModel().workflows || [];
      const options = [{ value: '', label: 'Choose a workflow' }];
      const ids = uniqueValues(workflows.map((workflow) => workflow.id));
      for (const id of ids) options.push({ value: id, label: id });
      if (current && !ids.includes(current)) options.push({ value: current, label: current + ' (not in project)' });
      return options;
    }

    function stageSummary(stage, index) {
      const head = el('div', null, 'wf-stage-head');
      head.append(el('span', String(index + 1), 'mg-badge' + (stage.id ? '' : ' mg-badge--warn')));
      head.append(el('span', stageLabel(stage, index), 'wf-stage-title'));
      const chips = el('span', null, 'wf-stage-chips');
      chips.append(el('span', stage.role || 'verify only', 'mg-chip'));
      chips.append(
        el('span', agentSummary(stage), stage.agentMode === 'inline' ? 'mg-chip mg-chip--info' : 'mg-chip'),
      );
      if (stage.dependsOn.length > 0) {
        const depends = el('span', 'needs ' + stage.dependsOn.join(', '), 'mg-chip');
        depends.title = 'Depends on ' + stage.dependsOn.join(', ');
        chips.append(depends);
      }
      const duplicate = stage.id !== '' && getForm().stages.filter((candidate) => candidate.id === stage.id).length > 1;
      if (duplicate) chips.append(el('span', 'duplicate id', 'mg-chip mg-chip--warn'));
      head.append(chips);
      return head;
    }

    function stageTools(index) {
      const total = getForm().stages.length;
      const tools = el('div', null, 'wf-stage-tools');
      tools.append(
        action('Move up', 'quiet', () => moveStage(index, -1), isFormReadOnly() || index === 0),
        action('Move down', 'quiet', () => moveStage(index, 1), isFormReadOnly() || index === total - 1),
      );
      const remove = action('Remove stage', 'quiet', () => removeStage(index), isFormReadOnly());
      remove.classList.add('wf-tool-remove');
      tools.append(remove);
      return tools;
    }

    function identityGroup(stage, index) {
      const originalId = stage.id;
      const idControl = textControl(stage.id, stagePath(index, 'id'), (next) => {
        stage.id = next;
      }, { placeholder: 'stage-id' });
      idControl.addEventListener('change', () => {
        const next = idControl.value.trim();
        if (next !== idControl.value) idControl.value = next;
        stage.id = next;
        renameStageReferences(originalId, next);
        edited(stagePath(index, 'id'));
      });
      const producesControl = textControl(stage.producesArtifact, stagePath(index, 'producesArtifact'), (next) => {
        stage.producesArtifact = next;
      }, { placeholder: 'stage.md' });
      producesControl.addEventListener('change', () => edited(stagePath(index, 'producesArtifact')));
      const fields = [
        field('ID', idControl, stagePath(index, 'id'), 'Other stages and outputs refer to this id.'),
        field('Description', textControl(stage.description, stagePath(index, 'description'), (next) => {
          stage.description = next;
        }, { placeholder: 'What this stage covers' }), stagePath(index, 'description'), undefined, true),
        field('Role', selectControl(stage.role, stagePath(index, 'role'), roleOptions(stage.role), (next) => {
          stage.role = next;
          edited(stagePath(index, 'role'));
        }), stagePath(index, 'role'), 'The role supplies the agent unless it is overridden.'),
        field('Agent', selectControl(stage.agentMode, stagePath(index, 'agentMode'), AGENT_MODES, (next) => {
          stage.agentMode = next;
          edited(stagePath(index, 'agentMode'));
        }), stagePath(index, 'agentMode'), 'Use the role agent, a named agent, or a complete inline agent.'),
      ];
      if (stage.agentMode === 'named') {
        fields.push(
          field('Agent name', selectControl(stage.agentName, stagePath(index, 'agentName'), agentNameOptions(stage.agentName), (next) => {
            stage.agentName = next;
          }), stagePath(index, 'agentName'), 'An agent from config.yaml.'),
        );
      }
      fields.push(
        field('Ask', selectControl(stage.ask, stagePath(index, 'ask'), ASK_OPTIONS, (next) => {
          stage.ask = next;
        }), stagePath(index, 'ask'), 'Ask a human before the stage runs.'),
        field('Max revisions', numberControl(stage.maxRevisions, stagePath(index, 'maxRevisions'), (next) => {
          stage.maxRevisions = next;
        }), stagePath(index, 'maxRevisions'), 'Only valid when a decision routes back to this stage.'),
        field('Produces artifact', producesControl, stagePath(index, 'producesArtifact'), 'The file this stage hands to outputs and downstream workflows.'),
      );
      return ui.group('Identity', 'Name, description and how the stage runs.', {
        children: [ui.grid(fields)],
      });
    }

    function agentSummary(stage) {
      if (stage.agentMode === 'named') return 'agent ' + (stage.agentName || '?');
      if (stage.agentMode === 'inline') return 'inline agent';
      return 'role agent';
    }

    /** Not a complete agent yet is fine: the CLI reports the missing client or model after Save. */
    function inlineAgentEditor(stage, index) {
      const agent = stage.agent;
      const known = isKnownModel(agent.clientType, agent.model);
      const hasModel = agent.clientType !== '' || agent.model !== '';
      const hint =
        clientChoices().length === 0
          ? 'Client list is not available yet; Reload to try again.'
          : hasModel && !known
            ? 'Not in the client list; pick a listed model or edit the workflow file to change it.'
            : 'Every client and model migent get models reports.';
      return ui.group('Inline agent', 'A complete agent replaces the role agent entirely.', {
        children: [
          ui.grid([
            field('Model', ui.picker({
              value: agentModelLabel(agent),
              path: stagePath(index, 'agent.model'),
              placeholder: 'Choose a model',
              disabled: isFormReadOnly(),
              onPick: () => {
                if (typeof pickModel === 'function') pickModel(index);
              },
            }), stagePath(index, 'agent.model'), hint),
            field('Effort', textControl(agent.effort, stagePath(index, 'agent.effort'), (next) => {
              agent.effort = next;
            }, { placeholder: 'high', list: 'wf-efforts' }), stagePath(index, 'agent.effort'), 'A value the client supports; doctor reports an invalid one.'),
          ]),
          pairList(
            agent.clientOptions,
            stagePath(index, 'agent.clientOptions'),
            'Client options',
            'key',
            'value',
            undefined,
            'wf-option-keys-' + index,
            'Add option',
          ),
        ],
      });
    }

    function dependsOnEditor(stage, index) {
      const form = getForm();
      const available = [];
      for (const candidate of form.stages) {
        if (candidate === stage || !candidate.id || available.includes(candidate.id)) continue;
        available.push(candidate.id);
      }
      const unknown = stage.dependsOn.filter((id) => !available.includes(id) && id !== stage.id);
      const content = [
        checkList([...available, ...unknown], stage.dependsOn, 'stages.' + index + '.dependsOn', (id, checked) => {
          if (checked && !stage.dependsOn.includes(id)) stage.dependsOn.push(id);
          if (!checked) stage.dependsOn = stage.dependsOn.filter((value) => value !== id);
        }, unknown),
      ];
      if (form.stages.length < 2) {
        return ui.fieldset('Depends on', content, {
          hint: 'A stage can depend on another stage once one exists.',
        });
      }
      return ui.fieldset('Depends on', content);
    }

    function dependenciesGroup(stage, index) {
      return ui.group('Dependencies', 'What must finish first, and an optional session to resume.', {
        children: [
          dependsOnEditor(stage, index),
          ui.grid([
            field('Resume from', selectControl(stage.sessionResumeFrom, stagePath(index, 'sessionResumeFrom'), resumeOptions(stage, stage.sessionResumeFrom), (next) => {
              stage.sessionResumeFrom = next;
            }), stagePath(index, 'sessionResumeFrom'), 'A completed role stage in Depends on; client, model and options must match.'),
          ]),
        ],
      });
    }

    function instructionsGroup(stage, index) {
      return ui.group('Instructions', 'One behavior per row; the agent receives them in order.', {
        children: [
          textList(stage.instructions, {
            path: stagePath(index, 'instructions'),
            label: '',
            placeholder: 'What this stage must do',
            addLabel: 'Add instruction',
            itemLabel: 'instruction',
            multiline: true,
          }),
        ],
      });
    }

    /** One destination per decision: complete or another stage, never the stage itself. */
    function navigationEditor(route, path, stageId) {
      const current = route.navigate;
      const destinations = uniqueValues([
        'complete',
        ...stageIds().filter((id) => id !== '' && id !== stageId),
      ]);
      const known = current === '' || destinations.includes(current);
      const choices = [{ value: '', label: 'Choose a destination' }];
      for (const value of destinations) choices.push({ value, label: value });
      if (!known) choices.push({ value: current, label: navigationLabel(current, stageId) });
      const control = selectControl(current, path, choices, (next) => {
        route.navigate = next;
        edited(path);
      });
      const hint =
        current === ''
          ? 'A decision needs one destination.'
          : known
            ? 'Route to complete or one other stage.'
            : navigationProblem(current, stageId);
      const wrap = ui.fieldset('Navigate to', [control], {
        path,
        hint,
        hintWarning: !known || current === '',
        issue: issueOf(path),
      });
      return wrap;
    }

    /** An imported value the editor cannot offer stays visible instead of being rewritten. */
    function navigationLabel(value, stageId) {
      if (value === stageId) return value + ' (this stage)';
      if (value.includes(',')) return value + ' (several destinations)';
      return value + ' (not a stage in this workflow)';
    }

    function navigationProblem(value, stageId) {
      if (value === stageId) return 'This file routes back to this stage; choose one destination.';
      if (value.includes(',')) return 'This file routes to several stages; choose one destination.';
      return 'This file routes to a stage that is not in this workflow; choose one destination.';
    }

    function decisionEditor(stage, index) {
      const wrap = el('div', null, 'wf-decision-list');
      (stage.decision || []).forEach((route, routeIndex) => {
        const base = stagePath(index, 'decision') + '.' + routeIndex;
        wrap.append(
          ui.section('Decision ' + (routeIndex + 1), {
            level: 3,
            variant: 'card',
            accent: true,
            actions: [
              action('Remove decision', 'quiet', () => {
                stage.decision.splice(routeIndex, 1);
                edited(stagePath(index, 'decision'));
              }, isFormReadOnly()),
            ],
            children: [
              ui.grid([
                field('Decision', textControl(route.value, base + '.value', (next) => {
                  route.value = next;
                }, { placeholder: 'approved' }), base + '.value'),
                navigationEditor(route, base + '.navigate', stage.id),
              ]),
              ui.grid([
                field('Choose when', textControl(route.when, base + '.when', (next) => {
                  route.when = next;
                }, { placeholder: 'The work meets the task' }), base + '.when', undefined, true),
              ]),
            ],
          }),
        );
      });
      wrap.append(
        ui.addButton('Add decision', () => {
          stage.decision = stage.decision || [];
          stage.decision.push({ value: '', when: '', navigate: '' });
          edited(stagePath(index, 'decision') + '.' + (stage.decision.length - 1) + '.value');
        }, isFormReadOnly()),
      );
      return wrap;
    }

    function decisionsGroup(stage, index) {
      return ui.group('Decisions', 'Route the workflow from this stage; without one it completes when it finishes.', {
        children: [decisionEditor(stage, index)],
      });
    }

    function stageAdvanced(stage, index) {
      const advanced = details('stage:' + index + ':advanced', 'Advanced settings', 'wf-advanced', false);
      const body = el('div', null, 'wf-advanced-body');
      body.append(
        ui.grid([
          field('Verify timeout', numberControl(stage.verifyTimeout, stagePath(index, 'verifyTimeout'), (next) => {
            stage.verifyTimeout = next;
          }, 'seconds'), stagePath(index, 'verifyTimeout'), 'Requires at least one verify command.'),
          field('Max verify runs', numberControl(stage.maxVerify, stagePath(index, 'maxVerify'), (next) => {
            stage.maxVerify = next;
          }, '3'), stagePath(index, 'maxVerify'), 'Requires at least one verify command.'),
        ]),
      );
      body.append(
        textList(stage.verify, {
          path: stagePath(index, 'verify'),
          label: 'Verify commands',
          placeholder: 'pnpm test',
          addLabel: 'Add command',
          itemLabel: 'verify command',
        }),
      );
      body.append(
        textList(stage.runWhenPaths, {
          path: stagePath(index, 'runWhenPaths'),
          label: 'Run only when these paths changed',
          placeholder: 'docs/**/*',
          addLabel: 'Add path',
          itemLabel: 'path',
        }),
      );
      advanced.append(body);
      return advanced;
    }

    function renderStage(stage, index) {
      const box = details('stage:' + index, stageSummary(stage, index), 'wf-stage', index === 0);
      box.id = 'stage-' + index;
      const body = el('div', null, 'wf-stage-body');
      body.append(stageTools(index));
      body.append(identityGroup(stage, index));
      if (stage.agentMode === 'inline') body.append(inlineAgentEditor(stage, index));
      body.append(dependenciesGroup(stage, index));
      body.append(instructionsGroup(stage, index));
      body.append(decisionsGroup(stage, index));
      body.append(stageAdvanced(stage, index));
      box.append(body);
      return box;
    }

    function renderOutputs() {
      const form = getForm();
      const children = [];
      if (form.outputs.length === 0) children.push(el('p', 'No published outputs.', 'mg-empty'));
      form.outputs.forEach((output, index) => {
        children.push(
          ui.group('Output ' + (index + 1), undefined, {
            card: true,
            actions: [
              action('Remove output', 'quiet', () => {
                form.outputs.splice(index, 1);
                edited('outputs');
              }, isFormReadOnly()),
            ],
            children: [
              ui.grid([
                field('Name', textControl(output.name, 'outputs.' + index + '.name', (next) => {
                  output.name = next;
                }, { placeholder: 'plan', list: 'wf-output-names' }), 'outputs.' + index + '.name'),
                field('From stage', selectControl(output.fromStage, 'outputs.' + index + '.fromStage', outputStageOptions(output.fromStage), (next) => {
                  const stage = getForm().stages.find((candidate) => candidate.id === next);
                  const artifact = stage && stage.producesArtifact !== '' ? stage.producesArtifact : '';
                  output.fromStage = next;
                  if (artifact !== '') {
                    output.artifact = artifact;
                    if (output.name === '') output.name = artifactBaseName(artifact);
                  }
                  edited('outputs.' + index + '.fromStage');
                }), 'outputs.' + index + '.fromStage'),
                field('Artifact', selectControl(output.artifact, 'outputs.' + index + '.artifact', outputArtifactOptions(output), (next) => {
                  output.artifact = next;
                  if (output.name === '') output.name = artifactBaseName(next);
                  edited('outputs.' + index + '.artifact');
                }), 'outputs.' + index + '.artifact', 'Must match the source stage\'s produces.artifact.'),
              ]),
            ],
          }),
        );
      });
      return ui.section('Outputs', {
        note: 'Artifacts the workflow publishes and the stage each one comes from.',
        actions: [
          action('Add output', 'secondary', () => {
            form.outputs.push({ name: '', fromStage: '', artifact: '' });
            edited('outputs.' + (form.outputs.length - 1) + '.fromStage');
          }, isFormReadOnly()),
        ],
        children,
      });
    }

    function renderDownstream() {
      const form = getForm();
      const children = [];
      if (form.downstream.length === 0) children.push(el('p', 'No downstream suggestions.', 'mg-empty'));
      form.downstream.forEach((target, index) => {
        target.artifacts = target.artifacts || [];
        children.push(
          ui.group('Suggestion ' + (index + 1), undefined, {
            card: true,
            actions: [
              action('Remove suggestion', 'quiet', () => {
                form.downstream.splice(index, 1);
                edited('downstream');
              }, isFormReadOnly()),
            ],
            children: [
              ui.grid([
                field('Workflow', selectControl(target.workflow, 'downstream.' + index + '.workflow', workflowOptions(target.workflow), (next) => {
                  target.workflow = next;
                }), 'downstream.' + index + '.workflow'),
                field('Task', textControl(target.task, 'downstream.' + index + '.task', (next) => {
                  target.task = next;
                }, { placeholder: 'Implement the approved draft.' }), 'downstream.' + index + '.task', undefined, true),
              ]),
              pairList(
                target.artifacts,
                'downstream.' + index + '.artifacts',
                'Artifacts',
                'destination key',
                'output name',
                outputNameOptions,
                undefined,
                'Add artifact',
              ),
            ],
          }),
        );
      });
      return ui.section('Downstream', {
        note: 'Workflows the reader is offered after this one completes.',
        actions: [
          action('Add suggestion', 'secondary', () => {
            form.downstream.push({ workflow: '', task: '', artifacts: [] });
            edited('downstream.' + (form.downstream.length - 1) + '.workflow');
          }, isFormReadOnly()),
        ],
        children,
      });
    }

    function datalists() {
      const holder = el('div');
      const names = getForm().outputs.flatMap((output) => [
        output.name,
        output.artifact === '' ? '' : artifactBaseName(output.artifact),
      ]);
      holder.append(ui.datalist('wf-output-names', uniqueValues(names)));
      holder.append(ui.datalist('wf-efforts', EFFORT_SUGGESTIONS));
      getForm().stages.forEach((stage, index) => {
        holder.append(
          ui.datalist('wf-option-keys-' + index, optionKeySuggestions(stage.agent.clientType)),
        );
      });
      return holder;
    }

    /** The whole Design view: datalists, Basics, Stages, Outputs and Downstream. */
    function render() {
      const nodes = [datalists(), renderBasics()];
      nodes.push(renderStages(), renderOutputs(), renderDownstream());
      return nodes;
    }

    /**
     * Apply a pair chosen in the host's model picker. The page owns the draft, so the host only reports the choice
     * and this writes it; an unknown stage or a read-only form keeps the draft unchanged.
     */
    function applyModelPick(index, client, model) {
      const stage = getForm().stages[index];
      if (isFormReadOnly() || !stage || stage.agentMode !== 'inline' || !stage.agent) return false;
      if (typeof client !== 'string' || client === '' || typeof model !== 'string' || model === '') return false;
      stage.agent.clientType = client;
      stage.agent.model = model;
      edited('stages.' + index + '.agent.model');
      return true;
    }

    return { render, isReadOnly: isFormReadOnly, applyModelPick };
  }

  window.MigentWorkflowForm = { create, emptyForm, normalizeForm };
})();
