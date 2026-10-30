import { closeSync, fstatSync,openSync, readSync } from 'node:fs';

import { KNOWN_EVENT_VERSION } from './model';

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
}

const CHUNK_SIZE = 64 * 1024;

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
  const isRecord =
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  if (isRecord === null || typeof isRecord.event !== 'string') {
    return emptyEvent({ raw: null, rawLine: line, seq: null, v: 1, event: null });
  }
  const version = isRecord.v;
  const v = typeof version === 'number' && Number.isInteger(version) && version >= 1 ? version : 1;
  const isUnknownVersion = v > KNOWN_EVENT_VERSION;
  const str = (key: string): string | null =>
    typeof isRecord[key] === 'string' ? (isRecord[key]) : null;
  const seq = typeof isRecord.seq === 'number' && Number.isInteger(isRecord.seq) ? isRecord.seq : null;
  const parsed: TailEvent = {
    seq,
    v,
    event: isRecord.event,
    timestamp: str('timestamp') ?? '',
    executionId: str('execution_id'),
    stageId: str('stage_id'),
    summary: str('summary'),
    data: isData(isRecord.data),
    raw: isRecord,
    rawLine: isUnknownVersion ? line : null,
  };
  return parsed;
}

function isData(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
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
 * (no trailing `\n` yet) is left for the next call. A file that shrank below the
 * offset is treated as fully consumed; the caller re-snapshots on such a rewrite.
 */
export function tailEvents(filePath: string, offset: number): TailRead {
  const { text, size } = readFrom(offset, filePath);
  if (text === '') return { events: [], offset: Math.max(offset, size) };

  const lastNewline = text.lastIndexOf('\n');
  const consumed = lastNewline === -1 ? '' : text.slice(0, lastNewline + 1);
  if (consumed === '') return { events: [], offset };

  const events = consumed
    .split('\n')
    .filter((line) => line !== '')
    .map(parseLine);
  return { events, offset: offset + Buffer.byteLength(consumed, 'utf8') };
}
