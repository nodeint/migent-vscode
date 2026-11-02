import { rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { type IntervalTimers, Liveness } from './liveness';
import { SessionStore } from './store';
import { makeProject } from './testHelpers';

const projects: string[] = [];

afterEach(() => {
  for (const dir of projects.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fakeIntervals(): IntervalTimers & { active: () => number; fire: () => void } {
  const timers = new Map<number, () => void>();
  let nextId = 1;
  return {
    setInterval: (callback) => {
      const id = nextId++;
      timers.set(id, callback);
      return id;
    },
    clearInterval: (id) => {
      timers.delete(id);
    },
    active: () => timers.size,
    fire: () => {
      for (const callback of [...timers.values()]) callback();
    },
  };
}

function project(): { store: SessionStore; lock: string } {
  const root = makeProject();
  projects.push(root);
  const lock = path.join(root, '.migent', 'sessions', 'running', 'session.lock');
  // The committed lock is stale; give it a fresh heartbeat from this host so it probes as alive.
  writeFileSync(
    lock,
    JSON.stringify({ pid: process.pid, host: os.hostname(), heartbeat_at: new Date().toISOString() }),
  );
  const store = new SessionStore(root);
  store.load();
  return { store, lock };
}

describe('Liveness', () => {
  it('has no timer while nothing is Running', () => {
    const { store, lock } = project();
    rmSync(lock);
    store.refreshSession('running');
    const timers = fakeIntervals();
    const liveness = new Liveness({ stores: () => [store], timers });
    liveness.update();
    expect(liveness.isActive).toBe(false);
    expect(timers.active()).toBe(0);
  });

  it('starts one timer when a session is Running, not one per update', () => {
    const { store } = project();
    const timers = fakeIntervals();
    const liveness = new Liveness({ stores: () => [store, store], timers });
    liveness.update();
    liveness.update();
    expect(liveness.isActive).toBe(true);
    expect(timers.active()).toBe(1);
  });

  it('lets a hard-killed session leave Running on a tick, then stops the timer', () => {
    const { store, lock } = project();
    const timers = fakeIntervals();
    const liveness = new Liveness({ stores: () => [store], timers });
    liveness.update();
    // The runner dies without an event: the lock disappears (or its heartbeat goes stale).
    rmSync(lock);
    expect(store.snapshot('running')?.displayState.state).toBe('running');
    timers.fire();
    expect(store.snapshot('running')?.displayState.state).toBe('stopped');
    expect(liveness.isActive).toBe(false);
    expect(timers.active()).toBe(0);
  });

  it('refreshes only Running sessions on a tick', () => {
    const { store } = project();
    const refreshed: string[] = [];
    const original = store.refreshSession.bind(store);
    store.refreshSession = (id: string): void => {
      refreshed.push(id);
      original(id);
    };
    const liveness = new Liveness({ stores: () => [store], timers: fakeIntervals() });
    liveness.tick();
    expect(refreshed).toEqual(['running']);
  });

  it('dispose clears the timer', () => {
    const { store } = project();
    const timers = fakeIntervals();
    const liveness = new Liveness({ stores: () => [store], timers });
    liveness.update();
    liveness.dispose();
    expect(timers.active()).toBe(0);
    expect(liveness.isActive).toBe(false);
  });

  it('notifies tick listeners after each tick until they unsubscribe', () => {
    const { store } = project();
    const liveness = new Liveness({ stores: () => [store], timers: fakeIntervals() });
    let ticks = 0;
    const unsubscribe = liveness.onDidTick(() => {
      ticks += 1;
    });
    liveness.tick();
    liveness.tick();
    unsubscribe();
    liveness.tick();
    expect(ticks).toBe(2);
  });
});
