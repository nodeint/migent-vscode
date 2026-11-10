import { isValid,WORKFLOW_SCHEMA_VERSION, WorkflowDocumentInput } from '@nodeint/migent-contracts';
import { describe, expect, it } from 'vitest';

import type { WorkflowDraft, WorkflowStageDraft } from './workflowContractDraft';
import { workflowBodyFromForm, workflowFormFromClient } from './workflowEditor';
import { EDITABLE_SCHEMA_VERSION } from './workflowForm';

describe('workflow draft against the contract', () => {
  it('serializes an incomplete draft (no schema_version, empty id, route without navigate, downstream without task)', () => {
    const form = workflowFormFromClient({
      id: '',
      stages: [{ id: 'a', decision: [{ value: 'x', when: 'w', navigate: '' }] }],
      downstream: [{ workflow: 'next', task: '' }],
    });
    expect(workflowBodyFromForm(form, null)).toEqual({
      stages: [{ id: 'a', decision: [{ x: { when: 'w' } }] }],
      downstream: [{ workflow: 'next' }],
    });
  });

  it('renders a complete form as a valid WorkflowDocumentInput', () => {
    const form = workflowFormFromClient({
      id: 'plan',
      concurrency: 2,
      constraints: ['c'],
      artifacts: [{ id: 'plan', file: 'plan.md', description: 'd', required: true }],
      stages: [
        {
          id: 'plan',
          role: 'planner',
          ask: 'human',
          agentMode: 'inline',
          agent: { model: 'm', clientType: 'codex', clientOptions: [{ key: 'a', value: 'b' }] },
          verify: ['pnpm test'],
          max_revisions: 2,
          sessionResumeFrom: 'prev',
          runWhenPaths: ['src/**'],
          decision: [{ value: 'ok', navigate: 'done', artifacts: { kind: 'local', items: [{ id: 'f', file: 'f.md' }] } }],
        },
      ],
      downstream: [{ workflow: 'next', task: 't', artifacts: [{ key: 'plan', value: 'plan' }] }],
    });
    expect(isValid(WorkflowDocumentInput, workflowBodyFromForm(form, WORKFLOW_SCHEMA_VERSION))).toBe(true);
  });

  it('reads an ask other than human as none', () => {
    const form = workflowFormFromClient({ id: 'p', stages: [{ id: 'a', ask: 'robot' }] });
    expect(form.stages[0].ask).toBe('');
  });

  it('pins the editable schema version to the contract', () => {
    expect(EDITABLE_SCHEMA_VERSION).toBe(WORKFLOW_SCHEMA_VERSION);
  });

  it('rejects an unknown key or a value outside the contract type', () => {
    // @ts-expect-error the contract is closed
    const unknown: WorkflowDraft = { title: 'x' };
    // @ts-expect-error max_revisions is an integer or string
    const stage: WorkflowStageDraft = { max_revisions: true };
    // @ts-expect-error ask is only "human"
    const ask: WorkflowStageDraft = { ask: 'robot' };
    expect([unknown, stage, ask]).toHaveLength(3);
  });
});
