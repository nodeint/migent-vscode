import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

/* A tiny DOM, just enough to run the page scripts in media/ against the real shared scripts. */
type Handler = (event: Record<string, unknown>) => void;

class FakeText {
  constructor(public text: string) {}
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

  constructor(
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

  /** Dispatch an event on this element, then on each ancestor, as a bubbling DOM event does. */
  private bubble(type: string): void {
    for (const handler of this.listeners[type] ?? []) handler({ target: this });
    this.parentElement?.bubbleFrom(type, this);
  }

  private bubbleFrom(type: string, target: FakeElement): void {
    for (const handler of this.listeners[type] ?? []) handler({ target });
    this.parentElement?.bubbleFrom(type, target);
  }

  public change(checked: boolean): void {
    this.checked = checked;
    this.bubble('change');
  }

  public type_(value: string): void {
    this.value = value;
    this.bubble('input');
  }

  /** Type a value and commit it, as leaving the field does. */
  public enter(value: string): void {
    this.type_(value);
    this.bubble('change');
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

  constructor() {
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



const HASH = 'a'.repeat(64);
const HASH2 = 'b'.repeat(64);

type Form = ReturnType<typeof form>;

function form(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: 7,
    agents: [
      { name: 'fast', agent: { model: 'm', client: { type: 'codex', options: [{ key: 'sandbox', value: 'ro' }], extra: {} }, extra: {} } },
    ],
    roles: [{ name: 'dev', description: 'builds', responsibilities: [], agent: { mode: 'named', name: 'fast' }, extra: {} }],
    extra: {},
    ...over,
  };
}

interface Tab {
  exists: boolean;
  hash: string;
  form: Form;
  state?: string;
  validation?: { errors: { path: string; message: string; file?: string }[]; warnings: unknown[] };
}

function tab(scope: string, over: Partial<Tab> = {}) {
  return {
    scope,
    file: scope === 'project' ? 'config.yaml' : 'config.local.yaml',
    path: '.migent/x',
    state: 'ok',
    exists: true,
    hash: HASH,
    schemaVersion: 7,
    readError: null,
    form: form(),
    canSave: true,
    validation: { errors: [], warnings: [] },
    ...over,
  };
}

function model(project: Partial<Tab> = {}, local: Partial<Tab> = {}, tabName = 'project') {
  return {
    project: 'p',
    tab: tabName,
    tabs: {
      project: tab('project', project),
      local: tab('local', {
        state: 'missing',
        exists: false,
        hash: '',
        form: form({ agents: [], roles: [] }),
        ...local,
      }),
    },
    clients: [{ id: 'codex', models: ['gpt-5'], optionKeys: ['sandbox'] }],
    agentNames: ['fast'],
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
      postMessage: (m: Record<string, unknown>) => posted.push(m),
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
    'config/configcopy.js',
    'config/configform.js',
    'config/config.js',
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
  const send = (data: Record<string, unknown>): void => {
    for (const handler of listeners.message ?? []) handler({ data });
  };
  const find = (predicate: (node: FakeElement) => boolean): FakeElement | undefined =>
    doc.root.descendants().find(predicate);
  const button = (label: string): FakeElement | undefined =>
    find((n) => n.tagName === 'BUTTON' && n.textContent === label);
  const at = (p: string): FakeElement | undefined => find((n) => n.dataset.path === p);
  const saves = () => posted.filter((m) => m.type === 'saveForm');
  return { doc, posted, deliver, send, button, at, find, saves };
}

const text = (page: ReturnType<typeof load>): string => page.doc.root.textContent;

describe('Configuration page', () => {
  it('shows one tab per file and an empty local draft that a first save creates without a hash', () => {
    const page = load();
    page.deliver(model());
    page.button('Local')?.click();
    expect(text(page)).toContain('config.local.yaml does not exist yet');
    expect(page.button('YAML')?.disabled).toBe(true);
    page.button('Add agent')?.click();
    page.at('agents.0.name')?.enter('quick');
    page.button('Save configuration')?.click();
    expect(page.saves()).toHaveLength(1);
    expect(page.saves()[0]).toMatchObject({ tab: 'local', base: { kind: 'create' } });
  });

  it('saves the project tab with the hash it was read at', () => {
    const page = load();
    page.deliver(model());
    page.at('roles.0.description')?.enter('builds more');
    page.button('Save configuration')?.click();
    expect(page.saves()[0]).toMatchObject({ tab: 'project', base: { kind: 'replace', hash: HASH } });
  });

  it('keeps each tab\'s draft across tab switches', () => {
    const page = load();
    page.deliver(model());
    page.at('roles.0.description')?.enter('edited');
    page.button('Local')?.click();
    page.button('Project')?.click();
    expect(page.at('roles.0.description')?.value).toBe('edited');
    expect(page.button('Save configuration')?.disabled).toBe(false);
  });

  it('adopts a changed file into a clean tab and keeps a dirty draft with its original base', () => {
    const page = load();
    page.deliver(model());
    page.deliver(model({ hash: HASH2, form: form({ roles: [{ name: 'dev', description: 'external', responsibilities: [], agent: { mode: 'absent' }, extra: {} }] }) }));
    expect(page.at('roles.0.description')?.value).toBe('external');

    page.at('roles.0.description')?.enter('mine');
    page.deliver(model({ hash: HASH }));
    expect(text(page)).toContain('changed on disk');
    expect(page.at('roles.0.description')?.value).toBe('mine');
    page.button('Save configuration')?.click();
    expect(page.saves().at(-1)).toMatchObject({ base: { kind: 'replace', hash: HASH2 } });
  });

  it('keeps a replace intent for a draft whose file was deleted, and a create intent when a file appeared', () => {
    const page = load();
    page.deliver(model());
    page.at('roles.0.description')?.enter('mine');
    page.deliver(model({ exists: false, hash: '', state: 'missing' }));
    expect(text(page)).toContain('deleted on disk');
    page.button('Save configuration')?.click();
    expect(page.saves().at(-1)).toMatchObject({ base: { kind: 'replace', hash: HASH } });

    const other = load();
    other.deliver(model());
    other.button('Local')?.click();
    other.button('Add agent')?.click();
    other.at('agents.0.name')?.enter('q');
    other.deliver(model({}, { exists: true, hash: HASH2, state: 'ok' }));
    expect(text(other)).toContain('created on disk');
    other.button('Save configuration')?.click();
    expect(other.saves().at(-1)).toMatchObject({ tab: 'local', base: { kind: 'create' } });
  });

  it('keeps edits made after the submit when the save is confirmed', () => {
    const page = load();
    page.deliver(model());
    page.at('roles.0.description')?.enter('one');
    page.button('Save configuration')?.click();
    page.at('roles.0.description')?.enter('two');
    page.deliver(
      model({ hash: HASH2, form: form({ roles: [{ name: 'dev', description: 'one', responsibilities: [], agent: { mode: 'absent' }, extra: {} }] }) }),
      { saving: false, applying: false, error: null, saved: 'project' },
    );
    expect(page.at('roles.0.description')?.value).toBe('two');
    page.button('Save configuration')?.click();
    expect(page.saves().at(-1)).toMatchObject({ base: { kind: 'replace', hash: HASH2 } });
  });

  it('discards back to the disk state', () => {
    const page = load();
    page.deliver(model());
    page.at('roles.0.description')?.enter('x');
    page.button('Discard changes')?.click();
    expect(page.at('roles.0.description')?.value).toBe('builds');
  });

  it('writes a picked model into the entry that asked, on the tab that asked', () => {
    const page = load();
    page.deliver(model());
    page.find((n) => n.dataset.path === 'agents.0.model')?.click();
    expect(page.posted.at(-1)).toMatchObject({ type: 'pickModel', tab: 'project' });
    page.send({ type: 'modelPicked', tab: 'project', client: 'codex', model: 'gpt-5' });
    expect(page.at('agents.0.model')?.textContent).toContain('codex · gpt-5');
    page.button('Save configuration')?.click();
    const saved = page.saves()[0] as { form: Form };
    expect(saved.form.agents[0].agent).toMatchObject({ model: 'gpt-5', client: { type: 'codex' } });
  });

  it('labels a diagnostic of the other layer with its file and does not mark a control', () => {
    const page = load();
    page.deliver(model());
    page.button('Local')?.click();
    page.deliver(model({}, { validation: { errors: [{ path: 'roles.dev.agent', message: 'missing agent', file: 'config.yaml' }], warnings: [] } }));
    expect(text(page)).toContain('config.yaml: missing agent');
  });

  it('offers an unknown named agent with a warning and the union of agent names', () => {
    const page = load();
    page.deliver(
      model({ form: form({ roles: [{ name: 'dev', agent: { mode: 'named', name: 'ghost' }, extra: {} }] }) }),
    );
    expect(text(page)).toContain('not in config.yaml or config.local.yaml');
  });

  it('on Local, inherit and override change only their own unit and keep an explicit empty override', () => {
    const page = load();
    page.deliver(
      model(
        { form: form({ roles: [{ name: 'dev', description: 'base', responsibilities: ['a'], agent: { mode: 'named', name: 'fast' }, extra: {} }] }) },
        { state: 'ok', exists: true, hash: HASH2, form: form({ agents: [], roles: [{ name: 'dev', responsibilities: [], agent: { mode: 'absent' }, extra: {} }] }) },
        'local',
      ),
    );
    expect(page.at('roles.0.responsibilities.override')?.checked).toBe(true);
    expect(page.at('roles.0.description.override')?.checked).toBe(false);
    page.at('roles.0.description.override')?.change(true);
    page.at('roles.0.description.value')?.enter('local desc');
    page.button('Save configuration')?.click();
    const saved = page.saves()[0] as { form: Form };
    expect(saved.form.roles[0]).toMatchObject({ description: 'local desc', responsibilities: [] });
    expect(saved.form.roles[0].agent).toEqual({ mode: 'absent' });
  });

  it('renders the Local control disabled with the inherited value until the unit is overridden', () => {
    const page = load();
    page.deliver(
      model(
        {
          form: form({
            roles: [
              {
                name: 'dev',
                description: 'base',
                responsibilities: ['a', 'b'],
                agent: { mode: 'named', name: 'fast' },
                extra: {},
              },
            ],
          }),
        },
        {
          state: 'ok',
          exists: true,
          hash: HASH2,
          form: form({ agents: [], roles: [{ name: 'dev', agent: { mode: 'absent' }, extra: {} }] }),
        },
        'local',
      ),
    );
    const description = page.at('roles.0.description.override');
    const responsibilities = page.at('roles.0.responsibilities.override');
    expect(description?.parentElement?.parentElement?.className).toContain('mg-field-action');
    expect(responsibilities?.parentElement?.parentElement?.className).toContain('mg-field-action');
    const input = page.at('roles.0.description.value');
    expect(input?.value).toBe('base');
    expect(input?.disabled).toBe(true);
    const first = page.at('roles.0.responsibilities.0');
    const second = page.at('roles.0.responsibilities.1');
    expect(first?.value).toBe('a');
    expect(second?.value).toBe('b');
    expect(first?.disabled).toBe(true);
    expect(second?.disabled).toBe(true);
  });

  it('enables the Local control with the local value and summarizes the overrides on the card', () => {
    const page = load();
    page.deliver(
      model(
        {
          form: form({
            roles: [
              { name: 'dev', description: 'base', responsibilities: [], agent: { mode: 'named', name: 'fast' }, extra: {} },
            ],
          }),
        },
        {
          state: 'ok',
          exists: true,
          hash: HASH2,
          form: form({ agents: [], roles: [{ name: 'dev', description: 'mine', agent: { mode: 'absent' }, extra: {} }] }),
        },
        'local',
      ),
    );
    const box = page.at('roles.0.description.override');
    expect(box?.checked).toBe(true);
    expect(text(page)).toContain('1 override');
    const input = page.at('roles.0.description.value');
    expect(input?.value).toBe('mine');
    expect(input?.disabled).toBe(false);
  });

  it('on Project, marks each unit the saved local config overrides and leaves the others unmarked', () => {
    const page = load();
    page.deliver(
      model(
        {},
        {
          state: 'ok',
          exists: true,
          hash: HASH2,
          form: form({
            agents: [
              {
                name: 'fast',
                agent: {
                  model: 'm2',
                  client: { type: 'codex', options: [{ key: 'sandbox', value: 'rw' }], extra: {} },
                  extra: {},
                },
              },
            ],
            roles: [{ name: 'dev', description: 'local', agent: { mode: 'named', name: 'fast' }, extra: {} }],
          }),
        },
      ),
    );
    const actionOf = (p: string): string | undefined =>
      page.at(p)?.parentElement?.querySelector('.mg-field-action')?.textContent;
    expect(actionOf('agents.0.model')).toBe('Overridden');
    expect(actionOf('agents.0.effort')).toBeUndefined();
    expect(actionOf('roles.0.description')).toBe('Overridden');
    expect(actionOf('roles.0.agentMode')).toBe('Overridden');
    const legendAction = (label: string): string | undefined =>
      page
        .find((node) => node.tagName === 'LEGEND' && node.textContent.startsWith(label))
        ?.querySelector('.mg-field-action')?.textContent;
    expect(legendAction('Client options')).toBe('Overridden');
    expect(legendAction('Responsibilities')).toBeUndefined();
    const tags = page.doc.root
      .descendants()
      .filter((node) => node.classList.contains('mg-override-tag'))
      .map((node) => node.textContent);
    expect(tags).toEqual(['Overridden', 'Overridden', 'Overridden', 'Overridden']);
    const tag = page.at('agents.0.model')?.parentElement?.querySelector('.mg-override-tag');
    expect(tag?.dataset.tip).toBe('config.local.yaml overrides this value. Change it on the Local tab.');
    expect(tag?.children.some((child) => child instanceof FakeElement && child.tagName === 'SVG')).toBe(true);
    // The Project tab still shows the value config.yaml holds; the tag states that local overrides it.
    expect(page.at('roles.0.description')?.value).toBe('builds');
  });

  it('starts a local inline role agent empty and copies the project agent only on request', () => {
    const page = load();
    page.deliver(
      model(
        {},
        { state: 'ok', exists: true, hash: HASH2, form: form({ agents: [], roles: [{ name: 'dev', agent: { mode: 'absent' }, extra: {} }] }) },
        'local',
      ),
    );
    const select = page.at('roles.0.agentMode');
    select?.enter('inline');
    expect(page.at('roles.0.agent.model')?.textContent).toBe('Choose a model');
    expect(text(page)).toContain('Replaces the config.yaml agent: fast');
    page.button('Copy from config.yaml')?.click();
    expect(page.at('roles.0.agentName')).toBeDefined();
    expect(page.at('roles.0.agent.model')).toBeUndefined();
  });

  it('keeps the first client option row on the project tab and in an inline role agent', () => {
    const page = load();
    page.deliver(
      model({
        form: form({
          agents: [{ name: 'bare', agent: { extra: {} } }],
          roles: [{ name: 'dev', agent: { mode: 'inline', agent: { extra: {} } }, extra: {} }],
        }),
      }),
    );
    page.button('Add option')?.click();
    expect(page.at('agents.0.clientOptions.0.key')).toBeDefined();
    page.at('agents.0.clientOptions.0.key')?.enter('sandbox');
    page.button('Save configuration')?.click();
    const saved = page.saves()[0] as { form: Form };
    expect(saved.form.agents[0].agent.client?.options).toEqual([{ key: 'sandbox', value: '' }]);

    const role = load();
    role.deliver(model({ form: form({ agents: [], roles: [{ name: 'dev', agent: { mode: 'inline', agent: { extra: {} } }, extra: {} }] }) }));
    role.button('Add option')?.click();
    expect(role.at('roles.0.agent.clientOptions.0.key')).toBeDefined();
  });

  it('ignores diagnostics once the draft they describe has changed, also after switching tabs', () => {
    const page = load();
    page.deliver(model());
    page.at('roles.0.description')?.enter('bad');
    page.button('Save configuration')?.click();
    const errors = { errors: [{ path: 'roles.dev.description', message: 'nope' }], warnings: [] };
    page.deliver(model({ validation: errors }), { saving: false, applying: false, error: null });
    expect(text(page)).toContain('1 problem found');
    expect(page.button('Save configuration')?.disabled).toBe(true);

    page.at('roles.0.description')?.enter('good');
    expect(text(page)).not.toContain('1 problem found');
    expect(page.button('Save configuration')?.disabled).toBe(false);

    page.button('Local')?.click();
    page.deliver(model({ validation: errors }));
    page.button('Project')?.click();
    expect(text(page)).not.toContain('1 problem found');
    expect(page.button('Save configuration')?.disabled).toBe(false);
  });

  it('shows the diagnostics of a second save that returns the same errors as the first', () => {
    const page = load();
    page.deliver(model());
    const errors = { errors: [{ path: 'roles.dev.description', message: 'nope' }], warnings: [] };
    const result = (seq: number) => ({ saving: false, applying: false, error: null, result: { tab: 'project', seq } });

    page.at('roles.0.description')?.enter('one');
    page.button('Save configuration')?.click();
    page.deliver(model({ validation: errors }), result(1));
    expect(text(page)).toContain('1 problem found');

    page.at('roles.0.description')?.enter('two');
    expect(text(page)).not.toContain('1 problem found');
    page.button('Save configuration')?.click();
    page.deliver(model({ validation: errors }), result(2));
    expect(text(page)).toContain('1 problem found');
    expect(page.button('Save configuration')?.disabled).toBe(true);

    // A background repost of the same result keeps it, and an edit still hides it.
    page.deliver(model({ validation: errors }));
    expect(text(page)).toContain('1 problem found');
    page.at('roles.0.description')?.enter('three');
    expect(text(page)).not.toContain('1 problem found');
  });
});
