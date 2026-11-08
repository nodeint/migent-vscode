import { describe, expect, it } from 'vitest';

import { parseWorkflowEditorMessage } from './workflowEditorIntent';

const HASH = 'a'.repeat(64);

describe('parseWorkflowEditorMessage', () => {
  it('accepts every closed action name', () => {
    for (const type of ['openFile', 'reload', 'reveal', 'run', 'duplicate', 'delete', 'pickModel'] as const) {
      expect(parseWorkflowEditorMessage({ type })).toEqual({ type });
    }
  });

  it('accepts a save request with a draft and its SHA-256 base hash', () => {
    expect(parseWorkflowEditorMessage({ type: 'saveForm', form: { id: 'plan' }, baseHash: HASH })).toEqual({
      type: 'saveForm',
      form: { id: 'plan' },
      baseHash: HASH,
    });
  });

  it('drops a save request without both a draft and a valid base hash', () => {
    expect(parseWorkflowEditorMessage({ type: 'saveForm', form: {}, baseHash: 'abc' })).toBeNull();
    expect(parseWorkflowEditorMessage({ type: 'saveForm', form: {}, baseHash: 'A'.repeat(64) })).toBeNull();
    expect(parseWorkflowEditorMessage({ type: 'saveForm', baseHash: HASH })).toBeNull();
    expect(parseWorkflowEditorMessage({ type: 'saveForm', form: [], baseHash: HASH })).toBeNull();
  });

  it('rejects unknown actions and payload types', () => {
    expect(parseWorkflowEditorMessage({ type: 'remove' })).toBeNull();
    expect(parseWorkflowEditorMessage({ type: 'path', path: '../../../etc/passwd' })).toBeNull();
    expect(parseWorkflowEditorMessage({})).toBeNull();
    expect(parseWorkflowEditorMessage({ type: 7 })).toBeNull();
    expect(parseWorkflowEditorMessage(null)).toBeNull();
    expect(parseWorkflowEditorMessage('run')).toBeNull();
  });
});
