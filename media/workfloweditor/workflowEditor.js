// Workflow editor page. The page edits the workflow as a form (YAML opens the file in the editor); it keeps a local draft and asks the
// host to validate, apply or save it. The Design view's controls live in workflowForm.js. Every string is set with
// textContent. The shared helpers in media/shared/page.js and workflowForm.js load first (see docs/ui.md).
(function () {
  'use strict';

  const { el, connect, menuButton, icon, trackFooter, pageTabs } = window.MigentPage;
  const copy = window.MigentCopy;
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

  /** The control an issue path edits, or the nearest one around it; null when the form has none (such as roles). */
  function controlOfIssue(issue) {
    const parts = window.MigentWorkflowModel.formPathOf(unit.form, issue.path).split('.');
    while (parts.length > 1) {
      const node = controlAt(parts.join('.'));
      if (node) return node;
      parts.pop();
    }
    return null;
  }

  /**
   * Take the reader to the control an issue names. A control inside a closed card is not shown, so the cards that
   * hold it open first (the shared `details` keeps that state across the repaint, so the card stays open), then the
   * control is scrolled to the middle of the view and focused.
   */
  function revealControl(node) {
    window.MigentPage.openAround(node);
    node.scrollIntoView({ block: 'center' });
    node.focus({ preventScroll: true });
  }

  // ---------- header ----------

  function addFact(parent, name, text, title) {
    const item = el('span', null, 'mg-meta-item');
    if (title) item.title = title;
    item.append(icon(name), el('span', text));
    parent.append(item);
  }

  function workflowMenu() {
    const items = [];
    if (model.mode !== 'new') {
      items.push({ label: 'New session', onSelect: () => post('run') });
      items.push({ label: 'Duplicate workflow', onSelect: () => post('duplicate') });
      items.push({ label: 'Delete workflow', onSelect: () => post('delete') });
    }
    if (model.file && model.mode !== 'new') items.push({ label: copy.menu.reloadFromDisk, onSelect: () => post('reload') });
    if (model.file) items.push({ label: copy.menu.revealInExplorer, onSelect: () => post('reveal') });
    return menuButton({ label: '⋯', ariaLabel: 'Workflow actions', items });
  }

  function renderHeader() {
    const header = el('header', null, 'mg-header mg-header--session');
    const row = el('div', null, 'mg-header-row');
    row.append(el('span', 'Workflow', 'mg-eyebrow'));
    header.append(row);

    const title = model.mode === 'new' ? 'New workflow' : model.id || 'Workflow';
    header.append(el('h1', title, 'mg-title'));

    const subtitle = el('p', null, 'mg-subtitle mg-meta');
    if (model.file) addFact(subtitle, 'package', model.file, model.path || undefined);
    addFact(
      subtitle,
      'checklist',
      unit.form.stages.length + (unit.form.stages.length === 1 ? ' stage' : ' stages'),
      'Stages in this workflow',
    );
    header.append(subtitle);

    const bar = el('div', null, 'mg-tabbar');
    // YAML is the file itself: the tab opens it in the VS Code editor instead of a page-made editor.
    const hasFile = Boolean(model.file) && model.mode !== 'new';
    const tabs = pageTabs({
      label: 'Workflow editor views',
      current: 'design',
      tabs: [
        { key: 'design', label: 'Design' },
        {
          key: 'yaml',
          label: 'YAML',
          disabled: !hasFile,
          title: hasFile ? 'Open the YAML file in the editor' : 'Save the workflow first; it has no file yet',
          onSelect: () => post('openFile'),
        },
      ],
    });
    bar.append(tabs, workflowMenu());
    header.append(bar);
    return header;
  }

  // ---------- notices ----------

  function alertLine(text, className, isAlert) {
    const node = el('p', text, 'mg-alert ' + className);
    if (isAlert) node.setAttribute('role', 'alert');
    return node;
  }

  function issueBanner(list, tone, summary) {
    const banner = el('div', null, 'mg-banner mg-banner--' + tone);
    banner.setAttribute('role', tone === 'error' ? 'alert' : 'status');
    const mark = el('span', null, 'mg-banner__icon');
    mark.append(icon(tone === 'error' ? 'error' : 'warning'));
    const body = el('div');
    body.append(el('p', summary));
    const items = el('ul', null, 'mg-list mg-issue-list');
    for (const issue of list) {
      const item = el('li');
      if (issue.path === 'yaml') {
        const jump = el('button', issue.message, 'mg-btn mg-btn--link');
        jump.type = 'button';
        jump.addEventListener('click', () => post('openFile'));
        item.append(jump);
      } else if (controlOfIssue(issue) !== null) {
        const jump = el('button', issue.message, 'mg-btn mg-btn--link');
        jump.type = 'button';
        jump.addEventListener('click', () => {
          const node = controlOfIssue(issue);
          if (node) revealControl(node);
        });
        item.append(jump);
      } else {
        // No control edits this path (a role, say): plain text, not a link that goes nowhere.
        item.append(el('span', issue.message));
      }
      items.append(item);
    }
    body.append(items);
    banner.append(mark, body);
    return banner;
  }

  function renderNotices() {
    const nodes = [];
    if (transient.error) nodes.push(alertLine(transient.error, 'mg-error', true));
    if (model.state === 'invalid') {
      nodes.push(alertLine('This file is not valid YAML: ' + (model.readError || 'unknown error'), 'mg-error', true));
    }
    if (model.state === 'unreadable') {
      nodes.push(alertLine('This file cannot be read: ' + (model.readError || 'unknown error'), 'mg-error', true));
    }
    if (model.state === 'unsupported') {
      nodes.push(
        alertLine(
          'This workflow uses schema ' +
            (model.schemaVersion === null ? 'unknown' : model.schemaVersion) +
            '. The Design view is read-only; edit the YAML file or migrate the workflow with the Migent CLI.',
          'mg-warn',
        ),
      );
    }
    if (model.duplicateOf && model.duplicateOf.length > 0) {
      nodes.push(alertLine('Another workflow file also declares id "' + model.id + '".', 'mg-warn'));
    }
    const errors = issues('errors');
    if (errors.length > 0) nodes.push(issueBanner(errors, 'error', errors.length + ' problem' + (errors.length === 1 ? '' : 's') + ' found'));
    const warnings = issues('warnings');
    if (warnings.length > 0) nodes.push(issueBanner(warnings, 'warn', warnings.length + ' warning' + (warnings.length === 1 ? '' : 's')));
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
      stateLabel: dirty ? copy.unsavedChanges : model.mode === 'new' ? 'Not saved yet' : '',
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
