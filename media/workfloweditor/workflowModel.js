// Workflow model: the data shape of the workflow form and the pure operations on a draft. It builds no DOM and reads
// no host callback, so it can be tested and reused without a page. Exposes `window.MigentWorkflowModel`.
(function () {
  'use strict';

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
      depends_on: [],
      max_revisions: null,
      instructions: [],
      artifacts: [],
      sessionResumeFrom: '',
      verify: [],
      verify_timeout: null,
      max_verify: null,
      runWhenPaths: [],
      decision: [],
    };
  }

  function emptyForm() {
    return { id: '', concurrency: null, constraints: [], stages: [], artifacts: [], downstream: [] };
  }

  /**
   * A copy of a list, or an empty one. The draft and the saved copy are both normalized from the same source, and
   * the controls edit the draft's lists in place, so a list shared between them would change both and the page
   * would never see an edit.
   */
  function copyList(values) {
    return Array.isArray(values) ? values.slice() : [];
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
    stage.depends_on = copyList(stage.depends_on);
    stage.instructions = copyList(stage.instructions);
    stage.verify = copyList(stage.verify);
    stage.runWhenPaths = copyList(stage.runWhenPaths);
    stage.artifacts = copyList(stage.artifacts);
    stage.decision = (Array.isArray(stage.decision) ? stage.decision : []).map((route) => ({
      value: '',
      when: '',
      navigate: '',
      ...(route || {}),
      artifacts: normalizeRouteArtifacts(route && route.artifacts),
    }));
    return stage;
  }

  /** A route's artifacts keep the shape the file used: null (absent), registry ids, or decision-local items. */
  function normalizeRouteArtifacts(value) {
    if (!value || typeof value !== 'object') return null;
    if (value.kind === 'ids') return { kind: 'ids', ids: copyList(value.ids) };
    if (value.kind === 'local') {
      const items = Array.isArray(value.items) ? value.items : [];
      return { kind: 'local', items: items.map((item) => ({ id: '', file: '', description: '', ...(item || {}) })) };
    }
    return null;
  }

  function normalizeForm(input) {
    const next = { ...emptyForm(), ...(input || {}) };
    next.constraints = copyList(next.constraints);
    next.stages = (Array.isArray(next.stages) ? next.stages : []).map(normalizeStage);
    next.artifacts = (Array.isArray(next.artifacts) ? next.artifacts : []).map((item) => ({
      id: '',
      file: '',
      description: '',
      required: null,
      ...(item || {}),
    }));
    // `artifacts: null` means the key is absent: every published artifact is passed under its own id.
    next.downstream = (Array.isArray(next.downstream) ? next.downstream : []).map((target) => ({
      workflow: '',
      task: '',
      ...(target || {}),
      artifacts: target && Array.isArray(target.artifacts) ? normalizePairs(target.artifacts) : null,
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

  // ---------- draft operations ----------

  /** Move an item of `list` by `delta`; returns the new index, or -1 when it would leave the list. */
  function moveItem(list, index, delta) {
    const target = index + delta;
    if (target < 0 || target >= list.length) return -1;
    const [item] = list.splice(index, 1);
    list.splice(target, 0, item);
    return target;
  }

  /** Move a stage by `delta`; returns the new index, or -1 when it would leave the list. */
  function moveStage(form, index, delta) {
    return moveItem(form.stages, index, delta);
  }

  function removeStage(form, index) {
    form.stages.splice(index, 1);
  }

/** Keep every in-file reference in step when a stage id changes. Returns true when anything was rewritten. */
function renameStageReferences(form, oldId, newId) {
  if (oldId === '' || newId === '' || oldId === newId) return false;
  let changed = false;
  for (const stage of form.stages) {
    stage.depends_on = stage.depends_on.map((id) => {
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
  return changed;
}

/**
 * Translate a CLI diagnostic path to the path of the control that edits it. The CLI keys the registry and
 * decision-local artifacts by id and nests a decision under its name (`artifacts.plan.file`,
 * `stages.0.decision.1.revise.artifacts.fixes.file`); the form lists them by index. A list index of registry ids
 * (`stages.0.artifacts.1`, `stages.0.decision.0.approved.artifacts.0`) becomes the checkbox of that id. Unknown shapes
 * pass through.
 *
 * A diagnostic about a whole object (a stage, a decision, an artifact) is placed on the control that names it: the
 * `id` of a stage or an artifact, the `value` of a decision. So every diagnostic lands on exactly one control and the
 * reader sees where the problem is. A diagnostic about a whole `artifacts` block of a decision lands on its type select.
 */
function formPathOf(form, path) {
  const parts = String(path).split('.');
  if (parts[0] === 'artifacts' && parts.length > 1) {
    const index = form.artifacts.findIndex((item) => item.id === parts[1]);
    if (index >= 0) return ['artifacts', index, ...(parts.length === 2 ? ['id'] : parts.slice(2))].join('.');
    return path;
  }
  if (parts[0] === 'stages' && parts.length === 2 && form.stages[Number(parts[1])]) return path + '.id';
  if (parts[0] === 'stages' && parts[2] === 'artifacts' && parts.length === 4) {
    const stage = form.stages[Number(parts[1])];
    const id = stage && stage.artifacts[Number(parts[3])];
    return id === undefined ? path : ['stages', parts[1], 'artifacts', id].join('.');
  }
  if (parts[0] !== 'stages' || parts[2] !== 'decision' || parts.length < 4) return path;
  const stage = form.stages[Number(parts[1])];
  const route = stage && stage.decision[Number(parts[3])];
  if (!route) return path;
  const rest = parts.slice(4);
  const head = ['stages', parts[1], 'decision', parts[3]];
  if (rest.length === 0) return [...head, 'value'].join('.');
  if (rest[0] === route.value && !['when', 'navigate', 'artifacts'].includes(rest[0])) rest.shift();
  if (rest.length === 0) return [...head, 'value'].join('.');
  if (rest[0] === 'artifacts' && rest.length > 1 && route.artifacts && route.artifacts.kind === 'local') {
    const index = route.artifacts.items.findIndex((item) => item.id === rest[1]);
    if (index >= 0) return [...head, 'artifacts', index, ...(rest.length === 2 ? ['id'] : rest.slice(2))].join('.');
  }
  if (rest.length === 1 && rest[0] === 'artifacts') return [...head, 'artifacts', 'kind'].join('.');
  // A list of registry ids: the index becomes the checkbox of that id.
  if (rest[0] === 'artifacts' && rest.length === 2 && route.artifacts && route.artifacts.kind === 'ids') {
    const id = route.artifacts.ids[Number(rest[1])];
    if (id !== undefined) return [...head, 'artifacts', 'ids', id].join('.');
  }
  return [...head, ...rest].join('.');
}

/** Keep every in-file reference in step when a registry artifact id changes. Returns true when anything changed. */
function renameArtifactReferences(form, oldId, newId) {
  if (oldId === '' || newId === '' || oldId === newId) return false;
  let changed = false;
  const swap = (id) => {
    if (id !== oldId) return id;
    changed = true;
    return newId;
  };
  for (const stage of form.stages) {
    stage.artifacts = stage.artifacts.map(swap);
    for (const route of stage.decision || []) {
      if (route.artifacts && route.artifacts.kind === 'ids') route.artifacts.ids = route.artifacts.ids.map(swap);
    }
  }
  for (const target of form.downstream) {
    for (const pair of target.artifacts || []) pair.value = swap(pair.value);
  }
  return changed;
}

function roleOptions(model, current) {
  const roles = model.roles || [];
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

function stageIds(form) {
  return uniqueValues(form.stages.map((stage) => stage.id));
}

function agentNameOptions(model, current) {
  const agents = model.agents || [];
  const options = [{ value: '', label: agents.length === 0 ? 'No agents in config' : 'Choose an agent' }];
  for (const agent of agents) options.push({ value: agent, label: agent });
  if (current && !agents.includes(current)) options.push({ value: current, label: current + ' (not in config)' });
  return options;
}

function resumeOptions(form, stage, current) {
  const options = [{ value: '', label: 'No resumed session' }];
  const listed = [];
  for (const id of uniqueValues(stage.depends_on)) {
    const dependency = form.stages.find((candidate) => candidate.id === id);
    if (dependency && dependency.role === '') continue;
    options.push({ value: id, label: id });
    listed.push(id);
  }
  if (current && !listed.includes(current)) {
    const suffix = stage.depends_on.includes(current) ? ' (no role)' : ' (not a dependency)';
    options.push({ value: current, label: current + suffix });
  }
  return options;
}

/** Registry ids for a select; an id the registry does not define stays visible and flagged. */
function artifactIdOptions(form, current) {
  const options = [{ value: '', label: 'Choose an artifact' }];
  const ids = uniqueValues(form.artifacts.map((item) => item.id));
  for (const id of ids) options.push({ value: id, label: id });
  if (current && !ids.includes(current)) options.push({ value: current, label: current + ' (not in the registry)' });
  return options;
}

function workflowOptions(model, current) {
  const workflows = model.workflows || [];
  const options = [{ value: '', label: 'Choose a workflow' }];
  const ids = uniqueValues(workflows.map((workflow) => workflow.id));
  for (const id of ids) options.push({ value: id, label: id });
  if (current && !ids.includes(current)) options.push({ value: current, label: current + ' (not in project)' });
  return options;
}

  window.MigentWorkflowModel = {
    emptyAgent,
    emptyStage,
    emptyForm,
    normalizeForm,
    moveItem,
    moveStage,
    removeStage,
    renameStageReferences,
    renameArtifactReferences,
    formPathOf,
    uniqueValues,
    stageIds,
    roleOptions,
    agentNameOptions,
    resumeOptions,
    artifactIdOptions,
    workflowOptions,
  };
})();
