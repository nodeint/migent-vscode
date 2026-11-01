/** Timer seam so tests drive time by hand. */
export interface CoalescerTimers {
  now: () => number;
  /** Returns an opaque numeric id for `clearTimer`. */
  setTimer: (callback: () => void, delayMs: number) => number;
  clearTimer: (id: number) => void;
}

function realTimers(): CoalescerTimers {
  const live = new Map<number, ReturnType<typeof setTimeout>>();
  let nextId = 1;
  return {
    now: () => Date.now(),
    setTimer: (callback, delayMs) => {
      const id = nextId++;
      live.set(
        id,
        setTimeout(() => {
          live.delete(id);
          callback();
        }, delayMs),
      );
      return id;
    },
    clearTimer: (id) => {
      const handle = live.get(id);
      if (handle !== undefined) clearTimeout(handle);
      live.delete(id);
    },
  };
}

export interface CoalescerOptions<T> {
  /** Quiet time after the last item before a key flushes. */
  delayMs: number;
  /** A key flushes at most this long after its first item, however busy it stays. */
  maxWaitMs: number;
  flush: (key: string, items: T[]) => void;
  timers?: CoalescerTimers;
}

interface Pending<T> {
  items: T[];
  firstAt: number;
  handle: number;
}

/**
 * Per-key trailing debounce with a maximum wait. Items added for a key while it is
 * pending are collected and delivered together in one `flush`.
 */
export class Coalescer<T> {
  readonly #options: CoalescerOptions<T>;
  readonly #timers: CoalescerTimers;
  readonly #pending = new Map<string, Pending<T>>();

  constructor(options: CoalescerOptions<T>) {
    this.#options = options;
    this.#timers = options.timers ?? realTimers();
  }

  public get pendingKeys(): string[] {
    return [...this.#pending.keys()];
  }

  public add(key: string, item: T): void {
    const now = this.#timers.now();
    const current = this.#pending.get(key);
    const firstAt = current?.firstAt ?? now;
    if (current !== undefined) this.#timers.clearTimer(current.handle);
    const wait = Math.max(0, Math.min(this.#options.delayMs, firstAt + this.#options.maxWaitMs - now));
    const handle = this.#timers.setTimer(() => {
      this.flushKey(key);
    }, wait);
    this.#pending.set(key, { items: [...(current?.items ?? []), item], firstAt, handle });
  }

  /** Flush one key now. No-op when nothing is pending for it. */
  public flushKey(key: string): void {
    const current = this.#pending.get(key);
    if (current === undefined) return;
    this.#timers.clearTimer(current.handle);
    this.#pending.delete(key);
    this.#options.flush(key, current.items);
  }

  public flushAll(): void {
    for (const key of this.pendingKeys) this.flushKey(key);
  }

  /** Drop everything pending without flushing; no timer remains. */
  public dispose(): void {
    for (const pending of this.#pending.values()) this.#timers.clearTimer(pending.handle);
    this.#pending.clear();
  }
}
