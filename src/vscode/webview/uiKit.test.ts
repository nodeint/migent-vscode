import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

const media = path.join(__dirname, '../../../media');
const KIT = ['shared/utils.js', 'shared/icons.js', 'shared/copy.js', 'shared/dom.js', 'shared/components.js', 'shared/form.js'];

/** A minimal element: enough to build the kit's components and read back what a page can observe. */
class FakeElement {
  public children: FakeElement[] = [];
  public attrs: Record<string, string> = {};
  public className = '';
  public dataset: Record<string, string> = {};
  public disabled = false;
  public open = false;
  public title = '';
  public type = '';
  public id = '';
  public hidden = false;
  public handlers: Record<string, ((event?: unknown) => void)[]> = {};
  private text = '';

  public constructor(public readonly tagName: string) {}

  public get classList(): { add: (name: string) => void; contains: (name: string) => boolean } {
    return {
      add: (name) => {
        this.className = this.className ? `${this.className} ${name}` : name;
      },
      contains: (name) => this.className.split(' ').includes(name),
    };
  }

  public set textContent(value: string) {
    this.text = value;
    this.children = [];
  }

  public get textContent(): string {
    return this.text + this.children.map((child) => child.textContent).join('');
  }

  public append(...items: (FakeElement | string)[]): void {
    for (const item of items) {
      if (typeof item === 'string') this.text += item;
      else this.children.push(item);
    }
  }

  public replaceChildren(...items: FakeElement[]): void {
    this.children = [];
    this.text = '';
    this.append(...items);
  }

  public setAttribute(name: string, value: string): void {
    this.attrs[name] = value;
  }

  public getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }

  public addEventListener(type: string, handler: (event?: unknown) => void): void {
    (this.handlers[type] ??= []).push(handler);
  }

  public click(): void {
    for (const handler of this.handlers.click ?? []) handler();
  }

  public descendants(): FakeElement[] {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }
}

interface Ui {
  [name: string]: (...args: never[]) => FakeElement;
}

function load(files: string[] = KIT, extra: Record<string, unknown> = {}) {
  const listeners: string[] = [];
  const window: Record<string, unknown> = {
    addEventListener: (type: string) => listeners.push(type),
  };
  const context = vm.createContext({
    window,
    document: {
      createElement: (tag: string) => new FakeElement(tag.toUpperCase()),
      createElementNS: (_ns: string, tag: string) => new FakeElement(tag.toUpperCase()),
      addEventListener: (type: string) => listeners.push(type),
    },
    ...extra,
  });
  for (const file of files) vm.runInContext(readFileSync(path.join(media, file), 'utf8'), context);
  return { window, listeners, ui: window.MigentUi as Ui };
}

const call = (fn: unknown, ...args: unknown[]): FakeElement => (fn as (...a: unknown[]) => FakeElement)(...args);

describe('UI kit module groups', () => {
  it('loads and builds components without a host: no VS Code API, no message listener, no host adapter', () => {
    const { window, listeners, ui } = load();
    expect(window.MigentPage).toBeUndefined();
    expect(window.MigentDraftPage).toBeUndefined();
    expect(listeners).not.toContain('message');
    expect(call(ui.button, 'Go', { kind: 'primary' }).tagName).toBe('BUTTON');
  });

  it('keeps the kit files free of host calls and of the retired globals', () => {
    for (const file of ['dom.js', 'components.js', 'form.js']) {
      const source = readFileSync(path.join(media, 'shared', file), 'utf8');
      expect(source, file).not.toMatch(/acquireVsCodeApi|postMessage|MigentPage|MigentForm|MigentDraftPage/);
    }
  });

  it('loads in the order the page lists and leaves no retired global behind', () => {
    const source = readFileSync(path.join(__dirname, 'page.ts'), 'utf8');
    const list = /const SHARED_SCRIPTS = \[([^\]]*)\]/.exec(source)?.[1] ?? '';
    const files = [...list.matchAll(/'([^']+\.js)'/g)].map((match) => `shared/${match[1]}`);
    expect(files.slice(0, 3)).toEqual(['shared/utils.js', 'shared/icons.js', 'shared/copy.js']);
    const api = { postMessage: () => undefined, setState: () => undefined };
    const { window } = load(files, { acquireVsCodeApi: () => api });
    expect(window.MigentForm).toBeUndefined();
    expect(Object.keys(window.MigentPage as object).sort()).toEqual(['connect', 'trackFooter']);
    expect(window.MigentUi).toBeDefined();
  });

  it('reads only kit copy keys that exist', () => {
    const { window } = load();
    const { kit } = window.MigentCopy as { kit: Record<string, string> };
    for (const file of ['components.js', 'form.js']) {
      const source = readFileSync(path.join(media, 'shared', file), 'utf8');
      for (const match of source.matchAll(/copy\.kit\.(\w+)/g)) expect(kit, `${file}: ${match[1]}`).toHaveProperty(match[1]);
    }
  });
});

describe('UI kit builders', () => {
  it('button: kind and size classes, tip as data-tip, title as the native title', () => {
    const { ui } = load();
    const quiet = call(ui.button, 'x', { kind: 'quiet' });
    expect(quiet.className).toBe('mg-btn mg-btn--quiet mg-btn--sm');
    expect(call(ui.button, 'x', { kind: 'quiet', size: 'md' }).className).toBe('mg-btn mg-btn--quiet');
    const tipped = call(ui.button, 'x', { tip: 'Tip', title: 'Native', className: 'extra' });
    expect(tipped.attrs['data-tip']).toBe('Tip');
    expect(tipped.title).toBe('Native');
    expect(tipped.className).toContain('extra');
    expect(call(ui.button, 'x', { disabled: true }).disabled).toBe(true);
  });

  it('icon, remove and add buttons name themselves and carry the path', () => {
    const { ui } = load();
    const icon = call(ui.iconButton, 'Move up', { icon: 'arrow-up', path: 'stages.0.move-up', disabled: true });
    expect(icon.attrs['aria-label']).toBe('Move up');
    expect(icon.attrs['data-tip']).toBe('Move up');
    expect(icon.dataset.path).toBe('stages.0.move-up');
    expect(icon.disabled).toBe(true);
    const remove = call(ui.removeButton, 'Remove stage 1', { onClick: () => undefined });
    expect(remove.className).toContain('mg-btn--danger');
    expect(remove.attrs['aria-label']).toBe('Remove stage 1');
    expect(call(ui.addButton, 'Add', {}).className).toContain('mg-add');
    expect(call(ui.addBlockButton, 'Add', {}).className).toContain('mg-add-block');
    const framed = call(ui.addBlockButton, 'Add', { empty: 'Nothing yet' });
    expect(framed.className).toBe('mg-empty');
    expect(framed.children.map((child) => child.className)).toEqual(['mg-empty-text', expect.stringContaining('mg-add-block')]);
  });

  it('banner and alertLine: tone is presentation, role is its own option', () => {
    const { ui } = load();
    expect(call(ui.banner, { tone: 'error', lines: ['x'] }).attrs.role).toBe('alert');
    expect(call(ui.banner, { tone: 'ok', lines: ['x'] }).attrs.role).toBe('status');
    expect(call(ui.banner, { tone: 'error', role: 'status', lines: ['x'] }).attrs.role).toBe('status');
    expect(call(ui.banner, { tone: 'error', role: 'none', lines: ['x'] }).attrs.role).toBeUndefined();
    const line = call(ui.alertLine, 'Bad', { tone: 'warn' });
    expect(line.className).toBe('mg-alert mg-warn');
    expect(line.attrs.role).toBeUndefined();
    expect(call(ui.alertLine, 'Bad', { tone: 'error', role: 'alert' }).attrs.role).toBe('alert');
  });

  it('chip, pill and empty', () => {
    const { ui } = load();
    expect(call(ui.chip, '3').className).toBe('mg-chip');
    expect(call(ui.chip, 'Slow', { tone: 'warn' }).className).toBe('mg-chip mg-chip--warn');
    expect(call(ui.pill, 'done').className).toBe('mg-pill');
    const empty = call(ui.empty, 'Nothing');
    expect(empty.tagName).toBe('P');
    expect(empty.className).toBe('mg-empty');
    expect(empty.textContent).toBe('Nothing');
  });

  it('listRow: a div row, or a button row with a click; classes and title follow the options', () => {
    const { ui } = load();
    const plain = call(ui.listRow, { main: 'Label', meta: 'path', metaClass: 'mg-mono' });
    expect(plain.tagName).toBe('LI');
    const [row] = plain.children;
    expect(row.tagName).toBe('DIV');
    expect(row.className).toBe('mg-row');
    expect(row.children.map((child) => child.className)).toEqual(['mg-row-main', 'mg-row-meta mg-mono']);
    let clicked = 0;
    const action = call(ui.listRow, {
      main: 'Open',
      mainClass: 'mg-row-main--action',
      meta: [call(ui.pill, 'ok')],
      title: 'Whole task',
      onClick: () => (clicked += 1),
    });
    const [button] = action.children;
    expect(button.tagName).toBe('BUTTON');
    expect(button.type).toBe('button');
    expect(button.title).toBe('Whole task');
    expect(button.children[0].className).toBe('mg-row-main mg-row-main--action');
    expect(button.children[1].children[0].className).toBe('mg-pill');
    button.click();
    expect(clicked).toBe(1);
  });

  it('footer: one mg-footer row; saveFooter keeps its node and reads its labels from the copy', () => {
    const { ui } = load();
    const plain = call(ui.footer, { children: [call(ui.button, 'A')] });
    expect(plain.tagName).toBe('FOOTER');
    expect(plain.className).toBe('mg-footer');
    const save = call(ui.saveFooter, { canSave: true, saveLabel: 'Save configuration' });
    expect(save.className).toBe('mg-footer mg-save-footer');
    const buttons = save.descendants().filter((node) => node.tagName === 'BUTTON');
    expect(buttons.map((node) => node.textContent)).toEqual(['Discard changes', 'Save configuration']);
    expect(call(ui.saveFooter, { into: save, saving: true })).toBe(save);
    expect(buttons[1].textContent).toBe('Saving…');
  });

  it('details: the open state survives a rebuild by key', () => {
    const { ui } = load();
    const first = call(ui.details, 'Details', { key: 'k', open: true });
    expect(first.open).toBe(true);
    first.open = false;
    first.handlers.toggle[0]();
    expect(call(ui.details, 'Details', { key: 'k', open: true }).open).toBe(false);
  });

  it('select shows the copy for an empty or unknown value', () => {
    const { ui } = load();
    const select = call(ui.select, { value: 'x', options: [], onInput: () => undefined });
    expect(select.children[0].textContent).toBe('x (not in list)');
    const blank = call(ui.select, { value: '', options: [{ value: 'a', label: 'A' }], onInput: () => undefined });
    expect(blank.children[0].textContent).toBe('(none)');
  });
});
