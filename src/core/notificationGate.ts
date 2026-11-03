/**
 * Groups notifications per session: while one is open for a session, later ones for the same session are not
 * stacked. Only the latest is kept and offered again when the open one is dismissed, if it still applies.
 * Other sessions are never affected. No `vscode` import.
 */
export class NotificationGate<T> {
  readonly #open = new Set<string>();
  readonly #pending = new Map<string, T>();

  /** True when the caller may show `item` now; otherwise it replaces any earlier queued item of the session. */
  public request(key: string, item: T): boolean {
    if (!this.#open.has(key)) {
      this.#open.add(key);
      return true;
    }
    this.#pending.set(key, item);
    return false;
  }

  /** The session's notification was dismissed or answered; returns the latest queued item, if any. */
  public release(key: string): T | undefined {
    this.#open.delete(key);
    const next = this.#pending.get(key);
    this.#pending.delete(key);
    return next;
  }
}
