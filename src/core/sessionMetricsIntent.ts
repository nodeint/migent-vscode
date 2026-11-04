import { isRecord } from './record';
import { SESSION_ACTIONS, type SessionAction } from './resultsIntent';

/**
 * What the Session Metrics page may ask the host to do. Intents carry identity only (a closed action
 * name or a closed intent name), never a path or a command: the host resolves each for the panel's session.
 */
export type SessionMetricsIntent =
  | { intent: 'sessionAction'; action: SessionAction }
  | { intent: 'openResults' }
  | { intent: 'openMetricsFile' };

export type SessionMetricsMessage = { type: 'ready' } | { type: 'intent'; value: SessionMetricsIntent };

function intentWith(message: Record<string, unknown>): SessionMetricsIntent | null {
  switch (message.intent) {
    case 'openResults':
    case 'openMetricsFile':
      return { intent: message.intent };
    case 'sessionAction': {
      const action = SESSION_ACTIONS.find((candidate) => candidate === message.action);
      return action === undefined ? null : { intent: 'sessionAction', action };
    }
    default:
      return null;
  }
}

/** Validate a message from the page. Anything outside the contract is dropped (null). */
export function parseSessionMetricsMessage(message: unknown): SessionMetricsMessage | null {
  if (!isRecord(message)) return null;
  if (message.type === 'ready') return { type: 'ready' };
  if (message.type !== 'intent') return null;
  const value = intentWith(message);
  return value === null ? null : { type: 'intent', value };
}
