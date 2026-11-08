// Session workflow page: the workflow.yaml of one session as the shared workflow form (workflowform.js). The form is
// locked once a stage has run; before that it keeps a local draft and asks the host to save it. Every string is set with textContent.
(function () {
  'use strict';

  const { el, connect, sessionHeader, icon, trackFooter } = window.MigentPage;
  const copy = window.MigentCopy;
  const ui = window.MigentForm;
  const { emptyForm, normalizeForm } = window.MigentWorkflowForm;
  const root = document.getElementById('root');

  const NO_TRANSIENT = { saving: false, applying: false, error: null };

  let model = null;
  let transient = NO_TRANSIENT;
  let form = emptyForm();
  let savedForm = emptyForm();
  let nextFocus = null;
  let noticesHost = null;
  let footerHost = null;
  /** Stable JSON of the draft last sent to save; edits made after it must survive the save's completion. */
  let submitted = null;
  let pendingModelPick = null;

  const post = (type, payload) => page.post({ type, ...(payload || {}) });

  /** Stable JSON: key order never makes two equal drafts look different. */
  function stable(value) {
    if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
    if (value !== null && typeof value === 'object') {
      return (
        '{' +
        Object.keys(value)
          .sort()
          .map((key) => JSON.stringify(key) + ':' + stable(value[key]))
          .join(',') +
        '}'
      );
    }
    return JSON.stringify(value);
  }

  const isDirty = () => model !== null && stable(form) !== stable(savedForm);

  const issues = (kind) => (model && model.validation && model.validation[kind]) || [];

  function adopt(nextModel, nextTransient) {
    // A save is pending from the click until the host posts its result; background refreshes carry no transient state.
    const hasNewFile = model !== null && model.savedHash !== nextModel.savedHash;
    const editedSinceSubmit = submitted !== null && stable(form) !== submitted;
    const keepDraft =
      model !== null &&
      !nextModel.isLocked &&
      (hasNewFile ? editedSinceSubmit : isDirty());
    model = nextModel;
    // Only the host's explicit result ends a pending save; a background refresh must not re-enable Save.
    if (nextTransient !== undefined && !nextTransient.saving) submitted = null;
    transient = { ...(nextTransient || NO_TRANSIENT), saving: submitted !== null };
    if (!keepDraft) form = normalizeForm(nextModel.form);
    savedForm = normalizeForm(nextModel.form);
    paint();
  }

  function markEdited() {
    // Diagnostics describe the draft that was saved; any edit makes them stale.
    if (model !== null) model.validation = { errors: [], warnings: [] };
    // Rebuilding the form would drop the focused input; only the notices and footer depend on the edit.
    if (noticesHost !== null) noticesHost.replaceChildren(...renderNotices());
    if (footerHost !== null) {
      fillFooter(footerHost);
      trackFooter();
    }
  }

  function saveWorkflow() {
    if (submitted !== null) return;
    submitted = stable(form);
    post('saveForm', { form, baseHash: model.savedHash });
  }

  function repaint(focusPath) {
    nextFocus = focusPath || null;
    paint();
  }

  const designForm = window.MigentWorkflowForm.create({
    getModel: () => model,
    getForm: () => form,
    issues,
    onEdit: markEdited,
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
    if (typeof message.client === 'string' && typeof message.model === 'string') {
      designForm.applyModelPick(index, message.client, message.model);
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
        ...(model.meta.pendingQuestions > 0 ? [{ key: 'questions', label: copy.tab.questions, onSelect: action('answerQuestions') }] : []),
        { key: 'results', label: copy.tab.results, onSelect: action('openResult') },
        { key: 'metrics', label: copy.tab.metrics, onSelect: action('openMetrics') },
        { key: 'workflow', label: copy.tab.workflow },
        { key: 'task', label: copy.tab.task, onSelect: action('openTask') },
      ],
      menuItems: [
        { label: 'Open workflow.yaml', onSelect: () => post('openFile') },
        { label: copy.menu.reloadFromDisk, onSelect: () => post('reload') },
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
    }
    if (transient.error) add(transient.error, 'mg-error');
    for (const [kind, tone] of [['errors', 'mg-error'], ['warnings', 'mg-warn']]) {
      for (const issue of issues(kind)) add(issue.message, tone);
    }
    return nodes;
  }

  function footerOptions() {
    const dirty = isDirty();
    return {
      stateLabel: dirty ? copy.unsavedChanges : '',
      saving: transient.saving,
      canDiscard: dirty,
      canSave: dirty && issues('errors').length === 0,
      onDiscard: () => {
        form = normalizeForm(savedForm);
        paint();
      },
      onSave: saveWorkflow,
    };
  }

  function fillFooter(footer) {
    ui.saveFooter(footerOptions(), footer);
  }

  function renderFooter() {
    footerHost = ui.saveFooter(footerOptions());
    return footerHost;
  }

  function paint() {
    root.replaceChildren();
    noticesHost = null;
    footerHost = null;
    if (model === null) {
      root.append(el('p', copy.loadingWorkflow, 'mg-muted'));
      return;
    }
    noticesHost = ui.notices([]);
    noticesHost.append(...renderNotices());
    root.append(renderHeader(), noticesHost, ...designForm.render());
    if (model.canSave && !model.isLocked) root.append(renderFooter());
    if (nextFocus) {
      const node = root.querySelector('[data-path="' + String(nextFocus).replaceAll('"', '') + '"]');
      if (node) {
        // A new item starts closed; open the cards around its first control so the reader can type into it.
        window.MigentPage.openAround(node);
        node.focus();
      }
      nextFocus = null;
    }
    trackFooter();
  }

  paint();
  const page = connect({ render: (nextModel, nextTransient) => adopt(nextModel, nextTransient) });
})();
