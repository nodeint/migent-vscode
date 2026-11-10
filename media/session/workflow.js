// Workflow tab of the Session page: the workflow.yaml of one session as the shared workflow form (workflowForm.js).
// The form is locked once a stage has run; before that it keeps a local draft and asks the host to save it. Every
// string is set with textContent.
(function () {
  'use strict';

  const { trackFooter } = window.MigentPage;
  const copy = window.MigentCopy;
  const text = window.MigentSessionWorkflowCopy;
  const { emptyForm, normalizeForm } = window.MigentWorkflowForm;
  const draftPage = window.MigentDraftPage;
  const ui = window.MigentUi;
  const { el, controlOf, revealControl } = ui;

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

  /**
   * How an issue is shown: a link when the mounted form drew a control for its path, plain text otherwise. The path is
   * mapped to the form's control path first; the form itself decides which controls exist.
   */
  function resolveIssue(issue) {
    const path = window.MigentWorkflowModel.formPathOf(unit.form, issue.path);
    if (controlOf(root, path) === null) return { text: issue.message };
    return {
      text: issue.message,
      activate: () => {
        const node = controlOf(root, path);
        if (node) revealControl(node);
      },
    };
  }

  function renderNotices() {
    const nodes = [];
    if (model.state === 'invalid') nodes.push(ui.alertLine(text.invalid(model.readError), { tone: 'error' }));
    if (model.state === 'unreadable') nodes.push(ui.alertLine(text.unreadable(model.readError), { tone: 'error' }));
    if (model.state === 'unsupported') nodes.push(ui.alertLine(text.unsupported(model.schemaVersion), { tone: 'warn' }));
    if (model.isLocked) {
      nodes.push(ui.banner({ tone: 'warn', lines: [text.locked.title, text.locked.body(model.ranStages)] }));
    }
    if (transient.error) nodes.push(ui.alertLine(transient.error, { tone: 'error' }));
    const errors = issues('errors');
    if (errors.length > 0) {
      nodes.push(ui.issueBanner({ tone: 'error', summary: copy.issues.problems(errors.length), issues: errors, resolve: resolveIssue }));
    }
    const warnings = issues('warnings');
    if (warnings.length > 0) {
      nodes.push(ui.issueBanner({ tone: 'warn', summary: copy.issues.warnings(warnings.length), issues: warnings, resolve: resolveIssue }));
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
    // Filled once the form is mounted, so an issue is a link only when its control was drawn.
    chrome.fillNotices();
    if (model.canSave && !model.isLocked) root.append(chrome.footer());
    if (nextFocus) {
      const node = root.querySelector('[data-path="' + String(nextFocus).replaceAll('"', '') + '"]');
      if (node) {
        // A new item starts closed; open the cards around its first control so the reader can type into it.
        ui.openAround(node);
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
