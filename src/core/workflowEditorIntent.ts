import { isRecord } from './record';

const MESSAGE_TYPES = ['openFile', 'reload', 'reveal', 'run', 'duplicate', 'pickModel', 'saveForm'] as const;

export type WorkflowEditorMessageType = (typeof MESSAGE_TYPES)[number];

export type WorkflowEditorMessage =
  | { type: Exclude<WorkflowEditorMessageType, 'saveForm'> }
  | { type: 'saveForm'; form: Record<string, unknown>; baseHash: string };

const KNOWN = new Set<string>(MESSAGE_TYPES);

const BASE_HASH = /^[0-9a-f]{64}$/;

/**
 * Validate a page message. The host resolves every action itself; a save request carries only the inert
 * draft and the SHA-256 of the bytes it was read from, both checked again before the CLI sees them.
 */
export function parseWorkflowEditorMessage(raw: unknown): WorkflowEditorMessage | null {
  if (!isRecord(raw)) return null;
  const { type } = raw;
  if (typeof type !== 'string' || !KNOWN.has(type)) return null;
  const known = MESSAGE_TYPES.find((candidate) => candidate === type);
  if (known === undefined) return null;
  if (known === 'saveForm') {
    const { form, baseHash } = raw;
    if (!isRecord(form) || typeof baseHash !== 'string' || !BASE_HASH.test(baseHash)) return null;
    return { type: 'saveForm', form, baseHash };
  }
  return { type: known };
}
