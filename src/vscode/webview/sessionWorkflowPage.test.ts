import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

/* A tiny DOM, just enough to run the Workflow tab of media/session with the real shared scripts. */
type Handler = (event: Record<string, unknown>) => void;

class FakeText {
  public constructor(public text: string) {}
}

class FakeElement {
  public children: (FakeElement | FakeText)[] = [];
  public attrs: Record<string, string> = {};
  public dataset: Record<string, string> = {};
  public placeholder = '';
  public title = '';
  public rows = 0;
  public readOnly = false;
  public selected = false;
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
  public parentElement: FakeElement | null = null;
  public readonly classList = {
    add: (...names: string[]): void => {
      const current = new Set(this.className.split(' ').filter(Boolean));
      for (const name of names) current.add(name);
      this.className = [...current].join(' ');
    },
    remove: (...names: string[]): void => {
      this.className = this.className
        .split(' ')
        .filter((name) => name !== '' && !names.includes(name))
        .join(' ');
    },
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
    for (const item of items) {
      if (typeof item !== 'string') item.parentElement = this;
      this.children.push(typeof item === 'string' ? new FakeText(item) : item);
    }
  }

  /** The nearest element, this one included, with the given tag name. */
  public closest(selector: string): FakeElement | null {
    if (this.tagName === selector.toUpperCase()) return this;
    return this.parentElement?.closest(selector) ?? null;
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

  /** Run the handlers of `type` on this node, then on each ancestor, as a bubbling DOM event does. */
  private dispatch(type: string): void {
    const dispatchTarget = (node: FakeElement | null): void => {
      if (node === null) return;
      for (const handler of node.listeners[type] ?? []) handler({ target: this });
      dispatchTarget(node.parentElement);
    };
    dispatchTarget(this);
  }

  public type_(value: string): void {
    this.value = value;
    this.dispatch('input');
  }

  /** Type a value and commit it, as leaving the field does. */
  public enter(value: string): void {
    this.type_(value);
    this.dispatch('change');
  }

  public focus(): void {
    this.doc.active = this;
  }

  public scrolledTo = false;

  public scrollIntoView(): void {
    this.scrolledTo = true;
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
    const attr = /^\[data-path="(.*)"\]$/.exec(selector);
    const match = (node: FakeElement): boolean => {
      if (attr !== null) return node.dataset.path === attr[1];
      return selector.startsWith('.')
        ? node.classList.contains(selector.slice(1))
        : node.tagName === selector.toUpperCase();
    };
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

const FORM = {
  stages: [{ id: 'plan', role: 'planner', producesArtifact: 'plan.md' }],
  outputs: [],
  downstream: [],
};

function model(overrides: Record<string, unknown> = {}) {
  return {
    mode: 'edit',
    project: 'p',
    file: 'workflow.yaml',
    path: '.migent/sessions/s/workflow.yaml',
    id: 'wf',
    schemaVersion: 5,
    state: 'ok',
    isSupported: true,
    readError: null,
    form: FORM,
    yaml: '',
    roles: ['planner'],
    agents: [],
    workflows: [],
    clients: [],
    duplicateOf: [],
    validation: { errors: [], warnings: [] },
    savedHash: 'h1',
    canSave: true,
    sessionId: 's',
    isLocked: false,
    ranStages: [],
    title: 'Session',
    sessionState: 'Prepared',
    workflowId: 'wf',
    meta: {
      stageId: null,
      createdAt: null,
      updatedAt: null,
      isRunning: false,
      pendingQuestions: 0,
      canComplete: false,
    },
    ...overrides,
  };
}

/** The Session page model of the Workflow tab for a workflow model, as the host builds it. */
function sessionPage(workflow: Record<string, unknown>) {
  const { sessionId, title, sessionState, workflowId, meta } = workflow;
  return {
    tab: 'workflow',
    header: { availability: 'ok', sessionId, title, state: sessionState, workflowId, meta },
    workflow,
  };
}

function load() {
  const doc = new FakeDocument();
  const listeners: Record<string, Handler[]> = {};
  const posted: Record<string, unknown>[] = [];
  const window: Record<string, unknown> = {
    scrollY: 0,
    scrollTo: (): void => undefined,
    addEventListener: (type: string, handler: Handler): void => {
      (listeners[type] ??= []).push(handler);
    },
  };
  const context = vm.createContext({
    window,
    document: doc,
    ResizeObserver: class {
      public observe(): void {}
      public disconnect(): void {}
    },
    acquireVsCodeApi: () => ({
      postMessage: (message: Record<string, unknown>) => posted.push(message),
      setState: () => undefined,
    }),
  });
  const media = path.join(__dirname, '../../../media');
  for (const file of [
    'shared/utils.js',
    'shared/icons.js',
    'shared/copy.js',
    'shared/dom.js',
    'shared/components.js',
    'shared/form.js',
    'shared/page.js',
    'shared/agentform.js',
    'shared/draftpage.js',
    'workfloweditor/workflowCopy.js',
    'workfloweditor/workflowModel.js',
    'workfloweditor/workflowForm.js',
    'session/sessionCopy.js',
    'session/overviewCopy.js',
    'session/resultsCopy.js',
    'session/metricsCopy.js',
    'session/sessionWorkflowCopy.js',
    'session/questionsCopy.js',
    'session/sessionHeader.js',
    'session/overviewProgress.js',
    'session/overview.js',
    'session/results.js',
    'session/metrics.js',
    'session/workflow.js',
    'session/questions.js',
    'session/session.js',
  ]) {
    vm.runInContext(readFileSync(path.join(media, file), 'utf8'), context);
  }
  let revision = 0;
  const deliver = (next: Record<string, unknown>, transient?: Record<string, unknown>): void => {
    revision += 1;
    for (const handler of listeners.message ?? []) {
      handler({ data: { type: 'model', revision, identity: { a: 1 }, model: sessionPage(next), transient } });
    }
  };
  const deliverPage = (pageModel: Record<string, unknown>): void => {
    revision += 1;
    for (const handler of listeners.message ?? []) {
      handler({ data: { type: 'model', revision, identity: { a: 1 }, model: pageModel } });
    }
  };
  const find = (predicate: (node: FakeElement) => boolean): FakeElement | undefined =>
    doc.root.descendants().find(predicate);
  const button = (label: string): FakeElement | undefined =>
    find((node) => node.tagName === 'BUTTON' && node.textContent === label);
  const stageId = (): FakeElement => {
    const node = find((candidate) => candidate.dataset.path === 'stages.0.id');
    if (node === undefined) throw new Error('no stage id input');
    return node;
  };
  return { doc, window, posted, deliver, deliverPage, button, stageId, find };
}

const lastSave = (posted: Record<string, unknown>[]) =>
  posted.filter((message) => message.type === 'saveForm').at(-1) as
    { form: { stages: { id: string }[] }; baseHash: string } | undefined;

describe('Session workflow page', () => {
  it('does not rebuild the form on each keystroke', () => {
    const page = load();
    page.deliver(model());
    expect(page.button('Save workflow')?.disabled).toBe(true);
    const input = page.stageId();
    input.focus();
    input.type_('p');
    input.type_('pl');
    input.type_('pla');
    expect(page.stageId()).toBe(input);
    expect(page.doc.activeElement).toBe(input);
  });

  it('enables Save and Discard once a field edit is committed', () => {
    const page = load();
    page.deliver(model());
    page.stageId().enter('plan2');
    expect(page.button('Save workflow')?.disabled).toBe(false);
    expect(page.button('Discard changes')?.disabled).toBe(false);
  });

  it('keeps the focus on the field after a committed edit rebuilds the form', () => {
    const page = load();
    page.deliver(model());
    const input = page.stageId();
    input.focus();
    input.enter('plan2');
    expect(page.doc.activeElement).toBe(page.stageId());
  });

  it('opens the card of a new item and focuses its first field when Add is clicked', () => {
    const page = load();
    page.deliver(model());
    page.button('Add suggestion')?.click();
    const field = page.find((node) => node.dataset.path === 'downstream.0.workflow');
    expect(field).toBeDefined();
    expect(page.doc.activeElement).toBe(field);
    expect(field?.closest('details')?.open).toBe(true);
  });

  it('posts the draft with the base hash on Save', () => {
    const page = load();
    page.deliver(model());
    page.stageId().enter('plan2');
    page.button('Save workflow')?.click();
    expect(lastSave(page.posted)).toMatchObject({ baseHash: 'h1', form: { stages: [{ id: 'plan2' }] } });
  });

  it('keeps edits made while the save was in flight when the saved model arrives', () => {
    const page = load();
    page.deliver(model());
    page.stageId().enter('plan2');
    page.button('Save workflow')?.click();
    page.deliver(model(), { saving: true, applying: false, error: null });
    page.stageId().enter('plan3');
    page.deliver(model({ savedHash: 'h2', form: { ...FORM, stages: [{ id: 'plan2', role: 'planner' }] } }), {
      saving: false,
      applying: false,
      error: null,
    });
    expect(page.stageId().value).toBe('plan3');
    expect(page.button('Save workflow')?.disabled).toBe(false);
  });

  it('keeps a post-submit edit across a background refresh that precedes the save result', () => {
    const page = load();
    page.deliver(model());
    page.stageId().enter('plan2');
    page.button('Save workflow')?.click();
    page.deliver(model(), { saving: true, applying: false, error: null });
    page.stageId().enter('plan3');
    page.deliver(model());
    page.deliver(model({ savedHash: 'h2', form: { ...FORM, stages: [{ id: 'plan2', role: 'planner' }] } }), {
      saving: false,
      applying: false,
      error: null,
    });
    expect(page.stageId().value).toBe('plan3');
    expect(page.button('Save workflow')?.disabled).toBe(false);
  });

  it('keeps an edit that reverts to the original value while the save is in flight', () => {
    const page = load();
    page.deliver(model());
    page.stageId().enter('plan2');
    page.button('Save workflow')?.click();
    page.deliver(model(), { saving: true, applying: false, error: null });
    page.stageId().enter('plan');
    page.deliver(model({ savedHash: 'h2', form: { ...FORM, stages: [{ id: 'plan2', role: 'planner' }] } }), {
      saving: false,
      applying: false,
      error: null,
    });
    expect(page.stageId().value).toBe('plan');
    expect(page.button('Save workflow')?.disabled).toBe(false);
  });

  it('keeps Save disabled and the first submission pending across a background refresh', () => {
    const page = load();
    page.deliver(model());
    page.stageId().enter('plan2');
    page.button('Save workflow')?.click();
    page.deliver(model(), { saving: true, applying: false, error: null });
    page.stageId().enter('plan3');
    page.deliver(model());
    const save = page.button('Saving…');
    expect(save?.disabled).toBe(true);
    save?.click();
    expect(page.posted.filter((message) => message.type === 'saveForm')).toHaveLength(1);
    page.deliver(model({ savedHash: 'h2', form: { ...FORM, stages: [{ id: 'plan2', role: 'planner' }] } }), {
      saving: false,
      applying: false,
      error: null,
    });
    expect(page.stageId().value).toBe('plan3');
    expect(page.button('Save workflow')?.disabled).toBe(false);
  });

  it('shows the saved draft as clean when nothing changed during the save', () => {
    const page = load();
    page.deliver(model());
    page.stageId().enter('plan2');
    page.button('Save workflow')?.click();
    page.deliver(model({ savedHash: 'h2', form: { ...FORM, stages: [{ id: 'plan2', role: 'planner' }] } }), {
      saving: false,
      applying: false,
      error: null,
    });
    expect(page.stageId().value).toBe('plan2');
    expect(page.button('Save workflow')?.disabled).toBe(true);
  });

  it('shows a save error and keeps the draft', () => {
    const page = load();
    page.deliver(model());
    page.stageId().enter('plan2');
    page.deliver(model(), { saving: false, applying: false, error: 'Could not save: boom' });
    expect(page.doc.root.textContent).toContain('Could not save: boom');
    expect(page.stageId().value).toBe('plan2');
  });

  it('has no Save controls once a stage has run', () => {
    const page = load();
    page.deliver(model({ isLocked: true, canSave: false, ranStages: ['plan'] }));
    expect(page.button('Save workflow')).toBeUndefined();
    expect(page.doc.root.textContent).toContain('This workflow is locked');
  });

  it('lists the issues in one banner and links only those whose control the form drew', () => {
    const page = load();
    page.deliver(
      model({
        validation: {
          errors: [
            { path: 'stages.0', message: 'Stage needs an id' },
            { path: 'roles.reviewer', message: 'Role reviewer is missing' },
            { path: 'artifacts.ghost.file', message: 'Ghost has no file' },
          ],
          warnings: [{ path: 'stages.0.role', message: 'Role is unused' }],
        },
      }),
    );
    const banners = page.doc.root.descendants().filter((node) => node.classList.contains('mg-banner'));
    expect(banners).toHaveLength(2);
    expect(banners[0].textContent).toContain('3 problems found');
    expect(banners[1].textContent).toContain('1 warning');
    // The first paint already links an issue to a drawn control; the others are plain text, not dead links.
    expect(page.button('Stage needs an id')).toBeDefined();
    expect(page.button('Role is unused')).toBeDefined();
    expect(page.button('Role reviewer is missing')).toBeUndefined();
    expect(page.button('Ghost has no file')).toBeUndefined();
    expect(page.doc.root.textContent).toContain('Role reviewer is missing');
  });

  it('takes the reader to the control of an issue on click', () => {
    const page = load();
    page.deliver(model({ validation: { errors: [{ path: 'stages.0', message: 'Stage needs an id' }], warnings: [] } }));
    page.button('Stage needs an id')?.click();
    expect(page.stageId().scrolledTo).toBe(true);
    expect(page.doc.activeElement).toBe(page.stageId());
  });

  it('keeps the notices above the form and refreshes them in place after an edit', () => {
    const page = load();
    page.deliver(model({ validation: { errors: [{ path: 'stages.0', message: 'Stage needs an id' }], warnings: [] } }));
    const notices = page.find((node) => node.classList.contains('mg-notices'));
    const form = page.find((node) => node.dataset.path === 'stages.0.description');
    expect(notices).toBeDefined();
    expect(form).toBeDefined();
    const all = page.doc.root.descendants();
    expect(all.indexOf(notices as FakeElement)).toBeLessThan(all.indexOf(form as FakeElement));
    (form as FakeElement).type_('a note');
    // A value edit makes the diagnostics stale and clears them without rebuilding the form.
    expect(page.find((node) => node.classList.contains('mg-banner'))).toBeUndefined();
    expect(page.find((node) => node.dataset.path === 'stages.0.description')).toBe(form);
  });
});

const HEADER = {
  availability: 'ok',
  sessionId: 's',
  title: 'Session',
  state: 'Completed',
  workflowId: 'wf',
  meta: { stageId: null, createdAt: null, updatedAt: null, isRunning: false, pendingQuestions: 0, canComplete: false },
};

const ZERO_USAGE = {
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0,
};

function execution(overrides: Record<string, unknown>) {
  return {
    id: 'e1',
    order: 1,
    stageId: 'plan',
    attempt: 1,
    role: 'planner',
    status: 'completed',
    decision: null,
    client: 'claude',
    model: 'sonnet',
    wallSeconds: 12,
    verifySeconds: 0,
    turns: 2,
    usage: { ...ZERO_USAGE, costUsd: 0.5 },
    usageMissing: { costUsd: 0 },
    createdAt: null,
    completedAt: null,
    verify: null,
    skipReason: null,
    resumesExecutionId: null,
    routedFrom: null,
    ...overrides,
  };
}

function metricsPage(executions: Record<string, unknown>[], header: Record<string, unknown> = HEADER) {
  return {
    tab: 'metrics',
    header,
    metrics: {
      sessionId: 's',
      workflowId: 'wf',
      completedAt: null,
      metrics: {
        kind: 'ok',
        totals: {
          wallSeconds: 20,
          activeSeconds: 10,
          executions: executions.length,
          skipped: 0,
          turns: 2,
          uncapturedTurns: 0,
          revisions: 0,
          verifySeconds: 0,
          verifyRed: 0,
          costPartial: false,
          failedExecutions: 0,
          blocked: 0,
          cancelled: 0,
          usage: ZERO_USAGE,
        },
        stages: [{ id: 'plan', executions: executions.length, skipped: 0, revisions: 0, failed: 0, blocked: 0 }],
        executions,
      },
    },
  };
}

describe('Session Overview and Metrics tabs', () => {
  it('draws a Metrics execution as a collapsible card with the last one open', () => {
    const page = load();
    page.deliverPage(metricsPage([execution({ id: 'e1' }), execution({ id: 'e2', order: 2, attempt: 2 })]));
    const cards = page.doc.root.descendants().filter((node) => node.classList.contains('mg-collapsible'));
    expect(cards).toHaveLength(2);
    expect(cards.map((card) => card.open)).toEqual([false, true]);
    expect(cards[1].textContent).toContain('plan · attempt 2');
    expect(cards[1].textContent).toContain('planner');
    const heads = page.doc.root.descendants().filter((node) => node.classList.contains('mg-section-head'));
    expect(heads.length).toBeGreaterThanOrEqual(4);
    expect(heads.some((head) => head.textContent.includes('Executions') && head.textContent.includes('2'))).toBe(true);
  });

  it('never shows an unreported cost as zero, and shows a skipped execution without run facts', () => {
    const page = load();
    page.deliverPage(
      metricsPage([
        execution({ id: 'e1', usage: { ...ZERO_USAGE, costUsd: null }, usageMissing: { costUsd: 2 } }),
        execution({ id: 'e2', order: 2, status: 'skipped', skipReason: 'not needed', client: null, usage: ZERO_USAGE }),
      ]),
    );
    const [ran, skipped] = page.doc.root.descendants().filter((node) => node.classList.contains('mg-collapsible'));
    expect(ran.textContent).toContain('no cost');
    expect(ran.textContent).not.toContain('$0.00');
    expect(skipped.textContent).toContain('Skipped');
    expect(skipped.textContent).toContain('did not run');
    expect(skipped.textContent).toContain('not needed');
    expect(skipped.textContent).not.toContain('Tokens');
    expect(skipped.textContent).not.toContain('Wall / verify');
  });

  it('marks a failed execution in the error tone and an unreported cost in the warning tone', () => {
    const page = load();
    page.deliverPage(
      metricsPage([
        execution({ id: 'e1', status: 'failed' }),
        execution({ id: 'e2', order: 2, usage: { ...ZERO_USAGE, costUsd: null }, usageMissing: { costUsd: 1 } }),
        execution({ id: 'e3', order: 3, status: 'cancelled' }),
        execution({ id: 'e4', order: 4 }),
      ]),
    );
    const cards = page.doc.root.descendants().filter((node) => node.classList.contains('mg-collapsible'));
    const chips = (card: FakeElement): FakeElement[] => card.descendants().filter((n) => n.classList.contains('mg-chip'));
    const toneOf = (card: FakeElement, label: string): string | undefined =>
      chips(card).find((chip) => chip.textContent === label)?.className;
    expect(toneOf(cards[0], 'Failed')).toContain('mg-chip--error');
    expect(toneOf(cards[1], 'no cost')).toContain('mg-chip--warn');
    expect(toneOf(cards[2], 'Cancelled')).toContain('mg-chip--warn');
    // A clean execution carries no chip and its cost stays in the quiet summary.
    expect(chips(cards[3])).toHaveLength(0);
    expect(cards[3].textContent).toContain('$0.50');
  });

  it('keeps an execution card open or closed across a re-render', () => {
    const page = load();
    const two = metricsPage([execution({ id: 'e1' }), execution({ id: 'e2', order: 2 })]);
    page.deliverPage(two);
    const cards = (): FakeElement[] => page.doc.root.descendants().filter((n) => n.classList.contains('mg-collapsible'));
    const toggle = (card: FakeElement, open: boolean): void => {
      card.open = open;
      for (const handler of card.listeners.toggle ?? []) handler({ target: card });
    };
    expect(cards().map((card) => card.open)).toEqual([false, true]);
    toggle(cards()[0], true);
    toggle(cards()[1], false);
    page.deliverPage(two);
    expect(cards().map((card) => card.open)).toEqual([true, false]);
  });

  it('keeps the Session header tiers: state, title, facts, then tabs and the menu', () => {
    const page = load();
    const meta = {
      stageId: 'plan',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:05:00.000Z',
      isRunning: false,
      pendingQuestions: 2,
      canComplete: true,
      canReply: true,
    };
    page.deliverPage(metricsPage([execution({})], { ...HEADER, state: 'Stopped', meta }));
    const header = page.find((node) => node.tagName === 'HEADER' && node.classList.contains('mg-header'));
    expect(header).toBeDefined();
    const tiers = (header as FakeElement).children.map((child) => (child as FakeElement).className.split(' ')[0]);
    expect(tiers).toEqual(['mg-header-row', 'mg-title', 'mg-subtitle', 'mg-tabbar']);
    const [identity, title, facts, bar] = (header as FakeElement).children as FakeElement[];
    expect(identity.textContent).toBe('Stoppedwf');
    expect(title.classList.contains('mg-title--clamp')).toBe(true);
    const chips = facts.children.map((chip) => (chip as FakeElement).textContent);
    expect(chips[0]).toBe('plan');
    expect(chips[1]).toBe('5m 0s');
    expect(chips.at(-1)).toBe('2 pending');
    const barKinds = bar.children.map((child) => (child as FakeElement).className.split(' ')[0]);
    expect(barKinds).toEqual(['mg-tabs', 'mg-menu']);
    const tabs = (bar.children[0] as FakeElement).children.map((tab) => (tab as FakeElement).textContent);
    expect(tabs).toEqual(['Questions', 'Overview', 'Metrics', 'Workflow', 'Task']);
    const items = bar.descendants().filter((node) => node.classList.contains('mg-menu-item'));
    expect(items.map((item) => item.textContent).slice(0, 4)).toEqual([
      'View log',
      'Copy session ID',
      'Reveal in Explorer',
      'Rename session…',
    ]);
  });

  it('draws an unavailable Metrics file as one banner', () => {
    const page = load();
    page.deliverPage({ tab: 'metrics', header: HEADER, metrics: { metrics: { kind: 'missing' } } });
    const banners = page.doc.root.descendants().filter((node) => node.classList.contains('mg-banner'));
    expect(banners).toHaveLength(1);
    expect(banners[0].classList.contains('mg-banner--warn')).toBe(true);
  });

  it('draws Overview result sections with counts, an empty block, and no control inside a card', () => {
    const page = load();
    page.deliverPage({
      tab: 'overview',
      header: HEADER,
      overview: {
        summary: {
          state: 'completed',
          unknownReason: null,
          runningStage: null,
          runningSummary: null,
          blocked: [],
          quotaResetAt: null,
          pendingQuestions: 0,
          latestExecution: null,
          isRunning: false,
        },
        progress: { kind: 'empty' },
        activity: { visible: false },
        actions: { primary: null, secondary: [] },
        outputs: { rows: [], directoryError: null },
        next: {
          state: 'ok',
          detail: null,
          suggestions: [{ workflow: 'next-wf', task: 'Go', declared: true, target: 'ok', artifacts: [] }],
        },
        children: [],
        source: null,
      },
    });
    const { root } = page.doc;
    expect(root.descendants().filter((node) => node.classList.contains('mg-section-head'))).toHaveLength(4);
    expect(root.descendants().some((node) => node.classList.contains('mg-empty'))).toBe(true);
    const card = root.descendants().find((node) => node.classList.contains('mg-collapsible'));
    expect(card).toBeDefined();
    const nested = (card as FakeElement).descendants().filter((node) => ['DETAILS', 'INPUT'].includes(node.tagName));
    expect(nested).toHaveLength(0);
    expect(root.descendants().some((node) => node.classList.contains('results-suggestion'))).toBe(false);
  });
});

interface Kit {
  banner: (options: Record<string, unknown>) => FakeElement;
  issueBanner: (options: Record<string, unknown>) => FakeElement;
  alertLine: (message: string, options?: { tone?: string; role?: string }) => FakeElement;
}

interface PageKit {
  controlOf: (root: FakeElement, path: string) => FakeElement | null;
  pageHeader: (options: Record<string, unknown>) => FakeElement;
}

describe('Shared UI kit', () => {
  it('builds one banner with a tone, an icon, a message, quieter lines and actions', () => {
    const page = load();
    const kit = page.window.MigentUi as Kit;
    const node = kit.banner({ tone: 'error', lines: ['Broken', 'More detail'], actions: [page.doc.createElement('button')] });
    expect(node.classList.contains('mg-banner--error')).toBe(true);
    expect(node.attrs.role).toBe('alert');
    expect(node.textContent).toBe('BrokenMore detail');
    expect(node.descendants().filter((child) => child.classList.contains('mg-muted'))).toHaveLength(1);
    expect(kit.banner({ tone: 'warn', lines: ['x'] }).attrs.role).toBe('status');
    expect(kit.alertLine('Bad', { tone: 'error', role: 'alert' }).attrs.role).toBe('alert');
    expect(kit.alertLine('Bad', { tone: 'error' }).attrs.role).toBeUndefined();
    expect(kit.banner({ tone: 'error', role: 'none', lines: ['x'] }).attrs.role).toBeUndefined();
    expect(kit.banner({ tone: 'warn', role: 'alert', lines: ['x'] }).attrs.role).toBe('alert');
  });

  it('shows an issue as a link only when the page resolver gives it an action', () => {
    const page = load();
    const kit = page.window.MigentUi as Kit;
    const activated: string[] = [];
    const node = kit.issueBanner({
      tone: 'warn',
      summary: '2 warnings',
      issues: ['a', 'b'],
      resolve: (issue: string) => (issue === 'a' ? { text: 'Go to a', activate: () => activated.push(issue) } : { text: 'Only b' }),
    });
    const links = node.descendants().filter((child) => child.tagName === 'BUTTON');
    expect(links.map((link) => link.textContent)).toEqual(['Go to a']);
    expect(links[0].classList.contains('mg-btn--link')).toBe(true);
    links[0].click();
    expect(activated).toEqual(['a']);
    expect(node.textContent).toContain('Only b');
  });

  it('finds the control of a form path or the nearest one around it, never the bare first part', () => {
    const page = load();
    const kit = page.window.MigentUi as PageKit;
    const root = page.doc.createElement('div');
    const stage = page.doc.createElement('input');
    stage.dataset.path = 'stages.0.id';
    const stages = page.doc.createElement('button');
    stages.dataset.path = 'stages.0';
    root.append(stage, stages);
    expect(kit.controlOf(root, 'stages.0.id')).toBe(stage);
    expect(kit.controlOf(root, 'stages.0.id.extra')).toBe(stage);
    expect(kit.controlOf(root, 'stages.0.role')).toBe(stages);
    expect(kit.controlOf(root, 'roles.reviewer')).toBeNull();
    expect(kit.controlOf(root, 'artifacts.ghost.file')).toBeNull();
  });

  it('keeps the four header tiers in order for any page', () => {
    const page = load();
    const kit = page.window.MigentUi as PageKit;
    const node = kit.pageHeader({
      eyebrow: 'Workflow',
      title: 'wf',
      facts: [{ icon: 'package', text: 'workflow.yaml' }],
      tabs: { label: 'Views', current: 'design', tabs: [{ key: 'design', label: 'Design' }] },
      menu: { label: 'Actions', items: [{ label: 'Reload', onSelect: () => undefined }] },
    });
    const classes = node.children.map((child) => (child as FakeElement).className.split(' ')[0]);
    expect(classes).toEqual(['mg-header-row', 'mg-title', 'mg-subtitle', 'mg-tabbar']);
    expect(node.textContent).toContain('Workflow');
    expect(node.textContent).toContain('workflow.yaml');
    expect(node.descendants().some((child) => child.classList.contains('mg-menu'))).toBe(true);
    expect(node.descendants().find((child) => child.classList.contains('mg-title'))?.classList.contains('mg-title--clamp')).toBe(false);
  });
});
