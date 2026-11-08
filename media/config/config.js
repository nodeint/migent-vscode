// Configuration page: .migent/config.yaml (Project) and .migent/config.local.yaml (Local) as forms, one draft per tab; YAML
// opens the active tab's real file in the editor. The page keeps each tab's draft and the save intent it started from
// and asks the host to save; the CLI is the only validator. Every string is set with textContent.
// Needs media/shared (page.js, form.js, agentform.js, draftpage.js) and configform.js loaded first (see docs/ui.md).
(function () {
  'use strict';

  const { el, connect, menuButton, icon, pageTabs } = window.MigentPage;
  const copy = window.MigentCopy;
  const text = window.MigentConfigCopy;
  const draftPage = window.MigentDraftPage;
  const configForm = window.MigentConfigForm;
  const root = document.getElementById('root');

  const NO_TRANSIENT = { saving: false, applying: false, error: null };
  const SCOPES = ['project', 'local'];
  const FILES = { project: 'config.yaml', local: 'config.local.yaml' };
  const NO_ISSUES = { errors: [], warnings: [] };

  let model = null;
  let transient = NO_TRANSIENT;
  let active = 'project';
  let nextFocus = null;

  /**
   * Per tab: the draft unit, the save intent (`base`) the draft was started from and the latest disk state the host
   * posted (`disk`). The host reports disk facts only; the page decides whether to keep a draft.
   */
  const tabs = {};
  for (const scope of SCOPES) {
    tabs[scope] = {
      unit: draftPage.createUnit({ empty: configForm.emptyForm, normalize: configForm.normalizeForm }),
      base: { kind: 'create' },
      disk: null,
      /** The diagnostics last shown (as JSON) and the stable draft they describe; a changed draft hides them. */
      shown: null,
      shownDraft: null,
      /** Number of the last save result adopted; a result with a new number is fresh, anything else a repost. */
      resultSeq: 0,
    };
  }

  const post = (type, payload) => page.post({ type, tab: active, ...(payload || {}) });

  const intentOf = (disk) => (disk.exists ? { kind: 'replace', hash: disk.hash } : { kind: 'create' });
  const unitOf = (scope) => tabs[scope].unit;
  const diskOf = (scope) => (model === null ? null : model.tabs[scope]);
  const isDirty = (scope) => model !== null && unitOf(scope).isDirty();

  // ---------- draft transitions ----------

  const hasDiskChanged = (state, disk) => state.disk.exists !== disk.exists || state.disk.hash !== disk.hash;

  /** Start the draft over from the posted disk state: a missing file gives an empty draft with intent `create`. */
  function startFrom(scope, disk) {
    const state = tabs[scope];
    state.base = intentOf(disk);
    state.disk = disk;
    state.unit.adopt(disk.form, false);
  }

  function adoptTab(scope, disk, wasSaved) {
    const state = tabs[scope];
    const unit = state.unit;
    if (state.disk === null) {
      startFrom(scope, disk);
      return;
    }
    if (wasSaved) {
      // Confirmed save: the written file is the new base; edits made after the submit stay as a dirty draft.
      const keep = unit.editedSinceSubmit();
      state.base = intentOf(disk);
      state.disk = disk;
      unit.adopt(disk.form, keep);
      return;
    }
    if (!hasDiskChanged(state, disk)) {
      state.disk = disk;
      return;
    }
    // A clean draft follows the file. A dirty one keeps its draft and its save intent, so Save reports a conflict.
    if (unit.isDirty()) state.disk = disk;
    else startFrom(scope, disk);
  }

  function adopt(nextModel, nextTransient) {
    const result = nextTransient || NO_TRANSIENT;
    const saved = nextTransient && nextTransient.saved;
    const firstModel = model === null;
    model = nextModel;
    if (firstModel) active = nextModel.tab;
    for (const scope of SCOPES) {
      trackValidation(scope, nextModel.tabs[scope].validation, result.result);
      adoptTab(scope, nextModel.tabs[scope], saved === scope);
    }
    // Only the host's explicit result ends a pending save; a background refresh must not re-enable Save.
    if (nextTransient !== undefined && !nextTransient.saving) for (const scope of SCOPES) tabs[scope].unit.submitted = null;
    transient = { ...result, saving: SCOPES.some((scope) => tabs[scope].unit.submitted !== null) };
    paint();
  }

  /** Reload and Discard both adopt the current disk state of one tab. */
  function adoptDisk(scope) {
    startFrom(scope, tabs[scope].disk);
    tabs[scope].unit.submitted = null;
  }

  function reload() {
    adoptDisk(active);
    post('reload');
    paint();
  }

  function discard() {
    adoptDisk(active);
    paint();
  }

  // ---------- issues ----------

  /** The diagnostics of a tab, only while its draft is the one they were produced for. */
  function validationOf(scope) {
    const state = tabs[scope];
    const validation = model && model.tabs[scope].validation;
    if (!validation || state.shownDraft === null) return NO_ISSUES;
    return state.unit.submittedStable(state.shownDraft) ? validation : NO_ISSUES;
  }

  /**
   * Tie a posted validation to a draft. A save's own result (a new `result.seq` for this tab) belongs to the draft
   * that was submitted, even when its diagnostics equal the last ones. Anything else is a repost: it keeps its
   * binding, and a validation the page has not seen is bound to the draft shown now.
   */
  function trackValidation(scope, validation, result) {
    const state = tabs[scope];
    const key = JSON.stringify(validation);
    const hasAny = validation.errors.length > 0 || validation.warnings.length > 0;
    const isFresh = result !== undefined && result.tab === scope && result.seq > state.resultSeq;
    if (isFresh) state.resultSeq = result.seq;
    else if (key === state.shown) return;
    state.shown = key;
    if (!hasAny) state.shownDraft = null;
    else state.shownDraft = isFresh && state.unit.submitted !== null ? state.unit.submitted : draftPage.stable(state.unit.form);
  }

  /** Map a CLI path (by name) onto a control path (by index). */
  function controlPath(scope, cliPath) {
    const form = unitOf(scope).form;
    const parts = cliPath.split('.');
    const kind = parts[0];
    if (kind !== 'agents' && kind !== 'roles') return cliPath;
    const index = form[kind].findIndex((entry) => entry.name === parts[1]);
    if (index < 0) return cliPath;
    const base = kind + '.' + index;
    const rest = parts.slice(2);
    if (rest.length === 0) return base + '.name';
    if (kind === 'agents') {
      if (rest[0] === 'client' && rest[1] === 'options') return base + '.clientOptions';
      if (rest[0] === 'client' || rest[0] === 'model') return base + '.model';
      return base + '.' + rest[0];
    }
    if (rest[0] === 'agent' && rest.length === 1) return base + '.agentMode';
    if (rest[0] === 'agent') {
      if (rest[1] === 'client' && rest[2] === 'options') return base + '.agent.clientOptions';
      return base + '.agent.' + (rest[1] === 'effort' ? 'effort' : 'model');
    }
    return base + '.' + rest[0];
  }

  /** The diagnostic of the current layer for a control; one from the other file never marks a control. */
  function issueOf(path) {
    const tab = validationOf(active);
    for (const [list, warning] of [[tab.errors, false], [tab.warnings, true]]) {
      const hit = list.find((item) => !item.file && controlPath(active, item.path) === path);
      if (hit) return { message: hit.message, warning };
    }
    return undefined;
  }

  const controlAt = (path) => root.querySelector('[data-path="' + String(path).replaceAll('"', '') + '"]');

  function controlOfIssue(item) {
    const parts = controlPath(active, item.path).split('.');
    while (parts.length > 1) {
      const node = controlAt(parts.join('.'));
      if (node) return node;
      parts.pop();
    }
    return null;
  }

  function revealControl(node) {
    window.MigentPage.openAround(node);
    node.scrollIntoView({ block: 'center' });
    node.focus({ preventScroll: true });
  }

  // ---------- forms ----------

  function markEdited() {
    // Diagnostics describe the draft that was saved; `validationOf` hides them once the draft differs.
    chrome.refresh();
  }

  function repaint(focusPath) {
    nextFocus = focusPath || null;
    paint();
  }

  const forms = {};
  for (const scope of SCOPES) {
    forms[scope] = configForm.create({
      scope,
      getModel: () => model,
      getForm: () => unitOf(scope).form,
      getProjectForm: () => unitOf('project').saved,
      // The Project tab marks a unit config.local.yaml overrides: the saved local file, not its draft.
      getLocalForm: () => unitOf('local').saved,
      issueOf,
      onEdit: markEdited,
      repaint,
      pickModel: (token) => picker.request({ scope, token }),
    });
  }

  const picker = draftPage.createPicker(post, (pending, message) => {
    forms[pending.scope].applyModelPick(pending.token, message.client, message.model);
  });

  // ---------- header ----------

  function renderHeader() {
    const header = el('header', null, 'mg-header mg-header--session');
    const row = el('div', null, 'mg-header-row');
    row.append(el('span', text.eyebrow, 'mg-eyebrow'));
    header.append(row, el('h1', model.project || text.eyebrow, 'mg-title'));
    const subtitle = el('p', null, 'mg-subtitle mg-meta');
    const item = el('span', null, 'mg-meta-item');
    item.title = model.tabs[active].path;
    item.append(icon('package'), el('span', FILES[active]));
    subtitle.append(item);
    header.append(subtitle);

    const bar = el('div', null, 'mg-tabbar');
    const hasFile = model.tabs[active].exists;
    const select = (scope) => () => {
      active = scope;
      post('selectTab');
      paint();
    };
    bar.append(
      pageTabs({
        label: text.tabsLabel,
        current: active,
        tabs: [
          { key: 'project', label: text.tabs.project, onSelect: select('project') },
          { key: 'local', label: text.tabs.local, onSelect: select('local') },
          {
            key: 'yaml',
            label: text.tabs.yaml,
            disabled: !hasFile,
            title: hasFile ? text.yaml.open : text.yaml.noLocal,
            onSelect: () => post('openFile'),
          },
        ],
      }),
      menuButton({
        label: '⋯',
        ariaLabel: text.menuLabel,
        items: [{ label: copy.menu.reloadFromDisk, onSelect: reload }],
      }),
    );
    header.append(bar);
    return header;
  }

  // ---------- notices ----------

  function alertLine(message, tone, isAlert) {
    const node = el('p', message, 'mg-alert ' + tone);
    if (isAlert) node.setAttribute('role', 'alert');
    return node;
  }

  function changedNotice() {
    const state = tabs[active];
    const disk = state.disk;
    if (!isDirty(active) || (state.base.kind === 'replace' ? disk.exists && disk.hash === state.base.hash : !disk.exists)) {
      return null;
    }
    let message = text.notice.changed;
    if (state.base.kind === 'replace' && !disk.exists) message = text.notice.deleted;
    else if (state.base.kind === 'create') message = text.notice.created;
    const node = el('div', null, 'mg-banner mg-banner--warn');
    node.setAttribute('role', 'status');
    const mark = el('span', null, 'mg-banner__icon');
    mark.append(icon('warning'));
    const body = el('div');
    body.append(el('p', message));
    const button = window.MigentForm.button(text.notice.reload, { kind: 'secondary', onClick: reload });
    body.append(button);
    node.append(mark, body);
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
    for (const item of list) {
      const line = el('li');
      if (item.file) {
        // From the other layer's file: labelled with it, never a control of this form.
        line.append(el('span', text.notice.otherFile(item.file, item.message)));
      } else if (controlOfIssue(item) !== null) {
        const jump = el('button', item.message, 'mg-btn mg-btn--link');
        jump.type = 'button';
        jump.addEventListener('click', () => {
          const node = controlOfIssue(item);
          if (node) revealControl(node);
        });
        line.append(jump);
      } else {
        line.append(el('span', item.message));
      }
      items.append(line);
    }
    body.append(items);
    banner.append(mark, body);
    return banner;
  }

  function renderNotices() {
    const nodes = [];
    const tab = model.tabs[active];
    const file = FILES[active];
    if (transient.error) nodes.push(alertLine(transient.error, 'mg-error', true));
    if (tab.state === 'invalid') nodes.push(alertLine(text.notice.invalid(file, tab.readError || 'unknown error'), 'mg-error', true));
    if (tab.state === 'unreadable') nodes.push(alertLine(text.notice.unreadable(file, tab.readError || 'unknown error'), 'mg-error', true));
    if (tab.state === 'unsupported') {
      nodes.push(alertLine(text.notice.unsupported(file, tab.schemaVersion === null ? 'unknown' : tab.schemaVersion), 'mg-warn'));
    }
    if (tab.state === 'missing') nodes.push(alertLine(active === 'local' ? text.notice.missingLocal : text.notice.missingProject, 'mg-warn'));
    const changed = changedNotice();
    if (changed) nodes.push(changed);
    const validation = validationOf(active);
    if (validation.errors.length > 0) nodes.push(issueBanner(validation.errors, 'error', text.notice.problems(validation.errors.length)));
    if (validation.warnings.length > 0) nodes.push(issueBanner(validation.warnings, 'warn', text.notice.warnings(validation.warnings.length)));
    return nodes;
  }

  // ---------- footer ----------

  function save() {
    const unit = unitOf(active);
    if (unit.submitted !== null) return;
    unit.markSubmitted();
    post('saveForm', { form: unit.form, base: tabs[active].base });
  }

  function footerOptions() {
    const dirty = isDirty(active);
    const isNew = tabs[active].base.kind === 'create';
    const validation = validationOf(active);
    return {
      stateLabel: dirty ? copy.unsavedChanges : isNew ? text.notSavedYet : '',
      saving: transient.saving,
      saveLabel: text.saveLabel,
      canDiscard: dirty,
      // config.yaml is never created from the page: a project without it is outside this page's scope.
      canSave:
        model.tabs[active].canSave &&
        (dirty || isNew) &&
        (active === 'local' || !isNew) &&
        validation.errors.filter((item) => !item.file).length === 0,
      onDiscard: discard,
      onSave: save,
    };
  }

  const chrome = draftPage.createChrome({ renderNotices, footerOptions });

  // ---------- paint ----------

  function paint() {
    root.replaceChildren();
    chrome.reset();
    if (model === null) {
      root.append(el('p', text.loading, 'mg-muted'));
      return;
    }
    const tab = model.tabs[active];
    root.append(renderHeader(), chrome.notices());
    // A missing Project file has no form of its own, but a draft started from it keeps its form until Reload.
    const hasForm = tab.state === 'ok' || (tab.state === 'missing' && (active === 'local' || isDirty(active)));
    if (hasForm) {
      root.append(...forms[active].render());
      root.append(chrome.footer());
    }
    if (nextFocus) {
      const node = controlAt(nextFocus);
      if (node) {
        // A new item starts closed; open the cards around its first control so the reader can type into it.
        window.MigentPage.openAround(node);
        node.focus();
      }
      nextFocus = null;
    }
    window.MigentPage.trackFooter();
  }

  paint();
  const page = connect({ render: (nextModel, nextTransient) => adopt(nextModel, nextTransient) });
})();
