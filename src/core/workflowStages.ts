import { readFileSync } from 'node:fs';

import type { WorkflowDocumentInput, WorkflowStageInput } from '@nodeint/migent-contracts';
import { parse } from 'yaml';

import { text as describe } from '../text';
import { wireOf } from './contractRead';
import { frozenWorkflowPath, workflowDraftPath } from './paths';
import { isRecord } from './record';

/**
 * The stages a session's workflow declares, in order. `missing` means neither the
 * frozen copy nor the draft exists; `unreadable` and `invalid` carry the first
 * error so a page can explain why it fell back to executions.
 */
export type SessionStagePlan =
  | { kind: 'ok'; stages: string[] }
  | { kind: 'missing' }
  | { kind: 'unreadable'; error: string }
  | { kind: 'invalid'; error: string };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : describe('states.unknownError');
}

/** `stages[].id` in declaration order; malformed entries are skipped. */
function stageIds(parsed: unknown): string[] {
  if (!isRecord(parsed)) return [];
  // A frozen workflow wraps the body under `workflow`; a draft has the body at the top level.
  const stages = wireOf<WorkflowDocumentInput>(isRecord(parsed.workflow) ? parsed.workflow : parsed)?.stages;
  if (!Array.isArray(stages)) return [];
  const ids: string[] = [];
  for (const stage of stages) {
    const { id } = wireOf<WorkflowStageInput>(stage) ?? {};
    if (typeof id === 'string' && id !== '') ids.push(id);
  }
  return ids;
}

function readStages(filePath: string): SessionStagePlan {
  let text: string;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (error) {
    const code = isRecord(error) ? error.code : undefined;
    if (code === 'ENOENT') return { kind: 'missing' };
    return { kind: 'unreadable', error: errorText(error) };
  }
  let parsed: unknown;
  try {
    parsed = parse(text);
  } catch (error) {
    return { kind: 'invalid', error: errorText(error) };
  }
  return { kind: 'ok', stages: stageIds(parsed) };
}

/**
 * Read only the stage ids of a session's workflow: the frozen copy written by
 * `session run` first, else the editable draft. Parsing is limited to
 * `stages[].id`, so the page does not load the full workflow form, clients or
 * configuration just to draw progress.
 */
export function readSessionStagePlan(projectRoot: string, sessionId: string): SessionStagePlan {
  const frozen = readStages(frozenWorkflowPath(projectRoot, sessionId));
  if (frozen.kind !== 'missing') return frozen;
  return readStages(workflowDraftPath(projectRoot, sessionId));
}
