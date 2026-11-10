import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

import { DISPLAY_STATE_ICONS, DISPLAY_STATE_TONES, stateTone } from '../../core/displayState';

type ConnectFn = (options: { render: (...args: unknown[]) => void }) => Connected;
type Listener = (event: { data: unknown }) => void;

interface Connected {
  send: (intent: Record<string, unknown>) => void;
  post: (message: Record<string, unknown>) => void;
}

/** A minimal element, enough for `MigentUi.details` to build its header and chevron. */
class FakeElement {
  public children: (FakeElement | string)[] = [];
  public attrs: Record<string, string> = {};
  public className = '';
  public open = false;
  public listeners: string[] = [];
  public handlers: Record<string, (() => void)[]> = {};

  public constructor(public readonly tagName: string) {}

  public set textContent(value: string) {
    this.children = value === '' ? [] : [value];
  }

  public get textContent(): string {
    return this.children.map((child) => (typeof child === 'string' ? child : child.textContent)).join('');
  }

  public append(...items: (FakeElement | string)[]): void {
    this.children.push(...items);
  }

  public setAttribute(name: string, value: string): void {
    this.attrs[name] = value;
  }

  public addEventListener(type: string, handler?: () => void): void {
    this.listeners.push(type);
    if (handler !== undefined) (this.handlers[type] ??= []).push(handler);
  }
}

/** Run the shared scripts against a minimal browser stub and return what the page would see. */
function load() {
  const listeners: Listener[] = [];
  const posted: unknown[] = [];
  const states: unknown[] = [];
  const window: Record<string, unknown> = {
    addEventListener: (_type: string, listener: Listener) => listeners.push(listener),
  };
  const context = vm.createContext({
    window,
    document: {
      querySelector: () => null,
      documentElement: { style: { setProperty: () => undefined } },
      createElement: (tag: string) => new FakeElement(tag.toUpperCase()),
      createElementNS: (_ns: string, tag: string) => new FakeElement(tag.toUpperCase()),
    },
    acquireVsCodeApi: () => ({
      postMessage: (message: unknown) => posted.push(message),
      setState: (state: unknown) => states.push(state),
    }),
  });
  for (const file of ['shared/utils.js', 'shared/icons.js', 'shared/copy.js', 'shared/dom.js', 'shared/components.js', 'shared/page.js', 'session/sessionHeader.js']) {
    vm.runInContext(readFileSync(path.join(__dirname, '../../../media', file), 'utf8'), context);
  }
  const header = window.MigentSessionHeader as {
    sessionStates: Record<string, { icon: string; tone: string }>;
    sessionHeader: (connected: Connected, options: Record<string, unknown>) => FakeElement;
  };
  const ui = window.MigentUi as {
    details: (
      summary: string | FakeElement,
      options?: { key?: string; className?: string; open?: boolean },
    ) => FakeElement;
  };
  const page = {
    ...header,
    ...ui,
    connect: (window.MigentPage as { connect: ConnectFn }).connect,
  };
  return { page, listeners, posted, states, icons: window.MigentIcons as Record<string, unknown[]> };
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

describe('MigentUi.details', () => {
  it('puts the shared chevron before the header and the header after it', () => {
    const { page } = load();
    const header = new FakeElement('DIV');
    header.textContent = 'Advanced settings';
    const node = page.details(header, { key: 'stage:0', className: 'wf-advanced' });

    expect(node.tagName).toBe('DETAILS');
    expect(node.className).toBe('mg-details wf-advanced');
    expect(node.listeners).toContain('toggle');

    const head = node.children[0] as FakeElement;
    expect(head.tagName).toBe('SUMMARY');
    expect(head.className).toBe('mg-details-summary');

    const arrow = head.children[0] as FakeElement;
    expect(arrow.className).toBe('mg-details-arrow');
    expect((arrow.children[0] as FakeElement).tagName).toBe('SVG');

    const heading = head.children[1] as FakeElement;
    expect(heading.className).toBe('mg-details-heading');
    expect(heading.children[0]).toBe(header);
  });

  it('keeps a string summary as the heading text and honors the default open state', () => {
    const { page } = load();
    const closed = page.details('Details', { key: 'details' });
    const heading = (closed.children[0] as FakeElement).children[1] as FakeElement;
    expect(heading.textContent).toBe('Details');
    expect(closed.open).toBe(false);
    expect(page.details('Details', { key: 'open', open: true }).open).toBe(true);
  });
});

function buttons(node: FakeElement): FakeElement[] {
  const own = node.tagName.toLowerCase() === 'button' ? [node] : [];
  return [...own, ...node.children.flatMap((child) => (typeof child === 'string' ? [] : buttons(child)))];
}

function menuItems(node: FakeElement): FakeElement[] {
  const own = node.attrs.role === 'menuitem' ? [node] : [];
  return [...own, ...node.children.flatMap((child) => (typeof child === 'string' ? [] : menuItems(child)))];
}

describe('MigentSessionHeader.sessionHeader', () => {
  const header = (state: string, canComplete: boolean, canReply = false) => {
    const { page, posted } = load();
    const connected = page.connect({ render: () => undefined });
    const meta = { canComplete, canReply };
    const node = page.sessionHeader(connected, { state, title: 't', meta, tabs: [], current: 'results' });
    return { items: menuItems(node), node, posted };
  };

  it('offers Complete session in the more menu of a stopped session and sends its session action', () => {
    const { items, posted } = header('Stopped', true);
    const complete = items.find((item) => item.textContent === 'Complete session…');
    expect(complete).toBeDefined();
    complete?.handlers.click?.[0]();
    expect(posted.at(-1)).toMatchObject({ type: 'intent', intent: 'sessionAction', action: 'completeSession' });
  });

  it('shows a Reply button in the header only when the host says a reply can be sent, and sends its session action', () => {
    const labels = (state: string, canReply: boolean): string[] =>
      buttons(header(state, false, canReply).node).map((node) => node.textContent);
    expect(labels('Stopped', false)).not.toContain('Reply…');
    expect(labels('Cancelled', true)).toContain('Reply…');
    const { node, posted } = header('Cancelled', false, true);
    buttons(node).find((button) => button.textContent === 'Reply…')?.handlers.click?.[0]();
    expect(posted.at(-1)).toMatchObject({ type: 'intent', intent: 'sessionAction', action: 'reply' });
  });

  it.each(['Running', 'Completed', 'Prepared', 'Unknown'])('does not offer Complete session for a %s session', (state) => {
    expect(header(state, false).items.map((item) => item.textContent)).not.toContain('Complete session…');
  });

  it('does not offer Complete session for a stopped role session, which the host marks as not completable', () => {
    expect(header('Stopped', false).items.map((item) => item.textContent)).not.toContain('Complete session…');
  });
});

describe('icon vocabulary', () => {
  it('draws every session state with the icon the Sessions view uses', () => {
    const { page, icons } = load();
    const states = Object.entries(page.sessionStates);
    const fromPage = Object.fromEntries(states.map(([state, known]) => [state, known.icon]));
    const fromView = Object.fromEntries(
      Object.entries(DISPLAY_STATE_ICONS).map(([state, id]) => [
        state,
        id === 'circle-outline' ? 'circle' : id.replace('~spin', ''),
      ]),
    );
    expect(fromPage).toEqual(fromView);
    for (const id of Object.values(fromPage)) expect(icons[id]?.length, id).toBeGreaterThan(0);
  });

  it('colors every session state with the tone the tab icons use', () => {
    const { page } = load();
    const states = Object.entries(page.sessionStates);
    const fromPage = Object.fromEntries(states.map(([state, known]) => [state, known.tone]));
    expect(fromPage).toEqual(DISPLAY_STATE_TONES);
  });

  it('has a tab icon file per page, tone and theme, and treats other names as muted', () => {
    const tones = new Set(Object.values(DISPLAY_STATE_TONES));
    for (const page of ['questions', 'results', 'metrics']) {
      for (const tone of tones) {
        for (const theme of ['light', 'dark']) {
          const file = path.join(__dirname, '../../../media/tab-icons', `${page}-${tone}-${theme}.svg`);
          expect(existsSync(file), file).toBe(true);
        }
      }
    }
    expect(stateTone('Completed')).toBe('ok');
    expect(stateTone('Unavailable')).toBe('muted');
    expect(stateTone('')).toBe('muted');
  });
});
