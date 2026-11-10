import { closeSync, fstatSync,openSync, readSync } from 'node:fs';

import type { LegacyLifecycleEvent, LifecycleEventV2, Static } from '@nodeint/migent-contracts';

import { declaredOf } from './contractRead';
import { KNOWN_EVENT_VERSION } from './model';
import { isRecord } from './record';

/**
 * Envelope keys read below. All but the three extension-only ones come from the opt-in known shapes (current
 * `LifecycleEventV2`, plus `LegacyLifecycleEvent` whose `v` is optional), so an upstream rename fails typecheck.
 * `execution_id`, `stage_id` and `summary` are in neither shape; they are read leniently and stay null when absent.
 */
/** The envelope as read: the current shape, with `v` also allowed to be absent or 1 as in the legacy shape. */
export type EnvelopeFields = Omit<LifecycleEventV2, 'v'> & {
  v: LifecycleEventV2['v'] | Static<typeof LegacyLifecycleEvent>['v'];
};
type ExtensionKey = 'execution_id' | 'stage_id' | 'summary';

/**
 * Tail events.jsonl by byte offset. Each call reads from `offset` to end of file
 * and processes only lines terminated by `\n`; the trailing partial line (the log
 * may be mid-write) stays in the file and is picked up on the next call.
 *
 * Envelope: `{v, seq, event, timestamp, execution_id, stage_id, summary, data}`.
 * Lines from older migent have no `v` and read as version 1. An unknown `v`
 * yields the raw line instead of being dropped.
 */
export interface TailEvent {
  seq: number | null;
  v: number;
  event: string | null;
  timestamp: string;
  executionId: string | null;
  stageId: string | null;
  summary: string | null;
  data: Record<string, unknown>;
  raw: Record<string, unknown> | null;
  /** Set when the line did not parse or carries an unknown `v`. */
  rawLine: string | null;
}

export interface TailRead {
  events: TailEvent[];
  /** Byte offset to pass to the next call: just past the last complete line. */
  offset: number;
  /**
   * True when the file was smaller than the offset passed in (truncated or rewritten
   * by a repair). The read then restarted from byte 0 and `events` holds the new content.
   */
  truncated: boolean;
}

const CHUNK_SIZE = 65_536;

/** Read the file from `offset` to EOF as one string. Empty when nothing new. */
function readFrom(offset: number, filePath: string): { text: string; size: number } {
  let fd: number;
  try {
    fd = openSync(filePath, 'r');
  } catch {
    return { text: '', size: offset };
  }
  try {
    const {size} = fstatSync(fd);
    if (size <= offset) return { text: '', size };
    const chunks: string[] = [];
    let position = offset;
    while (position < size) {
      const length = Math.min(CHUNK_SIZE, size - position);
      const buffer = Buffer.alloc(length);
      const read = readSync(fd, buffer, 0, length, position);
      if (read <= 0) break;
      chunks.push(buffer.toString('utf8', 0, read));
      position += read;
    }
    return { text: chunks.join(''), size };
  } finally {
    closeSync(fd);
  }
}

function parseLine(line: string): TailEvent {
  let value: unknown = null;
  try {
    value = JSON.parse(line);
  } catch {
    // Fall through: returned as a raw line below.
  }
  const record = isRecord(value) ? value : null;
  const wire = declaredOf<EnvelopeFields>(record);
  if (record === null || wire === null || typeof wire.event !== 'string') {
    return emptyEvent({ raw: null, rawLine: line, seq: null, v: 1, event: null });
  }
  const version = wire.v;
  const v = typeof version === 'number' && Number.isInteger(version) && version >= 1 ? version : 1;
  const isUnknownVersion = v > KNOWN_EVENT_VERSION;
  const ext = (key: ExtensionKey): string | null => (typeof record[key] === 'string' ? record[key] : null);
  const seq = typeof wire.seq === 'number' && Number.isInteger(wire.seq) ? wire.seq : null;
  const parsed: TailEvent = {
    seq,
    v,
    event: wire.event,
    timestamp: typeof wire.timestamp === 'string' ? wire.timestamp : '',
    executionId: ext('execution_id'),
    stageId: ext('stage_id'),
    summary: ext('summary'),
    data: isData(wire.data),
    raw: record,
    rawLine: isUnknownVersion ? line : null,
  };
  return parsed;
}

function isData(value: unknown): Record<string, unknown> {
  return isRecord(value)
    ? value
    : {};
}

function emptyEvent(overrides: Partial<TailEvent>): TailEvent {
  return {
    seq: null,
    v: 1,
    event: null,
    timestamp: '',
    executionId: null,
    stageId: null,
    summary: null,
    data: {},
    raw: null,
    rawLine: null,
    ...overrides,
  };
}

/**
 * Read new events from `offset`. Only complete lines are consumed; a torn tail
 * (no trailing `\n` yet) is left for the next call. A file smaller than `offset`
 * was truncated: the read restarts from byte 0 and reports `truncated`.
 */
export function tailEvents(filePath: string, offset: number): TailRead {
  const { text, size } = readFrom(offset, filePath);
  if (size < offset) return { ...tailEvents(filePath, 0), truncated: true };
  if (text === '') return { events: [], offset: Math.max(offset, size), truncated: false };

  const lastNewline = text.lastIndexOf('\n');
  const consumed = lastNewline === -1 ? '' : text.slice(0, lastNewline + 1);
  if (consumed === '') return { events: [], offset, truncated: false };

  const events = consumed
    .split('\n')
    .filter((line) => line !== '')
    .map(parseLine);
  return { events, offset: offset + Buffer.byteLength(consumed, 'utf8'), truncated: false };
}

/**
 * Read the newest `limit` complete lines from `events.jsonl` without reading the
 * whole file. Walks backward in `CHUNK_SIZE` blocks until `limit + 1` newlines are
 * seen, joins the buffers and decodes once (so a multi-byte character split by a
 * block boundary is not corrupted), drops a possibly partial first line when the
 * walk stopped before byte 0, and ignores a torn final line. Returns `[]` for a
 * missing or unreadable file, a non-positive `limit`, or a file with no complete
 * line; never throws.
 */
export function readRecentEvents(filePath: string, limit: number): TailEvent[] {
  if (!Number.isInteger(limit) || limit <= 0) return [];
  let fd: number;
  try {
    fd = openSync(filePath, 'r');
  } catch {
    return [];
  }
  try {
    const {size} = fstatSync(fd);
    if (size <= 0) return [];
    const { text, start } = readTailText(fd, size, limit + 1);
    return recentLines(text, start, limit);
  } catch {
    return [];
  } finally {
    closeSync(fd);
  }
}

const NEWLINE = 0x0a;

function countNewlines(chunk: Buffer): number {
  let count = 0;
  for (const byte of chunk) if (byte === NEWLINE) count += 1;
  return count;
}

/** Collect backward blocks until `wanted` newlines or byte 0; decode once. */
function readTailText(fd: number, size: number, wanted: number): { text: string; start: number } {
  const chunks: Buffer[] = [];
  let newlines = 0;
  let position = size;
  while (position > 0 && newlines < wanted) {
    const length = Math.min(CHUNK_SIZE, position);
    const chunkStart = position - length;
    const buffer = Buffer.alloc(length);
    const read = readSync(fd, buffer, 0, length, chunkStart);
    if (read <= 0) break;
    const chunk = buffer.subarray(0, read);
    chunks.unshift(chunk);
    newlines += countNewlines(chunk);
    position = chunkStart;
  }
  return { text: Buffer.concat(chunks).toString('utf8'), start: position };
}

function recentLines(text: string, start: number, limit: number): TailEvent[] {
  const lastNewline = text.lastIndexOf('\n');
  if (lastNewline === -1) return [];
  const lines = text.slice(0, lastNewline).split('\n');
  // A backward read that stopped before byte 0 starts mid-line.
  const complete = start > 0 ? lines.slice(1) : lines;
  return complete
    .filter((line) => line !== '')
    .slice(-limit)
    .map(parseLine);
}

/** Most recent events an `EventTail` keeps; older ones are dropped and counted. */
export const DEFAULT_MAX_HISTORY = 5000;

export interface EventTailOptions {
  maxHistory?: number;
}

export interface TailUpdate {
  /** Events newly read by this poll (after the `seq` watermark filter). */
  events: TailEvent[];
  /** True when the file shrank: history was cleared and `events` is the whole new content. */
  truncated: boolean;
}

/**
 * Incremental reader for one `events.jsonl`. Owns the byte offset, the `seq`
 * watermark and a bounded history, so it is independent of any session snapshot.
 * The caller decides when to `poll()` and drops the instance when it no longer
 * needs the events (releasing the history with it).
 */
export class EventTail {
  readonly #filePath: string;
  readonly #maxHistory: number;
  #offset = 0;
  #lastSeq = 0;
  #history: TailEvent[] = [];
  #dropped = 0;

  constructor(filePath: string, options: EventTailOptions = {}) {
    this.#filePath = filePath;
    this.#maxHistory = Math.max(1, options.maxHistory ?? DEFAULT_MAX_HISTORY);
  }

  /** Highest `seq` consumed so far; 0 before any numbered event. */
  public get lastSeq(): number {
    return this.#lastSeq;
  }

  /** The most recent events, oldest first, at most `maxHistory`. */
  public get history(): readonly TailEvent[] {
    return this.#history;
  }

  /** How many older events were dropped from the history (for a "not shown" marker). */
  public get droppedCount(): number {
    return this.#dropped;
  }

  /**
   * Read events appended since the last call. Events with a numeric `seq` at or
   * below the watermark are dropped; events without a `seq` are kept. When the file
   * shrank, offset, watermark and history are reset first and the new content is read
   * from the start.
   */
  public poll(): TailUpdate {
    const result = tailEvents(this.#filePath, this.#offset);
    if (result.truncated) {
      this.#lastSeq = 0;
      this.#history = [];
      this.#dropped = 0;
    }
    this.#offset = result.offset;
    const watermark = this.#lastSeq;
    const fresh = result.events.filter(
      (event) => event.seq === null || watermark === 0 || event.seq > watermark,
    );
    for (const event of fresh) {
      if (event.seq !== null && event.seq > this.#lastSeq) this.#lastSeq = event.seq;
    }
    this.#append(fresh);
    return { events: fresh, truncated: result.truncated };
  }

  /** Same as `poll()` when only the new events matter. */
  public read(): TailEvent[] {
    return this.poll().events;
  }

  #append(events: readonly TailEvent[]): void {
    this.#history.push(...events);
    const excess = this.#history.length - this.#maxHistory;
    if (excess > 0) {
      this.#history.splice(0, excess);
      this.#dropped += excess;
    }
  }
}
