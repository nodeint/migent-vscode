/**
 * Total order over session ids. All-digit ids (CLI 0.5.6 and later) compare by number, so `10` is newer than `9`;
 * an all-digit id sorts before a non-numeric one (UUID, timestamp, `session_<hex>`); other ids compare as strings.
 */
export function compareSessionIds(left: string, right: string): number {
  const isLeftNumeric = /^\d+$/.test(left);
  const isRightNumeric = /^\d+$/.test(right);
  if (isLeftNumeric && isRightNumeric) {
    const a = BigInt(left);
    const b = BigInt(right);
    if (a === b) return left === right ? 0 : left.length - right.length;
    return a < b ? -1 : 1;
  }
  if (isLeftNumeric) return -1;
  if (isRightNumeric) return 1;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
