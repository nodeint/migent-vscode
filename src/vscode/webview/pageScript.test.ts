import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

type Listener = (event: { data: unknown }) => void;

interface Connected {
  send: (intent: Record<string, unknown>) => void;
  post: (message: Record<string, unknown>) => void;
}

/** Run `media/shared/page.js` against a minimal browser stub and return what the page would see. */
function load() {
  const listeners: Listener[] = [];
  const posted: unknown[] = [];
  const states: unknown[] = [];
  const window: Record<string, unknown> = {
    addEventListener: (_type: string, listener: Listener) => listeners.push(listener),
  };
  const context = vm.createContext({
    window,
    document: { querySelector: () => null, documentElement: { style: { setProperty: () => undefined } } },
    acquireVsCodeApi: () => ({
      postMessage: (message: unknown) => posted.push(message),
      setState: (state: unknown) => states.push(state),
    }),
  });
  const source = readFileSync(path.join(__dirname, '../../../media/shared/page.js'), 'utf8');
  vm.runInContext(source, context);
  const page = window.MigentPage as { connect: (options: { render: (...args: unknown[]) => void }) => Connected };
  return { page, listeners, posted, states };
}

describe('MigentPage.connect', () => {
  it('passes the transient state next to the model and ignores stale revisions', () => {
    const { page, listeners, posted, states } = load();
    const renders: unknown[][] = [];
    const connected = page.connect({ render: (...args) => renders.push(args) });
    expect(posted).toEqual([{ type: 'ready' }]);

    const identity = { sessionId: 's' };
    const transient = { pending: 'Starting', error: null };
    listeners[0]({ data: { type: 'model', revision: 2, identity, model: { a: 1 }, transient } });
    listeners[0]({ data: { type: 'model', revision: 2, identity, model: { a: 2 } } });
    listeners[0]({ data: { type: 'model', revision: 3, identity, model: { a: 3 } } });

    expect(renders).toEqual([[{ a: 1 }, transient], [{ a: 3 }, undefined]]);
    expect(states).toHaveLength(2);
    connected.send({ intent: 'x' });
    expect(posted.at(-1)).toEqual({ intent: 'x', type: 'intent', revision: 3 });
  });

  it('posts a page-typed message unchanged and still guards on the top-level revision', () => {
    const { page, listeners, posted } = load();
    const renders: unknown[][] = [];
    const connected = page.connect({ render: (...args) => renders.push(args) });
    const identity = { sessionId: 's' };
    // A revision only inside the model is not a revision: the message is ignored.
    listeners[0]({ data: { type: 'model', identity, model: { revision: 9 } } });
    listeners[0]({ data: { type: 'model', revision: 4, identity, model: { revision: 4 } } });
    listeners[0]({ data: { type: 'model', revision: 4, identity, model: { revision: 4, other: true } } });
    expect(renders).toEqual([[{ revision: 4 }, undefined]]);

    connected.post({ type: 'edit', fingerprint: 'f' });
    expect(posted.at(-1)).toEqual({ type: 'edit', fingerprint: 'f' });
  });
});
