import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

/* media/workfloweditor/workflowmodel.js is plain data and pure functions: it loads with no DOM and no FakeNode. */
interface Stage {
  id: string;
  role: string;
  depends_on: string[];
  instructions: string[];
  verify: string[];
  runWhenPaths: string[];
  sessionResumeFrom: string;
  artifacts: string[];
  decision: { value: string; when: string; navigate: string; artifacts: unknown }[];
}
interface Form {
  constraints: string[];
  stages: Stage[];
  artifacts: { id: string; file: string; description: string; required: boolean | null }[];
  downstream: { workflow: string; artifacts: { key: string; value: string }[] | null }[];
}
interface Choice {
  value: string;
  label: string;
}
interface Model {
  emptyForm: () => Form;
  normalizeForm: (input: unknown) => Form;
  moveItem: (list: unknown[], index: number, delta: number) => number;
  moveStage: (form: Form, index: number, delta: number) => number;
  removeStage: (form: Form, index: number) => void;
  renameStageReferences: (form: Form, oldId: string, newId: string) => boolean;
  uniqueValues: (values: string[]) => string[];
  stageIds: (form: Form) => string[];
  renameArtifactReferences: (form: Form, oldId: string, newId: string) => boolean;
  formPathOf: (form: Form, path: string) => string;
  roleOptions: (model: unknown, current: string) => Choice[];
  isKnownModel: (model: unknown, client: string, name: string) => boolean;
  agentModelLabel: (agent: { clientType?: string; model?: string }) => string;
  resumeOptions: (form: Form, stage: Stage, current: string) => Choice[];
  artifactIdOptions: (form: Form, current: string) => Choice[];
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
        artifacts: ['plan'],
        decision: [
          { value: 'approved', navigate: 'review, complete', artifacts: { kind: 'ids', ids: ['plan'] } },
          { value: 'revise', navigate: 'plan' },
        ],
      },
      { id: 'review', role: 'reviewer', depends_on: ['plan'], sessionResumeFrom: 'plan' },
      { id: 'ship', role: '', depends_on: ['review'] },
    ],
    artifacts: [{ id: 'plan', file: 'plan.md' }],
    downstream: [
      { workflow: 'next', artifacts: [{ key: 'in', value: 'plan' }] },
      { workflow: 'all' },
    ],
  });
}

describe('normalizeForm', () => {
  it('fills every missing field and tolerates junk input', () => {
    expect(model.normalizeForm(null)).toEqual(model.emptyForm());
    const form = model.normalizeForm({ stages: [null, { id: 'a', depends_on: 'x' }], constraints: 'x' });
    expect(form.stages[1].depends_on).toEqual([]);
    expect(form.stages[1].decision).toEqual([]);
  });

  it('copies every list, so editing the draft never changes a copy normalized from the same source', () => {
    const source = {
      constraints: ['a'],
      stages: [
        {
          id: 's',
          depends_on: ['d'],
          instructions: ['i'],
          verify: ['v'],
          runWhenPaths: ['p'],
          artifacts: ['x'],
          decision: [{ value: 'ok', artifacts: { kind: 'ids', ids: ['q'] } }],
        },
      ],
    };
    const draft = model.normalizeForm(source);
    const saved = model.normalizeForm(source);
    draft.constraints.push('new');
    draft.stages[0].depends_on.push('new');
    draft.stages[0].instructions.push('new');
    draft.stages[0].verify.push('new');
    draft.stages[0].runWhenPaths.push('new');
    draft.stages[0].artifacts.push('new');
    (draft.stages[0].decision[0].artifacts as { ids: string[] }).ids.push('new');

    expect(saved).toEqual(model.normalizeForm(source));
    expect(source.constraints).toEqual(['a']);
  });

  it('keeps an omitted downstream mapping omitted and an empty one empty', () => {
    const form = model.normalizeForm({ downstream: [{ workflow: 'a' }, { workflow: 'b', artifacts: [] }] });
    expect(form.downstream.map((target) => target.artifacts)).toEqual([null, []]);
  });

  it('keeps the shape of a decision route\'s artifacts', () => {
    const form = makeForm();
    expect(form.stages[0].decision.map((route) => route.artifacts)).toEqual([{ kind: 'ids', ids: ['plan'] }, null]);
  });
});

describe('renameStageReferences', () => {
  it('updates depends_on, sessionResumeFrom and decision routes', () => {
    const form = makeForm();
    expect(model.renameStageReferences(form, 'plan', 'design')).toBe(true);
    expect(form.stages[1].depends_on).toEqual(['design']);
    expect(form.stages[1].sessionResumeFrom).toBe('design');

    const routed = makeForm();
    model.renameStageReferences(routed, 'review', 'check');
    expect(routed.stages[0].decision[0].navigate).toBe('check, complete');
    expect(routed.stages[2].depends_on).toEqual(['check']);
  });

  it('does nothing for an empty or unchanged id', () => {
    const form = makeForm();
    expect(model.renameStageReferences(form, '', 'x')).toBe(false);
    expect(model.renameStageReferences(form, 'plan', '')).toBe(false);
    expect(model.renameStageReferences(form, 'plan', 'plan')).toBe(false);
    expect(model.renameStageReferences(form, 'nobody', 'x')).toBe(false);
  });
});

describe('formPathOf', () => {
  const form = (): Form =>
    model.normalizeForm({
      artifacts: [
        { id: 'plan', file: 'plan.md' },
        { id: 'notes', file: 'notes.md' },
      ],
      stages: [
        {
          id: 'review',
          decision: [
            { value: 'approved', navigate: 'complete' },
            {
              value: 'revise',
              navigate: 'review',
              artifacts: { kind: 'local', items: [{ id: 'fixes', file: 'fixes.md' }] },
            },
          ],
        },
      ],
    });

  it('maps registry diagnostics keyed by id to the control at that index', () => {
    expect(model.formPathOf(form(), 'artifacts.notes.file')).toBe('artifacts.1.file');
    expect(model.formPathOf(form(), 'artifacts.plan')).toBe('artifacts.0.id');
    expect(model.formPathOf(form(), 'artifacts.ghost.file')).toBe('artifacts.ghost.file');
  });

  it('maps decision paths that carry the decision name, including decision-local artifacts', () => {
    expect(model.formPathOf(form(), 'stages.0.decision.1.revise.navigate')).toBe('stages.0.decision.1.navigate');
    expect(model.formPathOf(form(), 'stages.0.decision.1.revise.artifacts.fixes.file')).toBe(
      'stages.0.decision.1.artifacts.0.file',
    );
    expect(model.formPathOf(form(), 'stages.0.decision.1.artifacts.fixes.file')).toBe(
      'stages.0.decision.1.artifacts.0.file',
    );
  });

  it('places a diagnostic about a whole object on the control that names it', () => {
    expect(model.formPathOf(form(), 'stages.0')).toBe('stages.0.id');
    expect(model.formPathOf(form(), 'stages.0.decision.1')).toBe('stages.0.decision.1.value');
    expect(model.formPathOf(form(), 'stages.0.decision.1.revise')).toBe('stages.0.decision.1.value');
    expect(model.formPathOf(form(), 'stages.0.decision.1.revise.artifacts.fixes')).toBe(
      'stages.0.decision.1.artifacts.0.id',
    );
    expect(model.formPathOf(form(), 'stages.0.decision.1.revise.artifacts')).toBe(
      'stages.0.decision.1.artifacts.kind',
    );
  });

  it('maps a list index of registry ids to the checkbox of that id, for a stage and for a decision', () => {
    const withIds = (): Form =>
      model.normalizeForm({
        artifacts: [{ id: 'plan', file: 'plan.md' }, { id: 'notes', file: 'notes.md' }],
        stages: [
          {
            id: 's',
            artifacts: ['plan', 'notes'],
            decision: [{ value: 'approved', navigate: 'complete', artifacts: { kind: 'ids', ids: ['notes'] } }],
          },
        ],
      });
    expect(model.formPathOf(withIds(), 'stages.0.artifacts.1')).toBe('stages.0.artifacts.notes');
    expect(model.formPathOf(withIds(), 'stages.0.decision.0.approved.artifacts.0')).toBe(
      'stages.0.decision.0.artifacts.ids.notes',
    );
    expect(model.formPathOf(withIds(), 'stages.0.artifacts.9')).toBe('stages.0.artifacts.9');
  });

  it('keeps the CLI path of a flat stage key, because the form uses the file key names', () => {
    for (const key of ['depends_on', 'max_revisions', 'verify_timeout', 'max_verify']) {
      expect(model.formPathOf(form(), `stages.0.${key}`)).toBe(`stages.0.${key}`);
    }
  });

  it('leaves paths it does not know unchanged', () => {
    expect(model.formPathOf(form(), 'stages.0.id')).toBe('stages.0.id');
    expect(model.formPathOf(form(), 'downstream.0.workflow')).toBe('downstream.0.workflow');
    expect(model.formPathOf(form(), 'stages.5.decision.0.x')).toBe('stages.5.decision.0.x');
  });
});

describe('renameArtifactReferences', () => {
  it('updates stage lists, decision lists and downstream mapping values', () => {
    const form = makeForm();
    expect(model.renameArtifactReferences(form, 'plan', 'draft')).toBe(true);
    expect(form.stages[0].artifacts).toEqual(['draft']);
    expect(form.stages[0].decision[0].artifacts).toEqual({ kind: 'ids', ids: ['draft'] });
    expect(form.downstream[0].artifacts).toEqual([{ key: 'in', value: 'draft' }]);
    expect(form.downstream[1].artifacts).toBeNull();
  });

  it('does nothing for an empty, unchanged or unreferenced id', () => {
    const form = makeForm();
    expect(model.renameArtifactReferences(form, '', 'x')).toBe(false);
    expect(model.renameArtifactReferences(form, 'plan', '')).toBe(false);
    expect(model.renameArtifactReferences(form, 'plan', 'plan')).toBe(false);
    expect(model.renameArtifactReferences(form, 'nobody', 'x')).toBe(false);
  });
});

describe('moveItem', () => {
  it('moves an item of any list and reports its new index, or -1 at the ends', () => {
    const list = ['a', 'b', 'c'];
    expect(model.moveItem(list, 2, -1)).toBe(1);
    expect(list).toEqual(['a', 'c', 'b']);
    expect(model.moveItem(list, 0, -1)).toBe(-1);
    expect(model.moveItem(list, 2, 1)).toBe(-1);
    expect(list).toEqual(['a', 'c', 'b']);
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
    expect(form.stages[0].depends_on).toEqual(['plan']);
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

  it('lists registry artifact ids and flags one the registry lacks', () => {
    const form = makeForm();
    expect(model.artifactIdOptions(form, 'plan').map((option) => option.value)).toEqual(['', 'plan']);
    expect(model.artifactIdOptions(form, 'ghost').at(-1)).toEqual({
      value: 'ghost',
      label: 'ghost (not in the registry)',
    });
  });

  it('derives names and labels', () => {
    expect(model.uniqueValues(['a', '', 'a', 'b'])).toEqual(['a', 'b']);
    expect(model.agentModelLabel({ clientType: 'codex', model: 'gpt-5' })).toBe('codex · gpt-5');
    expect(model.agentModelLabel({ model: 'gpt-5' })).toBe('gpt-5 (no client)');
    expect(model.isKnownModel({ clients: [{ id: 'codex', models: ['gpt-5'] }] }, 'codex', 'gpt-5')).toBe(true);
    expect(model.isKnownModel({ clients: [] }, 'codex', 'gpt-5')).toBe(false);
  });
});
