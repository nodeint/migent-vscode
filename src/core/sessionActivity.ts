import type { TailEvent } from './eventTail';
import { formatTimelineLine } from './timelineFormat';

/** How many recent events the Overview "Latest activity" block shows. */
export const OVERVIEW_ACTIVITY_LIMIT = 5;

/**
 * The Overview "Latest activity" block. A non-Running session never reads
 * `events.jsonl`, so its model is `{ visible: false }` and the block is absent.
 */
export type SessionActivity = { visible: false } | { visible: true; lines: string[] };

/**
 * Format the newest `OVERVIEW_ACTIVITY_LIMIT` events as activity lines, oldest
 * first. Pure: the caller decides whether the session is Running and supplies the
 * events it read; this module never reads a file.
 */
export function buildActivity(events: readonly TailEvent[]): SessionActivity {
  return {
    visible: true,
    lines: events.slice(-OVERVIEW_ACTIVITY_LIMIT).map((event) => formatTimelineLine(event)),
  };
}
