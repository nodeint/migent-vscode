import { describe, expect, it } from 'vitest';

import { classifyLaunch, type LaunchFacts, targetState } from './nextStepEligibility';
import type { WorkflowEntry } from './workflows';

function entry(id: string, state: 'ok' | 'invalid' = 'ok'): WorkflowEntry {
  return { id, file: `${id}.yaml`, state, error: null, title: null, stages: [], duplicate: false };
}

const READY: LaunchFacts = { sourceState: 'completed', declared: true, target: 'available' };

describe('targetState', () => {
  it('names a missing, duplicate, invalid or available target', () => {
    expect(targetState('a', [])).toBe('not-found');
    expect(targetState('a', [entry('a'), entry('a')])).toBe('duplicate');
    expect(targetState('a', [entry('a', 'invalid')])).toBe('invalid');
    expect(targetState('a', [entry('a')])).toBe('available');
  });
});

describe('classifyLaunch', () => {
  it('is ready for a Completed source, a declared suggestion and an available target', () => {
    expect(classifyLaunch(READY)).toEqual({ state: 'ready' });
  });

  it('gives each block its closed reason, source first', () => {
    expect(classifyLaunch({ ...READY, sourceState: 'running' })).toEqual({ state: 'blocked', reason: 'sourceNotCompleted' });
    expect(classifyLaunch({ ...READY, declared: false })).toEqual({ state: 'blocked', reason: 'notDeclared' });
    expect(classifyLaunch({ ...READY, declared: null })).toEqual({ state: 'blocked', reason: 'declarationUnreadable' });
    expect(classifyLaunch({ ...READY, target: 'not-found' })).toEqual({ state: 'blocked', reason: 'targetNotFound' });
    expect(classifyLaunch({ ...READY, target: 'invalid' })).toEqual({ state: 'blocked', reason: 'targetInvalid' });
    expect(classifyLaunch({ ...READY, target: 'duplicate' })).toEqual({ state: 'blocked', reason: 'targetDuplicate' });
    expect(classifyLaunch({ sourceState: 'failed', declared: false, target: 'not-found' })).toEqual({
      state: 'blocked',
      reason: 'sourceNotCompleted',
    });
  });
});
