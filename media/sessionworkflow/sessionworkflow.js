// Session workflow page: the workflow.yaml of one session as the shared workflow form (workflowform.js). The form is
// locked once a stage has run. Saving is not available yet. Every string is set with textContent.
(function () {
  'use strict';

  const { el, connect, sessionHeader, icon, trackFooter } = window.MigentPage;
  const { emptyForm, normalizeForm } = window.MigentWorkflowForm;
  const root = document.getElementById('root');

  let model = null;
  let form = emptyForm();
  let nextFocus = null;
  let pendingModelPick = null;

  const post = (type) => page.post({ type });

  function adopt(nextModel) {
    const keepDraft = model !== null && model.savedHash === nextModel.savedHash && !nextModel.isLocked;
    model = nextModel;
    if (!keepDraft) form = normalizeForm(nextModel.form);
    paint();
  }

  function repaint(focusPath) {
    nextFocus = focusPath || null;
    paint();
  }

  const designForm = window.MigentWorkflowForm.create({
    getModel: () => model,
    getForm: () => form,
    issues: () => [],
    onEdit: () => {},
    repaint,
    pickModel: (index) => {
      pendingModelPick = index;
      post('pickModel');
    },
  });

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || message.type !== 'modelPicked' || pendingModelPick === null) return;
    const index = pendingModelPick;
    pendingModelPick = null;
    if (typeof message.provider === 'string' && typeof message.model === 'string') {
      designForm.applyModelPick(index, message.provider, message.model);
    }
  });

  const action = (name) => () => page.send({ intent: 'sessionAction', action: name });

  function renderHeader() {
    return sessionHeader(page, {
      state: model.sessionState,
      title: model.title,
      workflowId: model.workflowId,
      meta: model.meta,
      current: 'workflow',
      tabs: [
        ...(model.meta.pendingQuestions > 0 ? [{ key: 'questions', label: 'Questions', onSelect: action('answerQuestions') }] : []),
        { key: 'results', label: 'Results', onSelect: action('openResult') },
        { key: 'metrics', label: 'Metrics', onSelect: action('openMetrics') },
        { key: 'workflow', label: 'Workflow' },
        { key: 'task', label: 'Task', onSelect: action('openTask') },
      ],
      menuItems: [
        { label: 'Open workflow.yaml', onSelect: () => post('openFile') },
        { label: 'Reload from disk', onSelect: () => post('reload') },
      ],
    });
  }

  /** The shared banner: an icon and a left edge in the tone of the message, one paragraph per line. */
  function banner(tone, title, lines) {
    const node = el('div', null, 'mg-banner mg-banner--' + tone);
    node.setAttribute('role', 'status');
    const mark = el('span', null, 'mg-banner__icon');
    mark.append(icon(tone === 'error' ? 'error' : 'warning'));
    const body = el('div');
    body.append(el('p', title));
    for (const line of lines) body.append(el('p', line, 'mg-muted'));
    node.append(mark, body);
    return node;
  }

  function renderNotices() {
    const nodes = [];
    const add = (text, tone) => {
      const node = el('p', text, 'mg-alert ' + tone);
      nodes.push(node);
    };
    if (model.state === 'invalid') add('workflow.yaml is not valid YAML: ' + (model.readError || 'unknown error'), 'mg-error');
    if (model.state === 'unreadable') add('workflow.yaml cannot be read: ' + (model.readError || 'unknown error'), 'mg-error');
    if (model.state === 'unsupported') add('This workflow uses schema ' + (model.schemaVersion === null ? 'unknown' : model.schemaVersion) + '. The form is read-only.', 'mg-warn');
    if (model.isLocked) {
      const stages = model.ranStages.join(', ');
      nodes.push(
        banner('warn', 'This workflow is locked', [
          'Stage' + (model.ranStages.length === 1 ? ' ' : 's ') + stages + ' already ran, so the workflow can no longer be changed.',
        ]),
      );
    } else {
      add('Saving changes is not available yet.', 'mg-warn');
    }
    return nodes;
  }

  function paint() {
    root.replaceChildren();
    if (model === null) {
      root.append(el('p', 'Loading the workflow…', 'mg-muted'));
      return;
    }
    const notices = el('div', null, 'wf-notices');
    notices.append(...renderNotices());
    root.append(renderHeader(), notices, ...designForm.render());
    if (nextFocus) {
      const node = root.querySelector('[data-path="' + String(nextFocus).replaceAll('"', '') + '"]');
      if (node) node.focus();
      nextFocus = null;
    }
    trackFooter();
  }

  paint();
  const page = connect({ render: (nextModel) => adopt(nextModel) });
})();
