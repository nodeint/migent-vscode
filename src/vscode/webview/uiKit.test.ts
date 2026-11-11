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
  public checked = false;
  public tabIndex = 0;
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
      mainClass: 'mg-mono',
      meta: [call(ui.pill, 'ok')],
      title: 'Whole task',
      onClick: () => (clicked += 1),
    });
    const [button] = action.children;
    expect(button.tagName).toBe('BUTTON');
    expect(button.type).toBe('button');
    expect(button.title).toBe('Whole task');
    expect(button.children[0].className).toBe('mg-row-main mg-mono');
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

  it('itemCard static: a div with no button, the number badge and the joined summary', () => {
    const { ui } = load();
    const card = call(ui.itemCard, { number: 2, title: 'review', summary: ['attempt 1', ''] });
    expect(card.tagName).toBe('DIV');
    expect(card.className).toBe('mg-item mg-item--static');
    expect(card.descendants().some((node) => node.tagName === 'BUTTON')).toBe(false);
    expect(card.descendants().some((node) => node.className.includes('mg-item-afford'))).toBe(false);
    const [head] = card.children;
    expect(head.className).toBe('mg-item-head mg-item-head--lead');
    const [badge, main] = head.children;
    expect(badge.className).toBe('mg-badge');
    expect(badge.textContent).toBe('2');
    expect(main.className).toBe('mg-item-main');
    const [title, summary] = main.children;
    expect(title.className).toBe('mg-item-title');
    expect(summary.className).toBe('mg-item-summary');
    expect(summary.textContent).toBe('attempt 1');
  });

  it('itemCard link: one button holds the lead and the main; status and tools stay outside it', () => {
    const { ui } = load();
    let clicked = 0;
    const statusState = { icon: 'pass', tone: 'ok', text: 'Completed', compact: true };
    const tool = call(ui.iconButton, 'Copy', { icon: 'copy', onClick: () => undefined });
    const card = call(ui.itemCard, {
      leading: 'file',
      title: 'plan.md',
      meta: [{ text: 'outputs/plan.md', mono: true }],
      status: statusState,
      tools: [tool],
      onClick: () => (clicked += 1),
    });
    expect(card.className).toBe('mg-item mg-item--link');
    const [head] = card.children;
    expect(head.className).toBe('mg-item-head');
    const [link, end] = head.children;
    expect(link.tagName).toBe('BUTTON');
    expect(link.type).toBe('button');
    expect(link.className).toBe('mg-item-link');
    expect(link.children.map((child) => child.className)).toEqual([
      'mg-item-leading',
      'mg-item-main',
      'mg-item-afford',
    ]);
    expect(link.attrs['aria-label']).toBe('plan.md — outputs/plan.md');
    expect(link.descendants().some((node) => node === tool)).toBe(false);
    expect(end.className).toBe('mg-item-end');
    const [status, tools] = end.children;
    expect(status.className).toBe('mg-status mg-status--ok mg-status--compact');
    expect(tools.children[0]).toBe(tool);
    link.click();
    expect(clicked).toBe(1);
  });

  it('itemCard link: a tip override is the tooltip only; the accessible name still carries the title and metadata', () => {
    const { ui } = load();
    const card = call(ui.itemCard, {
      leading: 'file',
      title: 'note.md',
      meta: [{ text: 'outputs/note.md', mono: true }],
      tip: 'outputs/note.md',
      onClick: () => undefined,
    });
    const [head] = card.children;
    const [link] = head.children;
    expect(link.textContent).toContain('note.md');
    expect(link.attrs['aria-label']).toBe('note.md — outputs/note.md');
    expect(link.attrs['data-tip']).toBe('outputs/note.md');
  });

  it('itemCard collapsible keeps its open state by key and appends the body', () => {
    const { ui } = load();
    const first = call(ui.itemCard, { key: 'card:k', title: 'next', body: ['content'] });
    expect(first.tagName).toBe('DETAILS');
    expect(first.className).toBe('mg-details mg-collapsible');
    expect(first.open).toBe(false);
    expect(first.children[1].className).toBe('mg-collapsible-body');
    first.open = true;
    first.handlers.toggle[0]();
    const second = call(ui.itemCard, { key: 'card:k', title: 'next', body: [] });
    expect(second.open).toBe(true);
  });

  it('collapsibleCard alias keeps the previous head DOM: badge, uncut title, joined summary, tools', () => {
    const { ui } = load();
    const tool = call(ui.iconButton, 'Open', { icon: 'go-to-file', onClick: () => undefined });
    const card = call(ui.collapsibleCard, {
      key: 'card:wf',
      number: 1,
      title: 'next-wf',
      summary: ['Do the next task', ''],
      tools: [tool],
      body: [],
    });
    expect(card.className).toBe('mg-details mg-collapsible');
    const [summary] = card.children;
    const [, heading] = summary.children;
    const [head] = heading.children;
    expect(head.className).toBe('mg-collapsible-head');
    const [badge, main, tools] = head.children;
    expect(badge.className).toBe('mg-badge');
    expect(main.children[0].className).toBe('mg-collapsible-title');
    expect(main.children[0].textContent).toBe('next-wf');
    expect(main.children[1].className).toBe('mg-collapsible-summary');
    expect(main.children[1].textContent).toBe('Do the next task');
    expect(main.attrs['data-tip']).toBe('next-wf — Do the next task');
    expect(tools.className).toBe('mg-collapsible-tools');
    expect(tools.children[0]).toBe(tool);
  });

  it('itemCard titleLines and meta: the clamp class keeps the full text; a refValue carries its value in data-tip', () => {
    const { ui } = load();
    const full = 'A child task long enough that two lines cannot hold all of it';
    const ref = call(ui.refValue, '123e4567-e89b-12d3-a456-426614174000', { kind: 'id' });
    const card = call(ui.itemCard, { title: full, titleLines: 2, meta: ['first', { text: 'path', mono: true }, ref] });
    const [head] = card.children;
    const [main] = head.children;
    const [title, meta] = main.children;
    expect(title.className).toBe('mg-item-title mg-item-title--clamp-2');
    expect(title.textContent).toBe(full);
    expect(head.attrs['data-tip']).toBe(full + ' — first · path · 123e4567-e89b-12d3-a456-426614174000');
    expect(meta.className).toBe('mg-item-meta');
    expect(meta.children[1].className).toBe('mg-mono');
    expect(ref.className).toBe('mg-ref mg-ref--id');
    expect(ref.dataset.tip).toBe('123e4567-e89b-12d3-a456-426614174000');
  });

  it('refValue.copyButton is a named icon button, separate from the value', () => {
    const { ui } = load();
    let copied = 0;
    const refValue = ui.refValue as unknown as {
      copyButton: (label: string, onCopy: () => void) => FakeElement;
    };
    const button = refValue.copyButton('Copy session ID', () => (copied += 1));
    expect(button.tagName).toBe('BUTTON');
    expect(button.className).toContain('mg-btn--icon');
    expect(button.attrs['aria-label']).toBe('Copy session ID');
    expect(button.attrs['data-tip']).toBe('Copy session ID');
    button.click();
    expect(copied).toBe(1);
  });

  it('details facts and ruled: a quiet summary beside the heading and the top rule', () => {
    const { ui } = load();
    const node = call(ui.details, 'Advanced', { facts: ['a', '', 'b'], ruled: true });
    expect(node.className).toBe('mg-details mg-details--ruled');
    const [summary] = node.children;
    const [, heading] = summary.children;
    expect(heading.textContent).toBe('Advanceda, b');
    const [facts] = heading.children;
    expect(facts.className).toBe('mg-summary');
    expect(facts.textContent).toBe('a, b');
  });

  it('stack, actions, denseList and plainList build the kit wrappers', () => {
    const { ui } = load();
    expect(call(ui.stack, [call(ui.itemCard, { title: 'a' })], { gap: 'card' }).className).toBe('mg-card-stack');
    expect(call(ui.stack, [call(ui.itemCard, { title: 'a' })]).className).toBe('mg-block-stack');
    expect(call(ui.actions, [call(ui.button, 'A')]).className).toBe('mg-actions');
    const dense = call(ui.denseList, ['a', { text: 'b', className: 'mg-muted' }]);
    expect(dense.tagName).toBe('UL');
    expect(dense.className).toBe('mg-list');
    expect(dense.children.map((child) => [child.tagName, child.textContent, child.className])).toEqual([
      ['LI', 'a', ''],
      ['LI', 'b', 'mg-muted'],
    ]);
    const plain = call(ui.plainList, ['x', 'y'], { mono: true });
    expect(plain.tagName).toBe('UL');
    expect(plain.className).toBe('mg-list--plain');
    expect(plain.children.map((child) => child.className)).toEqual(['mg-mono', 'mg-mono']);
  });

  it('keyValues: label/value pairs, a tone and a tool at the end of the row', () => {
    const { ui } = load();
    const tool = call(ui.iconButton, 'Copy', { icon: 'copy', onClick: () => undefined });
    const list = call(ui.keyValues, [
      { label: 'Latest execution', value: 'draft · attempt 1' },
      { label: 'Blocker', value: 'needs a token', tone: 'warn', tools: [tool] },
      { label: 'Hash', value: 'abc', mono: true },
    ]);
    expect(list.tagName).toBe('DL');
    expect(list.className).toBe('mg-kv');
    const [first, firstValue, , secondValue, , thirdValue] = list.children;
    expect(first.tagName).toBe('DT');
    expect(first.textContent).toBe('Latest execution');
    expect(firstValue.tagName).toBe('DD');
    expect(firstValue.children[0].className).toBe('mg-kv-value');
    expect(firstValue.children[0].textContent).toBe('draft · attempt 1');
    expect(secondValue.children[0].className).toBe('mg-kv-value mg-warn');
    expect(secondValue.children[1].className).toBe('mg-kv-tools');
    expect(secondValue.children[1].children[0]).toBe(tool);
    expect(thirdValue.children[0].className).toBe('mg-kv-value mg-mono');
  });

  it('empty with an icon keeps the message and the icon; statusIndicator compact keeps the hidden text', () => {
    const { ui } = load();
    const empty = call(ui.empty, 'Nothing here', { icon: 'folder' });
    expect(empty.className).toBe('mg-empty');
    expect(empty.children[0].className).toBe('mg-empty-icon');
    expect(empty.children[1].textContent).toBe('Nothing here');
    const status = call(ui.statusIndicator, { icon: 'pass', tone: 'ok', text: 'Completed', compact: true });
    expect(status.className).toBe('mg-status mg-status--ok mg-status--compact');
    expect(status.classList.contains('mg-status--compact')).toBe(true);
    expect(status.attrs['data-tip']).toBe('Completed');
    expect(status.children[1].className).toBe('mg-visually-hidden');
    expect(status.children[1].textContent).toBe('Completed');
  });

  it('fieldTag and fieldToggle: focusable tag with its tooltip, and a checkbox that reports its state', () => {
    const { ui } = load();
    const tag = call(ui.fieldTag, 'Overridden', { icon: 'warning', tip: 'Set in workspace settings' });
    expect(tag.className).toBe('mg-field-tag');
    expect(tag.children[1].textContent).toBe('Overridden');
    expect(tag.dataset.tip).toBe('Set in workspace settings');
    expect(tag.attrs['aria-label']).toBe('Overridden. Set in workspace settings');
    expect(tag.tabIndex).toBe(0);
    const seen: boolean[] = [];
    const toggle = call(ui.fieldToggle, 'Override', {
      checked: true,
      path: 'agents.planner.override',
      ariaLabel: 'Override the role',
      onChange: (checked: boolean) => seen.push(checked),
    });
    expect(toggle.tagName).toBe('LABEL');
    expect(toggle.className).toBe('mg-field-toggle');
    const [box, label] = toggle.children;
    expect(box.tagName).toBe('INPUT');
    expect(box.type).toBe('checkbox');
    expect(box.checked).toBe(true);
    expect(box.dataset.path).toBe('agents.planner.override');
    expect(box.attrs['aria-label']).toBe('Override the role');
    expect(label.textContent).toBe('Override');
    box.checked = false;
    box.handlers.change[0]();
    expect(seen).toEqual([false]);
  });

  it('field and grid density: roomy adds its modifier only when asked', () => {
    const { ui } = load();
    const control = call(ui.text, { value: '', path: 'a', onInput: () => undefined });
    expect(call(ui.field, { label: 'A', path: 'a', control }).className).toBe('mg-field');
    const roomy = call(ui.field, { label: 'A', path: 'a', control, density: 'roomy' });
    expect(roomy.className).toBe('mg-field mg-field--roomy');
    expect(call(ui.grid, []).className).toBe('mg-field-grid');
    expect(call(ui.grid, [], { density: 'roomy' }).className).toBe('mg-field-grid mg-field-grid--roomy');
  });
});

describe('UI kit boundaries', () => {
  const TEXT_UTILITIES = new Set(['mg-muted', 'mg-warn', 'mg-error', 'mg-mono']);

  it('page scripts write no mg-* class except the text utilities', () => {
    const pages = [
      'config/config.js',
      'config/configform.js',
      'workfloweditor/workflowEditor.js',
      'workfloweditor/workflowForm.js',
      'session/metrics.js',
      'session/overview.js',
      'session/overviewProgress.js',
      'session/results.js',
    ];
    for (const file of pages) {
      const source = readFileSync(path.join(media, file), 'utf8');
      const found = [...source.matchAll(/\bmg-[a-z0-9-]+/g)].map((match) => match[0]);
      expect(found.filter((name) => !TEXT_UTILITIES.has(name)), file).toEqual([]);
    }
  });

  it('a reference id or hash is a box the layout can cut, so the ellipsis applies in key-value rows too', () => {
    const css = readFileSync(path.join(media, 'shared/base.css'), 'utf8');
    const block = /\.mg-ref--id,\s*\.mg-ref--hash\s*\{([^}]*)\}/.exec(css);
    expect(block, 'the id/hash reference rule').not.toBeNull();
    const [, rules] = block as RegExpExecArray;
    expect(rules).toContain('display: inline-block');
    expect(rules).toContain('max-width: min(22ch, 100%)');
    expect(rules).toContain('overflow: hidden');
    expect(rules).toContain('text-overflow: ellipsis');
    expect(rules).toContain('white-space: nowrap');
  });

  it('no page stylesheet defines an mg-* selector; the two emptied sheets stay empty', () => {
    for (const file of ['session/session.css', 'config/config.css', 'workfloweditor/workflowEditor.css', 'workfloweditor/workflowForm.css']) {
      const source = readFileSync(path.join(media, file), 'utf8').replaceAll(/\/\*[\s\S]*?\*\//g, '');
      expect(source, file).not.toMatch(/\.mg-[a-z]/);
    }
    expect(readFileSync(path.join(media, 'config/config.css'), 'utf8').replaceAll(/\/\*[\s\S]*?\*\//g, '').trim()).toBe('');
    expect(readFileSync(path.join(media, 'workfloweditor/workflowEditor.css'), 'utf8').replaceAll(/\/\*[\s\S]*?\*\//g, '').trim()).toBe('');
    const form = readFileSync(path.join(media, 'workfloweditor/workflowForm.css'), 'utf8');
    expect(form).not.toMatch(/\.mg-[a-z]/);
    expect(form).toContain('scroll-padding-top');
  });
});
