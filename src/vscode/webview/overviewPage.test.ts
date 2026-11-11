import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

/* A tiny DOM, just enough for media/shared/page.js and media/session/session.js with the tab scripts to run. */
type Handler = (event: Record<string, unknown>) => void;

class FakeText {
  public constructor(public text: string) {}
}

class FakeElement {
  public children: (FakeElement | FakeText)[] = [];
  public attrs: Record<string, string> = {};
  public dataset: Record<string, string> = {};
  public listeners: Record<string, Handler[]> = {};
  public id = '';
  public className = '';
  public type = '';
  public hidden = false;
  public value = '';
  public offsetHeight = 0;
  public readonly classList = {
    toggle: (name: string, force?: boolean): void => {
      const names = new Set(this.className.split(' ').filter(Boolean));
      if (force ?? !names.has(name)) names.add(name);
      else names.delete(name);
      this.className = [...names].join(' ');
    },
    add: (...names: string[]): void => {
      const current = new Set(this.className.split(' ').filter(Boolean));
      for (const name of names) current.add(name);
      this.className = [...current].join(' ');
    },
    remove: (...names: string[]): void => {
      const current = new Set(this.className.split(' ').filter(Boolean));
      for (const name of names) current.delete(name);
      this.className = [...current].join(' ');
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

  public get activeElement(): null {
    return null;
  }

  public addEventListener(): void {
    // No document-level listeners are needed by this page.
  }
}

const HEADER = {
  availability: 'ok',
  sessionId: 's1',
  title: 'A session',
  state: 'Completed',
  workflowId: 'wf',
  meta: { stageId: null, createdAt: null, updatedAt: null, isRunning: false, pendingQuestions: 0 },
};

function summary(overrides: Record<string, unknown> = {}) {
  return {
    state: 'completed',
    unknownReason: null,
    runningStage: null,
    runningSummary: null,
    blocked: [],
    quotaResetAt: null,
    pendingQuestions: 0,
    latestExecution: null,
    isRunning: false,
    ...overrides,
  };
}

function execution(overrides: Record<string, unknown> = {}) {
  return {
    id: '0001-draft--attempt-01',
    order: 1,
    stage: 'draft',
    attempt: 1,
    status: 'completed',
    decision: 'go',
    blocker: null,
    client: null,
    model: null,
    hasFailureReport: false,
    kind: null,
    ...overrides,
  };
}

/** The Overview tab model of the Session page, as the host builds it. */
function pageModel(overrides: Record<string, unknown> = {}) {
  return {
    tab: 'overview',
    header: HEADER,
    overview: {
      availability: 'ok',
      sessionId: 's1',
      title: 'A session',
      state: 'Completed',
      workflowId: 'wf',
      meta: HEADER.meta,
      outputs: { rows: [], directoryError: null },
      next: { state: 'ok', detail: null, suggestions: [] },
      children: [],
      source: null,
      summary: summary(),
      progress: { kind: 'empty' },
      activity: { visible: false },
      actions: { primary: null, secondary: [] },
      ...overrides,
    },
  };
}

function load() {
  const doc = new FakeDocument();
  const windowListeners: Record<string, Handler[]> = {};
  const posted: Record<string, unknown>[] = [];
  const window = {
    scrollY: 0,
    scrollTo: (): void => undefined,
    addEventListener: (type: string, handler: Handler): void => {
      (windowListeners[type] ??= []).push(handler);
    },
  };
  class FakeResizeObserver {
    public observe(): void {
      // The page only tracks the footer height.
    }

    public disconnect(): void {
      // The page only tracks the footer height.
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
  for (const file of [
    'shared/utils.js',
    'shared/icons.js',
    'shared/copy.js',
    'shared/dom.js',
    'shared/components.js',
    'shared/form.js',
    'shared/page.js',
    'session/sessionCopy.js',
    'session/overviewCopy.js',
    'session/resultsCopy.js',
    'session/sessionHeader.js',
    'session/overviewProgress.js',
    'session/overview.js',
    'session/results.js',
    'session/session.js',
  ]) {
    vm.runInContext(readFileSync(path.join(media, file), 'utf8'), context);
  }
  let revision = 0;
  const deliver = (next: Record<string, unknown>): void => {
    revision += 1;
    for (const handler of windowListeners.message ?? []) {
      handler({ data: { type: 'model', revision, identity: { a: 1 }, model: next } });
    }
  };
  const sections = (): FakeElement[] => doc.root.descendants().filter((node) => node.className.split(' ').includes('mg-section'));
  const titles = (): string[] =>
    sections().map((section) => section.querySelector('.mg-section-title')?.textContent ?? '');
  const section = (title: string): FakeElement | undefined =>
    sections().find((candidate) => candidate.querySelector('.mg-section-title')?.textContent === title);
  const statusButtons = (): FakeElement[] =>
    (sections()[0]?.descendants() ?? []).filter((node) => node.tagName === 'BUTTON' && node.className.startsWith('mg-btn'));
  return { doc, posted, deliver, sections, section, titles, statusButtons };
}

describe('Overview page', () => {
  it('draws Status first, then the results blocks in their fixed order', () => {
    const page = load();
    page.deliver(pageModel());

    expect(page.titles()).toEqual(['Status', 'Progress', 'Outputs', 'Next steps']);
    expect(page.doc.root.descendants().filter((node) => node.classList.contains('mg-empty'))).toHaveLength(3);
  });

  it('keeps Outputs and Next steps on a Prepared session with no data and no Child, Source or Handoff frame', () => {
    const page = load();
    page.deliver(pageModel({ summary: summary({ state: 'prepared' }), actions: { primary: 'start', secondary: ['openTask'] } }));

    expect(page.titles()).toEqual(['Status', 'Progress', 'Outputs', 'Next steps']);
  });

  it('explains a Running session and draws exactly one primary action plus the danger Stop', () => {
    const page = load();
    page.deliver(pageModel({
      summary: summary({ state: 'running', isRunning: true, runningStage: 'draft', runningSummary: 'drafting' }),
      actions: { primary: 'showLog', secondary: ['stop'] },
    }));

    const [status] = page.sections();
    expect(status?.textContent).toContain('Running');
    expect(status?.textContent).toContain('Running stage draft.');
    expect(status?.textContent).toContain('Latest update');
    expect(status?.textContent).toContain('drafting');
    const buttons = page.statusButtons();
    expect(buttons.map((button) => button.textContent)).toEqual(['View log', 'Stop']);
    expect(buttons[0]?.className).toContain('mg-btn--primary');
    expect(buttons[1]?.className).toContain('mg-btn--danger');

    buttons[0]?.click();
    buttons[1]?.click();
    expect(page.posted.slice(-2)).toMatchObject([
      { type: 'intent', intent: 'sessionAction', action: 'showLog' },
      { type: 'intent', intent: 'sessionAction', action: 'stop' },
    ]);
  });

  it('draws the blocked reason, the recorded blocker and, without a reply target, no primary action', () => {
    const page = load();
    page.deliver(pageModel({
      summary: summary({
        state: 'blocked',
        blocked: [{ executionId: '0001-draft--attempt-01', stageId: 'draft', attempt: 2, blocker: 'needs a token' }],
      }),
      actions: { primary: null, secondary: ['showLog'] },
    }));

    const [status] = page.sections();
    expect(status?.textContent).toContain('Blocked');
    expect(status?.textContent).toContain('Blocked in');
    expect(status?.textContent).toContain('draft · attempt 2');
    expect(status?.textContent).toContain('Blocker');
    expect(status?.textContent).toContain('needs a token');
    expect(page.statusButtons().map((button) => button.textContent)).toEqual(['View log']);
    expect(page.statusButtons()[0]?.className).toContain('mg-btn--secondary');
  });

  it('offers only Answer questions while a batch is pending', () => {
    const page = load();
    page.deliver(pageModel({
      summary: summary({ state: 'question', pendingQuestions: 2 }),
      actions: { primary: 'answerQuestions', secondary: [] },
    }));

    const [status] = page.sections();
    expect(status?.textContent).toContain('Question');
    expect(status?.textContent).toContain('2 questions pending.');
    expect(page.statusButtons().map((button) => button.textContent)).toEqual(['Answer questions']);
    expect(page.statusButtons()[0]?.className).toContain('mg-btn--primary');
  });

  it('offers Continue and the secondary failure report and log for a Failed session', () => {
    const page = load();
    page.deliver(pageModel({
      summary: summary({ state: 'failed', latestExecution: execution({ status: 'failed', hasFailureReport: true }) }),
      actions: { primary: 'continue', secondary: ['openFailure', 'showLog'] },
    }));

    const [status] = page.sections();
    expect(status?.textContent).toContain('Failed');
    expect(status?.textContent).toContain('Latest execution');
    expect(status?.textContent).toContain('draft · attempt 1');
    expect(status?.textContent).toContain('Decision');
    expect(status?.textContent).toContain('go');
    expect(status?.querySelector('.mg-kv')).not.toBeNull();
    expect(page.statusButtons().map((button) => button.textContent)).toEqual([
      'Continue',
      'Open failure report',
      'View log',
    ]);
  });

  it('names each Unknown reason instead of a generic sentence', () => {
    const page = load();
    page.deliver(pageModel({
      summary: summary({ state: 'unknown', unknownReason: 'missing-status' }),
    }));

    const [status] = page.sections();
    expect(status?.textContent).toContain('Unknown');
    expect(status?.textContent).toContain('status.json is missing.');
    expect(page.statusButtons()).toEqual([]);
  });

  it('shows the pending question count and a local-free quota reset time', () => {
    const page = load();
    page.deliver(pageModel({
      summary: summary({ state: 'running', isRunning: true, pendingQuestions: 1, quotaResetAt: Date.UTC(2026, 10, 1, 12, 34) }),
      actions: { primary: 'showLog', secondary: [] },
    }));

    const [status] = page.sections();
    expect(status?.textContent).toContain('1 question pending.');
    expect(status?.textContent).toContain('Quota resets');
    expect(status?.textContent).toContain('12:34 UTC');
  });
  it('lists every workflow stage in order with its attempt and latest decision', () => {
    const page = load();
    page.deliver(pageModel({
      progress: {
        kind: 'stages',
        rows: [
          { id: 'plan', state: 'completed', attempts: 2, decision: 'revise', isCurrent: false },
          { id: 'implement', state: 'running', attempts: 1, decision: null, isCurrent: true },
          { id: 'review', state: 'not-run', attempts: null, decision: null, isCurrent: false },
        ],
      },
    }));

    const progress = page.section('Progress');
    const rows = progress?.descendants().filter((node) => node.classList.contains('mg-item')) ?? [];
    expect(rows.map((row) => row.querySelector('.mg-item-title')?.textContent)).toEqual([
      'plan',
      'implement',
      'review',
    ]);
    expect(rows.map((row) => row.querySelector('.mg-badge')?.textContent)).toEqual(['1', '2', '3']);
    expect(rows[0]?.textContent).toContain('attempt 2');
    expect(rows[0]?.textContent).toContain('decision revise');
    expect(rows[1]?.textContent).toContain('attempt 1');
    expect(rows[2]?.textContent).not.toContain('attempt');
    expect(rows[0]?.querySelector('.mg-status')?.className).toContain('mg-status--compact');
    expect(rows[2]?.querySelector('.mg-status')?.className).toContain('mg-status--muted');
    expect(rows[2]?.textContent).toContain('Not run');
    const [, current] = rows;
    expect(current?.className).toContain('mg-item--info');
    for (const row of rows) {
      expect(row.tagName).toBe('DIV');
      expect(row.descendants().some((node) => node.tagName === 'BUTTON')).toBe(false);
      expect(row.listeners.click).toBeUndefined();
    }
  });

  it('lists the execution turns of a role session', () => {
    const page = load();
    page.deliver(pageModel({
      progress: {
        kind: 'executions',
        rows: [
          { executionId: '0001-review--attempt-01', stage: 'review', attempt: 1, state: 'completed', decision: 'go', isCurrent: false },
          { executionId: '0002-review--attempt-02', stage: 'review', attempt: 2, state: 'failed', decision: null, isCurrent: false },
        ],
      },
    }));

    const progress = page.section('Progress');
    const rows = progress?.descendants().filter((node) => node.classList.contains('mg-item')) ?? [];
    expect(rows.map((row) => row.querySelector('.mg-item-title')?.textContent)).toEqual(['review', 'review']);
    expect(rows[0]?.textContent).toContain('attempt 1');
    expect(rows[0]?.textContent).toContain('decision go');
    expect(rows[0]?.querySelector('.mg-status')?.className).toContain('mg-status--compact');
    expect(rows[1]?.querySelector('.mg-status')?.className).toContain('mg-status--error');
  });

  it('shows one empty notice when there is no progress to list', () => {
    const page = load();
    page.deliver(pageModel({ progress: { kind: 'empty' } }));

    const progress = page.section('Progress');
    expect(progress?.descendants().filter((node) => node.classList.contains('mg-empty'))).toHaveLength(1);
    expect(progress?.textContent).toContain('No stages or executions to list.');
    expect(progress?.querySelector('.mg-card-stack')).toBeNull();
  });
  it('shows the five newest activity lines between Progress and Outputs while Running', () => {
    const page = load();
    page.deliver(pageModel({
      summary: summary({ state: 'running', isRunning: true }),
      activity: { visible: true, lines: ['10:15:30 plan started', '10:15:31 draft started'] },
    }));

    expect(page.titles()).toEqual(['Status', 'Progress', 'Latest activity', 'Outputs', 'Next steps']);
    const activity = page.section('Latest activity');
    expect(activity?.descendants().filter((node) => node.classList.contains('mg-mono')).map((node) => node.textContent)).toEqual([
      '10:15:30 plan started',
      '10:15:31 draft started',
    ]);
  });

  it('renders no activity block for a non-Running session', () => {
    const page = load();
    page.deliver(pageModel({ activity: { visible: false } }));

    expect(page.titles()).not.toContain('Latest activity');
    expect(page.doc.root.descendants().some((node) => node.classList.contains('mg-mono') && node.textContent.includes('plan started'))).toBe(false);
  });

  it('shows one empty notice for a Running session with no recorded events', () => {
    const page = load();
    page.deliver(pageModel({ summary: summary({ state: 'running', isRunning: true }), activity: { visible: true, lines: [] } }));

    const activity = page.section('Latest activity');
    expect(activity?.textContent).toContain('No activity recorded yet.');
  });
  it('renders Outputs, Next steps, Child sessions, Source session and Handoff after Activity in that order', () => {
    const page = load();
    page.deliver(pageModel({
      summary: summary({ state: 'running', isRunning: true }),
      activity: { visible: true, lines: ['10:15:30 plan started'] },
      outputs: {
        rows: [{ key: 'name:report.md', label: 'report.md', path: 'outputs/report.md', state: 'ok' }],
        directoryError: null,
      },
      next: {
        state: 'ok',
        detail: null,
        suggestions: [{ workflow: 'next-wf', task: 'Go', declared: true, target: 'ok', artifacts: [] }],
      },
      children: [{ sessionId: 'c1', title: 'Child', state: 'Running', task: 'Do the next task' }],
      source: {
        sessionId: 'source',
        title: 'Source',
        availability: 'retained',
        provenance: {
          state: 'ok',
          artifacts: [{
            name: 'a.md',
            output: 'report.md',
            path: 'handoff/1/a.md',
            localState: 'ok',
            sha256: 'abc',
            sourcePath: null,
          }],
        },
      },
    }));

    expect(page.titles()).toEqual([
      'Status',
      'Progress',
      'Latest activity',
      'Outputs',
      'Next steps',
      'Child sessions',
      'Source session',
      'Handoff',
    ]);
    expect(page.doc.root.descendants().filter((node) => node.classList.contains('mg-empty'))).toHaveLength(1);
    expect(page.section('Outputs')?.querySelector('.mg-empty')).toBeNull();
    expect(page.section('Next steps')?.querySelector('.mg-empty')).toBeNull();
  });

  it('keeps a plain Completed session to its facts, without a state line', () => {
    const page = load();
    page.deliver(pageModel());

    const status = page.section('Status');
    expect(status?.textContent).toContain('Where the session stands and what you can do.');
    expect(status?.descendants().some((node) => node.classList.contains('mg-status'))).toBe(false);
  });

  it('names no file in the empty Next steps state and shows a warn banner when the file cannot be used', () => {
    const empty = load();
    empty.deliver(pageModel({ next: { state: 'missing', detail: null, suggestions: [] } }));
    const next = empty.section('Next steps');
    expect(next?.textContent).toContain('This session suggested no next steps.');
    expect(next?.textContent).not.toContain('next.json');

    const invalid = load();
    invalid.deliver(pageModel({ next: { state: 'invalid', detail: 'bad', suggestions: [] } }));
    const section = invalid.section('Next steps');
    const banner = section?.descendants().find((node) => node.classList.contains('mg-banner'));
    expect(banner?.classList.contains('mg-banner--warn')).toBe(true);
    expect(banner?.textContent).toContain('Next steps are invalid');
    expect(banner?.textContent).toContain('bad');
  });

  it('clamps a long child task, keeps its full text, and puts the source id in a refValue with its copy outside the link', () => {
    const page = load();
    const task =
      'A child task that is much longer than two lines so the item head cannot show all of it without a clamp.';
    page.deliver(pageModel({
      children: [{ sessionId: 'c1', title: 'Child', state: 'Running', task }],
      source: {
        sessionId: '00000000-0000-4000-8000-0000000000b1',
        title: 'Source',
        availability: 'retained',
        provenance: { state: 'ok', artifacts: [] },
      },
    }));

    const children = page.section('Child sessions');
    const title = children?.querySelector('.mg-item-title');
    expect(title?.className).toContain('mg-item-title--clamp-2');
    expect(title?.textContent).toBe(task);
    const childLink = children?.descendants().find((node) => node.classList.contains('mg-item-link'));
    expect(childLink?.attrs['aria-label']).toContain(task);
    const childCopy = children?.descendants().find((node) => node.attrs['aria-label'] === 'Copy session ID');
    expect(childCopy?.tagName).toBe('BUTTON');
    expect(childLink?.descendants().some((node) => node === childCopy)).toBe(false);

    const source = page.section('Source session');
    const ref = source?.descendants().find((node) => node.classList.contains('mg-ref'));
    expect(ref?.textContent).toBe('00000000-0000-4000-8000-0000000000b1');
    expect(ref?.dataset.tip).toBe('00000000-0000-4000-8000-0000000000b1');
    const sourceLink = source?.descendants().find((node) => node.classList.contains('mg-item-link'));
    const sourceCopy = source?.descendants().find((node) => node.attrs['aria-label'] === 'Copy session ID');
    expect(sourceCopy?.tagName).toBe('BUTTON');
    expect(sourceLink?.descendants().some((node) => node === sourceCopy)).toBe(false);
  });

  it('keeps an output path as a mono meta segment, with the label still in the link name', () => {
    const page = load();
    page.deliver(pageModel({
      outputs: { rows: [{ key: 'name:report', label: 'report.md', path: 'outputs/report.md', state: 'ok' }], directoryError: null },
    }));
    const meta = page.section('Outputs')?.querySelector('.mg-item-meta');
    const segment = meta?.querySelector('.mg-mono');
    expect(segment?.className).toBe('mg-mono');
    expect(segment?.textContent).toBe('outputs/report.md');
    const link = page.section('Outputs')?.querySelector('.mg-item-link');
    expect(link?.textContent).toContain('report.md');
    expect(link?.attrs['aria-label']).toBe('report.md — outputs/report.md');
    expect(link?.attrs['data-tip']).toBe('outputs/report.md');
  });

  it('sends the copy intent for a child id and for both handoff values', () => {
    const page = load();
    page.deliver(pageModel({
      children: [{ sessionId: 'c1', title: 'Child', state: 'Completed', task: 'Do it' }],
      source: {
        sessionId: 'src',
        title: 'Source',
        availability: 'retained',
        provenance: {
          state: 'ok',
          artifacts: [{
            name: 'a.md',
            output: 'plan',
            path: 'handoff/1/a.md',
            localState: 'ok',
            sha256: 'abc',
            sourcePath: 'C:/x/a.md',
          }],
        },
      },
    }));

    const click = (title: string, label: string): void => {
      const button = page.section(title)?.descendants().find((node) => node.attrs['aria-label'] === label);
      expect(button?.tagName, label).toBe('BUTTON');
      button?.click();
    };
    click('Child sessions', 'Copy session ID');
    click('Handoff', 'Copy SHA-256');
    click('Handoff', 'Copy source path');

    expect(page.posted.filter((message) => message.intent === 'copyValue')).toMatchObject([
      { type: 'intent', intent: 'copyValue', kind: 'sessionId', sessionId: 'c1' },
      { type: 'intent', intent: 'copyValue', kind: 'handoffHash', name: 'a.md' },
      { type: 'intent', intent: 'copyValue', kind: 'handoffSourcePath', name: 'a.md' },
    ]);
  });
});
