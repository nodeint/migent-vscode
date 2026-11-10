// Configuration form: the Agents and Roles sections over a config draft the host page owns. The draft has the shape of the
// core `ConfigForm` (src/core/config.ts): an optional field is absent or present, and keys the form does not model
// ride along in `extra` and are never touched here. On the Local tab each merge unit has an Override control: absent
// means inherited from config.yaml, present (even empty) means this file sets it. Every string is set with textContent.
// Needs media/shared (the kit, agentform.js, copy.js) and configcopy.js loaded first (see docs/ui.md).
(function () {
  'use strict';

  const ui = window.MigentUi;
  const { el, icon } = ui;
  const agents = window.MigentAgentForm;
  const copy = window.MigentCopy;
  const text = window.MigentConfigCopy;

  const SCHEMA_VERSION = 7;

  const emptyAgent = () => ({ extra: {} });
  const emptyForm = () => ({ schemaVersion: SCHEMA_VERSION, agents: [], roles: [], extra: {} });
  const normalizeForm = (form) => JSON.parse(JSON.stringify(form || emptyForm()));

  const setOrDrop = (target, key, value) => {
    if (value === '') delete target[key];
    else target[key] = value;
  };

  /**
   * The flat agent shape the shared inline editor edits, as a live view of a core agent. A cleared text becomes
   * absent. The option list is created on first use: `sync` stores it on the agent once it has a row, so rendering
   * alone never makes a field present.
   */
  function flatAgent(agent, syncs) {
    const scratch = [];
    syncs.push(() => {
      if (scratch.length > 0 && !(agent.client && agent.client.options)) {
        if (!agent.client) agent.client = { extra: {} };
        agent.client.options = scratch;
      }
    });
    return {
      get model() {
        return agent.model === undefined ? '' : agent.model;
      },
      set model(value) {
        setOrDrop(agent, 'model', value);
      },
      get effort() {
        return agent.effort === undefined ? '' : agent.effort;
      },
      set effort(value) {
        setOrDrop(agent, 'effort', value);
      },
      get clientType() {
        return agent.client && agent.client.type !== undefined ? agent.client.type : '';
      },
      set clientType(value) {
        if (value === '' && !agent.client) return;
        if (!agent.client) agent.client = { extra: {} };
        setOrDrop(agent.client, 'type', value);
      },
      get clientOptions() {
        return agent.client && agent.client.options ? agent.client.options : scratch;
      },
    };
  }

  /** Write a picked client and model into an agent, making both present. */
  function writePick(agent, client, model) {
    if (!agent.client) agent.client = { extra: {} };
    agent.client.type = client;
    agent.model = model;
  }

  function create(host) {
    const { getModel, getForm, getProjectForm, getLocalForm, scope, issueOf, onEdit, repaint, pickModel } = host;
    const isLocal = scope === 'local';
    let cards = [];
    let syncs = [];

    /** An edit of any kind first stores the lists that were only scratch (absent) until they got a row. */
    const syncAll = () => syncs.forEach((sync) => sync());
    const editedSynced = () => {
      syncAll();
      onEdit();
    };

    const track = (card) => {
      cards.push(card);
      return card;
    };

    /** A structural edit from a click: stale diagnostics go, then the page rebuilds and refocuses `path`. */
    function edited(path) {
      onEdit();
      repaint(path);
    }

    const projectAgent = (name) => (getProjectForm().agents.find((entry) => entry.name === name) || {}).agent;
    const projectRole = (name) => getProjectForm().roles.find((entry) => entry.name === name);
    const localAgent = (name) => (getLocalForm().agents.find((entry) => entry.name === name) || {}).agent;
    const localRole = (name) => getLocalForm().roles.find((entry) => entry.name === name);

    /** The tag a Project field shows when the saved config.local.yaml sets that merge unit. */
    const overriddenTag = () => {
      const tag = el('span', null, 'mg-override-tag');
      tag.append(icon('warning'), el('span', text.project.overridden));
      tag.dataset.tip = text.project.overriddenTip;
      tag.setAttribute('aria-label', text.project.overridden + '. ' + text.project.overriddenTip);
      // Focusable, so the keyboard reaches the tooltip.
      tag.tabIndex = 0;
      return tag;
    };

    /**
     * On the Project tab, the tag at the end of each label row whose unit config.local.yaml sets. The value stays
     * the one config.yaml holds; the tag states that another file overrides it.
     */
    function projectAgentActions(entry) {
      const local = localAgent(entry.name);
      if (!local) return {};
      const actions = {};
      if (local.model !== undefined || (local.client && local.client.type !== undefined)) actions.model = overriddenTag();
      if (local.effort !== undefined) actions.effort = overriddenTag();
      if (local.client && Array.isArray(local.client.options) && local.client.options.length > 0) {
        actions.clientOptions = overriddenTag();
      }
      return actions;
    }

    function projectRoleActions(role) {
      const local = localRole(role.name);
      if (!local) return {};
      const actions = {};
      if (local.description !== undefined) actions.description = overriddenTag();
      if (local.responsibilities !== undefined) actions.responsibilities = overriddenTag();
      if (local.agent.mode !== 'absent') actions.agent = overriddenTag();
      return actions;
    }

    function flatOf(agent) {
      return flatAgent(agent, syncs);
    }

    /**
     * One merge unit on the Local tab: the field label with the Override toggle at the end of its head, then the
     * unit's own control. While the unit is inherited the control is disabled and holds the value from
     * config.yaml, so the field keeps one height and the reader sees what would be inherited.
     */
    function overrideField(options) {
      const box = el('input');
      box.type = 'checkbox';
      box.checked = options.present;
      box.dataset.path = options.path + '.override';
      box.setAttribute('aria-label', text.local.overrideOf(options.label));
      box.addEventListener('change', () => {
        options.onToggle(box.checked);
        edited(options.path + '.override');
      });
      const toggle = el('label', null, 'mg-check mg-check--override');
      toggle.append(box, el('span', text.local.override));
      return ui.field({
        label: options.label,
        hint: options.hint,
        path: options.path,
        issue: options.issue,
        action: toggle,
        control: options.control({ disabled: !options.present }),
      });
    }

    /** How many merge units of an agent the Local file sets: each present field counts once. */
    function agentOverrideCount(agent) {
      let count = 0;
      if (agent.model !== undefined) count += 1;
      if (agent.effort !== undefined) count += 1;
      if (agent.client && agent.client.type !== undefined) count += 1;
      if (agent.client && agent.client.options !== undefined) count += 1;
      return count;
    }

    /** How many merge units of a role the Local file sets: the description, the responsibilities and the agent. */
    function roleOverrideCount(role) {
      let count = 0;
      if (role.description !== undefined) count += 1;
      if (role.responsibilities !== undefined) count += 1;
      if (role.agent.mode !== 'absent') count += 1;
      return count;
    }

    // ---------- agents ----------

    function agentSummary(entry) {
      const flat = flatAgent(entry.agent, []);
      return [flat.clientType || flat.model ? agents.agentModelLabel(flat) : '', flat.effort];
    }

    function projectAgentBody(entry, index, path) {
      return [
        agents.inlineEditor({
          agent: flatOf(entry.agent),
          path,
          title: text.agents.group,
          note: text.agents.inlineNote,
          actions: projectAgentActions(entry),
          model: getModel(),
          issueOf,
          disabled: false,
          onPick: () => pickModel({ kind: 'agents', index }),
          onEdit: editedSynced,
          repaint,
          optionKeysId: 'st-keys-agents-' + index,
        }),
      ];
    }

    function localAgentBody(entry, index, path) {
      const base = projectAgent(entry.name) || {};
      const own = entry.agent;
      const flat = flatOf(own);
      const baseFlat = flatAgent(base, []);
      const scalar = (key, label, hint, makeControl) =>
        overrideField({
          label,
          hint,
          path: path + '.' + key,
          issue: issueOf(path + '.' + key),
          present: key === 'clientType' ? own.client !== undefined && own.client.type !== undefined : own[key] !== undefined,
          onToggle: (on) => {
            if (key === 'clientType') {
              if (!on) {
                if (own.client) delete own.client.type;
              } else {
                if (!own.client) own.client = { extra: {} };
                own.client.type = baseFlat.clientType;
              }
            } else if (on) own[key] = baseFlat[key];
            else delete own[key];
          },
          control: (state) => makeControl(state.disabled),
        });
      const fields = [
        scalar('model', text.local.model.label, text.local.model.hint, (disabled) =>
          ui.picker({
            value: disabled ? agents.agentModelLabel(baseFlat) : agents.agentModelLabel(flat),
            path: path + '.model.value',
            placeholder: copy.agent.model.placeholder,
            disabled,
            onPick: () => pickModel({ kind: 'agents', index }),
          }),
        ),
        scalar('effort', text.local.effort.label, text.local.effort.hint, (disabled) =>
          ui.text({
            value: disabled ? base.effort : own.effort,
            path: path + '.effort.value',
            list: agents.EFFORT_LIST_ID,
            disabled,
            onInput: (next) => {
              own.effort = next;
            },
          }),
        ),
        scalar('clientType', text.local.clientType.label, text.local.clientType.hint, (disabled) =>
          ui.text({
            value: disabled ? baseFlat.clientType : own.client.type,
            path: path + '.clientType.value',
            disabled,
            onInput: (next) => {
              own.client.type = next;
            },
          }),
        ),
      ];
      const inherited = (base.client && base.client.options ? base.client.options : []).filter(
        (pair) => !flat.clientOptions.some((own2) => own2.key === pair.key),
      );
      const options = [
        ui.pairList({
          pairs: flat.clientOptions,
          path: path + '.clientOptions',
          label: text.local.options.label,
          itemLabel: text.local.options.item,
          keyPlaceholder: 'key',
          valuePlaceholder: 'value',
          keyList: 'st-keys-agents-' + index,
          addLabel: text.local.options.add,
          onEdit: editedSynced,
          onRestructure: repaint,
        }),
      ];
      if (inherited.length > 0) {
        const list = el('ul', null, 'mg-list');
        for (const pair of inherited) list.append(el('li', text.local.options.inherited(pair.key, pair.value), 'mg-muted'));
        options.push(list, el('p', text.local.options.note, 'mg-muted'));
      }
      return [ui.group(text.agents.group, { note: text.agents.inlineNote, children: [ui.grid(fields), ...options] })];
    }

    function renderAgentCard(entry, index) {
      const path = 'agents.' + index;
      const describe = () => {
        const summary = agentSummary(entry);
        const overrides = isLocal ? agentOverrideCount(entry.agent) : 0;
        if (overrides > 0) summary.push(text.local.overrides(overrides));
        return {
          title: entry.name || text.agents.untitled(index + 1),
          summary,
          alerts: [],
        };
      };
      return track(
        ui.collapsibleCard({
          key: 'agent:' + scope + ':' + index,
          number: index + 1,
          path: path + '.card',
          ...describe(),
          describe,
          tools: [
            ui.removeButton(copy.remove(text.agents.item, index + 1), { onClick: () => {
              getForm().agents.splice(index, 1);
              edited('agents');
            } }),
          ],
          body: [
            ui.grid([
              ui.field({
                label: text.agents.name.label,
                hint: text.agents.name.hint,
                path: path + '.name',
                issue: issueOf(path + '.name'),
                control: ui.text({
                  value: entry.name,
                  path: path + '.name',
                  onInput: (next) => {
                    entry.name = next;
                  },
                }),
              }),
            ]),
            ...(isLocal ? localAgentBody(entry, index, path) : projectAgentBody(entry, index, path)),
          ],
        }),
      );
    }

    function renderAgents() {
      const form = getForm();
      const children = form.agents.map(renderAgentCard);
      children.push(
        ui.addBlockButton(text.agents.add, { onClick: () => {
            form.agents.push({ name: '', agent: emptyAgent() });
            edited('agents.' + (form.agents.length - 1) + '.name');
          }, empty: form.agents.length === 0 ? text.agents.empty : undefined }),
      );
      return ui.section(text.agents.title, {
        note: isLocal ? text.agents.localNote : text.agents.note,
        count: String(form.agents.length),
        children,
      });
    }

    // ---------- roles ----------

    const MODES = (local) => [
      { value: 'absent', label: local ? text.roles.agent.modes.inherit : text.roles.agent.modes.absent },
      { value: 'named', label: text.roles.agent.modes.named },
      { value: 'inline', label: text.roles.agent.modes.inline },
    ];

    function replacesText(role) {
      const base = projectRole(role.name);
      if (!base || base.agent.mode === 'absent') return text.roles.agent.replacesNone;
      if (base.agent.mode === 'named') return text.roles.agent.replaces(base.agent.name);
      return text.roles.agent.replaces(agents.agentModelLabel(flatAgent(base.agent.agent, [])));
    }

    function roleAgentGroup(role, index, path) {
      const selection = role.agent;
      const known = getModel().agentNames || [];
      const children = [
        agents.selector({
          label: text.roles.agent.label,
          hint: text.roles.agent.hint,
          action: isLocal ? undefined : projectRoleActions(role).agent,
          path: path + '.agentMode',
          value: selection.mode,
          modes: MODES(isLocal),
          issue: issueOf(path + '.agent'),
          onInput: (next) => {
            if (next === 'absent') role.agent = { mode: 'absent' };
            else if (next === 'named') role.agent = { mode: 'named', name: '' };
            else role.agent = { mode: 'inline', agent: emptyAgent() };
            edited(path + '.agentMode');
          },
        }),
      ];
      if (isLocal && selection.mode !== 'absent') children.push(el('p', replacesText(role), 'mg-muted'));
      if (selection.mode === 'named') {
        children.push(
          ui.field({
            label: text.roles.agent.name.label,
            hint: text.roles.agent.name.hint,
            path: path + '.agentName',
            issue: issueOf(path + '.agentName') || (selection.name && !known.includes(selection.name)
              ? { message: text.roles.agent.unknown, warning: true }
              : undefined),
            control: ui.select({
              value: selection.name,
              path: path + '.agentName',
              options: agents.namedOptions(known, selection.name),
              onInput: (next) => {
                selection.name = next;
              },
            }),
          }),
        );
      }
      if (selection.mode === 'inline') {
        children.push(
          agents.inlineEditor({
            agent: flatOf(selection.agent),
            path: path + '.agent',
            title: text.roles.agent.inlineTitle,
            note: text.roles.agent.inlineNote,
            model: getModel(),
            issueOf,
            disabled: false,
            onPick: () => pickModel({ kind: 'roles', index }),
            onEdit: editedSynced,
            repaint,
            optionKeysId: 'st-keys-roles-' + index,
          }),
        );
        const base = projectRole(role.name);
        if (isLocal && base && base.agent.mode !== 'absent') {
          children.push(
            ui.button(text.roles.agent.copy, {
              kind: 'quiet',
              onClick: () => {
                role.agent =
                  base.agent.mode === 'named'
                    ? { mode: 'named', name: base.agent.name }
                    : { mode: 'inline', agent: normalizeForm({ agents: [{ agent: base.agent.agent }] }).agents[0].agent };
                edited(path + '.agentMode');
              },
            }),
          );
        }
      }
      return ui.group(text.roles.agent.label, { children });
    }

    function roleBody(role, index, path) {
      const base = projectRole(role.name) || {};
      const actions = isLocal ? {} : projectRoleActions(role);
      const description = isLocal
        ? overrideField({
            label: text.roles.description.label,
            hint: text.roles.description.hint,
            path: path + '.description',
            issue: issueOf(path + '.description'),
            present: role.description !== undefined,
            onToggle: (on) => {
              if (on) role.description = base.description === undefined ? '' : base.description;
              else delete role.description;
            },
            control: (state) =>
              ui.text({
                value: state.disabled ? base.description : role.description,
                path: path + '.description.value',
                disabled: state.disabled,
                onInput: (next) => {
                  role.description = next;
                },
              }),
          })
        : ui.field({
            label: text.roles.description.label,
            hint: text.roles.description.hint,
            action: actions.description,
            path: path + '.description',
            issue: issueOf(path + '.description'),
            control: ui.text({
              value: role.description,
              path: path + '.description',
              onInput: (next) => {
                setOrDrop(role, 'description', next);
              },
            }),
          });
      // The list is stored on the role once it has a row, so rendering alone never makes it present.
      const scratch = role.responsibilities === undefined ? [] : role.responsibilities;
      syncs.push(() => {
        if (role.responsibilities === undefined && scratch.length > 0) role.responsibilities = scratch;
      });
      const list = (values, label, disabled, action) =>
        ui.stringList({
          values,
          path: path + '.responsibilities',
          label,
          action,
          itemLabel: text.roles.responsibilities.item,
          addLabel: text.roles.responsibilities.add,
          disabled,
          onEdit: editedSynced,
          onRestructure: repaint,
        });
      const responsibilities = isLocal
        ? overrideField({
            label: text.roles.responsibilities.label,
            path: path + '.responsibilities',
            issue: issueOf(path + '.responsibilities'),
            present: role.responsibilities !== undefined,
            onToggle: (on) => {
              if (on) role.responsibilities = (base.responsibilities || []).slice();
              else delete role.responsibilities;
            },
            // The field already names the unit, so the list drops its own legend.
            control: (state) =>
              list(state.disabled ? (base.responsibilities || []).slice() : scratch, undefined, state.disabled),
          })
        : list(scratch, text.roles.responsibilities.label, false, actions.responsibilities);
      return [
        ui.grid([
          ui.field({
            label: text.roles.name.label,
            hint: text.roles.name.hint,
            path: path + '.name',
            issue: issueOf(path + '.name'),
            control: ui.text({
              value: role.name,
              path: path + '.name',
              onInput: (next) => {
                role.name = next;
              },
            }),
          }),
          description,
        ]),
        responsibilities,
        roleAgentGroup(role, index, path),
      ];
    }

    function renderRoleCard(role, index) {
      const path = 'roles.' + index;
      const describe = () => {
        const selection = role.agent;
        let summary = '';
        if (selection.mode === 'named') summary = selection.name;
        else if (selection.mode === 'inline') summary = copy.agent.model.label.toLowerCase();
        const parts = [summary];
        const overrides = isLocal ? roleOverrideCount(role) : 0;
        if (overrides > 0) parts.push(text.local.overrides(overrides));
        return { title: role.name || text.roles.untitled(index + 1), summary: parts, alerts: [] };
      };
      return track(
        ui.collapsibleCard({
          key: 'role:' + scope + ':' + index,
          number: index + 1,
          path: path + '.card',
          ...describe(),
          describe,
          tools: [
            ui.removeButton(copy.remove(text.roles.item, index + 1), { onClick: () => {
              getForm().roles.splice(index, 1);
              edited('roles');
            } }),
          ],
          body: roleBody(role, index, path),
        }),
      );
    }

    function renderRoles() {
      const form = getForm();
      const children = form.roles.map(renderRoleCard);
      children.push(
        ui.addBlockButton(text.roles.add, { onClick: () => {
            form.roles.push({ name: '', agent: { mode: 'absent' }, extra: {} });
            edited('roles.' + (form.roles.length - 1) + '.name');
          }, empty: form.roles.length === 0 ? text.roles.empty : undefined }),
      );
      return ui.section(text.roles.title, { note: text.roles.note, count: String(form.roles.length), children });
    }

    function optionKeyLists() {
      const form = getForm();
      const entries = [
        ...form.agents.map((entry, index) => ({ id: 'st-keys-agents-' + index, clientType: flatAgent(entry.agent, []).clientType })),
        ...form.roles.map((role, index) => ({
          id: 'st-keys-roles-' + index,
          clientType: role.agent.mode === 'inline' ? flatAgent(role.agent.agent, []).clientType : '',
        })),
      ];
      const holder = el('div');
      holder.append(...agents.datalists(getModel(), entries));
      return holder;
    }

    /** The whole form: datalists, Agents and Roles, inside one root that reports every value edit. */
    function render() {
      cards = [];
      syncs = [];
      const nodes = [optionKeyLists(), renderAgents(), renderRoles()];
      return [
        ui.root({ children: nodes, onEdit: () => {
            editedSynced();
            for (const card of cards) card.refresh();
          } }),
      ];
    }

    /**
     * Apply a pair chosen in the host's model picker to the agent or inline role agent that asked. An entry that
     * is gone keeps the draft unchanged.
     */
    function applyModelPick(token, client, model) {
      const form = getForm();
      let target;
      if (token.kind === 'agents') target = form.agents[token.index] && form.agents[token.index].agent;
      else {
        const role = form.roles[token.index];
        target = role && role.agent.mode === 'inline' ? role.agent.agent : undefined;
      }
      if (!target) return false;
      writePick(target, client, model);
      edited((token.kind === 'agents' ? 'agents.' : 'roles.') + token.index + (token.kind === 'agents' ? '' : '.agent') + '.model');
      return true;
    }

    return { render, applyModelPick };
  }

  window.MigentConfigForm = { create, emptyForm, normalizeForm, flatAgent };
})();
