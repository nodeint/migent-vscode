import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import type { ClientChoice } from './controlArgs';
import { readProjectConfig } from './projectConfig';
import { duplicateWorkflowText, workflowFileName, workflowIdProblem } from './workflowDraft';
import { duplicateArtifactProblem, newWorkflowForm, parseWorkflowAuthoringEnvelope, readWorkflowEditor, workflowBodyFromForm, workflowDraftFromForm, workflowFormFromClient } from './workflowEditor';
import { scanWorkflows } from './workflows';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function project(files: Record<string, string>, config = 'schema_version: 5\n'): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'migent-vscode-wf-editor-'));
  dirs.push(root);
  mkdirSync(path.join(root, '.migent', 'workflows'), { recursive: true });
  writeFileSync(path.join(root, '.migent', 'config.yaml'), config);
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(path.join(root, '.migent', 'workflows', name), text);
  }
  return root;
}

function model(root: string, file: string, clients: ClientChoice[] = []) {
  return readWorkflowEditor({
    projectKey: 'p',
    projectName: 'demo',
    projectRoot: root,
    file,
    scan: scanWorkflows(root),
    config: readProjectConfig(root),
    clients,
  });
}

const FULL = `schema_version: 7
id: plan
concurrency: 1
constraints:
  - Plan only.
artifacts:
  plan:
    file: plan.md
    description: The plan
    required: true
  notes:
    file: notes.md
stages:
  - id: plan
    description: First pass
    role: planner
    ask: human
    agent: deep_reasoning
    max_revisions: 3
    instructions:
      - Write the plan.
    artifacts: [plan, notes]
    verify:
      - pnpm build
    verify_timeout: 120
    session:
      resume_from: prepare
    decision:
      - approved:
          when: Ready.
          navigate: review
          artifacts: [notes]
      - revise:
          when: More work.
          navigate: plan
          artifacts:
            feedback:
              file: feedback.md
              description: What to change
  - id: review
    role: reviewer
    depends_on: [plan]
    agent:
      model: gpt-5
      effort: high
      client:
        type: codex
        options:
          sandbox: read-only
    run_when:
      changed_paths:
        - "docs/**/*"
    instructions:
      - Review it.
downstream:
  - workflow: implement
    task: Implement it.
    artifacts:
      plan: plan
  - workflow: docs
    task: Document it.
`;

const CONFIG = 'schema_version: 5\nroles:\n  planner: {}\n  reviewer: {}\nagents:\n  deep_reasoning: {}\n';

describe('readWorkflowEditor', () => {
  it('projects a schema 7 workflow into the form model', () => {
    const result = model(
      project(
        {
          'plan.yaml': FULL,
          'implement.yaml': 'schema_version: 7\nid: implement\nstages:\n  - id: implement\n',
        },
        CONFIG,
      ),
      'plan.yaml',
    );

    expect(result.state).toBe('ok');
    expect(result.isSupported).toBe(true);
    expect(result.id).toBe('plan');
    expect(result.path).toBe('.migent/workflows/plan.yaml');
    expect(result.roles).toEqual(['planner', 'reviewer']);
    expect(result.agents).toEqual(['deep_reasoning']);
    expect(result.workflows).toEqual([{ id: 'implement', file: 'implement.yaml' }]);
    expect(result.yaml).toBe(FULL);
    expect(result.savedHash).toHaveLength(64);

    const [plan, review] = result.form.stages;
    expect(plan).toMatchObject({
      id: 'plan',
      description: 'First pass',
      role: 'planner',
      ask: 'human',
      agentMode: 'named',
      agentName: 'deep_reasoning',
      max_revisions: 3,
      instructions: ['Write the plan.'],
      artifacts: ['plan', 'notes'],
      verify: ['pnpm build'],
      verify_timeout: 120,
      sessionResumeFrom: 'prepare',
      decision: [
        { value: 'approved', when: 'Ready.', navigate: 'review', artifacts: { kind: 'ids', ids: ['notes'] } },
        {
          value: 'revise',
          when: 'More work.',
          navigate: 'plan',
          artifacts: { kind: 'local', items: [{ id: 'feedback', file: 'feedback.md', description: 'What to change' }] },
        },
      ],
    });
    expect(review).toMatchObject({
      id: 'review',
      role: 'reviewer',
      agentMode: 'inline',
      depends_on: ['plan'],
      runWhenPaths: ['docs/**/*'],
    });
    expect(review.agent).toEqual({
      model: 'gpt-5',
      effort: 'high',
      clientType: 'codex',
      clientOptions: [{ key: 'sandbox', value: 'read-only' }],
    });
    expect(result.form.artifacts).toEqual([
      { id: 'plan', file: 'plan.md', description: 'The plan', required: true },
      { id: 'notes', file: 'notes.md', description: '', required: null },
    ]);
    expect(result.form.downstream).toEqual([
      { workflow: 'implement', task: 'Implement it.', artifacts: [{ key: 'plan', value: 'plan' }] },
      { workflow: 'docs', task: 'Document it.', artifacts: null },
    ]);
    expect(result.canSave).toBe(true);
  });

  it('round-trips a schema 7 file without dropping the registry, stage artifacts or an omitted mapping', () => {
    const result = model(project({ 'plan.yaml': FULL }, CONFIG), 'plan.yaml');
    const draft = workflowBodyFromForm(workflowFormFromClient(result.form), result.schemaVersion);
    expect(draft).toEqual(parse(FULL));
  });

  it('keeps an explicit empty mapping apart from an omitted one, through a save round trip', () => {
    const source =
      'schema_version: 7\nid: a\nstages:\n  - id: s\ndownstream:\n  - workflow: b\n    artifacts: {}\n  - workflow: c\n';
    const result = model(project({ 'a.yaml': source }), 'a.yaml');
    expect(result.form.downstream.map((target) => target.artifacts)).toEqual([[], null]);
    const body = workflowBodyFromForm(workflowFormFromClient(result.form), result.schemaVersion);
    expect(body.downstream).toEqual([{ workflow: 'b', artifacts: {} }, { workflow: 'c' }]);
  });

  it.each(['plan.yaml', 'implement.yaml', 'schema-workflow.yaml'])(
    'round-trips the official 0.5.1 %s without losing its registry or artifact references',
    (file) => {
      const text = readFileSync(path.join(__dirname, 'fixtures', 'workflows-0.5.1', file), 'utf8');
      const result = model(project({ [file]: text }), file);
      expect(result.state).toBe('ok');
      expect(result.form.artifacts.length).toBeGreaterThan(0);
      const body = workflowBodyFromForm(workflowFormFromClient(result.form), result.schemaVersion);
      expect(body.artifacts).toEqual((parse(text) as { artifacts: unknown }).artifacts);
      const original = parse(text) as { stages: { id: string; artifacts?: string[]; decision?: unknown[] }[] };
      const saved = body.stages as typeof original.stages;
      expect(saved.map((stage) => stage.artifacts)).toEqual(original.stages.map((stage) => stage.artifacts));
      expect(saved.map((stage) => stage.decision)).toEqual(original.stages.map((stage) => stage.decision));
      expect(body.downstream).toEqual((parse(text) as { downstream?: unknown }).downstream);
    },
  );

  it('turns a list of decision destinations into comma-separated text and back', () => {
    const source = `schema_version: 7
id: routed
stages:
  - id: review
    role: reviewer
    decision:
      - approved:
          navigate: [test, docs]
`;
    const result = model(project({ 'routed.yaml': source }), 'routed.yaml');
    expect(result.form.stages[0].decision[0].navigate).toBe('test, docs');
    const body = workflowBodyFromForm(result.form, result.schemaVersion);
    expect(body.stages).toEqual([
      {
        id: 'review',
        role: 'reviewer',
        decision: [{ approved: { navigate: ['test', 'docs'] } }],
      },
    ]);
  });

  it('keeps the text and reports invalid YAML', () => {
    const result = model(project({ 'broken.yaml': 'id: [unclosed\n' }), 'broken.yaml');
    expect(result.state).toBe('invalid');
    expect(result.isSupported).toBe(false);
    expect(result.readError).toBeTruthy();
    expect(result.yaml).toBe('id: [unclosed\n');
    expect(result.form.stages).toEqual([]);
  });

  it('reads any schema other than 7 as unsupported and cannot be saved', () => {
    for (const text of ['schema_version: 6\nid: old\nstages:\n  - id: a\n', 'id: old\nstages:\n  - id: a\n']) {
      const result = model(project({ 'old.yaml': text }), 'old.yaml');
      expect(result.state).toBe('unsupported');
      expect(result.isSupported).toBe(false);
      expect(result.canSave).toBe(false);
      expect(result.yaml).toBe(text);
      expect(result.readError).toBeNull();
    }
  });

  it('reports a missing file as unreadable, never creating it', () => {
    const result = model(project({}), 'gone.yaml');
    expect(result.state).toBe('unreadable');
    expect(result.file).toBe('gone.yaml');
    expect(result.yaml).toBe('');
  });

  it('lists the other files that declare the same id', () => {
    const root = project({ 'a.yaml': 'schema_version: 7\nid: shared\n', 'b.yaml': 'schema_version: 7\nid: shared\n' });
    expect(model(root, 'a.yaml').duplicateOf).toEqual(['b.yaml']);
  });

  it('carries the client suggestions into the model', () => {
    const clients = [{ id: 'codex', models: ['gpt-5'], optionKeys: ['model_reasoning_effort'] }];
    const result = model(project({ 'a.yaml': 'schema_version: 7\nid: a\n' }), 'a.yaml', clients);
    expect(result.clients).toEqual(clients);
  });
});

describe('the page draft', () => {
  it('normalizes untrusted fields and drops unknown ones', () => {
    const form = workflowFormFromClient({
      id: 'plan',
      title: 'dropped',
      stages: [
        {
          id: 'a',
          agentMode: 'named',
          agentName: 'fast',
          options: { effort: 'high' },
          decision: [{ value: 'ok', navigate: 'complete' }],
        },
        { id: 'b', agentMode: 'inline', agent: { clientType: 'codex', model: 'gpt-5', clientOptions: [{ key: 'k', value: 'v' }] } },
      ],
      artifacts: [],
      downstream: [],
    });
    expect(form.stages[0]).toMatchObject({ id: 'a', agentMode: 'named', agentName: 'fast' });
    expect(form.stages[0]).not.toHaveProperty('options');
    expect(form.stages[1].agent).toMatchObject({ clientType: 'codex', model: 'gpt-5' });
    expect(workflowBodyFromForm(form, 7)).not.toHaveProperty('title');
  });

  it('serializes the form as a canonical schema 7 draft', () => {
    const form = workflowFormFromClient({
      id: 'plan',
      concurrency: 1,
      constraints: ['Plan only.'],
      stages: [
        {
          id: 'plan',
          role: 'planner',
          agentMode: 'named',
          agentName: 'deep_reasoning',
          instructions: ['Write it.'],
          artifacts: ['plan'],
          decision: [{ value: 'approved', when: 'Ready.', navigate: 'complete' }],
        },
      ],
      artifacts: [{ id: 'plan', file: 'plan.md' }],
      downstream: [
        { workflow: 'implement', task: 'Do it.', artifacts: [{ key: 'plan', value: 'plan' }] },
        { workflow: 'docs', task: 'Doc it.' },
      ],
    });
    const draft = workflowDraftFromForm(form, 7);
    expect(parse(draft)).toEqual({
      schema_version: 7,
      id: 'plan',
      concurrency: 1,
      constraints: ['Plan only.'],
      artifacts: { plan: { file: 'plan.md' } },
      stages: [
        {
          id: 'plan',
          role: 'planner',
          agent: 'deep_reasoning',
          instructions: ['Write it.'],
          artifacts: ['plan'],
          decision: [{ approved: { when: 'Ready.', navigate: 'complete' } }],
        },
      ],
      downstream: [
        { workflow: 'implement', task: 'Do it.', artifacts: { plan: 'plan' } },
        { workflow: 'docs', task: 'Doc it.' },
      ],
    });
  });

  it('writes an inline agent and omits the keys the form left empty', () => {
    const form = workflowFormFromClient({
      id: 'plan',
      stages: [
        {
          id: 'plan',
          role: 'planner',
          agentMode: 'inline',
          agent: { model: 'gpt-5', clientType: 'codex', clientOptions: [{ key: 'sandbox', value: 'read-only' }] },
        },
      ],
    });
    const body = workflowBodyFromForm(form, 7);
    expect(body.stages).toEqual([
      {
        id: 'plan',
        role: 'planner',
        agent: { model: 'gpt-5', client: { type: 'codex', options: { sandbox: 'read-only' } } },
      },
    ]);
  });
});

describe('duplicateArtifactProblem', () => {
  it('is null for distinct ids, including the same id in different decisions', () => {
    const form = workflowFormFromClient({
      artifacts: [{ id: 'a', file: 'a.md' }, { id: 'b', file: 'b.md' }],
      stages: [
        {
          id: 's',
          decision: [
            { value: 'x', artifacts: { kind: 'local', items: [{ id: 'fixes', file: 'f.md' }] } },
            { value: 'y', artifacts: { kind: 'local', items: [{ id: 'fixes', file: 'g.md' }] } },
          ],
        },
      ],
    });
    expect(duplicateArtifactProblem(form)).toBeNull();
  });

  it('names a registry id used twice, which would otherwise keep only the second definition', () => {
    const form = workflowFormFromClient({
      artifacts: [{ id: 'plan', file: 'a.md' }, { id: 'plan', file: 'b.md' }],
    });
    expect(duplicateArtifactProblem(form)).toMatch(/"plan" is used more than once/);
  });

  it('names a decision-local id defined twice in one decision', () => {
    const form = workflowFormFromClient({
      stages: [
        {
          id: 'review',
          decision: [{ value: 'revise', artifacts: { kind: 'local', items: [{ id: 'fixes', file: 'a.md' }, { id: 'fixes', file: 'b.md' }] } }],
        },
      ],
    });
    expect(duplicateArtifactProblem(form)).toMatch(/Decision "revise" of stage "review".*"fixes"/);
  });
});

describe('parseWorkflowAuthoringEnvelope', () => {
  it('maps diagnostics to page paths and reads the save result', () => {
    const result = parseWorkflowAuthoringEnvelope({
      schema_version: 1,
      command: 'workflow.save',
      valid: false,
      diagnostics: [
        { severity: 'error', code: 'invalid-value', message: 'client is required.', path: ['stages', 0, 'agent', 'client', 'type'] },
        { severity: 'warning', code: 'comments-not-preserved', message: 'Comments were not preserved.' },
      ],
      file: 'workflows/plan.yaml',
      current_hash: 'c'.repeat(64),
    });
    expect(result).toEqual({
      valid: false,
      diagnostics: [
        { severity: 'error', code: 'invalid-value', message: 'client is required.', path: 'stages.0.agent.client.type' },
        { severity: 'warning', code: 'comments-not-preserved', message: 'Comments were not preserved.', path: '' },
      ],
      file: 'workflows/plan.yaml',
      hash: null,
      written: false,
      currentHash: 'c'.repeat(64),
    });
  });

  it('refuses output that is not an envelope', () => {
    expect(parseWorkflowAuthoringEnvelope({ valid: true })).toBeNull();
    expect(parseWorkflowAuthoringEnvelope(null)).toBeNull();
  });
});

describe('creating and duplicating workflows', () => {
  it('accepts only path-safe ids', () => {
    expect(workflowIdProblem('plan_2-b')).toBeNull();
    for (const bad of ['', '../x', 'a/b', '-a', 'a b', 'a.yaml']) expect(workflowIdProblem(bad)).not.toBeNull();
    expect(workflowFileName('plan')).toBe('plan.yaml');
  });

  it('reads a missing file as a new starter draft only when the page asks for one', () => {
    const root = project({});
    const base = { projectKey: 'p', projectName: 'demo', projectRoot: root, file: 'fresh.yaml', scan: scanWorkflows(root), config: readProjectConfig(root) };
    const fresh = readWorkflowEditor({ ...base, isNew: true });
    expect(fresh).toMatchObject({ mode: 'new', id: 'fresh', canSave: true, state: 'ok' });
    expect(fresh.form.stages).toHaveLength(1);
    expect(readWorkflowEditor(base)).toMatchObject({ mode: 'edit', state: 'unreadable', canSave: false });
    expect(newWorkflowForm('x', ['dev']).stages[0]?.role).toBe('dev');
  });

  it('copies the saved text with a new id and keeps comments', () => {
    const text = '# keep\nschema_version: 7\nid: a\nstages: []\n';
    const copy = duplicateWorkflowText(text, 'b') ?? '';
    expect(copy).toContain('# keep');
    expect(parse(copy)).toMatchObject({ id: 'b', schema_version: 7 });
    expect(duplicateWorkflowText('- a\n- b\n', 'b')).toBeNull();
  });
});
