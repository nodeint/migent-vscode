import { isRecord } from './record';

/** Header actions, a closed set. The host maps each to an existing session command for the panel's own session. */
export const SESSION_ACTIONS = ['openResult', 'openTask', 'showLog', 'copyId', 'revealInExplorer', 'openQuestions', 'openMetrics', 'answerQuestions'] as const;

export type SessionAction = (typeof SESSION_ACTIONS)[number];

/**
 * What the Results page may ask the host to do. Intents carry identity only (a key, a name or a
 * session id), never a path or a command: the host resolves each against fresh data.
 */
export type ResultsIntent =
  | { intent: 'openOutput'; name: string }
  | { intent: 'openNextFile' }
  | { intent: 'openNextStep'; workflow: string }
  | { intent: 'openManifest' }
  | { intent: 'openTargetWorkflow'; workflow: string }
  | { intent: 'openHandoffFile'; name: string }
  | { intent: 'openSession'; sessionId: string }
  | { intent: 'sessionAction'; action: SessionAction };

export type ResultsMessage = { type: 'ready' } | { type: 'intent'; value: ResultsIntent };

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function sessionAction(value: unknown): SessionAction | null {
  return SESSION_ACTIONS.find((action) => action === value) ?? null;
}

function intentWith(message: Record<string, unknown>): ResultsIntent | null {
  switch (message.intent) {
    case 'openNextFile':
    case 'openManifest':
      return { intent: message.intent };
    case 'openOutput':
    case 'openHandoffFile': {
      const name = text(message.name);
      return name === null ? null : { intent: message.intent, name };
    }
    case 'openNextStep':
    case 'openTargetWorkflow': {
      const workflow = text(message.workflow);
      return workflow === null ? null : { intent: message.intent, workflow };
    }
    case 'sessionAction': {
      const action = sessionAction(message.action);
      return action === null ? null : { intent: 'sessionAction', action };
    }
    case 'openSession': {
      const sessionId = text(message.sessionId);
      return sessionId === null ? null : { intent: 'openSession', sessionId };
    }
    default:
      return null;
  }
}

/** Validate a message from the page. Anything outside the contract is dropped (null). */
export function parseResultsMessage(message: unknown): ResultsMessage | null {
  if (!isRecord(message)) return null;
  if (message.type === 'ready') return { type: 'ready' };
  if (message.type !== 'intent') return null;
  const value = intentWith(message);
  return value === null ? null : { type: 'intent', value };
}
