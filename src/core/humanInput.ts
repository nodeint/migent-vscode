import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { type EventEntry, tailEvents } from './eventTail';
import type { ExecutionEntry } from './executions';
import { executionOutcomeStatus, listExecutions } from './executions';
import { EVENTS_FILENAME, EXECUTIONS_DIRNAME } from './paths';
import { isRecord } from './record';

/**
 * Every persisted human-input fact of a session, read from the files Migent 0.8 writes: each
 * `executions/<id>/input.json` and the `session.active` events of `events.jsonl` that carry human input. The
 * question history and Overview Progress both read through here, so the join and precedence rules exist once.
 * Stateless: each call reads the files and keeps nothing. `events.jsonl` is read (once, in full) only when
 * `input.json` cannot decide the need.
 */

/** `input.json` schema versions this extension reads. */
export const SUPPORTED_INPUT_SCHEMA_VERSIONS: readonly number[] = [1];

export const INPUT_FILENAME = 'input.json';

/** An answer in an observed shape: `{question_id, selected[]}` plus optional `text`. */
export interface QuestionAnswer {
  selected: string[];
  text: string | null;
}

/** A persisted answer to the questions one execution asked. */
export interface PersistedAnswer {
  /** When it was recorded; null when the source does not say. */
  at: string | null;
  source: 'input' | 'event';
  /** The answer per question id. A question without an entry was answered in a shape not read. */
  byQuestion: ReadonlyMap<string, QuestionAnswer | null>;
}

/** Who wrote a cancelled-stage reply. Null when the source does not say (Migent 0.7 and earlier). */
export type InputOrigin = 'human' | 'cut_off';

/** The human input an execution opened with. */
export interface HumanInputFact {
  kind: 'reply' | 'answers';
  text: string | null;
  origin: InputOrigin | null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** Parse one answer entry's `{selected[], text?}`. Null for any other shape. */
export function parseAnswer(value: unknown): QuestionAnswer | null {
  if (!isRecord(value) || !Array.isArray(value.selected)) return null;
  if (!value.selected.every((item) => typeof item === 'string')) return null;
  if (value.text !== undefined && typeof value.text !== 'string') return null;
  return { selected: value.selected, text: typeof value.text === 'string' ? value.text : null };
}

/** `answers[]` of `input.json` or an answer event, keyed by `question_id`. Null when it is not a list. */
function parseAnswerList(value: unknown): Map<string, QuestionAnswer | null> | null {
  if (!Array.isArray(value)) return null;
  const byQuestion = new Map<string, QuestionAnswer | null>();
  for (const entry of value) {
    const id = isRecord(entry) ? str(entry.question_id) : null;
    if (id !== null) byQuestion.set(id, parseAnswer(entry));
  }
  return byQuestion;
}

interface InputFile {
  executionId: string;
  kind: 'reply' | 'answers';
  respondsTo: string | null;
  recordedAt: string | null;
  text: string | null;
  answers: Map<string, QuestionAnswer | null> | null;
}

function parseInputFile(source: string, executionId: string): InputFile | null {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  const version = value.schema_version;
  if (typeof version !== 'number' || !SUPPORTED_INPUT_SCHEMA_VERSIONS.includes(version)) return null;
  if (value.kind !== 'reply' && value.kind !== 'answers') return null;
  return {
    executionId,
    kind: value.kind,
    respondsTo: str(value.responds_to_execution_id),
    recordedAt: str(value.recorded_at),
    text: typeof value.input === 'string' ? value.input : null,
    answers: parseAnswerList(value.answers),
  };
}

/** Every readable `input.json`, by the execution that it opened. */
function readInputFiles(sessionDirPath: string): Map<string, InputFile> {
  const files = new Map<string, InputFile>();
  let names: string[];
  try {
    names = readdirSync(path.join(sessionDirPath, EXECUTIONS_DIRNAME), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return files;
  }
  for (const name of names) {
    let source: string;
    try {
      source = readFileSync(path.join(sessionDirPath, EXECUTIONS_DIRNAME, name, INPUT_FILENAME), 'utf8');
    } catch {
      continue;
    }
    const parsed = parseInputFile(source, name);
    if (parsed !== null) files.set(name, parsed);
  }
  return files;
}

const readEvents = (sessionDirPath: string): EventEntry[] =>
  tailEvents(path.join(sessionDirPath, EVENTS_FILENAME), 0).events.filter(
    (event) => event.event?.event === 'session.active' && event.rawLine === null && event.executionId !== null,
  );

export interface AnswerIndex {
  /** The persisted answer by the execution that asked the questions. */
  answers: ReadonlyMap<string, PersistedAnswer>;
}

/**
 * The persisted answers of a session, by asking execution. For one execution the first match wins: a
 * `kind: answers` `input.json` that responds to it, then its latest `session.active` event with `data.answers`.
 * `undecided` names the asking executions without a legacy answer; `events.jsonl` is read only when one of them
 * has no `input.json` answer.
 */
export function readAnswerIndex(sessionDirPath: string, undecided: ReadonlySet<string>): AnswerIndex {
  const answers = new Map<string, PersistedAnswer>();
  if (undecided.size === 0) return { answers };
  for (const file of readInputFiles(sessionDirPath).values()) {
    if (file.kind !== 'answers' || file.respondsTo === null || file.answers === null) continue;
    answers.set(file.respondsTo, { at: file.recordedAt, source: 'input', byQuestion: file.answers });
  }
  if ([...undecided].every((id) => answers.has(id))) return { answers };
  for (const event of readEvents(sessionDirPath)) {
    const byQuestion = parseAnswerList(event.data.answers);
    if (byQuestion === null || event.executionId === null || answers.get(event.executionId)?.source === 'input') {
      continue;
    }
    // Later events win; the log is in write order.
    answers.set(event.executionId, { at: str(event.timestamp), source: 'event', byQuestion });
  }
  return { answers };
}

const originOf = (value: unknown): InputOrigin | null => (value === 'human' || value === 'cut_off' ? value : null);

function timeOf(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** The latest cancelled-reply event on `executionId` written at or before `recordedAt`. */
function cancelledReplyFor(
  events: readonly EventEntry[],
  executionId: string,
  recordedAt: string | null,
): { found: boolean; origin: InputOrigin | null } {
  const replies = events.filter((event) => event.executionId === executionId && event.data.from === 'cancelled_reply');
  if (replies.length === 0) return { found: false, origin: null };
  const limit = timeOf(recordedAt);
  const eligible = replies.filter((event) => {
    const at = timeOf(event.timestamp);
    return limit === null || at === null || at <= limit;
  });
  return { found: true, origin: originOf(eligible.at(-1)?.data.origin) };
}

const isAwaitingInput = (execution: ExecutionEntry): boolean =>
  execution.execution.status === 'cancelled' || executionOutcomeStatus(execution.execution) === 'question';

/** Whether an execution that stopped for input is followed by an attempt of its stage with no `input.json`. */
function followsWithoutInput(
  executions: readonly ExecutionEntry[],
  files: ReadonlyMap<string, InputFile>,
): boolean {
  const isLaterWithoutInput = (earlier: ExecutionEntry, later: ExecutionEntry): boolean =>
    later.execution.stage_id === earlier.execution.stage_id && later.order > earlier.order && !files.has(later.id);
  const hasLater = (earlier: ExecutionEntry): boolean =>
    executions.some((later) => isLaterWithoutInput(earlier, later));
  return executions.filter((execution) => isAwaitingInput(execution)).some((execution) => hasLater(execution));
}

function needsEventsForInputs(
  executions: readonly ExecutionEntry[],
  files: ReadonlyMap<string, InputFile>,
): boolean {
  const cancelled = new Set(executions.filter((execution) => execution.execution.status === 'cancelled').map((e) => e.id));
  for (const file of files.values()) {
    if (file.respondsTo !== null && cancelled.has(file.respondsTo)) return true;
  }
  return followsWithoutInput(executions, files);
}

function eventInput(event: EventEntry): HumanInputFact | null {
  const { data } = event;
  if (Array.isArray(data.answers)) {
    return { kind: 'answers', text: typeof data.input === 'string' ? data.input : null, origin: originOf(data.origin) };
  }
  if (typeof data.reply !== 'string') return null;
  return { kind: 'reply', text: data.reply, origin: originOf(data.origin) };
}

/** The attempt an event opened: the earliest later execution of the stage created at or after the event. */
function openedBy(
  event: EventEntry,
  executions: readonly ExecutionEntry[],
  files: ReadonlyMap<string, InputFile>,
): ExecutionEntry | null {
  const source = executions.find((execution) => execution.id === event.executionId);
  if (source === undefined) return null;
  const at = timeOf(event.timestamp);
  const candidates = executions.filter((execution) => {
    if (execution.execution.stage_id !== source.execution.stage_id || execution.order <= source.order) return false;
    const created = timeOf(execution.execution.created_at);
    return at === null || created === null || created >= at;
  });
  // The actual successor: when it already has an input.json, the event belongs to it and opens nothing else.
  const successor = candidates.at(0);
  return successor === undefined || files.has(successor.id) ? null : successor;
}

/**
 * The human input each execution opened with, by that execution's id. An `input.json` gives kind and text, with
 * the origin joined from the cancelled-reply event it responds to; an attempt without one (Migent 0.7 and
 * earlier, or a dispatch still in progress) is joined from the event alone.
 */
export function readInputIndex(sessionDirPath: string): ReadonlyMap<string, HumanInputFact> {
  const facts = new Map<string, HumanInputFact>();
  const executions = listExecutions(sessionDirPath);
  const files = readInputFiles(sessionDirPath);
  const events = needsEventsForInputs(executions, files) ? readEvents(sessionDirPath) : [];
  for (const file of files.values()) {
    const cancelled = file.respondsTo === null ? null : cancelledReplyFor(events, file.respondsTo, file.recordedAt);
    const origin = cancelled?.found === true ? cancelled.origin : 'human';
    facts.set(file.executionId, { kind: file.kind, text: file.text, origin });
  }
  for (const event of events) {
    const fact = eventInput(event);
    const opened = fact === null ? null : openedBy(event, executions, files);
    if (fact !== null && opened !== null) facts.set(opened.id, fact);
  }
  return facts;
}
