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

  it('accepts next-step intents by workflow id and reload without arguments', () => {
    expect(parseResultsMessage({ type: 'intent', intent: 'openNextStep', workflow: 'impl', argv: ['x'] })).toEqual({
      type: 'intent',
      value: { intent: 'openNextStep', workflow: 'impl' },
    });
    expect(parseResultsMessage({ type: 'intent', intent: 'openNextStep' })).toBeNull();
    expect(parseResultsMessage({ type: 'intent', intent: 'reloadSuggestions' })).toEqual({
      type: 'intent',
      value: { intent: 'reloadSuggestions' },
    });
  });

  it('accepts each of the seven header actions and nothing else', () => {
    for (const action of ['openResult', 'openTask', 'showLog', 'copyId', 'revealInExplorer', 'openQuestions', 'openMetrics']) {
      expect(parseResultsMessage({ type: 'intent', intent: 'sessionAction', action })).toEqual({
        type: 'intent',
        value: { intent: 'sessionAction', action },
      });
    }
    expect(
      parseResultsMessage({ type: 'intent', intent: 'sessionAction', action: 'openTask', command: 'x', path: 'C:/x' }),
    ).toEqual({ type: 'intent', value: { intent: 'sessionAction', action: 'openTask' } });
    expect(parseResultsMessage({ type: 'intent', intent: 'sessionAction' })).toBeNull();
    expect(parseResultsMessage({ type: 'intent', intent: 'sessionAction', action: 'migent.session.openTask' })).toBeNull();
    expect(parseResultsMessage({ type: 'intent', intent: 'sessionAction', action: 'deleteSession' })).toBeNull();
    expect(parseResultsMessage({ type: 'intent', intent: 'sessionAction', action: 7 })).toBeNull();
    expect(parseResultsMessage({ type: 'intent', intent: 'sessionAction', action: ['openTask'] })).toBeNull();
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
