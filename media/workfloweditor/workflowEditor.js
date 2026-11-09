// Workflow editor page. The page edits the workflow as a form (YAML opens the file in the editor); it keeps a local draft and asks the
// host to validate, apply or save it. The Design view's controls live in workflowForm.js. Every string is set with
// textContent. The shared helpers in media/shared/page.js and workflowForm.js load first (see docs/ui.md).
(function () {
  'use strict';

  const { el, connect, trackFooter, pageHeader, controlOf, revealControl } = window.MigentPage;
  const copy = window.MigentCopy;
  const text = window.MigentWorkflowCopy.page;
  const ui = window.MigentForm;
  const { emptyForm, normalizeForm } = window.MigentWorkflowForm;
  const draftPage = window.MigentDraftPage;
  const root = document.getElementById('root');

  const NO_TRANSIENT = { saving: false, applying: false, error: null };

  let model = null;
  let transient = NO_TRANSIENT;
  const unit = draftPage.createUnit({ empty: emptyForm, normalize: normalizeForm });
  let nextFocus = null;

  const post = (type, payload) => page.post({ type, ...(payload || {}) });

  // ---------- plain data ----------

  const isDirty = () => model !== null && unit.isDirty();

  function issues(kind) {
    return (model && model.validation && model.validation[kind]) || [];
  }

  // ---------- model and repaint ----------

  function adopt(nextModel, nextTransient) {
    // This page keeps a dirty draft only while the file on disk is the one the draft was started from.
    const keepDraft = model !== null && isDirty() && model.savedHash === nextModel.savedHash;
    model = nextModel;
    transient = nextTransient || NO_TRANSIENT;
    unit.adopt(nextModel.form, keepDraft);
    paint();
  }

  function repaint(focusPath) {
    nextFocus = focusPath || null;
    paint();
  }

  function paint() {
    const previous = captureFocus();
    root.replaceChildren();
    chrome.reset();
    if (model === null) {
      root.append(el('p', copy.loadingWorkflow, 'mg-muted'));
      return;
    }
    root.append(renderHeader());
    root.append(chrome.notices());
    root.append(...designForm.render());
    // The notices are filled once the form is mounted, so an issue is a link only when its control was drawn.
    chrome.fillNotices();
    root.append(chrome.footer());
    restoreFocus(nextFocus !== null ? { path: nextFocus } : previous);
    nextFocus = null;
    trackFooter();
  }

  function markEdited() {
    // Diagnostics describe the draft that was saved; any edit makes them stale.
    if (model !== null) model.validation = { errors: [], warnings: [] };
    chrome.refresh();
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

  function captureFocus() {
    const active = document.activeElement;
    if (!active || !active.dataset || !active.dataset.path) return null;
    return { path: active.dataset.path, start: active.selectionStart, end: active.selectionEnd };
  }

  function controlAt(path) {
    return root.querySelector('[data-path="' + String(path).replaceAll('"', '') + '"]');
  }

  function restoreFocus(target) {
    if (!target) return;
    const node = controlAt(target.path);
    if (!node) return;
    // A control in a closed card cannot take focus, so the cards around it open first (a new item starts closed).
    window.MigentPage.openAround(node);
    node.focus();
    if (typeof node.setSelectionRange === 'function' && typeof target.start === 'number') {
      node.setSelectionRange(target.start, target.end);
    }
  }

  // ---------- header ----------

  function workflowMenu() {
    const items = [];
    if (model.mode !== 'new') {
      items.push({ label: text.menu.newSession, onSelect: () => post('run') });
      items.push({ label: text.menu.duplicate, onSelect: () => post('duplicate') });
      items.push({ label: text.menu.delete, onSelect: () => post('delete') });
    }
    if (model.file && model.mode !== 'new') items.push({ label: copy.menu.reloadFromDisk, onSelect: () => post('reload') });
    if (model.file) items.push({ label: copy.menu.revealInExplorer, onSelect: () => post('reveal') });
    return { label: text.menuLabel, items };
  }

  function renderHeader() {
    const hasFile = Boolean(model.file) && model.mode !== 'new';
    const facts = [];
    if (model.file) facts.push({ icon: 'package', text: model.file, title: model.path || undefined });
    facts.push({ icon: 'checklist', text: text.stages(unit.form.stages.length), title: text.stagesTip });
    return pageHeader({
      eyebrow: text.eyebrow,
      title: model.mode === 'new' ? text.newTitle : model.id || text.fallbackTitle,
      facts,
      tabs: {
        label: text.tabsLabel,
        current: 'design',
        // YAML is the file itself: the tab opens it in the VS Code editor instead of a page-made editor.
        tabs: [
          { key: 'design', label: text.tabs.design },
          {
            key: 'yaml',
            label: text.tabs.yaml,
            disabled: !hasFile,
            title: hasFile ? text.yamlOpen : text.yamlNoFile,
            onSelect: () => post('openFile'),
          },
        ],
      },
      menu: workflowMenu(),
    });
  }

  // ---------- notices ----------

  /**
   * How an issue is shown. `yaml` opens the file; any other issue is a link only when the form drew a control for
   * it, looked up in the mounted form, and plain text otherwise (a role, say).
   */
  function resolveIssue(issue) {
    if (issue.path === 'yaml') return { text: issue.message, activate: () => post('openFile') };
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
    const unknownError = text.notice.unknownError;
    if (transient.error) nodes.push(ui.alertLine(transient.error, 'mg-error', true));
    if (model.state === 'invalid') nodes.push(ui.alertLine(text.notice.invalid(model.readError || unknownError), 'mg-error', true));
    if (model.state === 'unreadable') nodes.push(ui.alertLine(text.notice.unreadable(model.readError || unknownError), 'mg-error', true));
    if (model.state === 'unsupported') {
      nodes.push(ui.alertLine(text.notice.unsupported(model.schemaVersion === null ? text.notice.unknownSchema : model.schemaVersion), 'mg-warn'));
    }
    if (model.duplicateOf && model.duplicateOf.length > 0) nodes.push(ui.alertLine(text.notice.duplicate(model.id), 'mg-warn'));
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

  // ---------- footer ----------

  function saveWorkflow() {
    post('saveForm', { form: unit.form, baseHash: model.savedHash });
  }

  function discardChanges() {
    unit.discard();
    paint();
  }

  function action(label, kind, onClick, isDisabled) {
    return ui.button(label, { kind, onClick, disabled: Boolean(isDisabled) });
  }

  function footerOptions() {
    const dirty = isDirty();
    return {
      // A clean, saved workflow shows nothing; only unsaved or never-saved states are worth a label.
      stateLabel: dirty ? copy.unsavedChanges : model.mode === 'new' ? text.notSavedYet : '',
      saving: transient.saving,
      busy: transient.applying,
      canDiscard: dirty,
      canSave: (dirty || model.mode === 'new') && issues('errors').length === 0,
      onDiscard: discardChanges,
      onSave: saveWorkflow,
    };
  }

  const chrome = draftPage.createChrome({ renderNotices, footerOptions });

  // ---------- start ----------

  paint();
  const page = connect({
    render(nextModel, nextTransient) {
      adopt(nextModel, nextTransient);
    },
  });
})();
