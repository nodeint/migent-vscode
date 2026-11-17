import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseExecutionId } from './executions';

/**
 * Builders for synthetic Migent 0.8.0 session directories, shaped after the 0.8.0 JSON Schemas
 * (`execution-questions`, `execution-input`, `session.active`). Test support only.
 */

export interface TestOption {
  id: string;
  label: string;
}

const OPTIONS: TestOption[] = [
  { id: 'A', label: 'Keep' },
  { id: 'B', label: 'Replace' },
];

export function makeSession(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'migent-human-input-'));
}

function put(dir: string, file: string, content: string): void {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  writeFileSync(path.join(dir, file), content);
}

/** A file with the given text verbatim (the caller adds any trailing newline). */
export function putRaw(dir: string, file: string, content: string): void {
  put(dir, file, content);
}

export function putJson(dir: string, file: string, value: unknown): void {
  put(dir, file, JSON.stringify(value));
}

/** `executions/<id>/execution.json`. */
export function putExecution(
  dir: string,
  id: string,
  fields: { status?: string; outcomeStatus?: string; createdAt?: string } = {},
): void {
  const parsed = parseExecutionId(id);
  putJson(dir, `executions/${id}/execution.json`, {
    session_id: 's',
    execution_id: id,
    execution_order: parsed?.order ?? 1,
    stage_id: parsed?.stageId ?? 'plan',
    stage_attempt: parsed?.attempt ?? 1,
    status: fields.status ?? 'completed',
    created_at: fields.createdAt ?? '2026-11-01T10:00:00.000Z',
    outcome: fields.outcomeStatus === undefined ? undefined : { status: fields.outcomeStatus },
  });
}

/** `executions/<id>/questions.json`: no status, no answer. */
export function putQuestions(
  dir: string,
  id: string,
  options: { stageId?: string; ids?: string[]; recipient?: string } = {},
): void {
  putJson(dir, `executions/${id}/questions.json`, {
    schema_version: 1,
    stage_id: options.stageId ?? parseExecutionId(id)?.stageId ?? 'plan',
    execution_id: id,
    recipient: options.recipient ?? 'human',
    questions: (options.ids ?? ['1', '2']).map((questionId) => ({
      id: questionId,
      question: `Question ${questionId}?`,
      context: 'Some context',
      selection: 'single',
      options: OPTIONS,
      recommended: ['A'],
    })),
  });
}

export interface InputFileFields {
  kind?: 'reply' | 'answers';
  respondsTo?: string;
  recordedAt?: string;
  input?: string;
  answers?: unknown[];
}

/** `executions/<id>/input.json` of the execution that the input opened. */
export function putInput(dir: string, id: string, fields: InputFileFields = {}): void {
  putJson(dir, `executions/${id}/input.json`, {
    schema_version: 1,
    execution_id: id,
    stage_id: parseExecutionId(id)?.stageId ?? 'plan',
    kind: fields.kind ?? 'answers',
    responds_to_execution_id: fields.respondsTo ?? null,
    recorded_at: fields.recordedAt ?? '2026-11-01T11:00:00.000Z',
    sent: 'sent text',
    input: fields.input ?? 'typed text',
    ...(fields.answers === undefined ? {} : { answers: fields.answers }),
  });
}

export const answerEntry = (questionId: string, selected: string[], text?: string): Record<string, unknown> => ({
  question_id: questionId,
  selected,
  ...(text === undefined ? {} : { text }),
});

export interface TestEvent {
  executionId: string;
  stageId: string;
  timestamp: string;
  data: Record<string, unknown>;
}

/** `events.jsonl` with `session.active` events in write order. */
export function putEvents(dir: string, events: readonly TestEvent[]): void {
  const lines = events.map((event, index) =>
    JSON.stringify({
      v: 2,
      seq: index + 1,
      event: 'session.active',
      timestamp: event.timestamp,
      execution_id: event.executionId,
      stage_id: event.stageId,
      data: event.data,
    }),
  );
  put(dir, 'events.jsonl', `${lines.join('\n')}\n`);
}

/** `status.json.questions` rows: the latest question execution per stage. */
export function pendingRow(executionId: string, stageId: string, id: string): Record<string, unknown> {
  return {
    id,
    question: `Question ${id}?`,
    context: 'Some context',
    selection: 'single',
    options: OPTIONS,
    recommended: ['A'],
    execution_id: executionId,
    stage_id: stageId,
    recipient: 'human',
    file: `executions/${executionId}/questions.json`,
  };
}
