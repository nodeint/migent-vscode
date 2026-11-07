import { describe, expect, it } from 'vitest';

import type { CapabilityState } from './version';
import { WindowCapability } from './windowCapability';

const ok: CapabilityState = { kind: 'ok', required: '0.4.1', detected: '0.4.1' };
const missing: CapabilityState = { kind: 'missing', required: '0.4.1' };

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('WindowCapability', () => {
  it('is checking, then settles and announces both transitions', async () => {
    const changes: string[] = [];
    const window: WindowCapability = new WindowCapability(
      async () => ok,
      () => changes.push(window.state.kind),
    );
    const done = window.check();
    expect(window.state.kind).toBe('checking');
    await done;
    expect(window.state.kind).toBe('ok');
    expect(changes).toEqual(['checking', 'ok']);
  });

  it('discards a superseded probe and ready() returns the current one', async () => {
    const first = deferred<CapabilityState>();
    const second = deferred<CapabilityState>();
    const probes = [first, second];
    const window = new WindowCapability(() => probes.shift()!.promise, () => {});
    void window.check();
    const ready = window.ready();
    void window.check();
    first.resolve(missing);
    second.resolve(ok);
    expect((await ready).kind).toBe('ok');
    expect(window.state.kind).toBe('ok');
  });
});
