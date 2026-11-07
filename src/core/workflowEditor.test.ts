import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import type { ClientChoice } from './controlArgs';
import { readProjectConfig } from './projectConfig';
import { parseWorkflowAuthoringEnvelope, readWorkflowEditor, workflowBodyFromForm, workflowDraftFromForm, workflowFormFromClient } from './workflowEditor';
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

const FULL = `schema_version: 5
id: plan
concurrency: 1
constraints:
  - Plan only.
stages:
  - id: plan
    description: First pass
    role: planner
    ask: human
    agent: deep_reasoning
    max_revisions: 3
    instructions:
      - Write the plan.
    produces:
      artifact: plan.md
    verify:
      - pnpm build
    verify_timeout: 120
    session:
      resume_from: prepare
    decision:
      - approved:
          when: Ready.
          navigate: review
      - revise:
          when: More work.
          navigate: plan
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
outputs:
  - name: plan
    from_stage: plan
    artifact: plan.md
downstream:
  - workflow: implement
    task: Implement it.
    artifacts:
      plan: plan
`;

const CONFIG = 'schema_version: 5\nroles:\n  planner: {}\n  reviewer: {}\nagents:\n  deep_reasoning: {}\n';

describe('readWorkflowEditor', () => {
  it('projects a schema 5 workflow into the form model', () => {
    const result = model(
      project(
        {
          'plan.yaml': FULL,
          'implement.yaml': 'schema_version: 5\nid: implement\nstages:\n  - id: implement\n',
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
      maxRevisions: 3,
      instructions: ['Write the plan.'],
      producesArtifact: 'plan.md',
      verify: ['pnpm build'],
      verifyTimeout: 120,
      sessionResumeFrom: 'prepare',
      decision: [
        { value: 'approved', when: 'Ready.', navigate: 'review' },
        { value: 'revise', when: 'More work.', navigate: 'plan' },
      ],
    });
    expect(review).toMatchObject({
      id: 'review',
      role: 'reviewer',
      agentMode: 'inline',
      dependsOn: ['plan'],
      runWhenPaths: ['docs/**/*'],
    });
    expect(review.agent).toEqual({
      model: 'gpt-5',
      effort: 'high',
      clientType: 'codex',
      clientOptions: [{ key: 'sandbox', value: 'read-only' }],
    });
    expect(result.form.outputs).toEqual([{ name: 'plan', fromStage: 'plan', artifact: 'plan.md' }]);
    expect(result.form.downstream).toEqual([
      { workflow: 'implement', task: 'Implement it.', artifacts: [{ key: 'plan', value: 'plan' }] },
    ]);
  });

  it('turns a list of decision destinations into comma-separated text and back', () => {
    const source = `schema_version: 5
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
    const body = workflowBodyFromForm(result.form);
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

  it('marks another schema version unsupported but still projects its fields', () => {
    const result = model(project({ 'old.yaml': 'schema_version: 4\nid: old\nstages:\n  - id: a\n' }), 'old.yaml');
    expect(result.state).toBe('unsupported');
    expect(result.isSupported).toBe(false);
    expect(result.schemaVersion).toBe(4);
    expect(result.readError).toBe('schema_version must be 5');
    expect(result.form.stages.map((stage) => stage.id)).toEqual(['a']);
  });

  it('reports a missing file as unreadable, never creating it', () => {
    const result = model(project({}), 'gone.yaml');
    expect(result.state).toBe('unreadable');
    expect(result.file).toBe('gone.yaml');
    expect(result.yaml).toBe('');
  });

  it('lists the other files that declare the same id', () => {
    const root = project({ 'a.yaml': 'schema_version: 5\nid: shared\n', 'b.yaml': 'schema_version: 5\nid: shared\n' });
    expect(model(root, 'a.yaml').duplicateOf).toEqual(['b.yaml']);
  });

  it('carries the client suggestions into the model', () => {
    const clients = [{ id: 'codex', models: ['gpt-5'], optionKeys: ['model_reasoning_effort'] }];
    const result = model(project({ 'a.yaml': 'schema_version: 5\nid: a\n' }), 'a.yaml', clients);
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
      outputs: [],
      downstream: [],
    });
    expect(form.stages[0]).toMatchObject({ id: 'a', agentMode: 'named', agentName: 'fast' });
    expect(form.stages[0]).not.toHaveProperty('options');
    expect(form.stages[1].agent).toMatchObject({ clientType: 'codex', model: 'gpt-5' });
    expect(workflowBodyFromForm(form)).not.toHaveProperty('title');
  });

  it('serializes the form as a canonical schema 5 draft', () => {
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
          producesArtifact: 'plan.md',
          decision: [{ value: 'approved', when: 'Ready.', navigate: 'complete' }],
        },
      ],
      outputs: [{ name: 'plan', fromStage: 'plan', artifact: 'plan.md' }],
      downstream: [{ workflow: 'implement', task: 'Do it.', artifacts: [{ key: 'plan', value: 'plan' }] }],
    });
    const draft = workflowDraftFromForm(form);
    expect(parse(draft)).toEqual({
      schema_version: 5,
      id: 'plan',
      concurrency: 1,
      constraints: ['Plan only.'],
      stages: [
        {
          id: 'plan',
          role: 'planner',
          agent: 'deep_reasoning',
          instructions: ['Write it.'],
          produces: { artifact: 'plan.md' },
          decision: [{ approved: { when: 'Ready.', navigate: 'complete' } }],
        },
      ],
      outputs: [{ name: 'plan', from_stage: 'plan', artifact: 'plan.md' }],
      downstream: [{ workflow: 'implement', task: 'Do it.', artifacts: { plan: 'plan' } }],
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
    const body = workflowBodyFromForm(form);
    expect(body.stages).toEqual([
      {
        id: 'plan',
        role: 'planner',
        agent: { model: 'gpt-5', client: { type: 'codex', options: { sandbox: 'read-only' } } },
      },
    ]);
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
