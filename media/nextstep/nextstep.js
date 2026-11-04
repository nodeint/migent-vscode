// Next step page. It edits one task line and requests Run or Prepare. It sends a task text or an identity only,
// never a path, a command or argv. Every string is set with textContent. The shared helpers in
// media/shared/page.js load first (see docs/ui.md).
(function () {
  'use strict';

  const { el, section, connect } = window.MigentPage;
  const root = document.getElementById('root');
  const NO_TRANSIENT = { pending: null, error: null };

  /** A native button. `intent` may be a function so a click reads the current field text. */
  function action(label, intent, kind, isDisabled) {
    const node = el('button', label, 'mg-btn mg-btn--' + kind);
    node.type = 'button';
    node.disabled = Boolean(isDisabled);
    node.addEventListener('click', () => page.send(typeof intent === 'function' ? intent() : intent));
    return node;
  }

  const AVAILABILITY = { ok: '', missing: ' (file missing)', rejected: ' (path outside the session)' };

  // Launch status: icon, tone and text, so color is never the only signal.
  function statusIndicator(model, transient) {
    let known = { icon: '✓', tone: 'ok', text: 'Ready' };
    if (transient.pending) known = { icon: '●', tone: 'info', text: transient.pending };
    else if (model.launchBlock) known = { icon: '⚠', tone: 'warn', text: 'Blocked' };
    const node = el('span', null, 'mg-status mg-status--' + known.tone);
    const icon = el('span', known.icon);
    icon.setAttribute('aria-hidden', 'true');
    node.append(icon, el('span', known.text));
    return node;
  }

  function renderHeader(model, transient) {
    const header = el('header', null, 'mg-header');
    header.append(statusIndicator(model, transient));
    header.append(el('h1', 'Next: ' + model.target.workflow, 'mg-title'));
    const subtitle = el('p', null, 'mg-subtitle');
    subtitle.append('From ', action(model.sourceTitle, { intent: 'openResults' }, 'link'), ' · ' + model.sourceState);
    header.append(subtitle);
    return header;
  }

  /** A problem the reader must notice stays visible, never inside details. */
  function renderAlerts(model, transient) {
    const alerts = [];
    if (model.launchBlock) alerts.push(el('p', 'Cannot start: ' + model.launchBlock, 'mg-alert mg-warn'));
    if (transient.error) {
      const error = el('p', transient.error, 'mg-alert mg-error');
      error.setAttribute('role', 'alert');
      alerts.push(error);
    }
    return alerts;
  }

  function renderTask(model, input) {
    const node = section('Task', 'mg-section');
    input.type = 'text';
    input.id = 'task';
    input.className = 'mg-input';
    input.value = model.task;
    input.setAttribute('aria-label', 'Task');
    input.addEventListener('input', () => page.send({ intent: 'setTask', task: input.value }));
    node.append(input);
    if (model.isOverridden || model.suggestionChanged) {
      const row = el('div', null, 'mg-actions next-task-notes');
      if (model.isOverridden) row.append(action('Reset to suggested task', { intent: 'resetTask' }, 'secondary'));
      if (model.suggestionChanged) {
        row.append(el('span', 'The suggestion changed since you edited this task.', 'mg-warn'));
      }
      node.append(row);
    }
    return node;
  }

  function artifactRow(artifact) {
    const label = artifact.name + ' ← ' + artifact.output;
    if (artifact.availability === 'ok') {
      const node = el('button', null, 'mg-row');
      node.type = 'button';
      node.append(el('span', label, 'mg-row-main mg-row-main--action mg-mono'), el('span', artifact.path, 'mg-row-meta mg-mono'));
      node.addEventListener('click', () => page.send({ intent: 'openSourceOutput', output: artifact.output }));
      return node;
    }
    const node = el('div', null, 'mg-row');
    node.append(
      el('span', label, 'mg-row-main mg-warn mg-mono'),
      el('span', artifact.path + AVAILABILITY[artifact.availability], 'mg-row-meta mg-warn mg-mono'),
    );
    return node;
  }

  function renderContext(model) {
    const node = section('Context', 'mg-section');
    if (model.artifacts.length === 0) {
      node.append(el('p', 'No context from the source.', 'mg-muted'));
      return node;
    }
    const list = el('ul', null, 'mg-list');
    for (const artifact of model.artifacts) {
      const item = el('li');
      item.append(artifactRow(artifact));
      list.append(item);
    }
    node.append(list);
    return node;
  }

  function renderTarget(model) {
    const node = section('Target workflow', 'mg-section');
    const row = el('div', null, 'mg-actions');
    row.append(el('span', model.target.workflow, 'mg-mono'));
    if (model.target.file) {
      row.append(action(model.target.file, { intent: 'openTargetWorkflow' }, 'link'));
    }
    node.append(row);
    if (model.target.error) {
      const problem = el('div', null, 'mg-actions next-task-notes');
      problem.append(el('span', model.target.error, 'mg-warn'), action('Recheck', { intent: 'recheck' }, 'secondary'));
      node.append(problem);
    }
    return node;
  }

  function renderChildren(model) {
    if (model.children.length === 0) return null;
    const node = section('Sessions', 'mg-section');
    const list = el('ul', null, 'mg-list');
    for (const child of model.children) {
      const item = el('li');
      const row = el('div', null, 'mg-row');
      const meta = el('span', null, 'mg-row-meta next-child-meta');
      meta.append(el('span', child.state, 'mg-pill'));
      if (child.isActive) {
        meta.append(action('Open task', { intent: 'openChildTask', sessionId: child.sessionId }, 'secondary'));
      }
      const main = el('span', null, 'mg-row-main');
      main.append(action(child.title, { intent: 'openSession', sessionId: child.sessionId }, 'link'));
      row.append(main, meta);
      item.append(row);
      list.append(item);
    }
    node.append(list);
    return node;
  }

  function renderFooter(model, transient, input) {
    const footer = el('footer', null, 'mg-footer');
    const isBlocked = Boolean(model.launchBlock) || Boolean(transient.pending);
    const hasActive = model.children.some((child) => child.isActive);
    const task = () => input.value;
    let label = 'Run ' + model.target.workflow;
    if (transient.pending) label = 'Starting…';
    else if (hasActive) label = 'Run another session';
    footer.append(
      action('Back to results', { intent: 'openResults' }, 'secondary'),
      action('Prepare', () => ({ intent: 'prepare', task: task() }), 'secondary', isBlocked),
      action(label, () => ({ intent: 'run', task: task() }), 'primary', isBlocked),
    );
    return footer;
  }

  function render(model, transient = NO_TRANSIENT) {
    const previous = document.getElementById('task');
    const edited =
      previous !== null && document.activeElement === previous
        ? { value: previous.value, start: previous.selectionStart, end: previous.selectionEnd }
        : null;
    root.replaceChildren();
    if (model.availability === 'unavailable') {
      const header = el('header', null, 'mg-header');
      header.append(el('h1', 'Source session unavailable', 'mg-title'), el('p', model.sourceId, 'mg-subtitle mg-mono'));
      header.append(action('Back to results', { intent: 'openResults' }, 'secondary'));
      root.append(header);
      return;
    }
    const input = el('input');
    root.append(renderHeader(model, transient), ...renderAlerts(model, transient));
    root.append(renderTask(model, input), renderContext(model), renderTarget(model));
    const children = renderChildren(model);
    if (children) root.append(children);
    root.append(renderFooter(model, transient, input));
    // The text being typed wins over a background update.
    if (edited) {
      input.value = edited.value;
      input.focus();
      input.setSelectionRange(edited.start, edited.end);
    }
  }

  const page = connect({ render });
})();
