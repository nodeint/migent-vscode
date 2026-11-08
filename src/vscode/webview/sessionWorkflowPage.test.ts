import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

/* A tiny DOM, just enough to run media/sessionworkflow/sessionworkflow.js with the real shared scripts. */
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

  public type_(value: string): void {
    this.value = value;
    for (const handler of this.listeners.input ?? []) handler({ target: this });
  }

  /** Type a value and commit it, as leaving the field does. */
  public enter(value: string): void {
    this.type_(value);
    for (const handler of this.listeners.change ?? []) handler({ target: this });
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

function load() {
  const doc = new FakeDocument();
  const listeners: Record<string, Handler[]> = {};
  const posted: Record<string, unknown>[] = [];
  const window = {
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
    'shared/icons.js',
    'shared/copy.js',
    'shared/page.js',
    'shared/form.js',
    'shared/agentform.js',
    'shared/draftpage.js',
    'workfloweditor/workflowcopy.js',
    'workfloweditor/workflowmodel.js',
    'workfloweditor/workflowform.js',
    'sessionworkflow/sessionworkflow.js',
  ]) {
    vm.runInContext(readFileSync(path.join(media, file), 'utf8'), context);
  }
  let revision = 0;
  const deliver = (next: Record<string, unknown>, transient?: Record<string, unknown>): void => {
    revision += 1;
    for (const handler of listeners.message ?? []) {
      handler({ data: { type: 'model', revision, identity: { a: 1 }, model: next, transient } });
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
  return { doc, posted, deliver, button, stageId, find };
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
});
