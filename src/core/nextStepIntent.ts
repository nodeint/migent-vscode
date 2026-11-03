import { isRecord } from './record';

/**
 * What the Next step page may ask the host to do. Intents carry a task text or an identity, never a path,
 * a command or argv: the host resolves the target from the panel's captured identity.
 */
export type NextStepIntent =
  | { intent: 'setTask'; task: string }
  | { intent: 'resetTask' }
  | { intent: 'run'; task: string }
  | { intent: 'prepare'; task: string }
  | { intent: 'openResults' }
  | { intent: 'openTargetWorkflow' }
  | { intent: 'openSourceOutput'; output: string }
  | { intent: 'openSession'; sessionId: string }
  | { intent: 'openChildTask'; sessionId: string }
  | { intent: 'recheck' };

export type NextStepMessage = { type: 'ready' } | { type: 'intent'; value: NextStepIntent };

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function intentWith(message: Record<string, unknown>): NextStepIntent | null {
  switch (message.intent) {
    case 'resetTask':
    case 'openResults':
    case 'openTargetWorkflow':
    case 'recheck':
      return { intent: message.intent };
    case 'setTask':
    case 'run':
    case 'prepare':
      return typeof message.task === 'string' ? { intent: message.intent, task: message.task } : null;
    case 'openSourceOutput': {
      const output = text(message.output);
      return output === null ? null : { intent: 'openSourceOutput', output };
    }
    case 'openSession':
    case 'openChildTask': {
      const sessionId = text(message.sessionId);
      return sessionId === null ? null : { intent: message.intent, sessionId };
    }
    default:
      return null;
  }
}

/** Validate a message from the page. Anything outside the contract is dropped (null). */
export function parseNextStepMessage(message: unknown): NextStepMessage | null {
  if (!isRecord(message)) return null;
  if (message.type === 'ready') return { type: 'ready' };
  if (message.type !== 'intent') return null;
  const value = intentWith(message);
  return value === null ? null : { type: 'intent', value };
}
