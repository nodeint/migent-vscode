import * as vscode from 'vscode';

import type { SessionSnapshot } from '../../core/model';
import { sessionLabel } from '../../core/sessionPresentation';
import { formatTimeline, formatTimelineLine } from '../../core/timelineFormat';
import type { ProjectKey } from '../changes';
import type { ProjectRegistry } from '../projects';
import type { TailHandle, TailManager } from '../tails';

export const MAX_LOG_CHANNELS = 5;

const SHORT_ID_LENGTH = 8;

/** Held only while the session is Running; otherwise the channel is a static snapshot. */
class Entry {
  public handle: TailHandle | null = null;
  #subscription: vscode.Disposable | null = null;

  constructor(
    public readonly project: ProjectKey,
    public readonly sessionId: string,
    public readonly channel: vscode.LogOutputChannel,
  ) {}

  public follow(handle: TailHandle): void {
    this.handle = handle;
    this.#subscription = handle.onDidUpdate((update) => {
      if (update.truncated) {
        this.channel.clear();
        for (const line of formatTimeline(handle.history, handle.droppedCount)) this.channel.info(line);
      } else {
        for (const event of update.events) this.channel.info(formatTimelineLine(event));
      }
    });
  }

  public detach(): void {
    this.#subscription?.dispose();
    this.handle?.dispose();
    this.#subscription = null;
    this.handle = null;
  }
}

const keyOf = (project: ProjectKey, sessionId: string): string => `${project}#${sessionId}`;

/**
 * One `LogOutputChannel` per session, at most `MAX_LOG_CHANNELS`, least recently shown disposed
 * first. A channel follows the tail only while its session is Running; when the session stops it
 * does a final read and releases the tail (plans/02-monitoring.md §6.4, §6.8).
 */
export class LogChannels implements vscode.Disposable {
  readonly #registry: ProjectRegistry;
  readonly #tails: TailManager;
  /** Insertion order is recency: the first entry is the least recently shown. */
  readonly #entries = new Map<string, Entry>();
  readonly #subscription: vscode.Disposable;

  constructor(registry: ProjectRegistry, tails: TailManager) {
    this.#registry = registry;
    this.#tails = tails;
    this.#subscription = registry.onDidChange((change) => {
      if (change.type === 'session') {
        const key = keyOf(change.project, change.sessionId);
        if (change.kind === 'removed') this.#dispose(key);
        else this.#settle(key);
      } else if (change.type === 'projects') {
        for (const [key, entry] of [...this.#entries]) {
          if (this.#registry.project(entry.project) === undefined) this.#dispose(key);
        }
      }
    });
  }

  /** Names of the live channels, least recently shown first (tests). */
  public get names(): string[] {
    return [...this.#entries.values()].map((entry) => entry.channel.name);
  }

  /** Number of channels currently following a tail (tests, idle guarantee). */
  public get tailingCount(): number {
    return [...this.#entries.values()].filter((entry) => entry.handle !== null).length;
  }

  /** Create or reveal the session's channel with a catch-up read. */
  public show(project: ProjectKey, snapshot: SessionSnapshot): void {
    const key = keyOf(project, snapshot.sessionId);
    let entry = this.#entries.get(key);
    if (entry === undefined) {
      this.#evictOldest();
      entry = new Entry(
        project,
        snapshot.sessionId,
        vscode.window.createOutputChannel(
          `Migent: ${snapshot.sessionId.slice(0, SHORT_ID_LENGTH)} ${sessionLabel(snapshot)}`,
          { log: true },
        ),
      );
    } else {
      this.#entries.delete(key); // re-inserted below as the most recently shown
    }
    this.#entries.set(key, entry);
    this.#catchUp(entry);
    entry.channel.show(true);
  }

  public dispose(): void {
    this.#subscription.dispose();
    for (const key of [...this.#entries.keys()]) this.#dispose(key);
  }

  /** Rewrite the channel from the tail history; follow the tail only while the session is Running. */
  #catchUp(entry: Entry): void {
    entry.detach();
    const handle = this.#tails.acquire(entry.project, entry.sessionId);
    entry.channel.clear();
    if (handle === undefined) return;
    handle.poll(); // another holder may share the tail, so a missed watcher event is read here
    for (const line of formatTimeline(handle.history, handle.droppedCount)) entry.channel.info(line);
    if (this.#isRunning(entry)) {
      entry.follow(handle);
    } else {
      handle.dispose();
    }
  }

  /** A session changed: follow the tail when it is Running, read once more and stop when it is not. */
  #settle(key: string): void {
    const entry = this.#entries.get(key);
    if (entry === undefined) return;
    if (this.#isRunning(entry)) {
      if (entry.handle === null) this.#catchUp(entry);
    } else if (entry.handle !== null) {
      entry.handle.poll();
      entry.detach();
    }
  }

  #isRunning(entry: Entry): boolean {
    return this.#registry.project(entry.project)?.store.snapshot(entry.sessionId)?.displayState.state === 'running';
  }

  #evictOldest(): void {
    if (this.#entries.size < MAX_LOG_CHANNELS) return;
    const oldest = this.#entries.keys().next();
    if (oldest.done !== true) this.#dispose(oldest.value);
  }

  #dispose(key: string): void {
    const entry = this.#entries.get(key);
    if (entry === undefined) return;
    this.#entries.delete(key);
    entry.detach();
    entry.channel.dispose();
  }
}
