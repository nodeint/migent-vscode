import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

/* media/workfloweditor/workflowmodel.js is plain data and pure functions: it loads with no DOM and no FakeNode. */
interface Stage {
  id: string;
  role: string;
  dependsOn: string[];
  sessionResumeFrom: string;
  producesArtifact: string;
  decision: { value: string; when: string; navigate: string }[];
}
interface Form {
  stages: Stage[];
  outputs: { name: string; fromStage: string; artifact: string }[];
  downstream: unknown[];
}
interface Choice {
  value: string;
  label: string;
}
interface Model {
  emptyForm: () => Form;
  normalizeForm: (input: unknown) => Form;
  moveStage: (form: Form, index: number, delta: number) => number;
  removeStage: (form: Form, index: number) => void;
  renameStageReferences: (form: Form, oldId: string, newId: string) => boolean;
  uniqueValues: (values: string[]) => string[];
  stageIds: (form: Form) => string[];
  artifactBaseName: (artifact: string) => string;
  roleOptions: (model: unknown, current: string) => Choice[];
  isKnownModel: (model: unknown, client: string, name: string) => boolean;
  agentModelLabel: (agent: { clientType?: string; model?: string }) => string;
  resumeOptions: (form: Form, stage: Stage, current: string) => Choice[];
  outputStageOptions: (form: Form, current: string) => Choice[];
  outputArtifactOptions: (form: Form, output: { fromStage: string; artifact: string }) => Choice[];
  workflowOptions: (model: unknown, current: string) => Choice[];
}

function load(): Model {
  const window: Record<string, unknown> = {};
  const context = vm.createContext({ window });
  const file = path.join(__dirname, '../../../media/workfloweditor/workflowmodel.js');
  vm.runInContext(readFileSync(file, 'utf8'), context);
  return window.MigentWorkflowModel as Model;
}

const model = load();

function makeForm(): Form {
  return model.normalizeForm({
    stages: [
      {
        id: 'plan',
        role: 'planner',
        producesArtifact: 'plan.md',
        decision: [{ value: 'approved', navigate: 'review, complete' }],
      },
      { id: 'review', role: 'reviewer', dependsOn: ['plan'], sessionResumeFrom: 'plan' },
      { id: 'ship', role: '', dependsOn: ['review'] },
    ],
    outputs: [{ name: 'plan', fromStage: 'plan', artifact: 'plan.md' }],
  });
}

describe('normalizeForm', () => {
  it('fills every missing field and tolerates junk input', () => {
    expect(model.normalizeForm(null)).toEqual(model.emptyForm());
    const form = model.normalizeForm({ stages: [null, { id: 'a', dependsOn: 'x' }], constraints: 'x' });
    expect(form.stages[1].dependsOn).toEqual([]);
    expect(form.stages[1].decision).toEqual([]);
  });
});

describe('renameStageReferences', () => {
  it('updates dependsOn, sessionResumeFrom, decision routes and outputs', () => {
    const form = makeForm();
    expect(model.renameStageReferences(form, 'plan', 'design')).toBe(true);
    expect(form.stages[1].dependsOn).toEqual(['design']);
    expect(form.stages[1].sessionResumeFrom).toBe('design');
    expect(form.outputs[0].fromStage).toBe('design');

    const routed = makeForm();
    model.renameStageReferences(routed, 'review', 'check');
    expect(routed.stages[0].decision[0].navigate).toBe('check, complete');
    expect(routed.stages[2].dependsOn).toEqual(['check']);
  });

  it('does nothing for an empty or unchanged id', () => {
    const form = makeForm();
    expect(model.renameStageReferences(form, '', 'x')).toBe(false);
    expect(model.renameStageReferences(form, 'plan', '')).toBe(false);
    expect(model.renameStageReferences(form, 'plan', 'plan')).toBe(false);
    expect(model.renameStageReferences(form, 'nobody', 'x')).toBe(false);
  });
});

describe('moveStage and removeStage', () => {
  it('moves a stage and reports its new index, or -1 at the ends', () => {
    const form = makeForm();
    expect(model.moveStage(form, 0, 1)).toBe(1);
    expect(model.stageIds(form)).toEqual(['review', 'plan', 'ship']);
    expect(model.moveStage(form, 0, -1)).toBe(-1);
    expect(model.moveStage(form, 2, 1)).toBe(-1);
    expect(model.stageIds(form)).toEqual(['review', 'plan', 'ship']);
  });

  it('removes a stage and leaves references to it visible to the option lists', () => {
    const form = makeForm();
    model.removeStage(form, 0);
    expect(model.stageIds(form)).toEqual(['review', 'ship']);
    expect(form.stages[0].dependsOn).toEqual(['plan']);
    expect(model.outputStageOptions(form, 'plan').at(-1)).toEqual({ value: 'plan', label: 'plan (not a stage)' });
  });
});

describe('option lists', () => {
  it('keeps an unknown current value and marks it', () => {
    const info = { roles: ['planner'], workflows: [{ id: 'a' }] };
    expect(model.roleOptions(info, 'ghost').at(-1)).toEqual({ value: 'ghost', label: 'ghost (not in config)' });
    expect(model.roleOptions(info, 'planner')).toHaveLength(2);
    expect(model.workflowOptions(info, 'b').at(-1)).toEqual({ value: 'b', label: 'b (not in project)' });
  });

  it('offers only role-bearing dependencies to resume from', () => {
    const form = makeForm();
    expect(model.resumeOptions(form, form.stages[2], '').map((option) => option.value)).toEqual(['', 'review']);
    form.stages[1].role = '';
    expect(model.resumeOptions(form, form.stages[2], '').map((option) => option.value)).toEqual(['']);
    expect(model.resumeOptions(form, form.stages[1], 'plan').map((option) => option.value)).toEqual(['', 'plan']);
    expect(model.resumeOptions(form, form.stages[2], 'review').at(-1)?.label).toBe('review (no role)');
  });

  it('lists the artifact of the chosen stage and flags a mismatch', () => {
    const form = makeForm();
    expect(model.outputArtifactOptions(form, { fromStage: 'plan', artifact: 'plan.md' }).map((o) => o.value)).toEqual([
      '',
      'plan.md',
    ]);
    expect(model.outputArtifactOptions(form, { fromStage: 'plan', artifact: 'x.md' }).at(-1)?.label).toBe(
      'x.md (does not match)',
    );
    expect(model.outputStageOptions(form, '').map((o) => o.value)).toEqual(['', 'plan']);
  });

  it('derives names and labels', () => {
    expect(model.artifactBaseName('docs/plan.md')).toBe('plan');
    expect(model.uniqueValues(['a', '', 'a', 'b'])).toEqual(['a', 'b']);
    expect(model.agentModelLabel({ clientType: 'codex', model: 'gpt-5' })).toBe('codex · gpt-5');
    expect(model.agentModelLabel({ model: 'gpt-5' })).toBe('gpt-5 (no client)');
    expect(model.isKnownModel({ clients: [{ id: 'codex', models: ['gpt-5'] }] }, 'codex', 'gpt-5')).toBe(true);
    expect(model.isKnownModel({ clients: [] }, 'codex', 'gpt-5')).toBe(false);
  });
});
