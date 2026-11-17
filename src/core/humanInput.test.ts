import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as eventTail from './eventTail';
import { readAnswerIndex, readInputIndex } from './humanInput';
import {
  answerEntry,
  makeSession,
  putEvents,
  putExecution,
  putInput,
  putJson,
  putQuestions,
  putRaw,
} from './humanInputTestSupport';

vi.mock('./eventTail', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./eventTail')>();
  return { ...actual, tailEvents: vi.fn(actual.tailEvents) };
});

const ASKED = '0001-plan--attempt-01';
const NEXT = '0002-plan--attempt-02';
const NEXT_STAGE = '0003-plan--attempt-03';

beforeEach(() => {
  vi.mocked(eventTail.tailEvents).mockClear();
});

const eventsRead = (): number => vi.mocked(eventTail.tailEvents).mock.calls.length;

const answerEvent = (executionId: string, answers: unknown[], timestamp = '2026-11-01T11:00:00.000Z') => ({
  executionId,
  stageId: 'plan',
  timestamp,
  data: { answers, input: 'typed answers', reply: 'sent answers' },
});

describe('readAnswerIndex', () => {
  it('reads an answer from input.json without opening events.jsonl', () => {
    const dir = makeSession();
    putExecution(dir, ASKED);
    putInput(dir, NEXT, {
      respondsTo: ASKED,
      recordedAt: '2026-11-01T11:00:01.000Z',
      answers: [answerEntry('1', ['A']), answerEntry('2', [], 'free')],
    });
    const { answers } = readAnswerIndex(dir, new Set([ASKED]));
    const entry = answers.get(ASKED);
    expect(entry?.source).toBe('input');
    expect(entry?.at).toBe('2026-11-01T11:00:01.000Z');
    expect(entry?.byQuestion.get('1')).toEqual({ selected: ['A'], text: null });
    expect(entry?.byQuestion.get('2')).toEqual({ selected: [], text: 'free' });
    expect(eventsRead()).toBe(0);
  });

  it('reads an answer that only the event recorded (dispatch failed, no input.json yet)', () => {
    const dir = makeSession();
    putEvents(dir, [answerEvent(ASKED, [answerEntry('1', ['B'])])]);
    const entry = readAnswerIndex(dir, new Set([ASKED])).answers.get(ASKED);
    expect(entry).toMatchObject({ source: 'event', at: '2026-11-01T11:00:00.000Z' });
    expect(entry?.byQuestion.get('1')).toEqual({ selected: ['B'], text: null });
    expect(eventsRead()).toBe(1);
  });

  it('prefers input.json over the event and the latest event over an earlier one', () => {
    const dir = makeSession();
    putInput(dir, NEXT, { respondsTo: ASKED, answers: [answerEntry('1', ['A'])] });
    putEvents(dir, [
      answerEvent(ASKED, [answerEntry('1', ['B'])]),
      answerEvent('0004-test--attempt-01', [answerEntry('1', ['A'])], '2026-11-01T11:01:00.000Z'),
      answerEvent('0004-test--attempt-01', [answerEntry('1', ['B'])], '2026-11-01T11:02:00.000Z'),
    ]);
    const { answers } = readAnswerIndex(dir, new Set([ASKED, '0004-test--attempt-01']));
    expect(answers.get(ASKED)?.byQuestion.get('1')).toEqual({ selected: ['A'], text: null });
    expect(answers.get('0004-test--attempt-01')?.byQuestion.get('1')).toEqual({ selected: ['B'], text: null });
  });

  it('opens events.jsonl for a pending batch and never when every asking execution is decided', () => {
    const dir = makeSession();
    putEvents(dir, []);
    expect(readAnswerIndex(dir, new Set([ASKED])).answers.size).toBe(0);
    expect(eventsRead()).toBe(1);
    vi.mocked(eventTail.tailEvents).mockClear();
    expect(readAnswerIndex(dir, new Set()).answers.size).toBe(0);
    expect(eventsRead()).toBe(0);
  });

  it('skips an input.json with another schema version, invalid JSON or a reply kind', () => {
    const dir = makeSession();
    putJson(dir, `executions/${NEXT}/input.json`, { schema_version: 2, kind: 'answers', responds_to_execution_id: ASKED });
    putJson(dir, `executions/${NEXT_STAGE}/input.json`, '{ not json');
    putInput(dir, '0004-plan--attempt-04', { kind: 'reply', respondsTo: ASKED });
    expect(readAnswerIndex(dir, new Set([ASKED])).answers.size).toBe(0);
  });

  it('ignores a torn event line and an answer event without a list', () => {
    const dir = makeSession();
    putEvents(dir, [{ executionId: ASKED, stageId: 'plan', timestamp: 't', data: { answers: 'not a list' } }]);
    expect(readAnswerIndex(dir, new Set([ASKED])).answers.size).toBe(0);
  });
});

describe('session.active validation', () => {
  const legacyLine = (extra: Record<string, unknown>) =>
    `${JSON.stringify({
      event: 'session.active',
      execution_id: ASKED,
      stage_id: 'plan',
      data: { answers: [answerEntry('1', ['A'])] },
      ...extra,
    })}
`;
  const putLine = (dir: string, line: string) => putRaw(dir, 'events.jsonl', line);

  it('keeps answer evidence when an optional data member or envelope field is wrong-typed', () => {
    const dir = makeSession();
    const good = answerEvent(ASKED, [answerEntry('1', ['A'])]);
    putEvents(dir, [{ ...good, data: { ...good.data, reply: 5, reason: 42 } }]);
    expect(readAnswerIndex(dir, new Set([ASKED])).answers.get(ASKED)?.byQuestion.get('1')).toEqual({
      selected: ['A'],
      text: null,
    });
  });

  it('keeps answer evidence when the data carries a __proto__ key', () => {
    const dir = makeSession();
    const data = Object.defineProperty({ answers: [answerEntry('1', ['A'])] }, '__proto__', {
      value: { x: 1 },
      enumerable: true,
      configurable: true,
    });
    putRaw(
      dir,
      'events.jsonl',
      `${JSON.stringify({ v: 2, seq: 1, event: 'session.active', timestamp: 't', execution_id: ASKED, stage_id: 'plan', data })}
`,
    );
    expect(readAnswerIndex(dir, new Set([ASKED])).answers.get(ASKED)?.byQuestion.get('1')).toEqual({
      selected: ['A'],
      text: null,
    });
  });

  it('gives no answer evidence when the answers themselves are unusable', () => {
    const dir = makeSession();
    putEvents(dir, [{ executionId: ASKED, stageId: 'plan', timestamp: 't', data: { answers: ['x'] } }]);
    expect(readAnswerIndex(dir, new Set([ASKED])).answers.size).toBe(0);
  });

  it('rejects a complete legacy active line without a timestamp and recovers it with one', () => {
    const dir = makeSession();
    putLine(dir, legacyLine({}));
    expect(readAnswerIndex(dir, new Set([ASKED])).answers.size).toBe(0);
    putLine(dir, legacyLine({ timestamp: '2026-11-01T11:00:00.000Z' }));
    expect(readAnswerIndex(dir, new Set([ASKED])).answers.get(ASKED)?.byQuestion.get('1')).toEqual({
      selected: ['A'],
      text: null,
    });
  });
});

describe('readInputIndex', () => {
  it('joins input.json of a human cancelled-stage reply to its event origin without a later attempt needing events', () => {
    const dir = makeSession();
    putExecution(dir, ASKED, { status: 'cancelled' });
    putExecution(dir, NEXT);
    putInput(dir, NEXT, { kind: 'reply', respondsTo: ASKED, recordedAt: '2026-11-01T11:00:05.000Z', input: 'go on' });
    putEvents(dir, [
      { executionId: ASKED, stageId: 'plan', timestamp: '2026-11-01T11:00:04.000Z', data: { from: 'cancelled_reply', reply: 'go on', origin: 'human' } },
    ]);
    expect(readInputIndex(dir).get(NEXT)).toEqual({ kind: 'reply', text: 'go on', origin: 'human' });
    expect(eventsRead()).toBe(1);
  });

  it('reports a cut-off origin', () => {
    const dir = makeSession();
    putExecution(dir, ASKED, { status: 'cancelled' });
    putExecution(dir, NEXT);
    putInput(dir, NEXT, { kind: 'reply', respondsTo: ASKED, recordedAt: '2026-11-01T11:00:05.000Z', input: 'cut' });
    putEvents(dir, [
      { executionId: ASKED, stageId: 'plan', timestamp: '2026-11-01T11:00:04.000Z', data: { from: 'cancelled_reply', reply: 'cut', origin: 'cut_off' } },
    ]);
    expect(readInputIndex(dir).get(NEXT)?.origin).toBe('cut_off');
  });

  it('takes the latest cancelled-reply event at or before recorded_at', () => {
    const dir = makeSession();
    putExecution(dir, ASKED, { status: 'cancelled' });
    putExecution(dir, NEXT);
    putInput(dir, NEXT, { kind: 'reply', respondsTo: ASKED, recordedAt: '2026-11-01T11:00:05.000Z' });
    const reply = (timestamp: string, origin: string) => ({
      executionId: ASKED,
      stageId: 'plan',
      timestamp,
      data: { from: 'cancelled_reply', reply: 'x', origin },
    });
    putEvents(dir, [
      reply('2026-11-01T11:00:01.000Z', 'cut_off'),
      reply('2026-11-01T11:00:05.000Z', 'human'),
      reply('2026-11-01T11:00:09.000Z', 'cut_off'),
    ]);
    expect(readInputIndex(dir).get(NEXT)?.origin).toBe('human');
  });

  it('reads a blocked reply or answers from input.json as a human input without opening events', () => {
    const dir = makeSession();
    putExecution(dir, ASKED, { status: 'completed', outcomeStatus: 'blocked' });
    putExecution(dir, NEXT);
    putInput(dir, NEXT, { kind: 'reply', respondsTo: ASKED, input: 'unblock' });
    expect(readInputIndex(dir).get(NEXT)).toEqual({ kind: 'reply', text: 'unblock', origin: 'human' });
    expect(eventsRead()).toBe(0);
  });

  it('joins a pre-0.8 cancelled reply (event only, no origin) to the next attempt of its stage', () => {
    const dir = makeSession();
    putExecution(dir, ASKED, { status: 'cancelled', createdAt: '2026-11-01T10:00:00.000Z' });
    putExecution(dir, NEXT, { createdAt: '2026-11-01T11:00:10.000Z' });
    putEvents(dir, [
      { executionId: ASKED, stageId: 'plan', timestamp: '2026-11-01T11:00:05.000Z', data: { from: 'cancelled_reply', reply: 'old reply' } },
    ]);
    expect(readInputIndex(dir).get(NEXT)).toEqual({ kind: 'reply', text: 'old reply', origin: null });
    expect(eventsRead()).toBe(1);
  });

  it('joins a pre-0.8 answer event to the attempt that followed it', () => {
    const dir = makeSession();
    putExecution(dir, ASKED, { outcomeStatus: 'question' });
    putExecution(dir, NEXT, { createdAt: '2026-11-01T11:00:10.000Z' });
    putEvents(dir, [answerEvent(ASKED, [answerEntry('1', ['A'])], '2026-11-01T11:00:05.000Z')]);
    expect(readInputIndex(dir).get(NEXT)).toEqual({ kind: 'answers', text: 'typed answers', origin: null });
  });

  it('attaches a reply only to its actual successor, not to a later attempt without input.json', () => {
    const dir = makeSession();
    putExecution(dir, ASKED, { status: 'cancelled' });
    putExecution(dir, NEXT, { createdAt: '2026-11-01T11:00:10.000Z' });
    putExecution(dir, NEXT_STAGE, { createdAt: '2026-11-01T11:00:20.000Z' });
    putInput(dir, NEXT, { kind: 'reply', respondsTo: ASKED, recordedAt: '2026-11-01T11:00:09.000Z', input: 'r' });
    putEvents(dir, [
      { executionId: ASKED, stageId: 'plan', timestamp: '2026-11-01T11:00:05.000Z', data: { from: 'cancelled_reply', reply: 'r', origin: 'human' } },
    ]);
    const index = readInputIndex(dir);
    expect(index.get(NEXT)).toMatchObject({ kind: 'reply', text: 'r' });
    expect(index.has(NEXT_STAGE)).toBe(false);
  });

  it('shows no input while the reply has no later attempt yet', () => {
    const dir = makeSession();
    putExecution(dir, ASKED, { status: 'cancelled' });
    putEvents(dir, [
      { executionId: ASKED, stageId: 'plan', timestamp: '2026-11-01T11:00:05.000Z', data: { from: 'cancelled_reply', reply: 'r' } },
    ]);
    expect(readInputIndex(dir).size).toBe(0);
  });

  it('does not attach an event to an attempt created before it', () => {
    const dir = makeSession();
    putExecution(dir, ASKED, { status: 'cancelled' });
    putExecution(dir, NEXT, { createdAt: '2026-11-01T11:00:01.000Z' });
    putEvents(dir, [
      { executionId: ASKED, stageId: 'plan', timestamp: '2026-11-01T11:00:05.000Z', data: { from: 'cancelled_reply', reply: 'r' } },
    ]);
    expect(readInputIndex(dir).size).toBe(0);
  });

  it('does not open events.jsonl when every input is decided by input.json and nothing was cancelled', () => {
    const dir = makeSession();
    putExecution(dir, ASKED, { outcomeStatus: 'question' });
    putExecution(dir, NEXT);
    putQuestions(dir, ASKED);
    putInput(dir, NEXT, { respondsTo: ASKED, answers: [answerEntry('1', ['A'])], input: 'answers text' });
    expect(readInputIndex(dir).get(NEXT)).toEqual({ kind: 'answers', text: 'answers text', origin: 'human' });
    expect(eventsRead()).toBe(0);
  });

  it('opens events.jsonl for a stopped question attempt followed by an attempt without input.json', () => {
    const dir = makeSession();
    putExecution(dir, ASKED, { outcomeStatus: 'question' });
    putExecution(dir, NEXT);
    putEvents(dir, []);
    readInputIndex(dir);
    expect(eventsRead()).toBe(1);
  });
});
