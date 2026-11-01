import type { SessionStore } from './store';

/** Interval seam so tests drive time by hand. */
export interface IntervalTimers {
  setInterval: (callback: () => void, delayMs: number) => number;
  clearInterval: (id: number) => void;
}

export const LIVENESS_INTERVAL_MS = 10_000;

function realIntervals(): IntervalTimers {
  const live = new Map<number, ReturnType<typeof setInterval>>();
  let nextId = 1;
  return {
    setInterval: (callback, delayMs) => {
      const id = nextId++;
      live.set(id, setInterval(callback, delayMs));
      return id;
    },
    clearInterval: (id) => {
      const handle = live.get(id);
      if (handle !== undefined) clearInterval(handle);
      live.delete(id);
    },
  };
}

export interface LivenessOptions {
  stores: () => readonly SessionStore[];
  intervalMs?: number;
  timers?: IntervalTimers;
}

/**
 * One timer for every project, alive only while some session is Running. A hard-killed
 * runner leaves no event, so each tick re-reads the Running sessions (lock included) and
 * lets them leave Running once the lock goes stale. Call `update()` after any session
 * change; it starts or stops the timer. Nothing runs while no session is Running.
 */
export class Liveness {
  readonly #options: LivenessOptions;
  readonly #timers: IntervalTimers;
  readonly #tickListeners = new Set<() => void>();
  #timerId: number | null = null;

  constructor(options: LivenessOptions) {
    this.#options = options;
    this.#timers = options.timers ?? realIntervals();
  }

  public get isActive(): boolean {
    return this.#timerId !== null;
  }

  /** Called after every tick, so views can refresh time-dependent text. Returns an unsubscribe function. */
  public onDidTick(listener: () => void): () => void {
    this.#tickListeners.add(listener);
    return () => {
      this.#tickListeners.delete(listener);
    };
  }

  /** Start the timer when a session is Running and none is active; stop it when none remain. */
  public update(): void {
    const hasRunning = this.#options.stores().some((store) => this.runningIds(store).length > 0);
    if (hasRunning && this.#timerId === null) {
      this.#timerId = this.#timers.setInterval(() => {
        this.tick();
      }, this.#options.intervalMs ?? LIVENESS_INTERVAL_MS);
    } else if (!hasRunning && this.#timerId !== null) {
      this.stop();
    }
  }

  /** Re-read every Running session once. Public so the host can force a check. */
  public tick(): void {
    for (const store of this.#options.stores()) {
      for (const sessionId of this.runningIds(store)) store.refreshSession(sessionId);
    }
    this.update();
    for (const listener of this.#tickListeners) listener();
  }

  public dispose(): void {
    this.#tickListeners.clear();
    this.stop();
  }

  private stop(): void {
    if (this.#timerId === null) return;
    this.#timers.clearInterval(this.#timerId);
    this.#timerId = null;
  }

  private runningIds(store: SessionStore): string[] {
    return store
      .all()
      .filter((snapshot) => snapshot.displayState.state === 'running')
      .map((snapshot) => snapshot.sessionId);
  }
}
