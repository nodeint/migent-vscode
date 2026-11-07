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

  // ---------- draft operations ----------

  /** Move a stage by `delta`; returns the new index, or -1 when it would leave the list. */
  function moveStage(form, index, delta) {
    const target = index + delta;
    if (target < 0 || target >= form.stages.length) return -1;
    const [stage] = form.stages.splice(index, 1);
    form.stages.splice(target, 0, stage);
    return target;
  }

  function removeStage(form, index) {
    form.stages.splice(index, 1);
  }

/** Keep every in-file reference in step when a stage id changes. Returns true when anything was rewritten. */
function renameStageReferences(form, oldId, newId) {
  if (oldId === '' || newId === '' || oldId === newId) return false;
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

function artifactBaseName(artifact) {
  const base = String(artifact).split('/').pop() || String(artifact);
  return base.replace(/\.[^.]+$/, '') || base;
}

function agentNameOptions(model, current) {
  const agents = model.agents || [];
  const options = [{ value: '', label: agents.length === 0 ? 'No agents in config' : 'Choose an agent' }];
  for (const agent of agents) options.push({ value: agent, label: agent });
  if (current && !agents.includes(current)) options.push({ value: current, label: current + ' (not in config)' });
  return options;
}

function clientChoices(model) {
  return model.clients || [];
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

function resumeOptions(form, stage, current) {
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

function outputStageOptions(form, current) {
  const options = [{ value: '', label: 'Choose a stage' }];
  const seen = [];
  for (const stage of form.stages) {
    if (stage.id === '' || seen.includes(stage.id)) continue;
    if (stage.producesArtifact === '' && stage.id !== current) continue;
    seen.push(stage.id);
    const suffix = stage.producesArtifact === '' ? ' (no artifact)' : ' → ' + stage.producesArtifact;
    options.push({ value: stage.id, label: stage.id + suffix });
  }
  if (current && !seen.includes(current)) options.push({ value: current, label: current + ' (not a stage)' });
  return options;
}

function outputArtifactOptions(form, output) {
  const options = [{ value: '', label: output.fromStage === '' ? 'Choose a stage first' : 'Choose an artifact' }];
  const stage = form.stages.find((candidate) => candidate.id === output.fromStage);
  if (stage && stage.producesArtifact !== '') {
    options.push({ value: stage.producesArtifact, label: stage.producesArtifact });
  }
  if (output.artifact !== '' && !options.some((option) => option.value === output.artifact)) {
    options.push({ value: output.artifact, label: output.artifact + ' (does not match)' });
  }
  return options;
}

function outputNameOptions(form, current) {
  const options = [{ value: '', label: 'Choose an output' }];
  const names = uniqueValues(form.outputs.map((output) => output.name));
  for (const name of names) options.push({ value: name, label: name });
  if (current && !names.includes(current)) options.push({ value: current, label: current + ' (not an output)' });
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
    moveStage,
    removeStage,
    renameStageReferences,
    uniqueValues,
    stageIds,
    artifactBaseName,
    roleOptions,
    agentNameOptions,
    clientChoices,
    optionKeySuggestions,
    isKnownModel,
    agentModelLabel,
    resumeOptions,
    outputStageOptions,
    outputArtifactOptions,
    outputNameOptions,
    workflowOptions,
  };
})();
