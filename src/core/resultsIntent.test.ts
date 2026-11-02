import { describe, expect, it } from 'vitest';

import { parseResultsMessage } from './resultsIntent';

describe('parseResultsMessage', () => {
  it('accepts the ready handshake and each intent with its identity field', () => {
    expect(parseResultsMessage({ type: 'ready' })).toEqual({ type: 'ready' });
    expect(parseResultsMessage({ type: 'intent', intent: 'openNextFile', revision: 3 })).toEqual({
      type: 'intent',
      value: { intent: 'openNextFile' },
    });
    expect(parseResultsMessage({ type: 'intent', intent: 'openManifest' })).toEqual({
      type: 'intent',
      value: { intent: 'openManifest' },
    });
    expect(parseResultsMessage({ type: 'intent', intent: 'openOutput', name: 'note' })).toEqual({
      type: 'intent',
      value: { intent: 'openOutput', name: 'note' },
    });
    expect(parseResultsMessage({ type: 'intent', intent: 'openHandoffFile', name: 'a' })).toEqual({
      type: 'intent',
      value: { intent: 'openHandoffFile', name: 'a' },
    });
    expect(parseResultsMessage({ type: 'intent', intent: 'openTargetWorkflow', workflow: 'w' })).toEqual({
      type: 'intent',
      value: { intent: 'openTargetWorkflow', workflow: 'w' },
    });
    expect(parseResultsMessage({ type: 'intent', intent: 'openSession', sessionId: 's' })).toEqual({
      type: 'intent',
      value: { intent: 'openSession', sessionId: 's' },
    });
  });

  it('drops extra fields such as paths and commands', () => {
    expect(
      parseResultsMessage({ type: 'intent', intent: 'openOutput', name: 'note', path: 'C:/x', command: 'rm' }),
    ).toEqual({ type: 'intent', value: { intent: 'openOutput', name: 'note' } });
  });

  it('rejects unknown intents, missing or non-string fields and non-objects', () => {
    expect(parseResultsMessage({ type: 'intent', intent: 'run', command: 'migent' })).toBeNull();
    expect(parseResultsMessage({ type: 'intent', intent: 'openOutput' })).toBeNull();
    expect(parseResultsMessage({ type: 'intent', intent: 'openOutput', name: 7 })).toBeNull();
    expect(parseResultsMessage({ type: 'intent', intent: 'openSession', sessionId: '' })).toBeNull();
    expect(parseResultsMessage({ type: 'other' })).toBeNull();
    expect(parseResultsMessage('ready')).toBeNull();
    expect(parseResultsMessage(null)).toBeNull();
  });
});
