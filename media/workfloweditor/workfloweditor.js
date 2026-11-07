// Workflow editor page. The page edits the workflow as a form (YAML opens the file in the editor); it keeps a local draft and asks the
// host to validate, apply or save it. The Design view's controls live in workflowform.js. Every string is set with
// textContent. The shared helpers in media/shared/page.js and workflowform.js load first (see docs/ui.md).
(function () {
  'use strict';

  const { el, connect, menuButton, icon, trackFooter } = window.MigentPage;
  const ui = window.MigentForm;
  const { emptyForm, normalizeForm } = window.MigentWorkflowForm;
  const root = document.getElementById('root');

  const NO_TRANSIENT = { saving: false, applying: false, error: null };

  let model = null;
  let transient = NO_TRANSIENT;
  let form = emptyForm();
  let savedForm = emptyForm();
  let noticesHost = null;
  let footerHost = null;
  let nextFocus = null;
  let pendingModelPick = null;

  const post = (type, payload) => page.post({ type, ...(payload || {}) });

  // ---------- plain data ----------

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

  function isDirty() {
    if (model === null) return false;
    return stable(form) !== stable(savedForm);
  }

  function issues(kind) {
    return (model && model.validation && model.validation[kind]) || [];
  }

  // ---------- model and repaint ----------

  function adopt(nextModel, nextTransient) {
    const keepDraft = model !== null && isDirty() && model.savedHash === nextModel.savedHash;
    model = nextModel;
    transient = nextTransient || NO_TRANSIENT;
    if (!keepDraft) {
      form = normalizeForm(nextModel.form);
    }
    savedForm = normalizeForm(nextModel.form);
    paint();
  }

  function repaint(focusPath) {
    nextFocus = focusPath || null;
    paint();
  }

  function paint() {
    const previous = captureFocus();
    root.replaceChildren();
    noticesHost = null;
    footerHost = null;
    if (model === null) {
      root.append(el('p', 'Loading the workflow…', 'mg-muted'));
      return;
    }
    root.append(renderHeader());
    noticesHost = el('div', null, 'wf-notices');
    noticesHost.append(...renderNotices());
    root.append(noticesHost);
    root.append(...designForm.render());
    root.append(renderFooter());
    restoreFocus(nextFocus || previous);
    nextFocus = null;
    trackFooter();
  }

  /** Update the header status and the footer without rebuilding the form. */
  function refreshChrome() {
    if (footerHost !== null) {
      fillFooter(footerHost);
      trackFooter();
    }
  }

  function markEdited() {
    // Diagnostics describe the draft that was saved; any edit makes them stale.
    if (model !== null) model.validation = { errors: [], warnings: [] };
    if (noticesHost !== null) noticesHost.replaceChildren(...renderNotices());
    refreshChrome();
  }

  const designForm = window.MigentWorkflowForm.create({
    getModel: () => model,
    getForm: () => form,
    issues,
    onEdit: markEdited,
    repaint,
    pickModel: requestModelPick,
  });

  /** Ask the host for a model choice for one stage; the reply writes the draft and preserves every other edit. */
  function requestModelPick(index) {
    pendingModelPick = index;
    post('pickModel');
  }

  function applyModelPick(message) {
    const index = pendingModelPick;
    pendingModelPick = null;
    if (index === null) return;
    if (typeof message.client !== 'string' || typeof message.model !== 'string') return;
    designForm.applyModelPick(index, message.client, message.model);
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message && message.type === 'modelPicked') applyModelPick(message);
  });

  function captureFocus() {
    const active = document.activeElement;
    if (!active || !active.dataset || !active.dataset.path) return null;
    return { path: active.dataset.path, start: active.selectionStart, end: active.selectionEnd };
  }

  function restoreFocus(target) {
    if (!target) return;
    const node = root.querySelector('[data-path="' + String(target.path).replaceAll('"', '') + '"]');
    if (!node) return;
    node.focus();
    if (typeof node.setSelectionRange === 'function' && typeof target.start === 'number') {
      node.setSelectionRange(target.start, target.end);
    }
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
    items.push({ label: 'New session', onSelect: () => post('run') });
    items.push({ label: 'Duplicate workflow', onSelect: () => post('duplicate') });
    if (model.file) items.push({ label: 'Reload from disk', onSelect: () => post('reload') });
    if (model.file) items.push({ label: 'Reveal in Explorer', onSelect: () => post('reveal') });
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
      form.stages.length + (form.stages.length === 1 ? ' stage' : ' stages'),
      'Stages in this workflow',
    );
    header.append(subtitle);

    const bar = el('div', null, 'mg-tabbar');
    const tabs = el('nav', null, 'mg-tabs');
    tabs.setAttribute('aria-label', 'Workflow editor views');
    const design = el('button', 'Design', 'mg-tab');
    design.type = 'button';
    design.setAttribute('aria-current', 'page');
    // YAML is the file itself: the tab opens it in the VS Code editor instead of a page-made editor.
    const yaml = el('button', 'YAML', 'mg-tab');
    yaml.type = 'button';
    if (model.file) {
      yaml.title = 'Open the YAML file in the editor';
      yaml.addEventListener('click', () => post('openFile'));
    } else {
      yaml.disabled = true;
      yaml.title = 'Save the workflow first; it has no file yet';
    }
    tabs.append(design, yaml);
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
    const items = el('ul', null, 'mg-list wf-issue-list');
    for (const issue of list) {
      const item = el('li');
      const jump = el('button', issue.message, 'mg-btn mg-btn--link');
      jump.type = 'button';
      jump.addEventListener('click', () => {
        if (issue.path === 'yaml') post('openFile');
        else repaint(issue.path);
      });
      item.append(jump);
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
    post('saveForm', { form, baseHash: model.savedHash });
  }

  function discardChanges() {
    form = normalizeForm(savedForm);
    paint();
  }

  function action(label, kind, onClick, isDisabled) {
    return ui.button(label, { kind, onClick, disabled: Boolean(isDisabled) });
  }

  function renderFooter() {
    const footer = el('footer', null, 'mg-footer wf-footer');
    footerHost = footer;
    fillFooter(footer);
    return footer;
  }

  function fillFooter(footer) {
    footer.replaceChildren();
    const dirty = isDirty();
    const state = el('span', null, 'wf-save-state');
    // A clean, saved workflow shows nothing; only unsaved or never-saved states are worth a label.
    if (dirty || model.mode === 'new') {
      state.append(icon('circle'), dirty ? 'Unsaved changes' : 'Not saved yet');
    }
    footer.append(state);

    const actions = el('div', null, 'wf-footer-actions');
    actions.append(action('Discard changes', 'secondary', discardChanges, !dirty || transient.saving || transient.applying));
    const cannotSave = issues('errors').length > 0;
    actions.append(
      action(
        transient.saving ? 'Saving…' : 'Save workflow',
        'primary',
        saveWorkflow,
        !dirty || cannotSave || transient.saving || transient.applying,
      ),
    );
    footer.append(actions);
  }

  // ---------- start ----------

  paint();
  const page = connect({
    render(nextModel, nextTransient) {
      adopt(nextModel, nextTransient);
    },
  });
})();
