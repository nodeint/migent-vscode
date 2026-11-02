import * as vscode from 'vscode';

import { EventTail, type TailUpdate } from '../core/eventTail';
import { eventsPath } from '../core/paths';
import type { ProjectKey } from './changes';
import type { ProjectRegistry } from './projects';

/** One consumer's claim on a session's event tail. Dispose it when the events are no longer shown. */
export interface TailHandle extends vscode.Disposable {
  /** Most recent events, oldest first (bounded). Shared with the other holders of the same tail. */
  readonly history: EventTail['history'];
  readonly droppedCount: number;
  /** Fires after every poll that changed anything, with the newly read events. */
  readonly onDidUpdate: vscode.Event<TailUpdate>;
  /** Read what was appended since the last read (catch-up). */
  poll(): void;
}

class Entry {
  public tail: EventTail;
  public readonly emitter = new vscode.EventEmitter<TailUpdate>();
  public holders = 0;
  /** The project went away while holders remained; the tail restarts when it comes back. */
  public isOrphaned = false;

  constructor(
    public readonly project: ProjectKey,
    public readonly sessionId: string,
    private readonly file: string,
  ) {
    this.tail = new EventTail(file);
  }

  /** Forget the offset and history: the file may have been recreated. */
  public restart(): void {
    this.tail = new EventTail(this.file);
  }
}

const hasEvents = (targets: readonly { kind: string }[]): boolean => targets.some((target) => target.kind === 'events');

const keyOf = (project: ProjectKey, sessionId: string): string => `${project}#${sessionId}`;

/**
 * Reference-counted tail interest per (project, session). The first holder creates the
 * `EventTail` and reads it from the start; later `events.jsonl` changes read incrementally;
 * when the last holder disposes, the tail and its history are dropped. With no holder there
 * is no tail, no timer and no read (plans/02-monitoring.md §6.4, §6.5).
 */
export class TailManager implements vscode.Disposable {
  readonly #registry: ProjectRegistry;
  readonly #entries = new Map<string, Entry>();
  readonly #subscription: vscode.Disposable;

  constructor(registry: ProjectRegistry) {
    this.#registry = registry;
    this.#subscription = registry.onDidChange((change) => {
      if (change.type === 'files' && hasEvents(change.targets)) {
        const entry = this.#entries.get(keyOf(change.project, change.sessionId));
        if (entry !== undefined) this.#poll(entry);
      } else if (change.type === 'refresh') {
        for (const entry of this.#entries.values()) this.#poll(entry);
      } else if (change.type === 'projects') {
        this.#syncProjects();
      }
    });
  }

  /** Number of sessions with an active tail (tests, idle guarantee). */
  public get activeCount(): number {
    return this.#entries.size;
  }

  /** Take interest in a session's events; undefined when the project is not open. */
  public acquire(project: ProjectKey, sessionId: string): TailHandle | undefined {
    const context = this.#registry.project(project);
    if (context === undefined) return undefined;
    const key = keyOf(project, sessionId);
    let entry = this.#entries.get(key);
    if (entry === undefined) {
      entry = new Entry(project, sessionId, eventsPath(context.root, sessionId));
      this.#entries.set(key, entry);
      entry.tail.poll();
    }
    entry.holders += 1;
    const held = entry;
    let isReleased = false;
    return {
      get history() {
        return held.tail.history;
      },
      get droppedCount() {
        return held.tail.droppedCount;
      },
      onDidUpdate: held.emitter.event,
      poll: () => {
        if (!isReleased) this.#poll(held);
      },
      dispose: () => {
        if (isReleased) return;
        isReleased = true;
        held.holders -= 1;
        if (held.holders <= 0) this.#drop(key, held);
      },
    };
  }

  public dispose(): void {
    this.#subscription.dispose();
    for (const [key, entry] of [...this.#entries]) this.#drop(key, entry);
  }

  #poll(entry: Entry): void {
    const update = entry.tail.poll();
    if (update.events.length > 0 || update.truncated) entry.emitter.fire(update);
  }

  #drop(key: string, entry: Entry): void {
    if (this.#entries.get(key) === entry) this.#entries.delete(key);
    entry.emitter.dispose();
  }

  /**
   * Holders outlive a project that is removed and recreated, so their handles stay valid:
   * the tail restarts from the new file and holders are told to re-render.
   */
  #syncProjects(): void {
    for (const entry of this.#entries.values()) {
      const isOpen = this.#registry.project(entry.project) !== undefined;
      if (!isOpen) {
        entry.isOrphaned = true;
      } else if (entry.isOrphaned) {
        entry.isOrphaned = false;
        entry.restart();
        entry.tail.poll();
        entry.emitter.fire({ events: [...entry.tail.history], truncated: true });
      }
    }
  }
}
