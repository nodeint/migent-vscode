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
    createdAt: null,
    completedAt: null,
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
      nextStep: null,
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
  /** The source session's Details grid, which sits after the sections with no section of its own. */
  const source = (): FakeElement | undefined =>
    doc.root.descendants().find((node) => node.tagName === 'DETAILS' && node.className.includes('mg-details--ruled'));
  return { doc, posted, deliver, sections, section, titles, statusButtons, source };
}

describe('Overview page', () => {
  it('draws Status first, then the results blocks in their fixed order', () => {
    const page = load();
    page.deliver(pageModel());

    expect(page.titles()).toEqual(['Status', 'Progress', 'Outputs']);
    expect(page.doc.root.descendants().filter((node) => node.classList.contains('mg-empty'))).toHaveLength(2);
  });

  it('keeps Outputs on a Prepared session with no data and no Next steps, Child or From session frame', () => {
    const page = load();
    page.deliver(pageModel({ summary: summary({ state: 'prepared' }), actions: { primary: 'start', secondary: ['openTask'] } }));

    expect(page.titles()).toEqual(['Status', 'Progress', 'Outputs']);
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
    // Progress shows the latest execution and its decision, so Status does not repeat them.
    expect(status?.textContent).not.toContain('Latest execution');
    expect(status?.textContent).not.toContain('Decision');
    expect(status?.querySelector('.mg-status')?.className).toContain('mg-status--error');
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
  const stageRow = (overrides: Record<string, unknown>) => ({
    id: 'plan',
    state: 'completed',
    attempts: 1,
    decision: null,
    history: [{ order: 1, attempt: 1, state: 'completed', decision: null, completedAt: null }],
    completedAt: null,
    isCurrent: false,
    ...overrides,
  });

  const attemptFacts = (overrides: Record<string, unknown> = {}) => ({
    model: null,
    effort: null,
    error: null,
    blocker: null,
    createdAt: null,
    wallSeconds: null,
    usage: null,
    resumes: null,
    reason: null,
    asked: false,
    ...overrides,
  });
  const entries = (page: ReturnType<typeof load>) =>
    page.section('Progress')?.descendants().filter((node) => node.classList.contains('mg-tl-item')) ?? [];
  const titleOf = (item: FakeElement | undefined): string | undefined =>
    (item?.querySelector('.mg-tl-main')?.children[0] as FakeElement | undefined)?.textContent;

  it('draws Progress as a timeline: one entry per attempt on a rail, with no framed card', () => {
    const page = load();
    page.deliver(pageModel({
      progress: {
        kind: 'stages',
        rows: [
          stageRow({ id: 'plan' }),
          stageRow({
            id: 'implement',
            state: 'running',
            isCurrent: true,
            history: [{ order: 2, attempt: 1, state: 'running', decision: null, completedAt: null }],
          }),
          stageRow({ id: 'review', state: 'not-run', attempts: null, history: [] }),
        ],
      },
    }));

    const progress = page.section('Progress');
    const rows = entries(page);
    expect(progress?.querySelector('.mg-tl')?.tagName).toBe('UL');
    expect(progress?.descendants().some((node) => node.classList.contains('mg-item'))).toBe(false);
    expect(rows.map(titleOf)).toEqual(['plan', 'implement', 'review']);
    for (const row of rows) {
      expect((row.children[0] as FakeElement | undefined)?.className).toContain('mg-tl-marker');
      expect(row.descendants().some((node) => node.tagName === 'BUTTON')).toBe(false);
    }
    // The state is the dot only: icon, hidden text for readers and the tooltip, never a visible word.
    const dot = rows[0]?.querySelector('.mg-status');
    expect(dot?.className).toContain('mg-status--compact');
    expect(dot?.querySelector('.mg-visually-hidden')?.textContent).toBe('Completed');
    expect(dot?.attrs['data-tip']).toContain('Completed');
    expect(rows[0]?.querySelector('.mg-tl-main')?.textContent).not.toContain('Completed');
    expect(rows[1]?.className).toContain('mg-tl-item--info');
    expect(rows[1]?.querySelector('.mg-status')?.className).toContain('mg-status--info');
    // A stage that never ran sits last with an empty dot and muted text.
    expect(rows[2]?.className).toContain('mg-tl-item--muted');
    expect(rows[2]?.querySelector('.mg-status')?.className).toContain('mg-status--muted');
    expect(rows[2]?.querySelector('.mg-tl-main')?.textContent).toBe('review');
    expect(rows[2]?.textContent).not.toContain('#');
  });

  it('shows the attempt number, the decision badge and the reason an attempt ran', () => {
    const page = load();
    page.deliver(pageModel({
      progress: {
        kind: 'stages',
        rows: [stageRow({
          attempts: 2,
          decision: 'approved',
          history: [
            { order: 1, attempt: 1, state: 'completed', decision: 'revise', completedAt: null, ...attemptFacts() },
            {
              order: 2, attempt: 2, state: 'completed', decision: 'approved', completedAt: null,
              ...attemptFacts({ reason: { kind: 'revise', from: { stage: 'plan', attempt: 1 } } }),
            },
          ],
        })],
      },
    }));

    const rows = entries(page);
    expect(rows.map(titleOf)).toEqual(['plan', 'plan']);
    expect(rows.map((row) => (row.querySelector('.mg-tl-main')?.children[1] as FakeElement | undefined)?.textContent)).toEqual(['#1', '#2']);
    const decisions = rows.map((row) => row.querySelector('.mg-tl-main')?.descendants().filter((node) => node.classList.contains('mg-status')).at(-1));
    expect(decisions.map((node) => node?.textContent)).toEqual(['revise', 'approved']);
    expect(decisions.map((node) => node?.className)).toEqual(['mg-status mg-status--warn', 'mg-status mg-status--ok']);
    expect(rows[0]?.textContent).not.toContain('←');
    expect(rows[1]?.textContent).toContain('← revise from plan #1');
  });

  it('names a routed attempt only from the routing the model reports', () => {
    const page = load();
    page.deliver(pageModel({
      progress: {
        kind: 'stages',
        rows: [stageRow({
          history: [{
            order: 3, attempt: 3, state: 'completed', decision: null, completedAt: null,
            ...attemptFacts({ reason: { kind: 'routed', from: { stage: 'review_plan', attempt: 1 } } }),
          }],
        })],
      },
    }));
    expect(entries(page)[0]?.textContent).toContain('← routed from review_plan #1');
  });

  it('shows the full model and effort under the attempt, cut by CSS and without a tooltip', () => {
    const page = load();
    page.deliver(pageModel({
      progress: {
        kind: 'stages',
        rows: [stageRow({
          history: [{
            order: 1, attempt: 1, state: 'completed', decision: null, completedAt: null,
            ...attemptFacts({ model: 'claude-sonnet-5-5-20260101', effort: 'medium' }),
          }],
        })],
      },
    }));
    const sub = entries(page)[0]?.querySelector('.mg-tl-sub');
    expect(sub?.textContent).toBe('claude-sonnet-5-5-20260101 · medium');
    // The model line carries no tooltip, even when it is cut.
    expect(sub?.attrs['data-tip']).toBeUndefined();
    expect(entries(page)[0]?.querySelector('.mg-tl-subline')?.attrs['data-tip']).toBeUndefined();
  });

  const usage = (overrides: Record<string, unknown> = {}) => ({
    inputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    costUsd: null,
    ...overrides,
  });
  const done = (order: number, extra: Record<string, unknown>) => ({
    order, attempt: order, state: 'completed', decision: null, completedAt: null, ...attemptFacts(extra),
  });

  it('shows the duration on the head line and the usage cluster, one field each, on the model line', () => {
    const page = load();
    page.deliver(pageModel({
      progress: {
        kind: 'stages',
        rows: [stageRow({
          attempts: 2,
          history: [
            done(1, {
              model: 'sonnet', effort: 'medium', wallSeconds: 62,
              usage: usage({
                costUsd: 0.094, inputTokens: 8, outputTokens: 1100, reasoningTokens: 300,
                cacheWriteTokens: 16000, cacheReadTokens: 3730000,
              }),
            }),
            done(2, {
              wallSeconds: 220,
              usage: usage({ inputTokens: 72100, outputTokens: 3600, cacheWriteTokens: 0, cacheReadTokens: 706000 }),
            }),
          ],
        })],
        totals: {
          activeSeconds: 282,
          wallSeconds: 1458,
          usage: usage({
            costUsd: 0.094, inputTokens: 72108, outputTokens: 4700, cacheWriteTokens: 16000, cacheReadTokens: 4436000,
          }),
          costMissing: 1,
        },
      },
    }));
    const rows = entries(page);
    // The head line carries the duration only: no tokens.
    expect(rows[0]?.querySelector('.mg-tl-meta')?.textContent).toBe('1m 2s');
    expect(rows[1]?.querySelector('.mg-tl-meta')?.textContent).toBe('3m 40s');
    const sub = (row: FakeElement | undefined) => row?.querySelector('.mg-tl-sub');
    const tip = (row: FakeElement | undefined) =>
      sub(row)?.descendants().find((node) => node.attrs['data-tip'])?.attrs['data-tip'];
    // The cost follows the effort; the token breakdown is its tooltip. No cost reads "no cost record", still tipped.
    expect(sub(rows[0])?.textContent).toMatch(/ · 0\.09\$$/);
    expect(tip(rows[0])).toBe('8 in · 1.1k out · 16k cw · 3.7M cr');
    expect(sub(rows[1])?.textContent).toMatch(/ · no cost record$/);
    expect(tip(rows[1])).toBe('72.1k in · 3.6k out · 0 cw · 706k cr');
    expect(rows[0]?.querySelector('.mg-tl-sub-end')).toBeFalsy();

    const progress = page.section('Progress');
    expect(progress?.textContent).toContain('2 attempts');
    const total = progress?.querySelector('.mg-progress-totals');
    expect(total?.textContent).toBe('active 4m 42s · wall 24m 18s · 0.09$+');
    expect(total?.descendants().find((node) => node.textContent === '0.09$+')?.attrs['data-tip'])
      .toBe('72.1k in · 4.7k out · 16k cw · 4.4M cr; 1 attempt has no cost');
  });

  it('drops a null field, an emptied group and an unknown active or wall time', () => {
    const page = load();
    page.deliver(pageModel({
      progress: {
        kind: 'stages',
        rows: [stageRow({ history: [done(1, { usage: usage({ outputTokens: 500, cacheReadTokens: 2000 }) })] })],
        totals: { activeSeconds: null, wallSeconds: 90, usage: usage({ outputTokens: 500 }), costMissing: 0 },
      },
    }));
    expect(entries(page)[0]?.querySelector('.mg-tl-sub')?.textContent).toMatch(/no cost record$/);
    expect(page.section('Progress')?.querySelector('.mg-progress-totals')?.textContent).toBe('wall 1m 30s · no cost record');
  });

  it('shows a total cost without the plus when every attempt reported one', () => {
    const page = load();
    page.deliver(pageModel({
      progress: {
        kind: 'executions',
        rows: [],
        totals: { activeSeconds: null, wallSeconds: null, usage: usage({ costUsd: 2.281 }), costMissing: 0 },
      },
    }));
    const total = page.section('Progress')?.querySelector('.mg-progress-totals');
    expect(total?.textContent).toBe('2.28$');
    expect(total?.descendants().some((node) => node.attrs['data-tip'] !== undefined)).toBe(false);
  });

  it('marks an attempt that ended with a question, with an asked badge instead of the completed tick', () => {
    const page = load();
    page.deliver(pageModel({
      progress: {
        kind: 'stages',
        rows: [stageRow({
          history: [{
            ...done(1, { asked: true, createdAt: '2026-11-01T10:00:00.000Z' }),
            completedAt: '2026-11-01T10:05:00.000Z',
          }],
        })],
      },
    }));
    const [row] = entries(page);
    const marker = row?.querySelector('.mg-tl-marker')?.querySelector('.mg-status');
    expect(marker?.className).toContain('mg-status--warn');
    expect(marker?.attrs['data-tip']).toMatch(/^Asked a question · started /);
    expect(marker?.querySelector('.mg-visually-hidden')?.textContent).toBe('Asked a question');
    const main = row?.querySelector('.mg-tl-main');
    expect(main?.textContent).toContain('asked');
    expect(main?.textContent).not.toContain('Completed');
  });

  it('words why an attempt ran from its reason, and keeps resumes only in that label tooltip', () => {
    const page = load();
    page.deliver(pageModel({
      progress: {
        kind: 'stages',
        rows: [stageRow({
          history: [
            done(1, {}),
            done(2, { reason: { kind: 'answer' }, resumes: { stage: 'plan', attempt: 1 } }),
            done(3, { reason: { kind: 'revise', from: { stage: 'review_work', attempt: 1 } } }),
            done(4, { reason: { kind: 'routed', from: { stage: 'review_work', attempt: 2 } } }),
            done(5, { resumes: { stage: 'plan', attempt: 1 } }),
          ],
        })],
      },
    }));
    const rows = entries(page);
    const label = (row: FakeElement | undefined) =>
      row?.querySelector('.mg-tl-main')?.descendants().find((node) => node.classList.contains('mg-muted'));
    expect(label(rows[0])).toBeUndefined();
    expect(label(rows[1])?.textContent).toBe('← after your answer');
    expect(label(rows[1])?.attrs['data-tip']).toBe('resumes plan #1');
    expect(label(rows[2])?.textContent).toBe('← revise from review_work #1');
    expect(label(rows[2])?.attrs['data-tip']).toBeUndefined();
    expect(label(rows[3])?.textContent).toBe('← routed from review_work #2');
    // Resumes without a label has nowhere to show.
    expect(label(rows[4])).toBeUndefined();
    expect(rows[4]?.textContent).not.toContain('resumes');
  });

  it('leaves out what the data does not say: no metrics, model, effort or times, and no placeholder', () => {
    const page = load();
    page.deliver(pageModel({
      progress: {
        kind: 'stages',
        rows: [stageRow({
          history: [{ order: 1, attempt: 1, state: 'completed', decision: null, completedAt: null, ...attemptFacts({ model: 'm' }) }],
        })],
      },
    }));
    const [row] = entries(page);
    expect(row?.querySelector('.mg-tl-meta')).toBeNull();
    expect(row?.querySelector('.mg-tl-sub')?.textContent).toBe('m');
    expect(row?.querySelector('.mg-tl-note')).toBeNull();
    expect(page.section('Progress')?.textContent).not.toMatch(/unknown|—|undefined|null|NaN/i);
    // No attempt reports figures, so the head carries no totals.
    expect(page.section('Progress')?.querySelector('.mg-progress-totals')).toBeNull();
    expect(row?.querySelector('.mg-tl-sub-end')).toBeNull();

    // A model whose attempts predate every extra field still renders.
    page.deliver(pageModel({ progress: { kind: 'stages', rows: [stageRow({})] } }));
    expect(entries(page).map(titleOf)).toEqual(['plan']);
  });

  it('shows a blocker as a note and the absolute times in the dot tooltip', () => {
    const page = load();
    page.deliver(pageModel({
      progress: {
        kind: 'stages',
        rows: [stageRow({
          state: 'blocked',
          history: [{
            order: 1, attempt: 1, state: 'blocked', decision: null, completedAt: '2026-11-01T10:05:00.000Z',
            ...attemptFacts({ blocker: 'needs a token', createdAt: '2026-11-01T10:00:00.000Z' }),
          }],
        })],
      },
    }));
    const [row] = entries(page);
    expect(row?.querySelector('.mg-tl-note')?.textContent).toBe('needs a token');
    const tip = row?.querySelector('.mg-status')?.attrs['data-tip'] ?? '';
    expect(tip).toContain('Blocked');
    expect(tip).toContain('started ');
    expect(tip).toContain('finished ');
  });

  it('shows the recorded error of a failed attempt as a note, in stage and role-session timelines', () => {
    const page = load();
    page.deliver(pageModel({
      progress: {
        kind: 'stages',
        rows: [stageRow({
          state: 'failed',
          history: [{
            order: 1, attempt: 1, state: 'failed', decision: null, completedAt: null,
            ...attemptFacts({ error: 'verify failed: tests red' }),
          }],
        })],
      },
    }));
    expect(entries(page)[0]?.querySelector('.mg-tl-note')?.textContent).toBe('verify failed: tests red');

    page.deliver(pageModel({
      progress: {
        kind: 'executions',
        rows: [{
          executionId: '0001-review--attempt-01', stage: 'review', attempt: 1, state: 'failed', decision: null,
          completedAt: null, isCurrent: false, ...attemptFacts({ error: 'handoff file invalid' }),
        }],
      },
    }));
    expect(entries(page)[0]?.querySelector('.mg-tl-note')?.textContent).toBe('handoff file invalid');
  });

  it('orders attempts of every stage by when they ran, then the stages that never ran', () => {
    const page = load();
    const attempt = (order: number, n: number) => ({ order, attempt: n, state: 'completed', decision: null, completedAt: null });
    page.deliver(pageModel({
      progress: {
        kind: 'stages',
        rows: [
          stageRow({ id: 'implement', attempts: 2, history: [attempt(1, 1), attempt(3, 2)] }),
          stageRow({ id: 'review', attempts: 2, history: [attempt(2, 1), attempt(4, 2)] }),
          stageRow({ id: 'pr', state: 'not-run', attempts: null, history: [] }),
        ],
      },
    }));
    const rows = entries(page);
    expect(rows.map((row) => titleOf(row) + ' ' + (row.textContent.match(/#\d/)?.[0] ?? '')))
      .toEqual(['implement #1', 'review #1', 'implement #2', 'review #2', 'pr ']);
  });

  it('maps a decision to a tone: approved ok, approved-with-comments ok, revise warn, anything else neutral', () => {
    const page = load();
    const toneOf = (decision: string): string => {
      page.deliver(pageModel({ progress: { kind: 'stages', rows: [stageRow({ decision, history: [{ order: 1, attempt: 1, state: 'completed', decision, completedAt: null }] })] } }));
      const badges = (page.section('Progress')?.descendants() ?? []).filter((node) => node.textContent === decision);
      return badges.find((node) => node.classList.contains('mg-status'))?.className ?? '';
    };
    expect(toneOf('approved')).toContain('mg-status--ok');
    expect(toneOf('approved-with-comments')).toContain('mg-status--ok');
    expect(toneOf('revise')).toContain('mg-status--warn');
    expect(toneOf('other')).toContain('mg-status--muted');
  });

  it('gives every progress state a distinct icon and name, and distinct tones to running, waiting, failed and completed', () => {
    const page = load();
    const states = ['running', 'question', 'blocked', 'failed', 'completed', 'stopped', 'cancelled', 'prepared', 'not-run', 'skipped', 'unknown'];
    page.deliver(pageModel({
      progress: { kind: 'stages', rows: states.map((state) => stageRow({ id: state, state, history: [] })) },
    }));
    const badges = entries(page).map((row) => row.querySelector('.mg-status'));
    expect(badges).toHaveLength(states.length);
    expect(badges.every((badge) => (badge?.attrs['data-tip'] ?? '') !== '')).toBe(true);
    const icons = badges.map((badge) => JSON.stringify(badge?.descendants().map((node) => node.attrs.d ?? '')));
    expect(new Set(icons).size).toBe(states.length);
    const tone = (state: string): string => badges[states.indexOf(state)]?.className ?? '';
    expect(new Set(['running', 'question', 'failed', 'completed'].map(tone)).size).toBe(4);
  });

  it('lists the execution turns of a role session as the same timeline', () => {
    const page = load();
    page.deliver(pageModel({
      progress: {
        kind: 'executions',
        rows: [
          { executionId: '0001-review--attempt-01', stage: 'review', attempt: 1, state: 'completed', decision: 'approved', completedAt: null, isCurrent: false, ...attemptFacts({ model: 'claude-opus-5-5', effort: 'high', wallSeconds: 75, usage: usage({ inputTokens: 21000 }) }) },
          { executionId: '0002-review--attempt-02', stage: 'review', attempt: 2, state: 'failed', decision: null, completedAt: null, isCurrent: true, ...attemptFacts() },
        ],
      },
    }));

    const rows = entries(page);
    expect(rows.map(titleOf)).toEqual(['review', 'review']);
    expect(rows[0]?.textContent).toContain('#1');
    expect(rows[0]?.textContent).toContain('approved');
    expect(rows[0]?.textContent).toContain('claude-opus-5-5 · high');
    expect(rows[0]?.querySelector('.mg-tl-meta')?.textContent).toBe('1m 15s');
    expect(rows[0]?.querySelector('.mg-status')?.className).toContain('mg-status--compact');
    expect(rows[1]?.querySelector('.mg-status')?.className).toContain('mg-status--error');
    expect(rows[1]?.className).toContain('mg-tl-item--info');
    expect(page.section('Progress')?.querySelector('.mg-card-stack')).toBeNull();
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

    expect(page.titles()).toEqual(['Status', 'Progress', 'Latest activity', 'Outputs']);
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
  const suggestion = (overrides: Record<string, unknown> = {}) => ({
    workflow: 'next-wf',
    task: 'Go',
    declared: true,
    target: 'available',
    launch: { state: 'ready' },
    children: [],
    artifacts: [],
    ...overrides,
  });

  const SOURCE_MODEL = {
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
        sourcePath: 'C:/x/a.md',
      }],
    },
  };

  const outputRow = (key: string, overrides: Record<string, unknown> = {}) => ({
    key,
    label: key,
    path: 'outputs/' + key,
    state: 'ok',
    stage: null,
    attempt: null,
    publishedAt: null,
    ...overrides,
  });

  it('renders Status, Outputs, Next steps, Progress, Activity and Child sessions in that order, then the source Details with no section', () => {
    const page = load();
    page.deliver(pageModel({
      summary: summary({ state: 'running', isRunning: true }),
      activity: { visible: true, lines: ['10:15:30 plan started'] },
      outputs: { rows: [outputRow('report.md')], directoryError: null },
      next: { state: 'ok', detail: null, suggestions: [suggestion()] },
      children: [{ sessionId: 'c1', title: 'Child', state: 'Running', task: 'Do the next task', stageId: null, createdAt: null }],
      source: SOURCE_MODEL,
    }));

    expect(page.titles()).toEqual([
      'Status',
      'Outputs',
      'Next steps',
      'Progress',
      'Latest activity',
      'Child sessions',
    ]);
    const stack = page.doc.root.descendants().find((node) => node.children.includes(page.sections()[0] as FakeElement));
    expect(stack?.children.at(-1)).toBe(page.source());
    expect(page.section('Outputs')?.querySelector('.mg-empty')).toBeNull();
  });

  it('shows a count chip only for two or more items', () => {
    const page = load();
    const chip = (title: string) => page.section(title)?.querySelector('.mg-chip');
    page.deliver(pageModel({ outputs: { rows: [outputRow('a.md')], directoryError: null } }));
    expect(chip('Outputs')).toBeNull();
    page.deliver(pageModel({ outputs: { rows: [outputRow('a.md'), outputRow('b.md')], directoryError: null } }));
    expect(chip('Outputs')?.textContent).toBe('2');
  });

  it('shows no Next steps section without a suggestion, and a warn banner with Open next.json when the file is unusable', () => {
    const empty = load();
    empty.deliver(pageModel({ next: { state: 'missing', detail: null, suggestions: [] } }));
    expect(empty.titles()).not.toContain('Next steps');

    const invalid = load();
    invalid.deliver(pageModel({ next: { state: 'invalid', detail: 'bad', suggestions: [] } }));
    const section = invalid.section('Next steps');
    const banner = section?.descendants().find((node) => node.classList.contains('mg-banner'));
    expect(banner?.classList.contains('mg-banner--warn')).toBe(true);
    expect(banner?.textContent).toContain('Next steps are invalid');
    expect(banner?.textContent).toContain('bad');
    expect(banner?.textContent).toContain('Open next.json');
  });

  it('draws each next step as a clickable card that runs it, naming the newest child that already ran it', () => {
    const links = (host: ReturnType<typeof load>) =>
      (host.section('Next steps')?.descendants() ?? []).filter((node) => node.classList.contains('mg-item-link'));
    const page = load();
    page.deliver(pageModel({ next: { state: 'ok', detail: null, suggestions: [suggestion()] } }));
    const [card] = links(page);
    expect(card?.textContent).toContain('next-wf');
    expect(card?.textContent).toContain('Go');
    card?.click();
    expect(page.posted.at(-1)).toMatchObject({ type: 'intent', intent: 'openNextStep', workflow: 'next-wf' });

    const ran = load();
    ran.deliver(pageModel({
      next: {
        state: 'ok',
        detail: null,
        suggestions: [suggestion({
          children: [
            { sessionId: 'c2', title: 'Newest', state: 'Completed', createdAt: null },
            { sessionId: 'c1', title: 'Older', state: 'Completed', createdAt: null },
          ],
        })],
      },
    }));
    expect(links(ran)).toHaveLength(1);
    expect(links(ran)[0]?.textContent).toContain('Ran → Newest');
  });

  it('shows a blocked step with its reason chip; only an invalid or duplicate target is clickable, opening its workflow', () => {
    const cases: [Record<string, unknown>, string, boolean][] = [
      [{ declared: false, launch: { state: 'blocked', reason: 'notDeclared' } }, 'not declared', false],
      [{ declared: null, launch: { state: 'blocked', reason: 'declarationUnreadable' } }, 'declaration unreadable', false],
      [{ target: 'not-found', launch: { state: 'blocked', reason: 'targetNotFound' } }, 'target not found', false],
      [{ target: 'invalid', launch: { state: 'blocked', reason: 'targetInvalid' } }, 'target invalid', true],
      [{ target: 'duplicate', launch: { state: 'blocked', reason: 'targetDuplicate' } }, 'target duplicate', true],
    ];
    for (const [overrides, chip, clickable] of cases) {
      const page = load();
      page.deliver(pageModel({ next: { state: 'ok', detail: null, suggestions: [suggestion(overrides)] } }));
      const next = page.section('Next steps');
      expect(next?.textContent, chip).toContain(chip);
      const link = next?.descendants().find((node) => node.classList.contains('mg-item-link'));
      expect(Boolean(link), chip).toBe(clickable);
      link?.click();
      if (clickable) expect(page.posted.at(-1)).toMatchObject({ intent: 'openTargetWorkflow', workflow: 'next-wf' });
    }
  });

  it('puts the next action in Status as a line, never a run button', () => {
    const run = load();
    run.deliver(pageModel({ nextStep: { kind: 'run', workflow: 'next-wf' } }));
    expect(run.statusButtons().map((node) => node.textContent)).toEqual([]);

    const lines: [Record<string, unknown>, string][] = [
      [{ kind: 'choose', count: 2 }, '2 next steps can run. Pick one under Next steps.'],
      [{ kind: 'blocked', count: 1 }, 'The next steps are blocked. See Next steps for each reason.'],
      [{ kind: 'done' }, 'Nothing left to run.'],
    ];
    for (const [nextStep, line] of lines) {
      const page = load();
      page.deliver(pageModel({ nextStep }));
      expect(page.section('Status')?.textContent).toContain(line);
      expect(page.statusButtons().map((node) => node.textContent)).toEqual([]);
    }
  });

  it('always draws the overall state badge in Status, with an explanation when no action exists', () => {
    const page = load();
    page.deliver(pageModel({ summary: summary({ state: 'cancelled' }) }));
    const status = page.section('Status');
    expect(status?.descendants().some((node) => node.classList.contains('mg-status'))).toBe(true);
    expect(status?.textContent).toContain('Cancelled');
    expect(status?.textContent).toContain('No action is available.');
  });

  it('clamps a long child task, shows its facts, and sends openSession from the whole row with no other control', () => {
    const page = load();
    const task =
      'A child task that is much longer than two lines so the item head cannot show all of it without a clamp.';
    page.deliver(pageModel({
      children: [{ sessionId: 'c1', title: 'Child', state: 'Running', task, stageId: 'draft', createdAt: '2026-11-01T10:00:00.000Z' }],
    }));

    const children = page.section('Child sessions');
    const title = children?.querySelector('.mg-item-title');
    expect(title?.className).toContain('mg-item-title--clamp-2');
    expect(title?.textContent).toBe(task);
    const link = children?.querySelector('.mg-item-link');
    expect(link?.attrs['aria-label']).toContain(task);
    expect(link?.textContent).toContain('c1');
    expect(link?.textContent).toContain('draft');
    expect(link?.textContent).toContain('Running');
    expect((link?.children.at(-1) as FakeElement).className).toBe('mg-item-afford');
    expect(children?.descendants().filter((node) => node.tagName === 'BUTTON')).toHaveLength(1);
    link?.click();
    expect(page.posted.at(-1)).toMatchObject({ intent: 'openSession', sessionId: 'c1' });
  });

  it('shows the source session as one open Details grid with no section: upstream and each file as links, no hash, source path or output', () => {
    const page = load();
    page.deliver(pageModel({ source: { ...SOURCE_MODEL, sessionId: '00000000-0000-4000-8000-0000000000b1' } }));

    const details = page.source();
    expect((details as unknown as { open: boolean }).open).toBe(true);
    const labels = details?.descendants().filter((node) => node.tagName === 'DT').map((node) => node.textContent);
    expect(labels).toEqual(['upstream', 'a.md']);
    expect(details?.textContent).not.toContain('abc');
    expect(details?.textContent).not.toContain('C:/x/a.md');
    expect(details?.textContent).not.toContain('← output');
    expect(details?.descendants().some((node) => node.attrs['aria-label']?.startsWith('Copy'))).toBe(false);

    const link = (label: string) =>
      details?.descendants().find((node) => node.tagName === 'BUTTON' && node.className.includes('mg-btn--link') && node.textContent === label);
    link('Source')?.click();
    expect(page.posted.at(-1)).toMatchObject({ intent: 'openSession', sessionId: '00000000-0000-4000-8000-0000000000b1' });
    link('handoff/1/a.md')?.click();
    expect(page.posted.at(-1)).toMatchObject({ intent: 'openHandoffFile', name: 'a.md' });
  });

  it('shows an unavailable parent as plain text with its reason', () => {
    const page = load();
    page.deliver(pageModel({ source: { ...SOURCE_MODEL, availability: 'hidden', provenance: { state: 'none' } } }));
    const from = page.source();
    expect(from?.descendants().some((node) => node.classList.contains('mg-item-link'))).toBe(false);
    expect(from?.textContent).toContain('Show more in the Sessions view to load the source.');
  });

  it('keeps an output path as a mono segment only when it adds information, and shows who published it', () => {
    const page = load();
    page.deliver(pageModel({
      outputs: {
        rows: [
          outputRow('report', { path: 'outputs/report.md', stage: 'draft', attempt: 2, publishedAt: '2026-11-01T10:00:00.000Z' }),
          outputRow('plan', { path: 'elsewhere/plan.md' }),
        ],
        directoryError: null,
      },
    }));
    const links = page.section('Outputs')?.descendants().filter((node) => node.classList.contains('mg-item-link')) ?? [];
    expect(links[0]?.querySelector('.mg-mono')).toBeNull();
    expect(links[0]?.textContent).toContain('draft · attempt 2');
    expect(links[0]?.attrs['data-tip']).toBeUndefined();
    expect(links[1]?.querySelector('.mg-mono')?.textContent).toBe('elsewhere/plan.md');
    for (const link of links) expect((link.children.at(-1) as FakeElement).className).toBe('mg-item-afford');
  });

});
