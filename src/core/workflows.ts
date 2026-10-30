import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { parse } from 'yaml';

import { workflowsDir } from './paths';
import { isRecord } from './record';

export interface WorkflowSummary {
  /** Workflow id from the file body, else the file name without extension. */
  id: string;
  file: string;
  title: string | null;
  /** Stage ids in declaration order, for display. */
  stages: string[];
}

function stageIds(parsed: unknown): string[] {
  if (!isRecord(parsed)) return [];
  const {stages} = (parsed);
  if (!Array.isArray(stages)) return [];
  const ids: string[] = [];
  for (const stage of stages) {
    if (!isRecord(stage)) continue;
    const {id} = (stage);
    if (typeof id === 'string' && id !== '') ids.push(id);
  }
  return ids;
}

function isWorkflowFile(name: string): boolean {
  return name.endsWith('.yaml') || name.endsWith('.yml');
}

/** List `.migent/workflows/*.yaml`. A file that fails to parse is skipped, not guessed. */
export function listWorkflows(projectRoot: string): WorkflowSummary[] {
  let entries;
  try {
    entries = readdirSync(workflowsDir(projectRoot), { withFileTypes: true });
  } catch {
    return [];
  }
  const rows: WorkflowSummary[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !isWorkflowFile(entry.name)) continue;
    const file = path.join(workflowsDir(projectRoot), entry.name);
    let parsed: unknown;
    try {
      parsed = parse(readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    const body = isRecord(parsed)
      ? parsed
      : null;
    const id = typeof body?.id === 'string' && body.id !== '' ? body.id : path.basename(entry.name, path.extname(entry.name));
    const title = typeof body?.title === 'string' && body.title !== '' ? body.title : null;
    rows.push({ id, file: entry.name, title, stages: stageIds(parsed) });
  }
  rows.sort((left, right) => left.id.localeCompare(right.id));
  return rows;
}
