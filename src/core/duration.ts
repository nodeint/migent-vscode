const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

/** Duration such as `45s`, `3m 12s`, `2h 5m`, `1d 4h`. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / MS_PER_SECOND));
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const days = Math.floor(hours / HOURS_PER_DAY);
  if (days > 0) return `${days}d ${hours % HOURS_PER_DAY}h`;
  if (hours > 0) return `${hours}h ${minutes % MINUTES_PER_HOUR}m`;
  if (minutes > 0) return `${minutes}m ${seconds % SECONDS_PER_MINUTE}s`;
  return `${seconds}s`;
}
