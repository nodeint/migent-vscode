import { parseDocument } from 'yaml';

import { isRecord } from './record';

const WORKFLOW_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** Why a workflow id cannot name a new file, or null. The id is also the file name, so it stays path-safe. */
export function workflowIdProblem(id: string): string | null {
  if (id === '') return 'Enter a workflow id.';
  if (!WORKFLOW_ID.test(id)) return 'Use letters, digits, "-" and "_", starting with a letter or digit.';
  return null;
}

/** The file a new workflow with this id is saved to. */
export function workflowFileName(id: string): string {
  return `${id}.yaml`;
}

/**
 * The saved text of a workflow with a new id, keeping comments and key order; null when the text is not a mapping.
 * Used by Duplicate so the copy is the saved file, not a re-serialized form that drops keys the form does not show.
 */
export function duplicateWorkflowText(text: string, newId: string): string | null {
  const document = parseDocument(text);
  if (document.errors.length > 0 || !isRecord(document.toJS())) return null;
  document.set('id', newId);
  return document.toString({ lineWidth: 0 });
}
