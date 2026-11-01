import type { TailEvent } from './eventTail';
import { parseExecutionId } from './executions';

export interface TimelineFormatOptions {
  /** Format clock times in UTC instead of local time (tests, stable output). */
  isUtc?: boolean;
}

const NO_TIME = '--:--:--';

const PAD_WIDTH = 2;

function pad(value: number): string {
  return String(value).padStart(PAD_WIDTH, '0');
}

function clock(timestamp: string, isUtc: boolean): string {
  const date = new Date(timestamp);
  if (timestamp === '' || Number.isNaN(date.getTime())) return NO_TIME;
  const parts = isUtc
    ? [date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()]
    : [date.getHours(), date.getMinutes(), date.getSeconds()];
  return parts.map(pad).join(':');
}

/** `stage#attempt` from the execution id, else the stage id, else nothing. */
function subject(event: TailEvent): string {
  if (event.executionId !== null) {
    const parsed = parseExecutionId(event.executionId);
    if (parsed !== null) return `${parsed.stageId}#${parsed.attempt}`;
  }
  return event.stageId ?? '';
}

/**
 * One timeline line, for example `10:15:30 plan#1 started · claude/sonnet`. A line
 * that did not parse, has no event name or carries an unknown version is passed
 * through unchanged and marked unrecognized.
 */
export function formatTimelineLine(event: TailEvent, options: TimelineFormatOptions = {}): string {
  if (event.rawLine !== null) return `${NO_TIME} [unrecognized] ${event.rawLine}`;
  const label = (event.event ?? '').replace(/^execution\./, '');
  const head = [clock(event.timestamp, options.isUtc === true), subject(event), label].filter((part) => part !== '');
  const line = head.join(' ');
  return event.summary === null ? line : `${line} · ${event.summary}`;
}

/** All lines, with a first marker line when older events were dropped from the bounded history. */
export function formatTimeline(
  events: readonly TailEvent[],
  droppedCount: number,
  options: TimelineFormatOptions = {},
): string[] {
  const lines = events.map((event) => formatTimelineLine(event, options));
  return droppedCount > 0 ? [`… ${droppedCount} earlier events not shown`, ...lines] : lines;
}
