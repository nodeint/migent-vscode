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
  dependsOn: string[];
  sessionResumeFrom: string;
  decision: { value: string; when: string; navigate: string }[];
  agentMode?: string;
  agent?: {
    model: string;
    effort: string;
    clientType: string;
    clientOptions: { key: string; value: string }[];
  };
}

interface OutputForm {
  name: string;
  fromStage: string;
  artifact: string;
}

interface DownstreamForm {
  workflow: string;
  task: string;
  artifacts: { key: string; value: string }[];
}

interface WorkflowFormStub {
  constraints: string[];
  stages: StageForm[];
  outputs: OutputForm[];
  downstream: DownstreamForm[];
}

interface FormKit {
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
  for (const file of ['../../../media/shared/form.js', '../../../media/workfloweditor/workflowform.js']) {
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
        producesArtifact: 'plan.md',
        decision: [{ value: 'approved', when: '', navigate: 'complete' }],
      },
      {
        id: 'review',
        role: 'reviewer',
        agentMode: 'named',
        agentName: 'deep',
        dependsOn: ['plan'],
        sessionResumeFrom: 'plan',
      },
    ],
    outputs: [{ name: 'plan', fromStage: 'plan', artifact: 'plan.md' }],
    downstream: [
      { workflow: 'implement', task: 'Do it', artifacts: [{ key: 'plan', value: 'plan' }] },
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
    expect(options(byPath(nodes, 'outputs.0.fromStage'))).toEqual(['', 'plan']);
    expect(options(byPath(nodes, 'outputs.0.artifact'))).toEqual(['', 'plan.md']);
    expect(options(byPath(nodes, 'downstream.0.workflow'))).toEqual(['', 'implement']);
    expect(options(byPath(nodes, 'downstream.0.artifacts.0.value'))).toEqual(['', 'plan']);
  });

  it('fills the output artifact and name from the selected stage', () => {
    const form = makeForm();
    form.outputs[0] = { name: '', fromStage: '', artifact: '' };
    const fromStage = byPath(render(form), 'outputs.0.fromStage');
    fromStage.value = 'plan';
    fire(fromStage, 'change');

    expect(form.outputs[0]).toEqual({ name: 'plan', fromStage: 'plan', artifact: 'plan.md' });
  });

  it('renames every reference when a stage id changes', () => {
    const form = makeForm();
    const id = byPath(render(form), 'stages.0.id');
    id.value = 'draft';
    fire(id, 'change');

    expect(form.stages[0].id).toBe('draft');
    expect(form.stages[1].dependsOn).toEqual(['draft']);
    expect(form.stages[1].sessionResumeFrom).toBe('draft');
    expect(form.outputs[0].fromStage).toBe('draft');
  });

  it('clears the resumed session when its stage is removed from Depends on', () => {
    const form = makeForm();
    const box = byPath(render(form), 'stages.1.dependsOn.plan');
    box.checked = false;
    fire(box, 'change');

    expect(form.stages[1].dependsOn).toEqual([]);
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

  it('renders hints as tooltip icons on controls only', () => {
    const nodes = render(makeForm());
    const icons = all(nodes).filter((node) => node.className.includes('mg-hint-icon'));

    expect(icons.length).toBeGreaterThan(0);
    expect(icons[0].title).not.toBe('');
    expect(icons[0].children.some((child) => typeof child !== 'string' && child.tagName === 'SVG')).toBe(true);
    expect(all(nodes).some((node) => node.className === 'mg-hint')).toBe(false);

    const layoutHeads = all(nodes).filter((node) => node.className === 'mg-section-head');
    expect(layoutHeads.length).toBeGreaterThan(0);
    for (const head of layoutHeads) {
      expect(head.descendants().some((node) => node.className.includes('mg-hint-icon'))).toBe(false);
    }
    expect(all(nodes).some((node) => node.className === 'mg-section-note')).toBe(true);
  });

  it('renders each output and suggestion on its own card', () => {
    const nodes = render(makeForm());
    const cards = all(nodes).filter((node) => node.className.split(' ').includes('mg-section--card'));
    const titles = cards.flatMap((card) =>
      card.descendants().filter((node) => node.className === 'mg-section-title').map((node) => node.textContent),
    );

    expect(titles).toEqual(expect.arrayContaining(['Output 1', 'Suggestion 1']));
  });

  it('marks a decision without a destination with the warning hint tone', () => {
    const form = makeForm();
    form.stages[0].decision = [{ value: 'ok', when: '', navigate: '' }];
    const nodes = render(form);
    const icon = all(nodes).find((node) => node.className.includes('mg-hint-icon--warn'));

    expect(icon?.title).toBe('A decision needs one destination.');
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

    for (const heading of ['Basics', 'Stages', 'Outputs', 'Downstream']) {
      expect(texts).toContain(heading);
    }
    expect(texts).not.toContain('Flow');
    for (const heading of ['Identity', 'Dependencies', 'Instructions', 'Decisions', 'Advanced settings']) {
      expect(texts).toContain(heading);
    }

    const heads = all(nodes).filter((node) => node.className === 'wf-stage-head');
    expect(heads.map((head) => (head.children[0] as FakeNode).textContent)).toEqual(['1', '2']);
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
});
