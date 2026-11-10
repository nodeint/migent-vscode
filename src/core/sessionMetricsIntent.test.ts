import { describe, expect, it } from 'vitest';

import { SESSION_ACTIONS } from './resultsIntent';
import { parseSessionMetricsMessage } from './sessionMetricsIntent';

describe('parseSessionMetricsMessage', () => {
  it('accepts the ready handshake', () => {
    expect(parseSessionMetricsMessage({ type: 'ready' })).toEqual({ type: 'ready' });
  });

  it('accepts the identity-only intents and drops extra fields', () => {
    expect(parseSessionMetricsMessage({ type: 'intent', intent: 'openOverview', revision: 2, path: 'C:/x' })).toEqual({
      type: 'intent',
      value: { intent: 'openOverview' },
    });
    expect(parseSessionMetricsMessage({ type: 'intent', intent: 'openMetricsFile', command: 'x' })).toEqual({
      type: 'intent',
      value: { intent: 'openMetricsFile' },
    });
  });

  it('accepts each closed session action', () => {
    for (const action of SESSION_ACTIONS) {
      expect(parseSessionMetricsMessage({ type: 'intent', intent: 'sessionAction', action })).toEqual({
        type: 'intent',
        value: { intent: 'sessionAction', action },
      });
    }
  });

  it('rejects unknown actions, intents of other pages and malformed messages', () => {
    expect(parseSessionMetricsMessage({ type: 'intent', intent: 'sessionAction' })).toBeNull();
    expect(parseSessionMetricsMessage({ type: 'intent', intent: 'sessionAction', action: 'deleteSession' })).toBeNull();
    expect(
      parseSessionMetricsMessage({ type: 'intent', intent: 'sessionAction', action: 'migent.session.openTask' }),
    ).toBeNull();
    expect(parseSessionMetricsMessage({ type: 'intent', intent: 'sessionAction', action: ['openTask'] })).toBeNull();
    expect(parseSessionMetricsMessage({ type: 'intent', intent: 'openOutput', name: 'note' })).toBeNull();
    expect(parseSessionMetricsMessage({ type: 'intent', intent: 'openSession', sessionId: 's' })).toBeNull();
    expect(parseSessionMetricsMessage({ type: 'intent', intent: 'run', command: 'migent' })).toBeNull();
    expect(parseSessionMetricsMessage({ type: 'intent' })).toBeNull();
    expect(parseSessionMetricsMessage({ type: 'other' })).toBeNull();
    expect(parseSessionMetricsMessage('ready')).toBeNull();
    expect(parseSessionMetricsMessage(null)).toBeNull();
    expect(parseSessionMetricsMessage([])).toBeNull();
  });
});
