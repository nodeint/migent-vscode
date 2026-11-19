import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { isValid, LegacyLifecycleEvent, LifecycleEventV2 } from '@nodeint/migent-contracts';
import { describe, expect, it } from 'vitest';

import { EventTail, readRecentEvents, tailEvents } from './eventTail';

const dirs: string[] = [];


function tmpFile(name: string, content: string): string {
  const dir = mkdtemp();
  const file = path.join(dir, name);
  writeFileSync(file, content);
  return file;
}

function mkdtemp(): string {
  const dir = path.join(os.tmpdir(), `migent-tail-${dirs.length}`);
  mkdirSync(dir, { recursive: true });
  dirs.push(dir);
  return dir;
}

const line1 = JSON.stringify({ v: 2, seq: 1, event: 'session.created', timestamp: 't1', data: {} });
const line2 = JSON.stringify({
  v: 2,
  seq: 2,
  event: 'execution.started',
  timestamp: 't2',
  execution_id: '0001-plan--attempt-01',
  stage_id: 'plan',
  summary: 'claude/sonnet',
  data: { execution_order: 1 },
});

describe('tailEvents', () => {
  it('returns an empty read for a missing file', () => {
    const read = tailEvents(path.join(os.tmpdir(), 'does-not-exist-events.jsonl'), 0);
    expect(read.events).toEqual([]);
    expect(read.offset).toBe(0);
  });

  it('stops before a partial line and reads it once completed', () => {
    const file = tmpFile('events.jsonl', `${line1}\n${line2}\n${line2.slice(0, 10)}`);
    const first = tailEvents(file, 0);
    expect(first.events.map((event) => event.seq)).toEqual([1, 2]);
    expect(first.events[1]?.executionId).toBe('0001-plan--attempt-01');
    expect(first.events[1]?.stageId).toBe('plan');
    expect(first.events[1]?.summary).toBe('claude/sonnet');
    // The torn tail stays unconsumed.
    expect(tailEvents(file, first.offset).events).toEqual([]);
    writeFileSync(file, `${line1}\n${line2}\n${line2}\n`);
    const second = tailEvents(file, first.offset);
    expect(second.events.map((event) => event.seq)).toEqual([2]);
    expect(second.offset).toBeGreaterThan(first.offset);
  });

  it('consumes nothing when the only content is a torn line', () => {
    const file = tmpFile('events.jsonl', line2.slice(0, 20));
    const read = tailEvents(file, 0);
    expect(read.events).toEqual([]);
    expect(read.offset).toBe(0);
  });

  it('returns the raw line for a line that is not JSON', () => {
    const file = tmpFile('events.jsonl', `${line1}\nnot json at all\n`);
    const read = tailEvents(file, 0);
    expect(read.events).toHaveLength(2);
    expect(read.events[1]?.rawLine).toBe('not json at all');
    expect(read.events[1]?.event).toBeNull();
  });

  it('returns the raw line for an unknown envelope version and marks it', () => {
    const future = JSON.stringify({ v: 99, seq: 3, event: 'session.created', timestamp: 't3', data: {} });
    const file = tmpFile('events.jsonl', `${future}\n`);
    const read = tailEvents(file, 0);
    expect(read.events).toHaveLength(1);
    expect(read.events[0]?.isUnknownVersion).toBe(true);
    expect(read.events[0]?.event).toBeNull();
    expect(read.events[0]?.seq).toBe(3);
    expect(read.events[0]?.rawLine).toBe(future);
  });

  it('reads a missing v as a legacy line', () => {
    const legacy = JSON.stringify({ seq: 4, event: 'legacy.event', timestamp: 't4', data: {} });
    const file = tmpFile('events.jsonl', `${legacy}\n`);
    const [entry] = tailEvents(file, 0).events;
    expect(entry?.event?.event).toBe('legacy.event');
    expect(entry?.rawLine).toBeNull();
    expect(entry?.isUnknownVersion).toBe(false);
  });

  it('treats a non-object or eventless line as raw', () => {
    const file = tmpFile('events.jsonl', '[1,2,3]\n{"no_event":true}\n');
    const read = tailEvents(file, 0);
    expect(read.events.map((event) => event.rawLine)).toEqual(['[1,2,3]', '{"no_event":true}']);
  });

  it('handles empty lines by skipping them', () => {
    const file = tmpFile('events.jsonl', `${line1}\n\n${line2}\n`);
    const read = tailEvents(file, 0);
    expect(read.events.map((event) => event.seq)).toEqual([1, 2]);
  });

  it('restarts from byte 0 when truncated, including when the file is emptied', () => {
    const file = tmpFile('events.jsonl', `${line1}\n${line2}\n`);
    const first = tailEvents(file, 0);
    expect(first.truncated).toBe(false);
    writeFileSync(file, `${line1}\n`);
    const read = tailEvents(file, first.offset);
    expect(read.truncated).toBe(true);
    expect(read.events.map((event) => event.seq)).toEqual([1]);
    expect(read.offset).toBe(Buffer.byteLength(`${line1}\n`));
    writeFileSync(file, '');
    expect(tailEvents(file, read.offset)).toEqual({ events: [], offset: 0, truncated: true });
  });
});

describe('plugin events (CLI 0.9.0)', () => {
  it('reads plugin.decision and plugins.frozen lines as recognized events, not as unrecognized lines', () => {
    const decision = JSON.stringify({
      v: 2,
      seq: 3,
      event: 'plugin.decision',
      timestamp: 't3',
      data: {
        plugin: 'metrics',
        invocation_id: 'inv-1',
        proposed: [{ kind: 'artifact' }],
        results: [{ kind: 'artifact', status: 'applied', path: 'plugins/metrics/metrics.json' }],
      },
    });
    const frozen = JSON.stringify({
      v: 2,
      seq: 4,
      event: 'plugins.frozen',
      timestamp: 't4',
      data: { freeze_hash: 'abc', plugins: [{ id: 'metrics', enabled: true, advisory: false, version: '0.9.0', target: null }] },
    });
    const events = readRecentEvents(tmpFile('events.jsonl', `${decision}
${frozen}
`), 5);
    expect(events.map((event) => event.event?.event)).toEqual(['plugin.decision', 'plugins.frozen']);
    expect(events.every((event) => event.rawLine === null)).toBe(true);
  });
});

describe('readRecentEvents', () => {
  function numbered(count: number): string[] {
    return Array.from({ length: count }, (_, index) =>
      JSON.stringify({
        v: 2,
        seq: index + 1,
        event: 'execution.started',
        timestamp: 't',
        summary: `line-${index + 1}`,
        data: {},
      }));
  }

  it('returns the newest complete lines within the limit, oldest first', () => {
    const file = tmpFile('events.jsonl', `${numbered(10).join('\n')}\n`);
    expect(readRecentEvents(file, 5).map((event) => event.seq)).toEqual([6, 7, 8, 9, 10]);
  });

  it('reads only the tail of a large file', () => {
    const file = tmpFile('events.jsonl', `${numbered(10_000).join('\n')}\n`);
    const events = readRecentEvents(file, 5);
    expect(events.map((event) => event.seq)).toEqual([9996, 9997, 9998, 9999, 10_000]);
    expect(events[0]?.summary).toBe('line-9996');
  });

  it('ignores a torn final line', () => {
    const file = tmpFile('events.jsonl', `${line1}\n${line2}\n${line2.slice(0, 20)}`);
    expect(readRecentEvents(file, 5).map((event) => event.seq)).toEqual([1, 2]);
  });

  it('drops a partial first line when the backward read stops mid-file', () => {
    const lines = Array.from({ length: 2000 }, (_, index) =>
      JSON.stringify({
        v: 2,
        seq: index + 1,
        event: 'execution.started',
        timestamp: 't',
        summary: `padded-${index + 1}-${'x'.repeat(40)}`,
        data: {},
      }));
    const file = tmpFile('events.jsonl', `${lines.join('\n')}\n`);
    const events = readRecentEvents(file, 5);
    expect(events.map((event) => event.seq)).toEqual([1996, 1997, 1998, 1999, 2000]);
    expect(events.every((event) => event.rawLine === null && event.event?.event === 'execution.started')).toBe(true);
  });

  it('decodes a multi-byte summary read across chunks', () => {
    const filler = numbered(2000);
    const last = JSON.stringify({
      v: 2,
      seq: 2001,
      event: 'provider.turn_completed',
      timestamp: 't',
      summary: '日本語 — claude/sonnet',
      data: {},
    });
    const file = tmpFile('events.jsonl', `${filler.join('\n')}\n${last}\n`);
    const events = readRecentEvents(file, 1);
    expect(events).toHaveLength(1);
    expect(events[0]?.summary).toBe('日本語 — claude/sonnet');
  });

  it('returns nothing for a missing file, an empty file, a torn line or a non-positive limit', () => {
    expect(readRecentEvents(path.join(os.tmpdir(), 'does-not-exist-recent.jsonl'), 5)).toEqual([]);
    expect(readRecentEvents(tmpFile('events.jsonl', ''), 5)).toEqual([]);
    expect(readRecentEvents(tmpFile('events.jsonl', line2.slice(0, 20)), 5)).toEqual([]);
    const file = tmpFile('events.jsonl', `${line1}\n`);
    expect(readRecentEvents(file, 0)).toEqual([]);
    expect(readRecentEvents(file, -1)).toEqual([]);
  });
});

describe('EventTail', () => {
  it('keeps its own offset and watermark, and de-duplicates by seq', () => {
    const file = tmpFile('events.jsonl', `${line1}
${line2}
`);
    const tail = new EventTail(file);
    expect(tail.read().map((event) => event.seq)).toEqual([1, 2]);
    expect(tail.lastSeq).toBe(2);
    expect(tail.read()).toEqual([]);

    const next = JSON.stringify({ v: 2, seq: 3, event: 'provider.turn_completed', timestamp: 't', data: {} });
    writeFileSync(file, `${line1}
${line2}
${next}
`);
    expect(tail.read().map((event) => event.seq)).toEqual([3]);
    expect(tail.lastSeq).toBe(3);
  });

  it('drops a replayed seq at or below the watermark but keeps events without a seq', () => {
    const noSeq = JSON.stringify({ event: 'note', timestamp: 't', data: {} });
    const file = tmpFile('events.jsonl', `${line1}
${line2}
`);
    const tail = new EventTail(file);
    tail.read();
    writeFileSync(file, `${line1}
${line2}
${line2}
${noSeq}
`);
    expect(tail.read().map((event) => event.event?.event)).toEqual(['note']);
  });

  it('reads nothing for a missing file', () => {
    expect(new EventTail(path.join(mkdtemp(), 'absent.jsonl')).read()).toEqual([]);
  });

  it('keeps a bounded history and counts what it dropped', () => {
    const lines = [1, 2, 3, 4, 5].map((seq) => JSON.stringify({ v: 2, seq, event: 'e', timestamp: 't', data: {} }));
    const file = tmpFile('events.jsonl', `${lines.join('\n')}\n`);
    const tail = new EventTail(file, { maxHistory: 3 });
    tail.read();
    expect(tail.history.map((event) => event.seq)).toEqual([3, 4, 5]);
    expect(tail.droppedCount).toBe(2);
  });

  it('resets offset, watermark and history on truncation, and re-reads the new content', () => {
    const file = tmpFile('events.jsonl', `${line1}\n${line2}\n`);
    const tail = new EventTail(file);
    tail.read();
    expect(tail.lastSeq).toBe(2);
    // A repair rewrites the log shorter, restarting sequence numbers.
    writeFileSync(file, `${line1}\n`);
    const update = tail.poll();
    expect(update.truncated).toBe(true);
    expect(update.events.map((event) => event.seq)).toEqual([1]);
    expect(tail.history.map((event) => event.seq)).toEqual([1]);
    expect(tail.droppedCount).toBe(0);
    expect(tail.lastSeq).toBe(1);
    expect(tail.poll()).toEqual({ events: [], truncated: false });
  });

  it('does not treat an unreadable file as truncation', () => {
    const file = tmpFile('events.jsonl', `${line1}\n`);
    const tail = new EventTail(file);
    tail.read();
    rmSync(file);
    expect(tail.poll()).toEqual({ events: [], truncated: false });
    expect(tail.history).toHaveLength(1);
  });
});

describe('captured events.jsonl against the contract', () => {
  it('every line is a known envelope and reads as an event, not a raw line', () => {
    const file = path.join(__dirname, 'fixtures', 'sessions', 'completed', 'events.jsonl');
    const lines = readFileSync(file, 'utf8').split('\n').filter((line) => line !== '');
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const value: unknown = JSON.parse(line);
      expect(isValid(LifecycleEventV2, value) || isValid(LegacyLifecycleEvent, value)).toBe(true);
    }
    const read = tailEvents(file, 0);
    expect(read.events.every((event) => event.rawLine === null && event.event !== null)).toBe(true);
  });
});

// RC1: each required envelope field, missing or wrong-typed on an otherwise valid line, never throws and sends the line
// down the raw-line path. A v2 line missing `v` is a legacy line, which is accepted.
describe('envelope required fields', () => {
  const valid: Record<string, unknown> = { v: 2, seq: 1, event: 'session.created', timestamp: 't1', data: {} };
  const read = (record: Record<string, unknown>) => tailEvents(tmpFile('events.jsonl', `${JSON.stringify(record)}\n`), 0).events[0];
  const without = (key: string) => Object.fromEntries(Object.entries(valid).filter(([name]) => name !== key));

  it.each(['seq', 'event', 'timestamp', 'data'])('reads a v2 line without %s as a raw line', (field) => {
    const entry = read(without(field));
    expect(entry?.event).toBeNull();
    expect(entry?.rawLine).toBe(JSON.stringify(without(field)));
    expect(entry?.isUnknownVersion).toBe(false);
  });

  it.each([
    ['seq', '1'],
    ['event', 7],
    ['timestamp', 5],
    ['data', 'x'],
    ['v', '2'],
  ])('reads a line with a wrong-typed %s as a raw line', (field, value) => {
    const entry = read({ ...valid, [field]: value });
    expect(entry?.event).toBeNull();
    expect(entry?.rawLine).not.toBeNull();
  });

  it('accepts a legacy line with only event, and with v 1', () => {
    expect(read({ event: 'old' })?.event).toEqual({ event: 'old' });
    expect(read({ v: 1, event: 'old' })?.rawLine).toBeNull();
    expect(read({ v: 1 })?.event).toBeNull();
  });

  it('drops a wrong-typed extension field and keeps the event', () => {
    const entry = read({ ...valid, execution_id: 4, stage_id: ['x'], summary: {} });
    expect(entry?.event).not.toBeNull();
    expect([entry?.executionId, entry?.stageId, entry?.summary]).toEqual([null, null, null]);
  });
});

// RC1: the known event the extension reads as human-input evidence, session.active, keeps the contract's required
// fields in both shapes; a failure is a raw line and never falls back to the permissive legacy shape.
describe('session.active required fields', () => {
  const v2: Record<string, unknown> = { v: 2, seq: 1, event: 'session.active', timestamp: 't1', data: { reply: 'x' } };
  const legacy: Record<string, unknown> = { event: 'session.active', timestamp: 't1', data: { reply: 'x' } };
  const read = (record: Record<string, unknown>) => tailEvents(tmpFile('events.jsonl', `${JSON.stringify(record)}
`), 0).events[0];
  const without = (record: Record<string, unknown>, key: string) =>
    Object.fromEntries(Object.entries(record).filter(([name]) => name !== key));

  it('accepts a valid line of each shape', () => {
    expect(read(v2)?.event?.event).toBe('session.active');
    expect(read(legacy)?.event?.event).toBe('session.active');
  });

  it.each([
    ['v2', v2],
    ['legacy', legacy],
  ])('reads a %s line without timestamp or data as a raw line', (_name, record) => {
    for (const field of ['timestamp', 'data']) {
      const entry = read(without(record, field));
      expect(entry?.event).toBeNull();
      expect(entry?.rawLine).toBe(JSON.stringify(without(record, field)));
    }
  });

  it.each([
    ['timestamp', 5],
    ['data', 'x'],
    ['data', ['x']],
  ])('reads a legacy line with a wrong-typed required %s as a raw line', (field, value) => {
    const entry = read({ ...legacy, [field]: value });
    expect(entry?.event).toBeNull();
    expect(entry?.rawLine).not.toBeNull();
  });

  it('reads a v2 line with a wrong-typed seq as a raw line', () => {
    expect(read({ ...v2, seq: '1' })?.rawLine).not.toBeNull();
  });

  it.each([
    ['execution_id', 4],
    ['stage_id', 4],
    ['summary', 4],
    ['seq', '1'],
  ])('drops a wrong-typed optional legacy %s and keeps the event', (field, value) => {
    const entry = read({ ...legacy, execution_id: 'e1', stage_id: 'plan', summary: 's', [field]: value });
    expect(entry?.rawLine).toBeNull();
    expect(entry?.event?.event).toBe('session.active');
    expect(entry?.data).toEqual({ reply: 'x' });
    const dropped = {
      execution_id: entry?.executionId,
      stage_id: entry?.stageId,
      summary: entry?.summary,
      seq: entry?.seq,
    };
    expect(dropped[field as keyof typeof dropped]).toBeNull();
  });

  it.each([
    ['outcome', 'x'],
    ['from', 3],
    ['reason', 3],
    ['manual', 'yes'],
    ['reply', 3],
    ['origin', 3],
    ['answers', 'x'],
    ['answers', ['x']],
  ])('drops a wrong-typed data.%s, keeps the event and its valid members', (field, value) => {
    const keeper = field === 'reason' ? 'origin' : 'reason';
    const entry = read({ ...v2, data: { [keeper]: 'k', [field]: value } });
    expect(entry?.rawLine).toBeNull();
    expect(entry?.event?.event).toBe('session.active');
    expect(entry?.data).toEqual({ [keeper]: 'k' });
    const eventData = entry?.event !== null && entry?.event !== undefined && 'data' in entry.event ? entry.event.data : null;
    expect(eventData).toEqual({ [keeper]: 'k' });
  });

  it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'extra'])(
    'keeps an unknown data key named %s without throwing',
    (key) => {
      const data = Object.defineProperty({ reply: 'x' }, key, { value: 'v', enumerable: true, configurable: true });
      const file = tmpFile('events.jsonl', `${JSON.stringify({ ...v2, data })}
`);
      const [entry] = tailEvents(file, 0).events;
      expect(entry?.rawLine).toBeNull();
      expect(entry?.event?.event).toBe('session.active');
      expect(Object.keys(entry?.data ?? {}).sort()).toEqual([key, 'reply'].sort());
      expect(Object.getOwnPropertyDescriptor(entry?.data ?? {}, key)?.value).toBe('v');
      expect(readRecentEvents(file, 10).map((recent) => recent.event?.event)).toEqual(['session.active']);
    },
  );

  it('accepts null outcome and from, and an answers list of records', () => {
    expect(read({ ...v2, data: { outcome: null, from: null, answers: [{ id: '1' }] } })?.rawLine).toBeNull();
  });
});

// RC2: every events.jsonl line of every conforming fixture reads as a contract event, not a raw line.
describe('conforming fixture events', () => {
  const root = path.join(__dirname, 'fixtures');
  const files = ['sessions', 'captured', 'synthetic'].flatMap((group) =>
    readdirSync(path.join(root, group), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, group, entry.name, 'events.jsonl'))
      .filter((file) => existsSync(file)));

  it.each(files)('reads every line of %s', (file) => {
    const read = tailEvents(file, 0);
    expect(read.events.filter((entry) => entry.rawLine !== null)).toEqual([]);
  });
});
