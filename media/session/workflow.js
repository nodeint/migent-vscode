// Workflow tab of the Session page: the workflow.yaml of one session as the shared workflow form (workflowForm.js).
// The form is locked once a stage has run; before that it keeps a local draft and asks the host to save it. Every
// string is set with textContent.
(function () {
  'use strict';

  const { el, icon, trackFooter } = window.MigentPage;
  const copy = window.MigentCopy;
  const text = window.MigentSessionWorkflowCopy;
  const { emptyForm, normalizeForm } = window.MigentWorkflowForm;
  const draftPage = window.MigentDraftPage;

  const NO_TRANSIENT = { saving: false, applying: false, error: null };

  let page = null;
  let root = null;
  let model = null;
  let transient = NO_TRANSIENT;
  const unit = draftPage.createUnit({ empty: emptyForm, normalize: normalizeForm });
  let nextFocus = null;

  const post = (type, payload) => page.post({ type, ...(payload || {}) });

  const isDirty = () => model !== null && unit.isDirty();

  const issues = (kind) => (model && model.validation && model.validation[kind]) || [];

  function adopt(nextModel, nextTransient) {
    // A save is pending from the click until the host posts its result; background refreshes carry no transient state.
    const hasNewFile = model !== null && model.savedHash !== nextModel.savedHash;
    const editedSinceSubmit = unit.editedSinceSubmit();
    const keepDraft =
      model !== null &&
      !nextModel.isLocked &&
      (hasNewFile ? editedSinceSubmit : isDirty());
    model = nextModel;
    // Only the host's explicit result ends a pending save; a background refresh must not re-enable Save.
    if (nextTransient !== undefined && !nextTransient.saving) unit.submitted = null;
    transient = { ...(nextTransient || NO_TRANSIENT), saving: unit.submitted !== null };
    unit.adopt(nextModel.form, keepDraft);
    paint();
  }

  function markEdited() {
    // Diagnostics describe the draft that was saved; any edit makes them stale.
    if (model !== null) model.validation = { errors: [], warnings: [] };
    // Rebuilding the form would drop the focused input; only the notices and footer depend on the edit.
    chrome.refresh();
  }

  function saveWorkflow() {
    if (unit.submitted !== null) return;
    unit.markSubmitted();
    post('saveForm', { form: unit.form, baseHash: model.savedHash });
  }

  function repaint(focusPath) {
    nextFocus = focusPath || null;
    paint();
  }

  const designForm = window.MigentWorkflowForm.create({
    getModel: () => model,
    getForm: () => unit.form,
    issues,
    onEdit: markEdited,
    repaint,
    pickModel: (index) => picker.request(index),
  });

  const picker = draftPage.createPicker(post, (index, message) => {
    designForm.applyModelPick(index, message.client, message.model);
  });

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
    const add = (message, tone) => {
      const node = el('p', message, 'mg-alert ' + tone);
      nodes.push(node);
    };
    if (model.state === 'invalid') add(text.invalid(model.readError), 'mg-error');
    if (model.state === 'unreadable') add(text.unreadable(model.readError), 'mg-error');
    if (model.state === 'unsupported') add(text.unsupported(model.schemaVersion), 'mg-warn');
    if (model.isLocked) {
      nodes.push(banner('warn', text.locked.title, [text.locked.body(model.ranStages)]));
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
        unit.discard();
        paint();
      },
      onSave: saveWorkflow,
    };
  }

  const chrome = draftPage.createChrome({ renderNotices, footerOptions });

  function paint() {
    if (root === null) return;
    root.replaceChildren();
    chrome.reset();
    if (model === null) {
      root.append(el('p', copy.loadingWorkflow, 'mg-muted'));
      return;
    }
    root.append(chrome.notices(), ...designForm.render());
    if (model.canSave && !model.isLocked) root.append(chrome.footer());
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

  function render(mount, nextModel, nextTransient, host) {
    page = host;
    root = mount;
    adopt(nextModel, nextTransient);
  }

  window.MigentSessionWorkflow = { render };
})();
