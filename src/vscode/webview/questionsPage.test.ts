import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

/* A tiny DOM, just enough for media/shared/page.js and media/questions/questions.js to run. */
type Handler = (event: Record<string, unknown>) => void;

class FakeText {
  public constructor(public text: string) {}
}

class FakeElement {
  public children: (FakeElement | FakeText)[] = [];
  public attrs: Record<string, string> = {};
  public listeners: Record<string, Handler[]> = {};
  public id = '';
  public className = '';
  public type = '';
  public name = '';
  public htmlFor = '';
  public checked = false;
  public disabled = false;
  public open = false;
  public hidden = false;
  public value = '';
  public scrollTop = 0;
  public selectionStart = 0;
  public selectionEnd = 0;
  public selectionDirection = 'none';
  public offsetHeight = 0;
  public readonly classList = {
    toggle: (name: string, force?: boolean): void => {
      const names = new Set(this.className.split(' ').filter(Boolean));
      if (force ?? !names.has(name)) names.add(name);
      else names.delete(name);
      this.className = [...names].join(' ');
    },
    contains: (name: string): boolean => this.className.split(' ').includes(name),
  };

  public constructor(
    public readonly tagName: string,
    private readonly doc: FakeDocument,
  ) {}

  public set textContent(value: string) {
    this.children = [new FakeText(value)];
  }

  public get textContent(): string {
    return this.children.map((child) => (child instanceof FakeText ? child.text : child.textContent)).join('');
  }

  public append(...items: (FakeElement | string)[]): void {
    for (const item of items) this.children.push(typeof item === 'string' ? new FakeText(item) : item);
  }

  public replaceChildren(...items: (FakeElement | string)[]): void {
    this.children = [];
    this.append(...items);
  }

  public setAttribute(name: string, value: string): void {
    this.attrs[name] = value;
  }

  public addEventListener(type: string, handler: Handler): void {
    (this.listeners[type] ??= []).push(handler);
  }

  public click(): void {
    for (const handler of this.listeners.click ?? []) handler({ target: this });
  }

  public change(checked: boolean): void {
    this.checked = checked;
    for (const handler of this.listeners.change ?? []) handler({ target: this });
  }

  public type_(value: string): void {
    this.value = value;
    for (const handler of this.listeners.input ?? []) handler({ target: this });
  }

  public focus(): void {
    this.doc.active = this;
  }

  public setSelectionRange(start: number, end: number, direction = 'none'): void {
    this.selectionStart = start;
    this.selectionEnd = end;
    this.selectionDirection = direction;
  }

  public descendants(): FakeElement[] {
    return this.children.flatMap((child) => (child instanceof FakeText ? [] : [child, ...child.descendants()]));
  }

  public querySelector(selector: string): FakeElement | null {
    const match = (node: FakeElement): boolean =>
      selector.startsWith('.') ? node.classList.contains(selector.slice(1)) : node.tagName === selector.toUpperCase();
    return this.descendants().find(match) ?? null;
  }
}

class FakeDocument {
  public active: FakeElement | null = null;
  public readonly root = new FakeElement('MAIN', this);
  public readonly properties: Record<string, string> = {};
  public readonly documentElement = {
    style: {
      setProperty: (name: string, value: string): void => {
        this.properties[name] = value;
      },
    },
  };

  public constructor() {
    this.root.id = 'root';
  }

  public createElement(tag: string): FakeElement {
    return new FakeElement(tag.toUpperCase(), this);
  }

  public createElementNS(_namespace: string, tag: string): FakeElement {
    return this.createElement(tag);
  }

  public getElementById(id: string): FakeElement | null {
    return id === 'root' ? this.root : (this.root.descendants().find((node) => node.id === id) ?? null);
  }

  public querySelector(selector: string): FakeElement | null {
    return this.root.querySelector(selector);
  }

  public get activeElement(): FakeElement | null {
    return this.active !== null && this.root.descendants().includes(this.active) ? this.active : null;
  }

  public addEventListener(): void {
    // No document-level listeners are needed by these pages.
  }
}

interface Option {
  id: string;
  label: string;
  description: string | null;
}

function question(id: string, options: Option[] = []) {
  const choices = options.length > 0 ? options : [{ id: 'A', label: 'One', description: null }, { id: 'B', label: 'Two', description: null }];
  return { id, question: `Question ${id}`, context: null, selection: 'single', options: choices, recommended: [] };
}

function model(revision: number, overrides: Record<string, unknown> = {}) {
  return {
    revision,
    generation: 1,
    fingerprint: 'f1',
    title: 'Questions',
    workflowId: 'implement',
    sessionState: 'Question',
    meta: {
      stageId: 'plan',
      createdAt: '2026-11-01T10:00:00.000+00:00',
      updatedAt: '2026-11-01T10:09:48.000+00:00',
      isRunning: false,
      pendingQuestions: 3,
    },
    state: 'editing',
    message: null,
    questions: [question('1'), question('2')],
    draft: {},
    issues: [],
    answered: 0,
    editable: true,
    canSubmit: true,
    blockReason: null,
    ambiguous: [],
    recorded: null,
    archived: null,
    ...overrides,
  };
}

function load() {
  const doc = new FakeDocument();
  const windowListeners: Record<string, Handler[]> = {};
  const posted: Record<string, unknown>[] = [];
  const window = {
    scrollY: 0,
    scrollTo: (_x: number, y: number): void => {
      window.scrollY = y;
    },
    addEventListener: (type: string, handler: Handler): void => {
      (windowListeners[type] ??= []).push(handler);
    },
  };
  const observers: { callback: () => void; target: FakeElement | null; isDisconnected: boolean }[] = [];
  class FakeResizeObserver {
    private readonly record: { callback: () => void; target: FakeElement | null; isDisconnected: boolean } = {
      callback: () => undefined,
      target: null,
      isDisconnected: false,
    };

    public constructor(callback: () => void) {
      this.record.callback = callback;
      observers.push(this.record);
    }

    public observe(target: FakeElement): void {
      this.record.target = target;
    }

    public disconnect(): void {
      this.record.isDisconnected = true;
    }
  }
  const context = vm.createContext({
    ResizeObserver: FakeResizeObserver,
    window,
    document: doc,
    acquireVsCodeApi: () => ({
      postMessage: (message: Record<string, unknown>) => posted.push(message),
      setState: () => undefined,
    }),
  });
  const media = path.join(__dirname, '../../../media');
  for (const file of ['shared/icons.js', 'shared/page.js', 'questions/questions.js']) vm.runInContext(readFileSync(path.join(media, file), 'utf8'), context);
  const deliver = (revision: number, next: Record<string, unknown>): void => {
    for (const handler of windowListeners.message ?? []) handler({ data: { type: 'model', revision, identity: { a: 1 }, model: next } });
  };
  const byId = (id: string): FakeElement => {
    const node = doc.getElementById(id);
    if (node === null) throw new Error(`no element ${id}`);
    return node;
  };
  const key = (init: Record<string, unknown>): void => {
    for (const handler of windowListeners.keydown ?? []) handler(init);
  };
  return { doc, posted, window, deliver, byId, key, observers };
}

describe('Questions page', () => {
  it('keeps the local draft over a host echo of the same generation and fingerprint', () => {
    const page = load();
    page.deliver(1, model(1));
    page.byId('q1A').change(true);
    expect(page.posted.at(-1)).toMatchObject({
      type: 'edit',
      generation: 1,
      fingerprint: 'f1',
      questionId: '1',
      draft: { mode: 'choice', selected: ['A'], text: '' },
    });
    page.deliver(2, model(2, { draft: {} }));
    expect(page.byId('q1A').checked).toBe(true);
    expect(page.byId('jump-1').className).toContain('q-jump--done');
  });

  it('shows the shared session header with Questions, Results, Metrics, Workflow and Task tabs', () => {
    const page = load();
    page.deliver(1, model(1));
    const tabs = page.doc.root.descendants().filter((node) => node.className === 'mg-tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Questions', 'Results', 'Metrics', 'Workflow', 'Task']);
    expect(tabs[0]?.attrs['aria-current']).toBe('page');
    tabs[1]?.click();
    tabs[2]?.click();
    expect(page.posted.slice(-2)).toEqual([{ type: 'openResults' }, { type: 'openMetrics' }]);
    expect(page.doc.root.descendants().some((node) => node.textContent === 'implement')).toBe(true);
    const badge = page.doc.root.descendants().find((node) => node.className.startsWith('mg-status '));
    expect(badge?.textContent).toBe('Question');
    const facts = page.doc.root.descendants().filter((node) => node.className.includes('mg-meta-item'));
    expect(facts.map((fact) => fact.textContent)).toEqual([
      'plan',
      '9m 48s',
      expect.stringMatching(/ ago$/),
      '3 pending',
    ]);
    const banners = (): string[] =>
      page.doc.root
        .descendants()
        .filter((node) => node.className.startsWith('mg-banner '))
        .map((node) => node.className);
    expect(banners()).toEqual([]);
    page.deliver(2, model(2, { state: 'recorded', message: 'Answers recorded.', editable: false, canSubmit: false }));
    expect(banners()).toEqual(['mg-banner mg-banner--ok']);
    // Once the answers are sent the page is a record: no jump chips and no footer.
    expect(page.doc.root.descendants().some((node) => node.className === 'q-jumps')).toBe(false);
    expect(page.doc.root.querySelector('footer')).toBeNull();
    // The session facts do not depend on the page's own state.
    const again = page.doc.root.descendants().filter((node) => node.className.includes('mg-meta-item'));
    expect(again.map((fact) => fact.textContent)).toEqual(facts.map((fact) => fact.textContent));
  });

  it('replaces the draft when the host changes the generation or the batch', () => {
    const page = load();
    page.deliver(1, model(1));
    page.byId('q1A').change(true);
    page.deliver(2, model(2, { generation: 2 }));
    expect(page.byId('q1A').checked).toBe(false);
    page.byId('q1A').change(true);
    page.deliver(3, model(3, { generation: 2, fingerprint: 'f2' }));
    expect(page.byId('q1A').checked).toBe(false);
  });

  it('ignores an older revision', () => {
    const page = load();
    page.deliver(5, model(5));
    page.deliver(4, model(4, { title: 'Older' }));
    expect(page.byId('root').querySelector('h1')?.textContent).toBe('Questions');
  });

  it('treats Other as one more choice: picking an option leaves it, picking Other focuses the text', () => {
    const page = load();
    page.deliver(1, model(1));
    page.byId('other1').change(true);
    expect(page.doc.activeElement).toBe(page.byId('text1'));
    page.byId('q1A').change(true);
    expect(page.byId('q1A').checked).toBe(true);
    expect(page.byId('other1').checked).toBe(false);
  });

  it('keeps focus, selection and scroll of the text area through a background update', () => {
    const page = load();
    page.deliver(1, model(1));
    page.byId('other1').change(true);
    const area = page.byId('text1');
    area.type_('hello world');
    area.focus();
    area.setSelectionRange(2, 5, 'backward');
    area.scrollTop = 7;
    page.window.scrollY = 120;
    page.deliver(2, model(2, { message: 'Refreshed' }));
    const next = page.byId('text1');
    expect(next).not.toBe(area);
    expect(page.doc.activeElement).toBe(next);
    expect([next.value, next.selectionStart, next.selectionEnd, next.selectionDirection, next.scrollTop]).toEqual([
      'hello world',
      2,
      5,
      'backward',
      7,
    ]);
    expect(page.window.scrollY).toBe(120);
  });

  it('keeps focus on controls that have no input id of their own', () => {
    const page = load();
    const shown = {
      questions: [{ ...question('1'), context: 'x'.repeat(300) }],
      archived: [{ id: '1', question: 'Old', answer: '' }],
    };
    let revision = 1;
    page.deliver(revision, model(revision, shown));
    for (const id of ['act-discard', 'ctxbtn-1', 'archived-summary', 'jump-1']) {
      const before = page.byId(id);
      before.focus();
      revision += 1;
      // A changed message forces a redraw; a model that only echoes an edit is not redrawn.
      page.deliver(revision, model(revision, { ...shown, message: `Update ${revision}` }));
      const after = page.byId(id);
      expect(after).not.toBe(before);
      expect(page.doc.activeElement).toBe(after);
    }
  });

  it('tracks the current footer after a local re-render and after a resize', () => {
    const page = load();
    page.deliver(1, model(1));
    const first = page.doc.root.querySelector('footer');
    if (first === null) throw new Error('no footer');
    first.offsetHeight = 40;
    page.observers.at(-1)?.callback();
    expect(page.doc.properties['--mg-footer-height']).toBe('40px');
    // The Other toggle re-renders on the page's own, replacing the footer.
    page.byId('other1').change(true);
    const second = page.doc.root.querySelector('footer');
    expect(second).not.toBe(first);
    if (second === null) throw new Error('no footer');
    second.offsetHeight = 90;
    const latest = page.observers.at(-1);
    expect(latest?.target).toBe(second);
    // An older observer that still fires reads the current footer, never a detached one.
    page.observers[0].callback();
    expect(page.doc.properties['--mg-footer-height']).toBe('90px');
    latest?.callback();
    expect(page.doc.properties['--mg-footer-height']).toBe('90px');
    expect(page.observers.slice(0, -1).every((observer) => observer.isDisconnected)).toBe(true);
  });

  it('keeps expanded context across an update', () => {
    const page = load();
    const long = { questions: [{ ...question('1'), context: 'x'.repeat(300) }] };
    page.deliver(1, model(1, long));
    expect(page.byId('ctx-1').classList.contains('q-context--clamped')).toBe(true);
    page.byId('ctxbtn-1').click();
    page.deliver(2, model(2, long));
    expect(page.byId('ctx-1').classList.contains('q-context--clamped')).toBe(false);
  });

  it('enables submit and the shortcut only when the host allows it and every question is answered', () => {
    const page = load();
    page.deliver(1, model(1));
    expect(page.byId('submit').disabled).toBe(true);
    page.key({ ctrlKey: true, key: 'Enter' });
    expect(page.posted.filter((message) => message.type === 'submit')).toHaveLength(0);
    page.byId('q1A').change(true);
    page.byId('q2B').change(true);
    expect(page.byId('submit').disabled).toBe(false);
    page.key({ metaKey: true, key: 'Enter' });
    expect(page.posted.at(-1)).toEqual({ type: 'submit', revision: 1, fingerprint: 'f1' });
    page.deliver(2, model(2, { canSubmit: false }));
    expect(page.byId('submit').disabled).toBe(true);
  });

  it('offers one primary action and the recovery actions for each state', () => {
    const page = load();
    const cases: [string, string, string[]][] = [
      ['stale', 'act-reload', ['act-discard']],
      ['unconfirmed', 'act-recheck', ['act-viewLog', 'act-discard']],
      ['recorded-waiting', 'act-continue', ['act-viewLog']],
    ];
    let revision = 1;
    for (const [state, primary, others] of cases) {
      page.deliver(revision, model(revision, { state, editable: state === 'unconfirmed', canSubmit: false }));
      revision += 1;
      const footer = page.doc.root.querySelector('footer');
      const primaries = footer?.descendants().filter((node) => node.className.includes('mg-btn--primary')) ?? [];
      expect(primaries.map((node) => node.id)).toEqual([primary]);
      for (const id of others) expect(page.byId(id)).toBeDefined();
    }
  });
});
