// Shared pure helpers for Migent webview pages: small functions that more than one script needs and that touch no DOM.
// Loaded first, before `copy.js` (see docs/ui.md), so the copy files can build their texts with it. Exposes one global,
// `MigentUtils`.
(function () {
  'use strict';

  /** A count with its noun, `plural(2, 'stage')` is "2 stages" and `plural(1, 'stage')` is "1 stage". */
  const plural = (count, noun) => count + ' ' + noun + (count === 1 ? '' : 's');

  const MS_PER_SECOND = 1000;
  const SECONDS_PER_MINUTE = 60;
  const MINUTES_PER_HOUR = 60;
  const HOURS_PER_DAY = 24;
  const JUST_NOW_MS = 5 * MS_PER_SECOND;

  /** A span of milliseconds as its two largest units: `45s`, `3m 12s`, `2h 5m`, `1d 4h`. Never negative. */
  function formatDuration(ms) {
    const seconds = Math.max(0, Math.floor(ms / MS_PER_SECOND));
    const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
    const hours = Math.floor(minutes / MINUTES_PER_HOUR);
    const days = Math.floor(hours / HOURS_PER_DAY);
    if (days > 0) return days + 'd ' + (hours % HOURS_PER_DAY) + 'h';
    if (hours > 0) return hours + 'h ' + (minutes % MINUTES_PER_HOUR) + 'm';
    if (minutes > 0) return minutes + 'm ' + (seconds % SECONDS_PER_MINUTE) + 's';
    return seconds + 's';
  }

  /** The epoch milliseconds of an ISO string, or null when it is not one. */
  function parseTime(iso) {
    const time = typeof iso === 'string' ? Date.parse(iso) : NaN;
    return Number.isNaN(time) ? null : time;
  }

  /** The age of something as its largest unit: `just now`, `5m ago`. */
  function formatAgo(ms) {
    return ms < JUST_NOW_MS ? 'just now' : formatDuration(ms).split(' ')[0] + ' ago';
  }

  window.MigentUtils = { plural, formatDuration, parseTime, formatAgo };
})();
