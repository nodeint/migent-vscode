import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

/* A tiny DOM, just enough for media/workfloweditor/workflowform.js to render its controls. */
type Handler = () => void;

class FakeNode {
  public children: (FakeNode | string)[] = [];
  public className = '';
  public dataset: Record<string, string> = {};
  public listeners: Record<string, Handler[]> = {};
  public attrs: Record<string, string> = {};
  public value = '';
  public checked = false;
  public disabled = false;
  public id = '';
  public htmlFor = '';
  public title = '';
  public placeholder = '';
  public type = '';
  public open = false;
  public hidden = false;
  public tabIndex = -1;
  public refresh?: () => void;
  public readonly classList = {
    add: (...names: string[]): void => {
      const current = new Set(this.className.split(' ').filter(Boolean));
      for (const name of names) current.add(name);
      this.className = [...current].join(' ');
    },
    contains: (name: string): boolean => this.className.split(' ').includes(name),
  };

  public constructor(public readonly tagName: string) {}

  public set textContent(value: string) {
    this.children = [value];
  }

  public get textContent(): string {
    return this.children
      .map((child) => (typeof child === 'string' ? child : child.textContent))
      .join('');
  }

  public append(...items: (FakeNode | string)[]): void {
    this.children.push(...items);
  }

  public replaceChildren(...items: (FakeNode | string)[]): void {
    this.children = [...items];
  }

  public setAttribute(name: string, value: string): void {
    this.attrs[name] = value;
  }

  public addEventListener(type: string, handler: Handler): void {
    (this.listeners[type] ??= []).push(handler);
  }

  public descendants(): FakeNode[] {
    return this.children.flatMap((child) =>
      typeof child === 'string' ? [] : [child, ...child.descendants()],
    );
  }
}

interface StageForm {
  id: string;
  depends_on: string[];
  sessionResumeFrom: string;
  artifacts?: string[];
  decision: { value: string; when: string; navigate: string; artifacts?: unknown }[];
  agentMode?: string;
  agent?: {
    model: string;
    effort: string;
    clientType: string;
    clientOptions: { key: string; value: string }[];
  };
}

interface ArtifactForm {
  id: string;
  file: string;
  description: string;
  required: boolean | null;
}

interface DownstreamForm {
  workflow: string;
  task: string;
  artifacts: { key: string; value: string }[] | null;
}

interface WorkflowFormStub {
  concurrency: number | null;
  constraints: string[];
  stages: StageForm[];
  artifacts: ArtifactForm[];
  downstream: DownstreamForm[];
}

interface FooterOptions {
  stateLabel?: string;
  saving?: boolean;
  busy?: boolean;
  canDiscard?: boolean;
  canSave?: boolean;
  onDiscard?: () => void;
  onSave?: () => void;
}

interface FormKit {
  saveFooter: (options: FooterOptions, into?: FakeNode) => FakeNode;
  notices: (children: FakeNode[]) => FakeNode;
  collapsibleCard: (options: {
    key: string;
    number: number;
    title: string;
    summary?: string[];
    alerts?: FakeNode[];
    warn?: boolean;
    open?: boolean;
    body?: FakeNode[];
  }) => FakeNode;
  select: (options: {
    value: string;
    options: { value: string; label: string }[];
    onInput: (value: string) => void;
  }) => FakeNode;
  picker: (options: {
    value: string;
    placeholder?: string;
    onPick: () => void;
  }) => FakeNode;
}

function el(tag: string, text?: string | null, className?: string): FakeNode {
  const node = new FakeNode(tag.toUpperCase());
  if (className) node.className = className;
  if (text !== null && text !== undefined) node.textContent = text;
  return node;
}

function load() {
  const window: Record<string, unknown> = {
    MigentPage: {
      el,
      section: (title: string, className: string): FakeNode => {
        const node = el('section', null, className);
        node.append(el('h2', title));
        return node;
      },
      details: (_key: string, summary: string | FakeNode, className: string, isOpenByDefault: boolean): FakeNode => {
        const node = el('details', null, className);
        node.open = isOpenByDefault === true;
        const head = el('summary');
        if (typeof summary === 'string') head.textContent = summary;
        else head.append(summary);
        node.append(head);
        return node;
      },
      icon: (name: string): FakeNode => {
        const node = el('svg', null, 'mg-icon');
        node.setAttribute('data-icon', name);
        return node;
      },
    },
  };
  const context = vm.createContext({
    window,
    document: { getElementById: (): null => null },
  });
  for (const file of ['../../../media/shared/copy.js', '../../../media/shared/form.js', '../../../media/workfloweditor/workflowcopy.js', '../../../media/workfloweditor/workflowmodel.js', '../../../media/workfloweditor/workflowform.js']) {
    vm.runInContext(readFileSync(path.join(__dirname, file), 'utf8'), context);
  }
  return {
    workflowForm: window.MigentWorkflowForm as {
      create: (host: Record<string, unknown>) => {
        render: () => FakeNode[];
        applyModelPick: (index: number, client: string, model: string) => boolean;
      };
      normalizeForm: (input: unknown) => unknown;
    },
    form: window.MigentForm as FormKit,
  };
}

function makeForm(): WorkflowFormStub {
  return load().workflowForm.normalizeForm({
    stages: [
      {
        id: 'plan',
        role: 'planner',
        artifacts: ['plan'],
        decision: [{ value: 'approved', when: '', navigate: 'complete' }],
      },
      {
        id: 'review',
        role: 'reviewer',
        agentMode: 'named',
        agentName: 'deep',
        depends_on: ['plan'],
        sessionResumeFrom: 'plan',
      },
    ],
    artifacts: [{ id: 'plan', file: 'plan.md' }],
    downstream: [
      { workflow: 'implement', task: 'Do it', artifacts: [{ key: 'plan', value: 'plan' }] },
      { workflow: 'all', task: 'Take everything' },
    ],
  }) as WorkflowFormStub;
}

function create(form: WorkflowFormStub, host: Record<string, unknown> = {}) {
  return load().workflowForm.create({
    getModel: () => ({
      roles: ['planner', 'reviewer'],
      agents: ['deep'],
      workflows: [{ id: 'implement', file: 'implement.yaml' }],
      clients: [
        { id: 'codex', models: ['gpt-5', 'gpt-6'], optionKeys: ['model_reasoning_effort', 'sandbox'] },
        { id: 'claude', models: ['sonnet'], optionKeys: ['effort'] },
      ],
      isSupported: true,
      state: 'ok',
    }),
    getForm: () => form,
    issues: () => [],
    onEdit: () => undefined,
    repaint: () => undefined,
    ...host,
  });
}

function render(form: WorkflowFormStub, host: Record<string, unknown> = {}): FakeNode[] {
  return create(form, host).render();
}

function all(nodes: FakeNode[]): FakeNode[] {
  return nodes.flatMap((node) => [node, ...node.descendants()]);
}

function byPath(nodes: FakeNode[], wanted: string): FakeNode {
  const node = all(nodes).find((candidate) => candidate.dataset.path === wanted);
  if (node === undefined) throw new Error(`no control at ${wanted}`);
  return node;
}

function byId(nodes: FakeNode[], id: string): FakeNode {
  const node = all(nodes).find((candidate) => candidate.id === id);
  if (node === undefined) throw new Error(`no element with id ${id}`);
  return node;
}

function byText(nodes: FakeNode[], text: string): FakeNode {
  const node = all(nodes).find((candidate) => candidate.tagName === 'BUTTON' && candidate.textContent === text);
  if (node === undefined) throw new Error(`no button labelled ${text}`);
  return node;
}

function options(node: FakeNode): string[] {
  return node.children
    .filter((child): child is FakeNode => typeof child !== 'string' && child.tagName === 'OPTION')
    .map((child) => child.value);
}

function fire(node: FakeNode, type: string): void {
  for (const handler of node.listeners[type] ?? []) handler();
}

/** Fire like the DOM: the target first, then each ancestor up to the root, which the fake nodes do not track. */
function bubble(roots: FakeNode[], target: FakeNode, type: string): void {
  const chain = (node: FakeNode, path: FakeNode[]): FakeNode[] | null => {
    if (node === target) return [...path, node];
    for (const child of node.children) {
      if (typeof child === 'string') continue;
      const found = chain(child, [...path, node]);
      if (found !== null) return found;
    }
    return null;
  };
  for (const root of roots) {
    const found = chain(root, []);
    if (found !== null) {
      for (const node of found.reverse()) fire(node, type);
      return;
    }
  }
  throw new Error('target is not inside the rendered form');
}

describe('workflow form reference controls', () => {
  it('offers closed lists for every cross-reference', () => {
    const nodes = render(makeForm());

    expect(options(byPath(nodes, 'stages.1.agentName'))).toEqual(['', 'deep']);
    expect(options(byPath(nodes, 'stages.1.sessionResumeFrom'))).toEqual(['', 'plan']);
    expect(options(byPath(nodes, 'downstream.0.workflow'))).toEqual(['', 'implement']);
    expect(options(byPath(nodes, 'downstream.0.artifacts.0.value'))).toEqual(['', 'plan']);
  });

  it('renames an artifact id in stage lists, decision lists and downstream mappings', () => {
    const form = makeForm();
    form.stages[0].decision[0].artifacts = { kind: 'ids', ids: ['plan'] };
    const id = byPath(render(form), 'artifacts.0.id');
    id.value = 'draft';
    fire(id, 'change');

    expect(form.artifacts[0].id).toBe('draft');
    expect(form.stages[0].artifacts).toEqual(['draft']);
    expect(form.stages[0].decision[0].artifacts).toEqual({ kind: 'ids', ids: ['draft'] });
    expect(form.downstream[0].artifacts).toEqual([{ key: 'plan', value: 'draft' }]);
  });

  it('lets a stage pick registry artifacts and leaves the required flag unset by default', () => {
    const form = makeForm();
    form.artifacts.push({ id: 'notes', file: 'notes.md', description: '', required: null });
    const box = byPath(render(form), 'stages.1.artifacts.notes');
    box.checked = true;
    fire(box, 'change');

    expect(form.stages[1].artifacts).toEqual(['notes']);
    expect(form.artifacts[1].required).toBeNull();
  });

  it('shows a CLI diagnostic keyed by artifact id against the control at that index', () => {
    const nodes = render(makeForm(), {
      issues: (kind: string) =>
        kind === 'errors' ? [{ path: 'artifacts.plan.file', message: 'file is not unique' }] : [],
    });
    const file = byPath(nodes, 'artifacts.0.file');
    expect(file.attrs['aria-invalid']).toBe('true');
  });

  it('shows a diagnostic on a stage artifact list and on a decision artifact list', () => {
    const form = makeForm();
    form.stages[0].decision[0].artifacts = { kind: 'ids', ids: ['plan'] };
    const nodes = render(form, {
      issues: (kind: string) =>
        kind === 'errors'
          ? [
              { path: 'stages.0.artifacts.0', message: 'stage list problem' },
              { path: 'stages.0.decision.0.approved.artifacts.0', message: 'decision list problem' },
            ]
          : [],
    });
    const messages = all(nodes)
      .filter((node) => node.className.includes('mg-issue'))
      .map((node) => node.textContent);
    expect(messages).toEqual(expect.arrayContaining(['stage list problem', 'decision list problem']));
    expect(byPath(nodes, 'stages.0.artifacts.plan').dataset.path).toBe('stages.0.artifacts.plan');
    expect(byPath(nodes, 'stages.0.decision.0.artifacts.ids.plan').dataset.path).toBe(
      'stages.0.decision.0.artifacts.ids.plan',
    );
  });

  it('shows an omitted downstream mapping as such and not as an empty list', () => {
    const form = makeForm();
    const nodes = render(form);

    const mode = byPath(nodes, 'downstream.1.mode');
    const selected = mode.children.find(
      (child): child is FakeNode => typeof child !== 'string' && (child as FakeNode & { selected?: boolean }).selected === true,
    );
    expect(selected?.value).toBe('all');
    expect(all(nodes).some((node) => node.dataset.path === 'downstream.1.artifacts.0.key')).toBe(false);
    expect(form.downstream[1].artifacts).toBeNull();
  });

  it('renames every reference when a stage id changes', () => {
    const form = makeForm();
    const id = byPath(render(form), 'stages.0.id');
    id.value = 'draft';
    fire(id, 'change');

    expect(form.stages[0].id).toBe('draft');
    expect(form.stages[1].depends_on).toEqual(['draft']);
    expect(form.stages[1].sessionResumeFrom).toBe('draft');
  });

  it('clears the resumed session when its stage is removed from Depends on', () => {
    const form = makeForm();
    const box = byPath(render(form), 'stages.1.depends_on.plan');
    box.checked = false;
    fire(box, 'change');

    expect(form.stages[1].depends_on).toEqual([]);
    expect(form.stages[1].sessionResumeFrom).toBe('');
  });

  it('reports every value edit through the form root without a per-control onEdit', () => {
    const form = makeForm();
    let edits = 0;
    const nodes = render(form, { onEdit: () => (edits += 1) });
    const concurrency = byPath(nodes, 'concurrency');
    concurrency.value = '3';

    expect(nodes).toHaveLength(1);
    bubble(nodes, concurrency, 'input');
    expect(form.concurrency).toBe(3);
    expect(edits).toBe(1);

    const resume = byPath(nodes, 'stages.1.sessionResumeFrom');
    resume.value = '';
    bubble(nodes, resume, 'change');
    expect(form.stages[1].sessionResumeFrom).toBe('');
    expect(edits).toBe(2);
  });

  it('offers one decision destination, never the stage itself', () => {
    const nodes = render(makeForm());
    const control = byPath(nodes, 'stages.0.decision.0.navigate');

    expect(control.tagName).toBe('SELECT');
    expect(options(control)).toEqual(['', 'complete', 'review']);
  });

  it('puts Decision and Navigate to on one row with Choose when below', () => {
    const nodes = render(makeForm());
    const block = all(nodes).find((node) =>
      node.className.split(' ').includes('mg-section--accent'),
    );
    const body = (block?.children ?? []).find(
      (child): child is FakeNode => typeof child !== 'string' && child.className === 'mg-section-body',
    );
    const grids = (body?.children ?? []).filter(
      (child): child is FakeNode => typeof child !== 'string' && child.className === 'mg-field-grid',
    );

    expect(grids).toHaveLength(2);
    expect(grids[0].descendants().map((node) => node.dataset.path)).toEqual(
      expect.arrayContaining(['stages.0.decision.0.value', 'stages.0.decision.0.navigate']),
    );
    expect(grids[0].descendants().map((node) => node.dataset.path)).not.toContain('stages.0.decision.0.when');
    expect(grids[1].descendants().map((node) => node.dataset.path)).toContain('stages.0.decision.0.when');
  });

  it('writes a single destination when the decision changes', () => {
    const form = makeForm();
    const repaint = vi.fn();
    const nodes = render(form, { repaint });
    const control = byPath(nodes, 'stages.0.decision.0.navigate');

    control.value = 'review';
    fire(control, 'change');

    expect(form.stages[0].decision[0].navigate).toBe('review');
    expect(repaint).toHaveBeenCalledWith('stages.0.decision.0.navigate');
  });

  it('renders hints as tooltips on labels, with no icon and not on layout heads', () => {
    const nodes = render(makeForm());
    const labels = all(nodes).filter((node) => node.className.includes('mg-has-hint'));

    expect(labels.length).toBeGreaterThan(0);
    expect(labels[0].attrs['data-tip']).toBeTruthy();
    expect(labels[0].tabIndex).toBe(0);
    expect(all(nodes).some((node) => node.className.includes('mg-hint-icon'))).toBe(false);
    expect(all(nodes).some((node) => node.className === 'mg-hint')).toBe(false);

    const layoutHeads = all(nodes).filter((node) => node.className === 'mg-section-head');
    expect(layoutHeads.length).toBeGreaterThan(0);
    for (const head of layoutHeads) {
      expect(head.descendants().some((node) => node.className.includes('mg-has-hint'))).toBe(false);
    }
    expect(all(nodes).some((node) => node.className === 'mg-section-note')).toBe(true);
  });

  it('describes a control by its hint text for assistive technology', () => {
    const nodes = render(makeForm());
    const concurrency = byPath(nodes, 'concurrency');
    const describedBy = concurrency.attrs['aria-describedby'];
    const text = all(nodes).find((node) => node.id === describedBy);

    expect(text?.textContent).toBe('How many stages may run at the same time.');
    expect(text?.hidden).toBe(true);
  });

  it('renders each artifact and suggestion on its own collapsible card, closed by default', () => {
    const nodes = render(makeForm());
    const cards = all(nodes).filter((node) => node.className.split(' ').includes('mg-collapsible'));
    const titles = cards.flatMap((card) =>
      card.descendants().filter((node) => node.className === 'mg-collapsible-title').map((node) => node.textContent),
    );

    expect(titles).toEqual(expect.arrayContaining(['plan', 'implement', 'all']));
    expect(cards.length).toBeGreaterThanOrEqual(5);
    expect(cards.every((card) => card.open !== true)).toBe(true);
  });

  it('moves artifacts and downstream suggestions with the up and down buttons of their cards', () => {
    const form = makeForm();
    form.artifacts.push({ id: 'review', file: 'review.md', description: '', required: null });
    const repainted: string[] = [];
    const nodes = render(form, { repaint: (path: string) => repainted.push(path) });

    // The first item cannot move up and the last cannot move down.
    expect(byPath(nodes, 'artifacts.0.move-up').disabled).toBe(true);
    expect(byPath(nodes, 'artifacts.1.move-down').disabled).toBe(true);
    expect(byPath(nodes, 'downstream.0.move-up').disabled).toBe(true);
    expect(byPath(nodes, 'downstream.1.move-down').disabled).toBe(true);

    fire(byPath(nodes, 'artifacts.0.move-down'), 'click');
    expect(form.artifacts.map((item) => item.id)).toEqual(['review', 'plan']);
    // The focus follows the pressed button to the item's new place; at the end of the list that button is
    // disabled, so it goes to the opposite one.
    expect(repainted.at(-1)).toBe('artifacts.1.move-up');

    fire(byPath(nodes, 'downstream.1.move-up'), 'click');
    expect(form.downstream.map((target) => target.workflow)).toEqual(['all', 'implement']);
    expect(repainted.at(-1)).toBe('downstream.0.move-down');
  });

  it('marks a decision without a destination with the warning hint tone', () => {
    const form = makeForm();
    form.stages[0].decision = [{ value: 'ok', when: '', navigate: '' }];
    const nodes = render(form);
    const label = all(nodes).find((node) => node.className.includes('mg-has-hint--warn'));

    expect(label?.attrs['data-tip']).toBe('A decision needs one destination.');
  });

  it('keeps an imported multi-destination or self route visible', () => {
    const form = makeForm();
    form.stages[0].decision = [
      { value: 'several', when: '', navigate: 'review, complete' },
      { value: 'self', when: '', navigate: 'plan' },
    ];
    const nodes = render(form);

    expect(options(byPath(nodes, 'stages.0.decision.0.navigate'))).toContain('review, complete');
    expect(options(byPath(nodes, 'stages.0.decision.1.navigate'))).toContain('plan');
    expect(form.stages[0].decision[0].navigate).toBe('review, complete');
    expect(form.stages[0].decision[1].navigate).toBe('plan');
  });

  it('shows the inline agent model picker, effort suggestions and option keys', () => {
    const form = makeForm();
    form.stages[1] = {
      ...form.stages[1],
      agentMode: 'inline',
      agent: {
        model: 'gpt-5',
        effort: 'high',
        clientType: 'codex',
        clientOptions: [{ key: 'model_reasoning_effort', value: 'high' }],
      },
    };
    const nodes = render(form);

    expect(byPath(nodes, 'stages.1.agent.model').tagName).toBe('BUTTON');
    expect(byPath(nodes, 'stages.1.agent.model').textContent).toBe('codex · gpt-5');
    expect(byPath(nodes, 'stages.1.agent.effort').attrs.list).toBe('wf-efforts');
    expect(byPath(nodes, 'stages.1.agent.clientOptions.0.key').attrs.list).toBe('wf-option-keys-1');
    expect(options(byId(nodes, 'wf-option-keys-1'))).toEqual(['model_reasoning_effort', 'sandbox']);
    expect(options(byId(nodes, 'wf-efforts'))).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
  });

  it('opens the model picker for the stage', () => {
    const form = makeForm();
    form.stages[1] = {
      ...form.stages[1],
      agentMode: 'inline',
      agent: { model: 'gpt-5', effort: 'high', clientType: 'codex', clientOptions: [] },
    };
    const pickModel = vi.fn();
    const nodes = render(form, { pickModel });

    fire(byPath(nodes, 'stages.1.agent.model'), 'click');
    expect(pickModel).toHaveBeenCalledWith(1);
  });

  it('keeps an unknown imported agent visible and preserves its values', () => {
    const form = makeForm();
    form.stages[1] = {
      ...form.stages[1],
      agentMode: 'inline',
      agent: {
        model: 'coding-plan/deepseek-v4-pro',
        effort: '',
        clientType: 'opencode',
        clientOptions: [],
      },
    };
    const nodes = render(form);

    expect(byPath(nodes, 'stages.1.agent.model').textContent).toBe('opencode · coding-plan/deepseek-v4-pro');
    expect(form.stages[1].agent).toMatchObject({
      model: 'coding-plan/deepseek-v4-pro',
      clientType: 'opencode',
    });
    expect(
      all(nodes).some(
        (node) => node.tagName === 'DETAILS' && (node.children[0] as FakeNode).textContent === 'Advanced agent settings',
      ),
    ).toBe(false);
  });

  it('shows client options without an advanced block', () => {
    const form = makeForm();
    form.stages[1] = {
      ...form.stages[1],
      agentMode: 'inline',
      agent: {
        model: 'gpt-5',
        effort: '',
        clientType: 'codex',
        clientOptions: [{ key: 'sandbox', value: 'true' }],
      },
    };
    const nodes = render(form);

    expect(
      all(nodes).some(
        (node) => node.tagName === 'DETAILS' && (node.children[0] as FakeNode).textContent === 'Advanced agent settings',
      ),
    ).toBe(false);
    expect(byPath(nodes, 'stages.1.agent.clientOptions.0.key').value).toBe('sandbox');
    expect(byText(nodes, 'Add option')).toBeDefined();
  });

  it('writes a picked model into the inline stage draft and refocuses the picker', () => {
    const form = makeForm();
    form.stages[1] = {
      ...form.stages[1],
      agentMode: 'inline',
      agent: { model: 'gpt-5', effort: '', clientType: 'codex', clientOptions: [] },
    };
    const repaint = vi.fn();
    const api = create(form, { repaint });

    expect(api.applyModelPick(1, 'claude', 'sonnet')).toBe(true);
    expect(form.stages[1].agent).toMatchObject({ clientType: 'claude', model: 'sonnet' });
    expect(repaint).toHaveBeenCalledWith('stages.1.agent.model');
  });

  it('ignores a picked model for a stage that is not an inline agent', () => {
    const form = makeForm();
    const api = create(form, {});

    expect(api.applyModelPick(1, 'claude', 'sonnet')).toBe(false);
    expect(form.stages[1].agent).toMatchObject({ clientType: '', model: '' });
  });
});

describe('workflow form layout', () => {
  it('gives every section one head and one body', () => {
    const nodes = render(makeForm());
    const sections = all(nodes).filter((node) => node.className.split(' ').includes('mg-section'));

    expect(sections.length).toBeGreaterThan(4);
    for (const section of sections) {
      expect(section.children).toHaveLength(2);
      expect((section.children[0] as FakeNode).className).toBe('mg-section-head');
      expect((section.children[1] as FakeNode).className).toBe('mg-section-body');
    }
    expect(all(nodes).some((node) => node.className.includes('mg-group'))).toBe(false);
  });

  it('puts the Basics content on a card under its head', () => {
    const nodes = render(makeForm());
    const basics = all(nodes).find((node) => node.className.split(' ').includes('mg-section--surface'));

    expect(basics).toBeDefined();
    const body = basics?.children[1] as FakeNode;
    expect(body.className).toBe('mg-section-body');
    expect(body.children.length).toBeGreaterThan(0);
  });

  it('groups stage settings under named headings and numbers the stages', () => {
    const nodes = render(makeForm());
    const texts = all(nodes).map((node) => node.textContent);

    for (const heading of ['Basics', 'Artifacts', 'Stages', 'Downstream']) {
      expect(texts).toContain(heading);
    }
    expect(texts).not.toContain('Flow');
    for (const heading of ['Identity', 'Dependencies', 'Instructions', 'Decisions', 'Advanced settings']) {
      expect(texts).toContain(heading);
    }

    const heads = all(nodes).filter((node) => node.className === 'mg-collapsible-head');
    // Artifacts, then stages, then downstream suggestions, each numbered from 1.
    expect(heads.map((head) => (head.children[0] as FakeNode).textContent)).toEqual(['1', '1', '2', '1', '2']);
  });

  it('renders a validation issue against its field', () => {
    const nodes = render(makeForm(), {
      issues: (kind: string) =>
        kind === 'errors' ? [{ path: 'stages.0.id', message: 'id is required' }] : [],
    });
    const id = byPath(nodes, 'stages.0.id');

    expect(id.attrs['aria-invalid']).toBe('true');
    expect(id.attrs['aria-describedby']).toMatch(/-issue$/);
    const messages = all(nodes).filter((node) => node.className.includes('mg-issue'));
    expect(messages.map((node) => node.textContent)).toContain('id is required');
  });

  describe('an issue sits on one control', () => {
    const collisionForm = (): WorkflowFormStub =>
      load().workflowForm.normalizeForm({
        artifacts: [{ id: 'plan-comment', file: 'plan-comments.md' }],
        stages: [
          {
            id: 'plan',
            role: 'planner',
            decision: [
              { value: 'approved', navigate: 'complete' },
              {
                value: 'revise',
                navigate: 'plan',
                artifacts: { kind: 'local', items: [{ id: 'plan-comment', file: 'review.md', description: '' }] },
              },
            ],
          },
        ],
      }) as WorkflowFormStub;

    const flagged = (nodes: FakeNode[]): string[] =>
      all(nodes)
        .filter((node) => node.attrs['aria-invalid'] === 'true' && node.dataset.path !== undefined)
        .map((node) => node.dataset.path as string);

    it('marks only the ID of a decision-local artifact whose id collides with a top-level one', () => {
      const nodes = render(collisionForm(), {
        issues: (kind: string) =>
          kind === 'errors'
            ? [
                {
                  path: 'stages.0.decision.1.revise.artifacts.plan-comment',
                  message: 'artifact id collides with a top-level artifact.',
                },
              ]
            : [],
      });
      expect(flagged(nodes)).toEqual(['stages.0.decision.1.artifacts.0.id']);
    });

    it('marks only the ID of a top-level artifact for an issue about the whole artifact', () => {
      const nodes = render(collisionForm(), {
        issues: (kind: string) => (kind === 'errors' ? [{ path: 'artifacts.plan-comment', message: 'bad' }] : []),
      });
      expect(flagged(nodes)).toEqual(['artifacts.0.id']);
    });

    it('marks only the named property when the path already names one', () => {
      const nodes = render(collisionForm(), {
        issues: (kind: string) => (kind === 'errors' ? [{ path: 'artifacts.plan-comment.file', message: 'bad' }] : []),
      });
      expect(flagged(nodes)).toEqual(['artifacts.0.file']);
    });

    it('marks only the value of a decision for an issue about the whole decision', () => {
      const nodes = render(collisionForm(), {
        issues: (kind: string) => (kind === 'errors' ? [{ path: 'stages.0.decision.0', message: 'bad' }] : []),
      });
      expect(flagged(nodes)).toEqual(['stages.0.decision.0.value']);
    });

    it('marks only the id of a stage for an issue about the whole stage', () => {
      const nodes = render(collisionForm(), {
        issues: (kind: string) => (kind === 'errors' ? [{ path: 'stages.0', message: 'bad' }] : []),
      });
      expect(flagged(nodes)).toEqual(['stages.0.id']);
    });

    it('flags the stage header, with its problem count, when an error is inside it', () => {
      const nodes = render(collisionForm(), {
        issues: (kind: string) =>
          kind === 'errors'
            ? [
                { path: 'stages.0.decision.1.revise.artifacts.plan-comment', message: 'a' },
                { path: 'stages.0.decision.0.navigate', message: 'b' },
              ]
            : [],
      });
      const head = all(nodes).find(
        (node) => node.className === 'mg-collapsible-head' && node.textContent.includes('planner'),
      );
      expect(head?.textContent).toContain('2 problems');
    });
  });

  it('adds and removes constraint rows through the shared list editor', () => {
    const form = makeForm();
    const repaint = vi.fn();
    const nodes = render(form, { repaint });

    fire(byText(nodes, 'Add constraint'), 'click');
    expect(form.constraints).toEqual(['']);
    expect(repaint).toHaveBeenLastCalledWith('constraints.0');

    const next = render(form, { repaint });
    const remove = all(next).find((node) => node.attrs['aria-label'] === 'Remove constraint 1');
    if (remove === undefined) throw new Error('no remove button for constraint 1');
    expect(remove.attrs['data-tip']).toBe('Remove constraint 1');
    fire(remove, 'click');
    expect(form.constraints).toEqual([]);
    expect(repaint).toHaveBeenLastCalledWith('constraints.0');
  });
});

describe('shared form kit', () => {
  it('keeps a select value that its choices do not know', () => {
    const kit = load().form;
    const node = kit.select({
      value: 'custom',
      options: [{ value: 'known', label: 'Known' }],
      onInput: () => undefined,
    });

    expect(options(node)).toEqual(['custom', 'known']);
    expect(node.children[0]).toBeTruthy();
    expect((node.children[0] as FakeNode).textContent).toBe('custom (not in list)');
  });

  const footerButtons = (footer: FakeNode): Record<string, FakeNode> =>
    Object.fromEntries(all([footer]).filter((n) => n.tagName === 'BUTTON').map((n) => [n.textContent, n]));

  it('disables Save when clean, invalid or saving, and refills in place', () => {
    const kit = load().form;
    const base = { canDiscard: true, canSave: true, onDiscard: () => undefined, onSave: () => undefined };
    const footer = kit.saveFooter({ ...base, canDiscard: false, canSave: false });
    expect(footer.className).toContain('mg-footer');
    expect(footerButtons(footer)['Save workflow'].disabled).toBe(true);
    expect(footerButtons(footer)['Discard changes'].disabled).toBe(true);

    expect(kit.saveFooter(base, footer)).toBe(footer);
    expect(footerButtons(footer)['Save workflow'].disabled).toBe(false);
    expect(footerButtons(footer)['Discard changes'].disabled).toBe(false);

    kit.saveFooter({ ...base, canSave: false }, footer);
    expect(footerButtons(footer)['Save workflow'].disabled).toBe(true);

    kit.saveFooter({ ...base, saving: true }, footer);
    expect(footerButtons(footer)['Saving…'].disabled).toBe(true);
    expect(footerButtons(footer)['Discard changes'].disabled).toBe(true);

    kit.saveFooter({ ...base, busy: true }, footer);
    expect(footerButtons(footer)['Save workflow'].disabled).toBe(true);
  });

  it('keeps the same buttons when the footer is refilled, so a click already under way still lands', () => {
    const kit = load().form;
    const first = vi.fn();
    const second = vi.fn();
    const footer = kit.saveFooter({ canDiscard: true, canSave: true, onSave: first, onDiscard: () => undefined });
    const save = footerButtons(footer)['Save workflow'];

    kit.saveFooter({ canDiscard: true, canSave: true, onSave: second, onDiscard: () => undefined }, footer);

    // A refill during a press (a field's change event fires when Save takes the focus) must not swap the button.
    expect(footerButtons(footer)['Save workflow']).toBe(save);
    fire(save, 'click');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('shows the save state label only when given and wires the actions', () => {
    const kit = load().form;
    const onSave = vi.fn();
    const onDiscard = vi.fn();
    const footer = kit.saveFooter({ stateLabel: 'Unsaved changes', canDiscard: true, canSave: true, onSave, onDiscard });
    expect(all([footer]).find((n) => n.className === 'mg-save-state')?.textContent).toContain('Unsaved changes');
    fire(footerButtons(footer)['Save workflow'], 'click');
    fire(footerButtons(footer)['Discard changes'], 'click');
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledTimes(1);

    const clean = kit.saveFooter({});
    expect(all([clean]).find((n) => n.className === 'mg-save-state')?.descendants()).toHaveLength(0);
  });

  it('wraps notices in the shared area', () => {
    const kit = load().form;
    const node = kit.notices([el('p', 'hello')]);
    expect(node.className).toBe('mg-notices');
    expect(node.descendants()).toHaveLength(1);
  });

  it('renders a collapsible card with number, title, summary and body', () => {
    const kit = load().form;
    const card = kit.collapsibleCard({
      key: 'k',
      number: 2,
      title: 'Review',
      summary: ['planner', '', '2 decisions'],
      body: [el('p', 'inside')],
      open: true,
    });
    expect(card.tagName).toBe('DETAILS');
    expect(card.className).toContain('mg-collapsible');
    expect(card.open).toBe(true);
    const texts = all([card]).map((n) => n.textContent);
    expect(texts).toEqual(expect.arrayContaining(['2', 'Review', 'planner \u00b7 2 decisions', 'inside']));
    expect(all([card]).find((n) => n.className === 'mg-collapsible-body')).toBeTruthy();
    expect(all([card]).find((n) => n.className === 'mg-badge')).toBeTruthy();
    const warned = kit.collapsibleCard({ key: 'w', number: 1, title: '', warn: true });
    expect(all([warned]).find((n) => n.className === 'mg-badge mg-badge--warn')).toBeTruthy();
  });

  it('redraws a card header from the draft when a value in its body is edited', () => {
    const form = makeForm();
    const nodes = render(form);
    const titles = (): string[] =>
      all(nodes)
        .filter((node) => node.className === 'mg-collapsible-title')
        .map((node) => node.textContent);
    const summaries = (): string[] =>
      all(nodes)
        .filter((node) => node.className === 'mg-collapsible-summary')
        .map((node) => node.textContent);

    const workflow = byPath(nodes, 'downstream.0.workflow');
    workflow.value = 'review';
    bubble(nodes, workflow, 'change');
    expect(titles()).toContain('review');

    const task = byPath(nodes, 'downstream.0.task');
    task.value = 'Check it';
    bubble(nodes, task, 'input');
    expect(summaries().some((text) => text.startsWith('Check it'))).toBe(true);

    const artifact = byPath(nodes, 'artifacts.0.id');
    artifact.value = 'draft';
    bubble(nodes, artifact, 'input');
    expect(titles()).toContain('draft');

    const stage = byPath(nodes, 'stages.0.id');
    stage.value = 'build';
    bubble(nodes, stage, 'input');
    expect(titles()).toContain('build');
  });

  it('keeps the card header summary quiet, with warning chips as its only framed items', () => {
    const kit = load().form;
    const card = kit.collapsibleCard({
      key: 'k2',
      number: 1,
      title: 'Plan',
      summary: ['planner', 'role agent', '', '6 instructions'],
      alerts: [el('span', '2 problems', 'mg-chip mg-chip--warn')],
    });
    const summary = all([card]).find((n) => n.className === 'mg-collapsible-summary');
    expect(summary?.textContent).toBe('planner \u00b7 role agent \u00b7 6 instructions');
    const main = all([card]).find((n) => n.className === 'mg-collapsible-main');
    expect(main?.attrs['data-tip']).toBe('Plan \u2014 planner \u00b7 role agent \u00b7 6 instructions');
    const chips = all([card]).filter((n) => n.className.split(' ').includes('mg-chip'));
    expect(chips.map((n) => n.textContent)).toEqual(['2 problems']);
    const bare = kit.collapsibleCard({ key: 'k3', number: 1, title: 'Plan' });
    expect(all([bare]).some((n) => n.className === 'mg-collapsible-summary')).toBe(false);
    expect(all([bare]).some((n) => n.className === 'mg-collapsible-alerts')).toBe(false);
  });
});
