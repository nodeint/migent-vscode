import { describe, expect, it } from 'vitest';

import { parseSessionPageMessage } from './sessionPageIntent';

const HASH = 'a'.repeat(64);
const BATCH = { stageId: 'plan', executionId: 'e1' };

describe('parseSessionPageMessage', () => {
  it('accepts the ready handshake and the page-local navigation', () => {
    expect(parseSessionPageMessage({ type: 'ready' })).toEqual({ type: 'ready' });
    expect(parseSessionPageMessage({ type: 'intent', intent: 'selectTab', tab: 'metrics', revision: 2 })).toEqual({
      type: 'intent',
      value: { intent: 'selectTab', tab: 'metrics' },
    });
    expect(parseSessionPageMessage({ type: 'intent', intent: 'selectBatch', batch: BATCH })).toEqual({
      type: 'intent',
      value: { intent: 'selectBatch', batch: BATCH },
    });
  });

  it('keeps the intents of the results and metrics pages', () => {
    expect(parseSessionPageMessage({ type: 'intent', intent: 'openOutput', name: 'name:note' })).toEqual({
      type: 'intent',
      value: { intent: 'openOutput', name: 'name:note' },
    });
    expect(parseSessionPageMessage({ type: 'intent', intent: 'openMetricsFile' })).toEqual({
      type: 'intent',
      value: { intent: 'openMetricsFile' },
    });
    expect(parseSessionPageMessage({ type: 'intent', intent: 'sessionAction', action: 'openTask' })).toEqual({
      type: 'intent',
      value: { intent: 'sessionAction', action: 'openTask' },
    });
    expect(parseSessionPageMessage({ type: 'sessionAction', action: 'openTask' })).toEqual({
      type: 'intent',
      value: { intent: 'sessionAction', action: 'openTask' },
    });
  });

  it('keeps the answer messages the Questions tab sends', () => {
    const draft = { mode: 'choice', selected: ['A'], text: '' };
    expect(
      parseSessionPageMessage({ type: 'edit', generation: 1, fingerprint: 'f', questionId: '1', draft }),
    ).toEqual({ type: 'edit', generation: 1, fingerprint: 'f', questionId: '1', draft });
    expect(parseSessionPageMessage({ type: 'submit', revision: 2, fingerprint: 'f' })).toEqual({
      type: 'submit',
      revision: 2,
      fingerprint: 'f',
    });
    for (const type of ['discard', 'recheck', 'openQuestions', 'later', 'continue', 'viewLog', 'openResults', 'openMetrics']) {
      expect(parseSessionPageMessage({ type })).toEqual({ type });
    }
  });

  it('keeps the workflow-form messages and rejects the rest of the editor set', () => {
    expect(parseSessionPageMessage({ type: 'saveForm', form: { stages: [] }, baseHash: HASH })).toEqual({
      type: 'saveForm',
      form: { stages: [] },
      baseHash: HASH,
    });
    for (const type of ['reload', 'openFile', 'pickModel']) {
      expect(parseSessionPageMessage({ type })).toEqual({ type });
    }
    for (const type of ['run', 'reveal', 'duplicate', 'delete']) {
      expect(parseSessionPageMessage({ type })).toBeNull();
    }
    expect(parseSessionPageMessage({ type: 'saveForm', form: {}, baseHash: 'bad' })).toBeNull();
  });

  it('rejects malformed or foreign messages', () => {
    expect(parseSessionPageMessage({ type: 'intent', intent: 'selectTab', tab: 'config' })).toBeNull();
    expect(parseSessionPageMessage({ type: 'intent', intent: 'selectBatch', batch: { stageId: '', executionId: 'e' } })).toBeNull();
    expect(parseSessionPageMessage({ type: 'intent', intent: 'selectBatch', batch: { stageId: null, executionId: '' } })).toBeNull();
    expect(parseSessionPageMessage({ type: 'intent', intent: 'run', command: 'migent' })).toBeNull();
    expect(parseSessionPageMessage({ type: 'intent', intent: 'sessionAction', action: 'deleteSession' })).toBeNull();
    expect(parseSessionPageMessage({ type: 'edit', generation: 1 })).toBeNull();
    expect(parseSessionPageMessage('ready')).toBeNull();
    expect(parseSessionPageMessage(null)).toBeNull();
    expect(parseSessionPageMessage([])).toBeNull();
  });
});
