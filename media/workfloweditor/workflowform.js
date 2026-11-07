// Workflow form: the Design view's controls, separated from the editor page so another page can reuse them.
// It renders sections of controls over a draft it does not own; the data shape and pure draft operations live in
// workflowmodel.js.
// The host page supplies the model, the draft, validation issues and two callbacks (see `create`).
// Every string is set with textContent. Needs media/shared/page.js, media/shared/form.js and workflowmodel.js loaded first (see docs/ui.md).
(function () {
  'use strict';

  const { el, details } = window.MigentPage;
  const ui = window.MigentForm;
  const ops = window.MigentWorkflowModel;
  const { emptyStage, emptyForm, normalizeForm, uniqueValues, artifactBaseName, agentModelLabel } = ops;

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

    /**
     * A structural edit from a click: drop stale diagnostics through `onEdit`, then rebuild and refocus. A value
     * edit that also rebuilds calls `repaint` alone, because the form root reports the edit.
     */
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

    function stagePath(index, key) {
      return 'stages.' + index + '.' + key;
    }

    const roleOptions = (current) => ops.roleOptions(getModel(), current);
    const agentNameOptions = (current) => ops.agentNameOptions(getModel(), current);
    const clientChoices = () => ops.clientChoices(getModel());
    const optionKeySuggestions = (clientName) => ops.optionKeySuggestions(getModel(), clientName);
    const isKnownModel = (clientName, modelName) => ops.isKnownModel(getModel(), clientName, modelName);
    const resumeOptions = (stage, current) => ops.resumeOptions(getForm(), stage, current);
    const outputStageOptions = (current) => ops.outputStageOptions(getForm(), current);
    const outputArtifactOptions = (output) => ops.outputArtifactOptions(getForm(), output);
    const outputNameOptions = (current) => ops.outputNameOptions(getForm(), current);
    const workflowOptions = (current) => ops.workflowOptions(getModel(), current);
    const stageIds = () => ops.stageIds(getForm());

    function moveStage(index, delta) {
      const target = ops.moveStage(getForm(), index, delta);
      if (target >= 0) edited('stages.' + target + '.id');
    }

    function removeStage(index) {
      ops.removeStage(getForm(), index);
      edited('stages.' + Math.max(0, index - 1) + '.id');
    }

    function stageChips(stage) {
      const chips = [el('span', stage.role || 'verify only', 'mg-chip')];
      chips.push(el('span', agentSummary(stage), stage.agentMode === 'inline' ? 'mg-chip mg-chip--info' : 'mg-chip'));
      if (stage.dependsOn.length > 0) {
        const depends = el('span', 'needs ' + stage.dependsOn.join(', '), 'mg-chip');
        depends.title = 'Depends on ' + stage.dependsOn.join(', ');
        chips.push(depends);
      }
      const duplicate = stage.id !== '' && getForm().stages.filter((candidate) => candidate.id === stage.id).length > 1;
      if (duplicate) chips.push(el('span', 'duplicate id', 'mg-chip mg-chip--warn'));
      return chips;
    }

    function stageTools(index) {
      const total = getForm().stages.length;
      const tools = el('div', null, 'mg-collapsible-tools');
      tools.append(
        action('Move up', 'quiet', () => moveStage(index, -1), isFormReadOnly() || index === 0),
        action('Move down', 'quiet', () => moveStage(index, 1), isFormReadOnly() || index === total - 1),
      );
      const remove = action('Remove stage', 'quiet', () => removeStage(index), isFormReadOnly());
      remove.classList.add('mg-collapsible-tool-remove');
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
        ops.renameStageReferences(getForm(), originalId, next);
        repaint(stagePath(index, 'id'));
      });
      const producesControl = textControl(stage.producesArtifact, stagePath(index, 'producesArtifact'), (next) => {
        stage.producesArtifact = next;
      }, { placeholder: 'stage.md' });
      producesControl.addEventListener('change', () => repaint(stagePath(index, 'producesArtifact')));
      const fields = [
        field('ID', idControl, stagePath(index, 'id'), 'Other stages and outputs refer to this id.'),
        field('Description', textControl(stage.description, stagePath(index, 'description'), (next) => {
          stage.description = next;
        }, { placeholder: 'What this stage covers' }), stagePath(index, 'description'), undefined, true),
        field('Role', selectControl(stage.role, stagePath(index, 'role'), roleOptions(stage.role), (next) => {
          stage.role = next;
          repaint(stagePath(index, 'role'));
        }), stagePath(index, 'role'), 'The role supplies the agent unless it is overridden.'),
        field('Agent', selectControl(stage.agentMode, stagePath(index, 'agentMode'), AGENT_MODES, (next) => {
          stage.agentMode = next;
          repaint(stagePath(index, 'agentMode'));
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
          if (!checked && stage.sessionResumeFrom === id) stage.sessionResumeFrom = '';
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
        repaint(path);
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
      const box = ui.collapsibleCard({
        key: 'stage:' + index,
        number: index + 1,
        title: stageLabel(stage, index),
        warn: !stage.id,
        chips: stageChips(stage),
        open: index === 0,
        body: [
          stageTools(index),
          identityGroup(stage, index),
          ...(stage.agentMode === 'inline' ? [inlineAgentEditor(stage, index)] : []),
          dependenciesGroup(stage, index),
          instructionsGroup(stage, index),
          decisionsGroup(stage, index),
          stageAdvanced(stage, index),
        ],
      });
      box.id = 'stage-' + index;
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
                  repaint('outputs.' + index + '.fromStage');
                }), 'outputs.' + index + '.fromStage'),
                field('Artifact', selectControl(output.artifact, 'outputs.' + index + '.artifact', outputArtifactOptions(output), (next) => {
                  output.artifact = next;
                  if (output.name === '') output.name = artifactBaseName(next);
                  repaint('outputs.' + index + '.artifact');
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

    /**
     * The whole Design view: datalists, Basics, Stages, Outputs and Downstream, inside one form root that reports
     * every value edit through `onEdit`.
     */
    function render() {
      const nodes = [datalists(), renderBasics(), renderStages(), renderOutputs(), renderDownstream()];
      return [ui.root(nodes, { onEdit })];
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
