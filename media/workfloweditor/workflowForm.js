// Workflow form: the Design view's controls, separated from the editor page so another page can reuse them.
// It renders sections of controls over a draft it does not own; the data shape and pure draft operations live in
// workflowModel.js.
// The host page supplies the model, the draft, validation issues and two callbacks (see `create`).
// Every string is set with textContent. Needs the UI kit in media/shared and workflowModel.js loaded first (see docs/ui.md).
(function () {
  'use strict';

  const ui = window.MigentUi;
  const { el, details } = ui;
  const copy = window.MigentCopy;
  const text = window.MigentWorkflowCopy;
  const ops = window.MigentWorkflowModel;
  const agents = window.MigentAgentForm;
  const { emptyStage, emptyForm, normalizeForm, uniqueValues } = ops;

  const ASK_OPTIONS = [
    { value: '', label: text.identity.ask.options.none },
    { value: 'human', label: text.identity.ask.options.human },
  ];

  const AGENT_MODES = [
    { value: 'role', label: text.identity.agent.modes.role },
    { value: 'named', label: text.identity.agent.modes.named },
    { value: 'inline', label: text.identity.agent.modes.inline },
  ];

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

    // The collapsible cards of the last render. A value edit does not rebuild the form, so after each one the card
    // headers are redrawn from the draft: a title, a summary or a problem count never lags behind the controls.
    let cards = [];
    const track = (card) => {
      cards.push(card);
      return card;
    };
    function refreshHeaders() {
      for (const card of cards) card.refresh();
    }

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

    /**
     * The first issue that belongs to a field path. An issue sits on one control: the one its path names. A group
     * of controls (a fieldset, whose path is a parent of its items) shows the issue of an item inside it.
     */
    function issueFor(path) {
      const all = [...issues('errors'), ...issues('warnings')];
      return all.find((issue) => {
        const own = ops.formPathOf(getForm(), issue.path);
        return own === path || own.startsWith(path + '.');
      });
    }

    /** The issue in the shape the shared form kit renders, or null. */
    function issueOf(path) {
      const issue = issueFor(path);
      if (!issue) return null;
      return { message: issue.message, warning: issues('warnings').includes(issue) };
    }

    // ---------- form controls ----------

    function textList(options) {
      return ui.stringList({
        values: options.values,
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

    function checkList(options) {
      const { available, selected, path, onToggle, unknownValues } = options;
      const items = available.map((value) => ({
        value,
        label: value,
        unknown: Boolean(unknownValues && unknownValues.includes(value)),
        title: unknownValues && unknownValues.includes(value) ? text.dependencies.dependsOn.unknown(value) : '',
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

    // ---------- sections ----------

    function renderBasics() {
      const form = getForm();
      return ui.section(text.basics.title, {
        note: text.basics.note,
        surface: true,
        children: [
          ui.grid([
            ui.field({
              label: text.basics.id.label,
              control: ui.text({
                value: form.id,
                path: 'id',
                placeholder: text.basics.id.placeholder,
                disabled: isFormReadOnly(),
                onInput: (next) => {
                    form.id = next;
                  },
              }),
              path: 'id',
              hint: text.basics.id.hint,
              issue: issueOf('id'),
            }),
            ui.field({
              label: text.basics.concurrency.label,
              control: ui.number({
                value: form.concurrency,
                path: 'concurrency',
                placeholder: text.basics.concurrency.placeholder,
                disabled: isFormReadOnly(),
                onInput: (next) => {
                    form.concurrency = next;
                  },
              }),
              path: 'concurrency',
              hint: text.basics.concurrency.hint,
              issue: issueOf('concurrency'),
            }),
          ]),
          textList({
            values: form.constraints,
            path: 'constraints',
            label: text.basics.constraints.label,
            placeholder: text.basics.constraints.placeholder,
            addLabel: text.basics.constraints.add,
            itemLabel: text.basics.constraints.item,
          }),
        ],
      });
    }

    function stageLabel(stage, index) {
      return stage.id ? stage.id : text.stages.untitled(index + 1);
    }

    function renderStages() {
      const form = getForm();
      const count = String(form.stages.length);
      const children = [];
      form.stages.forEach((stage, index) => children.push(renderStage(stage, index)));
      children.push(
        ui.addBlockButton(text.stages.add, { onClick: () => {
          form.stages.push(emptyStage());
          edited('stages.' + (form.stages.length - 1) + '.id');
        }, disabled: isFormReadOnly(), empty: form.stages.length === 0 ? text.stages.empty : undefined }),
      );
      return ui.section(text.stages.title, {
        note: text.stages.note,
        count,
        children,
      });
    }

    function stagePath(index, key) {
      return 'stages.' + index + '.' + key;
    }

    const roleOptions = (current) => ops.roleOptions(getModel(), current);
    const agentNameOptions = (current) => ops.agentNameOptions(getModel(), current);
    const resumeOptions = (stage, current) => ops.resumeOptions(getForm(), stage, current);
    const artifactIdOptions = (current) => ops.artifactIdOptions(getForm(), current);
    const workflowOptions = (current) => ops.workflowOptions(getModel(), current);
    const stageIds = () => ops.stageIds(getForm());

    /**
     * Move a stage and keep the focus on the button that was pressed, on the stage's new place (the opposite one
     * when that button ends up disabled at the edge of the list). The card is not opened: the buttons are in its
     * header, so the order can be changed on closed cards.
     */
    function moveStage(index, delta) {
      const target = ops.moveStage(getForm(), index, delta);
      if (target < 0) return;
      const last = getForm().stages.length - 1;
      const same = delta < 0 ? 'up' : 'down';
      const blocked = delta < 0 ? target === 0 : target === last;
      const direction = blocked ? (same === 'up' ? 'down' : 'up') : same;
      edited('stages.' + target + '.move-' + direction);
    }

    /**
     * The icon buttons of an item card in a list (`artifacts`, `downstream`): move up, move down and remove. They
     * work like a stage's: the order changes on closed cards and the focus stays on the pressed button, on the
     * item's new place.
     */
    function listTools(listKey, label, index, onRemove) {
      const list = getForm()[listKey];
      const move = (delta) => {
        const target = ops.moveItem(list, index, delta);
        if (target < 0) return;
        const blocked = delta < 0 ? target === 0 : target === list.length - 1;
        const direction = (delta < 0) !== blocked ? 'up' : 'down';
        edited(listKey + '.' + target + '.move-' + direction);
      };
      return [
        ui.iconButton(text.stages.move(label, index + 1, 'up'), { icon: 'arrow-up', onClick: () => move(-1), disabled: isFormReadOnly() || index === 0, path: listKey + '.' + index + '.move-up' }),
        ui.iconButton(text.stages.move(label, index + 1, 'down'), { icon: 'arrow-down', onClick: () => move(1), disabled: isFormReadOnly() || index === list.length - 1, path: listKey + '.' + index + '.move-down' }),
        ui.removeButton(copy.remove(label, index + 1), { onClick: onRemove, disabled: isFormReadOnly() }),
      ];
    }

    /** Remove a stage and put the focus on the header of its neighbour, which stays as it was. */
    function removeStage(index) {
      ops.removeStage(getForm(), index);
      edited('stages.' + Math.max(0, index - 1) + '.card');
    }

    /** The errors that belong to a stage (its own controls, decisions and artifact lists), however far inside. */
    function stageErrorCount(index) {
      const prefix = 'stages.' + index + '.';
      return issues('errors').filter((issue) => ops.formPathOf(getForm(), issue.path).startsWith(prefix)).length;
    }

    /** The errors under a path prefix such as `artifacts.2.`, however far inside. */
    function errorCount(prefix) {
      return issues('errors').filter((issue) => ops.formPathOf(getForm(), issue.path).startsWith(prefix)).length;
    }

    /** The warning chips of a card header: the only framed items there, so a problem is what stands out. */
    function alertChips(errors, extra) {
      const chips = [];
      if (extra) chips.push(ui.chip(extra, { tone: 'warn' }));
      if (errors > 0) chips.push(ui.chip(text.stages.problems(errors), { tone: 'warn' }));
      return chips;
    }

    function artifactSummary(item) {
      return [item.file, item.required === null ? '' : item.required ? text.artifacts.summary.required : text.artifacts.summary.optional];
    }

    function downstreamSummary(target) {
      return [target.task, target.artifacts === null ? text.downstream.summary.all : text.downstream.summary.mapped(target.artifacts.length)];
    }

    /**
     * The quiet line beside a stage's title, most useful first: role, an agent that is not the role's own, what the
     * stage needs and how many decisions it makes. What every stage has (the role's agent) or what the body shows at
     * a glance (instructions) is left out.
     */
    function stageSummary(stage) {
      const decisions = (stage.decision || []).length;
      return [
        stage.role || text.stages.summary.verifyOnly,
        stage.agentMode === 'role' ? '' : agentSummary(stage),
        stage.depends_on.length > 0 ? text.stages.summary.needs(stage.depends_on.join(', ')) : '',
        decisions > 0 ? text.stages.summary.decisions(decisions) : '',
      ];
    }

    function stageAlerts(stage, index) {
      const duplicate = stage.id !== '' && getForm().stages.filter((candidate) => candidate.id === stage.id).length > 1;
      return alertChips(stageErrorCount(index), duplicate ? text.stages.duplicateId : '');
    }

    /** The icon buttons in a stage's header: move up, move down and remove. */
    function stageTools(index) {
      const total = getForm().stages.length;
      return [
        ui.iconButton(text.stages.move('stage', index + 1, 'up'), { icon: 'arrow-up', onClick: () => moveStage(index, -1), disabled: isFormReadOnly() || index === 0, path: stagePath(index, 'move-up') }),
        ui.iconButton(text.stages.move('stage', index + 1, 'down'), { icon: 'arrow-down', onClick: () => moveStage(index, 1), disabled: isFormReadOnly() || index === total - 1, path: stagePath(index, 'move-down') }),
        ui.removeButton(copy.remove('stage', index + 1), { onClick: () => removeStage(index), disabled: isFormReadOnly() }),
      ];
    }

    function identityGroup(stage, index) {
      const originalId = stage.id;
      const idControl = ui.text({
        value: stage.id,
        path: stagePath(index, 'id'),
        placeholder: text.identity.id.placeholder,
        disabled: isFormReadOnly(),
        onInput: (next) => {
          stage.id = next;
        },
      });
      idControl.addEventListener('change', () => {
        const next = idControl.value.trim();
        if (next !== idControl.value) idControl.value = next;
        stage.id = next;
        ops.renameStageReferences(getForm(), originalId, next);
        repaint(stagePath(index, 'id'));
      });
      const fields = [
        ui.field({
          label: text.identity.id.label,
          control: idControl,
          path: stagePath(index, 'id'),
          hint: text.identity.id.hint,
          issue: issueOf(stagePath(index, 'id')),
        }),
        ui.field({
          label: text.identity.description.label,
          control: ui.text({
            value: stage.description,
            path: stagePath(index, 'description'),
            placeholder: text.identity.description.placeholder,
            disabled: isFormReadOnly(),
            onInput: (next) => {
              stage.description = next;
            },
          }),
          path: stagePath(index, 'description'),
          wide: true,
          issue: issueOf(stagePath(index, 'description')),
        }),
        ui.field({
          label: text.identity.role.label,
          control: ui.select({
            value: stage.role,
            path: stagePath(index, 'role'),
            options: roleOptions(stage.role),
            disabled: isFormReadOnly(),
            onInput: (next) => {
              stage.role = next;
              repaint(stagePath(index, 'role'));
            },
          }),
          path: stagePath(index, 'role'),
          hint: text.identity.role.hint,
          issue: issueOf(stagePath(index, 'role')),
        }),
        ui.field({
          label: text.identity.agent.label,
          control: ui.select({
            value: stage.agentMode,
            path: stagePath(index, 'agentMode'),
            options: AGENT_MODES,
            disabled: isFormReadOnly(),
            onInput: (next) => {
              stage.agentMode = next;
              repaint(stagePath(index, 'agentMode'));
            },
          }),
          path: stagePath(index, 'agentMode'),
          hint: text.identity.agent.hint,
          issue: issueOf(stagePath(index, 'agentMode')),
        }),
      ];
      if (stage.agentMode === 'named') {
        fields.push(
          ui.field({
            label: text.identity.agentName.label,
            control: ui.select({
              value: stage.agentName,
              path: stagePath(index, 'agentName'),
              options: agentNameOptions(stage.agentName),
              disabled: isFormReadOnly(),
              onInput: (next) => {
                stage.agentName = next;
              },
            }),
            path: stagePath(index, 'agentName'),
            hint: text.identity.agentName.hint,
            issue: issueOf(stagePath(index, 'agentName')),
          }),
        );
      }
      fields.push(
        ui.field({
          label: text.identity.ask.label,
          control: ui.select({
            value: stage.ask,
            path: stagePath(index, 'ask'),
            options: ASK_OPTIONS,
            disabled: isFormReadOnly(),
            onInput: (next) => {
              stage.ask = next;
            },
          }),
          path: stagePath(index, 'ask'),
          hint: text.identity.ask.hint,
          issue: issueOf(stagePath(index, 'ask')),
        }),
        ui.field({
          label: text.identity.maxRevisions.label,
          control: ui.number({
            value: stage.max_revisions,
            path: stagePath(index, 'max_revisions'),
            disabled: isFormReadOnly(),
            onInput: (next) => {
              stage.max_revisions = next;
            },
          }),
          path: stagePath(index, 'max_revisions'),
          hint: text.identity.maxRevisions.hint,
          issue: issueOf(stagePath(index, 'max_revisions')),
        }),
      );
      return ui.group(text.identity.title, { note: text.identity.note, children: [ui.grid(fields)] });
    }

    function agentSummary(stage) {
      if (stage.agentMode === 'named') return text.stages.summary.agentNamed(stage.agentName);
      if (stage.agentMode === 'inline') return text.stages.summary.agentInline;
      return text.stages.summary.agentRole;
    }

    function inlineAgentEditor(stage, index) {
      return agents.inlineEditor({
        agent: stage.agent,
        path: stagePath(index, 'agent'),
        title: text.inlineAgent.title,
        note: text.inlineAgent.note,
        unknownHint: text.inlineAgent.modelHint.unknown,
        model: getModel(),
        issueOf,
        disabled: isFormReadOnly(),
        onPick: () => {
          if (typeof pickModel === 'function') pickModel(index);
        },
        onEdit,
        repaint,
        optionKeysId: 'wf-option-keys-' + index,
      });
    }

    function dependsOnEditor(stage, index) {
      const form = getForm();
      const available = [];
      for (const candidate of form.stages) {
        if (candidate === stage || !candidate.id || available.includes(candidate.id)) continue;
        available.push(candidate.id);
      }
      const unknown = stage.depends_on.filter((id) => !available.includes(id) && id !== stage.id);
      const content = [
        checkList({
          available: [...available, ...unknown],
          selected: stage.depends_on,
          path: 'stages.' + index + '.depends_on',
          onToggle: (id, checked) => {
            if (checked && !stage.depends_on.includes(id)) stage.depends_on.push(id);
            if (!checked) stage.depends_on = stage.depends_on.filter((value) => value !== id);
            if (!checked && stage.sessionResumeFrom === id) stage.sessionResumeFrom = '';
          },
          unknownValues: unknown,
        }),
      ];
      if (form.stages.length < 2) {
        return ui.fieldset(text.dependencies.dependsOn.label, { children: content, hint: text.dependencies.dependsOn.hintNoOthers });
      }
      return ui.fieldset(text.dependencies.dependsOn.label, { children: content });
    }

    /** Registry ids this stage writes on every completion. Ids the registry lacks stay visible and flagged. */
    function artifactsGroup(stage, index) {
      const registry = uniqueValues(getForm().artifacts.map((item) => item.id));
      const unknown = stage.artifacts.filter((id) => !registry.includes(id));
      const children = [];
      if (registry.length === 0 && unknown.length === 0) {
        children.push(ui.empty(text.stageArtifacts.empty));
      } else {
        children.push(
          ui.fieldset(text.stageArtifacts.writes, { children: [
            checkList({
              available: [...registry, ...unknown],
              selected: stage.artifacts,
              path: stagePath(index, 'artifacts'),
              onToggle: (id, checked) => {
                if (checked && !stage.artifacts.includes(id)) stage.artifacts.push(id);
                if (!checked) stage.artifacts = stage.artifacts.filter((value) => value !== id);
              },
              unknownValues: unknown,
            }),
          ], path: stagePath(index, 'artifacts'), issue: issueOf(stagePath(index, 'artifacts')) }),
        );
      }
      return ui.group(text.stageArtifacts.title, { note: text.stageArtifacts.note, children });
    }

    function dependenciesGroup(stage, index) {
      return ui.group(text.dependencies.title, { note: text.dependencies.note, children: [
          dependsOnEditor(stage, index),
          ui.grid([
            ui.field({
              label: text.dependencies.resumeFrom.label,
              control: ui.select({
                value: stage.sessionResumeFrom,
                path: stagePath(index, 'sessionResumeFrom'),
                options: resumeOptions(stage, stage.sessionResumeFrom),
                disabled: isFormReadOnly(),
                onInput: (next) => {
                  stage.sessionResumeFrom = next;
                },
              }),
              path: stagePath(index, 'sessionResumeFrom'),
              hint: text.dependencies.resumeFrom.hint,
              issue: issueOf(stagePath(index, 'sessionResumeFrom')),
            }),
          ]),
        ] });
    }

    function instructionsGroup(stage, index) {
      return ui.group(text.instructions.title, { note: text.instructions.note, children: [
          textList({
            values: stage.instructions,
            path: stagePath(index, 'instructions'),
            label: '',
            placeholder: text.instructions.placeholder,
            addLabel: text.instructions.add,
            itemLabel: text.instructions.item,
            multiline: true,
          }),
        ] });
    }

    /** One destination per decision: complete or another stage, never the stage itself. */
    function navigationEditor(route, path, stageId) {
      const current = route.navigate;
      const destinations = uniqueValues([
        'complete',
        ...stageIds().filter((id) => id !== '' && id !== stageId),
      ]);
      const known = current === '' || destinations.includes(current);
      const choices = [{ value: '', label: text.decisions.navigate.choose }];
      for (const value of destinations) choices.push({ value, label: value });
      if (!known) choices.push({ value: current, label: navigationLabel(current, stageId) });
      const control = ui.select({
        value: current,
        path,
        options: choices,
        disabled: isFormReadOnly(),
        onInput: (next) => {
          route.navigate = next;
          repaint(path);
        },
      });
      const hint =
        current === ''
          ? text.decisions.navigate.needsOne
          : known
            ? text.decisions.navigate.allowed
            : navigationProblem(current, stageId);
      const wrap = ui.fieldset(text.decisions.navigate.label, { children: [control], path,
        hint,
        hintWarning: !known || current === '',
        issue: issueOf(path) });
      return wrap;
    }

    /** An imported value the editor cannot offer stays visible instead of being rewritten. */
    function navigationLabel(value, stageId) {
      if (value === stageId) return text.decisions.navigate.option.self(value);
      if (value.includes(',')) return text.decisions.navigate.option.several(value);
      return text.decisions.navigate.option.unknown(value);
    }

    function navigationProblem(value, stageId) {
      if (value === stageId) return text.decisions.navigate.problem.self;
      if (value.includes(',')) return text.decisions.navigate.problem.several;
      return text.decisions.navigate.problem.unknown;
    }

    /**
     * A route's artifacts keep the shape the file used: registry ids, or decision-local definitions. The two
     * shapes are not converted into each other; switching discards the other shape's rows.
     */
    function routeArtifactsEditor(route, base) {
      const path = base + '.artifacts';
      const shape = route.artifacts ? route.artifacts.kind : 'none';
      const wrap = el('div', null, 'wf-route-artifacts');
      wrap.append(
        ui.field({
          label: text.decisions.artifacts.label,
          control: ui.select({
            value: shape,
            path: path + '.kind',
            options: [
              { value: 'none', label: text.decisions.artifacts.none },
              { value: 'ids', label: text.decisions.artifacts.registry },
              { value: 'local', label: text.decisions.artifacts.local },
            ],
            disabled: isFormReadOnly(),
            onInput: (next) => {
              if (next === 'ids') route.artifacts = { kind: 'ids', ids: [] };
              else if (next === 'local') route.artifacts = { kind: 'local', items: [] };
              else route.artifacts = null;
              repaint(path + '.kind');
            },
          }),
          path: path + '.kind',
          hint: text.decisions.artifacts.hint,
          issue: issueOf(path + '.kind'),
        }),
      );
      if (shape === 'ids') {
        const registry = uniqueValues(getForm().artifacts.map((item) => item.id));
        const unknown = route.artifacts.ids.filter((id) => !registry.includes(id));
        wrap.append(
          ui.fieldset(text.stageArtifacts.writes, { children: [
            checkList({
              available: [...registry, ...unknown],
              selected: route.artifacts.ids,
              path: path + '.ids',
              onToggle: (id, checked) => {
                const ids = route.artifacts.ids;
                if (checked && !ids.includes(id)) ids.push(id);
                if (!checked) route.artifacts.ids = ids.filter((value) => value !== id);
              },
              unknownValues: unknown,
            }),
          ], path: path + '.ids', issue: issueOf(path + '.ids') }),
        );
      } else if (shape === 'local') {
        route.artifacts.items.forEach((item, itemIndex) => {
          const itemPath = path + '.' + itemIndex;
          wrap.append(
            ui.group(text.decisions.artifacts.heading(itemIndex + 1), { card: true,
              actions: [
                ui.removeButton(copy.remove('artifact', itemIndex + 1), {
                  onClick: () => {
                    route.artifacts.items.splice(itemIndex, 1);
                    edited(path);
                  },
                  disabled: isFormReadOnly(),
                }),
              ],
              children: [
                ui.grid([
                  ui.field({
                    label: text.artifactFields.id.label,
                    control: ui.text({
                      value: item.id,
                      path: itemPath + '.id',
                      placeholder: text.artifactFields.id.placeholder,
                      disabled: isFormReadOnly(),
                      onInput: (next) => {
                        item.id = next;
                      },
                    }),
                    path: itemPath + '.id',
                    issue: issueOf(itemPath + '.id'),
                  }),
                  ui.field({
                    label: text.artifactFields.file.label,
                    control: ui.text({
                      value: item.file,
                      path: itemPath + '.file',
                      placeholder: text.artifactFields.file.placeholder,
                      disabled: isFormReadOnly(),
                      onInput: (next) => {
                        item.file = next;
                      },
                    }),
                    path: itemPath + '.file',
                    issue: issueOf(itemPath + '.file'),
                  }),
                  ui.field({
                    label: text.artifactFields.description.label,
                    control: ui.text({
                      value: item.description,
                      path: itemPath + '.description',
                      placeholder: text.artifactFields.description.placeholder,
                      disabled: isFormReadOnly(),
                      onInput: (next) => {
                        item.description = next;
                      },
                    }),
                    path: itemPath + '.description',
                    wide: true,
                    issue: issueOf(itemPath + '.description'),
                  }),
                ]),
              ] }),
          );
        });
        wrap.append(
          ui.addButton(text.decisions.artifacts.add, { onClick: () => {
            route.artifacts.items.push({ id: '', file: '', description: '' });
            edited(path + '.' + (route.artifacts.items.length - 1) + '.id');
          }, disabled: isFormReadOnly() }),
        );
      }
      return wrap;
    }

    function decisionEditor(stage, index) {
      const wrap = el('div', null, 'wf-decision-list');
      (stage.decision || []).forEach((route, routeIndex) => {
        const base = stagePath(index, 'decision') + '.' + routeIndex;
        wrap.append(
          ui.section(text.decisions.heading(routeIndex + 1), {
            level: 3,
            variant: 'card',
            accent: true,
            actions: [
              ui.removeButton(copy.remove('decision', routeIndex + 1), { onClick: () => {
                  stage.decision.splice(routeIndex, 1);
                  edited(stagePath(index, 'decision'));
                }, disabled: isFormReadOnly() }),
            ],
            children: [
              ui.grid([
                ui.field({
                  label: text.decisions.decision.label,
                  control: ui.text({
                    value: route.value,
                    path: base + '.value',
                    placeholder: text.decisions.decision.placeholder,
                    disabled: isFormReadOnly(),
                    onInput: (next) => {
                      route.value = next;
                    },
                  }),
                  path: base + '.value',
                  issue: issueOf(base + '.value'),
                }),
                navigationEditor(route, base + '.navigate', stage.id),
              ]),
              ui.grid([
                ui.field({
                  label: text.decisions.when.label,
                  control: ui.text({
                    value: route.when,
                    path: base + '.when',
                    placeholder: text.decisions.when.placeholder,
                    disabled: isFormReadOnly(),
                    onInput: (next) => {
                      route.when = next;
                    },
                  }),
                  path: base + '.when',
                  wide: true,
                  issue: issueOf(base + '.when'),
                }),
              ]),
              routeArtifactsEditor(route, base),
            ],
          }),
        );
      });
      wrap.append(
        ui.addButton(text.decisions.add, { onClick: () => {
          stage.decision = stage.decision || [];
          stage.decision.push({ value: '', when: '', navigate: '', artifacts: null });
          edited(stagePath(index, 'decision') + '.' + (stage.decision.length - 1) + '.value');
        }, disabled: isFormReadOnly() }),
      );
      return wrap;
    }

    function decisionsGroup(stage, index) {
      return ui.group(text.decisions.title, { note: text.decisions.note, children: [decisionEditor(stage, index)] });
    }

    function stageAdvanced(stage, index) {
      const facts = [];
      if (stage.verify.length > 0) facts.push(text.stages.advancedFacts.verifyCommands(stage.verify.length));
      if (stage.runWhenPaths.length > 0) facts.push(text.stages.advancedFacts.pathFilters(stage.runWhenPaths.length));
      const heading = el('span', text.advanced.title);
      if (facts.length > 0) heading.append(el('span', facts.join(', '), 'mg-summary'));
      const advanced = details(heading, { key: 'stage:' + index + ':advanced', className: 'wf-advanced' });
      const body = el('div', null, 'wf-advanced-body mg-stack');
      body.append(
        ui.grid([
          ui.field({
            label: text.advanced.verifyTimeout.label,
            control: ui.number({
              value: stage.verify_timeout,
              path: stagePath(index, 'verify_timeout'),
              placeholder: text.advanced.verifyTimeout.placeholder,
              disabled: isFormReadOnly(),
              onInput: (next) => {
                stage.verify_timeout = next;
              },
            }),
            path: stagePath(index, 'verify_timeout'),
            hint: text.advanced.verifyTimeout.hint,
            issue: issueOf(stagePath(index, 'verify_timeout')),
          }),
          ui.field({
            label: text.advanced.maxVerify.label,
            control: ui.number({
              value: stage.max_verify,
              path: stagePath(index, 'max_verify'),
              placeholder: text.advanced.maxVerify.placeholder,
              disabled: isFormReadOnly(),
              onInput: (next) => {
                stage.max_verify = next;
              },
            }),
            path: stagePath(index, 'max_verify'),
            hint: text.advanced.maxVerify.hint,
            issue: issueOf(stagePath(index, 'max_verify')),
          }),
        ]),
      );
      body.append(
        textList({
          values: stage.verify,
          path: stagePath(index, 'verify'),
          label: text.advanced.verifyCommands.label,
          placeholder: text.advanced.verifyCommands.placeholder,
          addLabel: text.advanced.verifyCommands.add,
          itemLabel: text.advanced.verifyCommands.item,
        }),
      );
      body.append(
        textList({
          values: stage.runWhenPaths,
          path: stagePath(index, 'runWhenPaths'),
          label: text.advanced.runWhenPaths.label,
          placeholder: text.advanced.runWhenPaths.placeholder,
          addLabel: text.advanced.runWhenPaths.add,
          itemLabel: text.advanced.runWhenPaths.item,
        }),
      );
      advanced.append(body);
      return advanced;
    }

    function renderStage(stage, index) {
      const describe = () => ({
        title: stageLabel(stage, index),
        warn: !stage.id || stageErrorCount(index) > 0,
        summary: stageSummary(stage),
        alerts: stageAlerts(stage, index),
      });
      const box = track(ui.collapsibleCard({
        key: 'stage:' + index,
        number: index + 1,
        path: stagePath(index, 'card'),
        ...describe(),
        describe,
        tools: stageTools(index),
        body: [
          identityGroup(stage, index),
          ...(stage.agentMode === 'inline' ? [inlineAgentEditor(stage, index)] : []),
          artifactsGroup(stage, index),
          dependenciesGroup(stage, index),
          instructionsGroup(stage, index),
          decisionsGroup(stage, index),
          stageAdvanced(stage, index),
        ],
      }));
      box.id = 'stage-' + index;
      return box;
    }

    function renderArtifacts() {
      const form = getForm();
      const children = [];
        form.artifacts.forEach((item, index) => {
        const base = 'artifacts.' + index;
        const originalId = item.id;
        const idControl = ui.text({
          value: item.id,
          path: base + '.id',
          placeholder: text.artifacts.id.placeholder,
          disabled: isFormReadOnly(),
          onInput: (next) => {
            item.id = next;
          },
        });
        idControl.addEventListener('change', () => {
          const next = idControl.value.trim();
          if (next !== idControl.value) idControl.value = next;
          item.id = next;
          ops.renameArtifactReferences(getForm(), originalId, next);
          repaint(base + '.id');
        });
        const describe = () => ({
          title: item.id || text.artifacts.heading(index + 1),
          warn: errorCount('artifacts.' + index + '.') > 0,
          summary: artifactSummary(item),
          alerts: alertChips(errorCount('artifacts.' + index + '.')),
        });
        children.push(
          track(ui.collapsibleCard({
            key: 'artifact:' + index,
            number: index + 1,
            ...describe(),
            describe,
            tools: listTools('artifacts', 'artifact', index, () => {
              form.artifacts.splice(index, 1);
              edited('artifacts');
            }),
            body: [
              ui.grid([
                ui.field({
                  label: text.artifacts.id.label,
                  control: idControl,
                  path: base + '.id',
                  hint: text.artifacts.id.hint,
                  issue: issueOf(base + '.id'),
                }),
                ui.field({
                  label: text.artifacts.file.label,
                  control: ui.text({
                    value: item.file,
                    path: base + '.file',
                    placeholder: text.artifacts.file.placeholder,
                    disabled: isFormReadOnly(),
                    onInput: (next) => {
                      item.file = next;
                    },
                  }),
                  path: base + '.file',
                  hint: text.artifacts.file.hint,
                  issue: issueOf(base + '.file'),
                }),
                ui.field({
                  label: text.artifacts.required.label,
                  control: ui.select({
                    value: item.required === null ? '' : String(item.required),
                    path: base + '.required',
                    options: [
                      { value: '', label: text.artifacts.required.options.default },
                      { value: 'true', label: text.artifacts.required.options.required },
                      { value: 'false', label: text.artifacts.required.options.optional },
                    ],
                    disabled: isFormReadOnly(),
                    onInput: (next) => {
                      item.required = next === '' ? null : next === 'true';
                    },
                  }),
                  path: base + '.required',
                  hint: text.artifacts.required.hint,
                  issue: issueOf(base + '.required'),
                }),
                ui.field({
                  label: text.artifacts.description.label,
                  control: ui.text({
                    value: item.description,
                    path: base + '.description',
                    placeholder: text.artifacts.description.placeholder,
                    disabled: isFormReadOnly(),
                    onInput: (next) => {
                      item.description = next;
                    },
                  }),
                  path: base + '.description',
                  wide: true,
                  issue: issueOf(base + '.description'),
                }),
              ]),
            ],
          })),
        );
      });
      const count = String(form.artifacts.length);
      return ui.section(text.artifacts.title, {
        count,
        note: text.artifacts.note,
        children: [
          ...children,
          ui.addBlockButton(text.artifacts.add, { onClick: () => {
            form.artifacts.push({ id: '', file: '', description: '', required: null });
            edited('artifacts.' + (form.artifacts.length - 1) + '.id');
          }, disabled: isFormReadOnly(), empty: form.artifacts.length === 0 ? text.artifacts.empty : undefined }),
        ],
      });
    }

    function renderDownstream() {
      const form = getForm();
      const children = [];
      form.downstream.forEach((target, index) => {
        const describe = () => ({
          title: target.workflow || text.downstream.heading(index + 1),
          warn: errorCount('downstream.' + index + '.') > 0,
          summary: downstreamSummary(target),
          alerts: alertChips(errorCount('downstream.' + index + '.')),
        });
        children.push(
          track(ui.collapsibleCard({
            key: 'downstream:' + index,
            number: index + 1,
            ...describe(),
            describe,
            tools: listTools('downstream', 'suggestion', index, () => {
              form.downstream.splice(index, 1);
              edited('downstream');
            }),
            body: [
              ui.grid([
                ui.field({
                  label: text.downstream.workflow.label,
                  control: ui.select({
                    value: target.workflow,
                    path: 'downstream.' + index + '.workflow',
                    options: workflowOptions(target.workflow),
                    disabled: isFormReadOnly(),
                    onInput: (next) => {
                      target.workflow = next;
                    },
                  }),
                  path: 'downstream.' + index + '.workflow',
                  issue: issueOf('downstream.' + index + '.workflow'),
                }),
                ui.field({
                  label: text.downstream.task.label,
                  control: ui.text({
                    value: target.task,
                    path: 'downstream.' + index + '.task',
                    placeholder: text.downstream.task.placeholder,
                    disabled: isFormReadOnly(),
                    onInput: (next) => {
                      target.task = next;
                    },
                  }),
                  path: 'downstream.' + index + '.task',
                  wide: true,
                  issue: issueOf('downstream.' + index + '.task'),
                }),
              ]),
              ui.field({
                label: text.downstream.mapping.label,
                control: ui.select({
                  value: target.artifacts === null ? 'all' : 'map',
                  path: 'downstream.' + index + '.mode',
                  options: [
                    { value: 'all', label: text.downstream.mapping.all },
                    { value: 'map', label: text.downstream.mapping.map },
                  ],
                  disabled: isFormReadOnly(),
                  onInput: (next) => {
                    target.artifacts = next === 'all' ? null : [];
                    repaint('downstream.' + index + '.mode');
                  },
                }),
                path: 'downstream.' + index + '.mode',
                hint: text.downstream.mapping.hint,
                wide: true,
                issue: issueOf('downstream.' + index + '.mode'),
              }),
              ...(target.artifacts === null
                ? []
                : [
                    ui.pairList({
                      pairs: target.artifacts,
                      path: 'downstream.' + index + '.artifacts',
                      label: text.downstream.artifacts.label,
                      itemLabel: text.downstream.artifacts.item,
                      keyPlaceholder: text.downstream.artifacts.keyPlaceholder,
                      valuePlaceholder: text.downstream.artifacts.valuePlaceholder,
                      valueOptions: artifactIdOptions,
                      addLabel: text.downstream.artifacts.add,
                      disabled: isFormReadOnly(),
                      onEdit,
                      onRestructure: repaint,
                    }),
                  ]),
            ],
          })),
        );
      });
      const count = String(form.downstream.length);
      return ui.section(text.downstream.title, {
        count,
        note: text.downstream.note,
        children: [
          ...children,
          ui.addBlockButton(text.downstream.add, { onClick: () => {
            form.downstream.push({ workflow: '', task: '', artifacts: null });
            edited('downstream.' + (form.downstream.length - 1) + '.workflow');
          }, disabled: isFormReadOnly(), empty: form.downstream.length === 0 ? text.downstream.empty : undefined }),
        ],
      });
    }

    function datalists() {
      const holder = el('div');
      holder.append(
        ...agents.datalists(
          getModel(),
          getForm().stages.map((stage, index) => ({ id: 'wf-option-keys-' + index, clientType: stage.agent.clientType })),
        ),
      );
      return holder;
    }

    /**
     * The whole Design view: datalists, Basics, Artifacts, Stages and Downstream, inside one form root that reports
     * every value edit through `onEdit`.
     */
    function render() {
      cards = [];
      const nodes = [datalists(), renderBasics(), renderArtifacts(), renderStages(), renderDownstream()];
      return [
        ui.root({ children: nodes, onEdit: () => {
            onEdit();
            refreshHeaders();
          } }),
      ];
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
