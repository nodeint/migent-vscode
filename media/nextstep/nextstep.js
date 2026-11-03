// Next step page. It edits one task line and requests Run or Prepare. It sends a task text or an identity only,
// never a path, a command or argv. Every string is set with textContent.
(function () {
  'use strict';

  const vscode = acquireVsCodeApi();
  const root = document.getElementById('root');
  let revision = -1;

  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function send(intent) {
    vscode.postMessage({ ...intent, type: 'intent', revision });
  }

  /** `intent` may be a function so a click reads the current field text. */
  function button(label, intent, className, disabled) {
    const node = el('button', label, className);
    node.type = 'button';
    node.disabled = Boolean(disabled);
    node.addEventListener('click', () => send(typeof intent === 'function' ? intent() : intent));
    return node;
  }

  function section(title) {
    const node = el('section');
    node.append(el('h2', title));
    return node;
  }

  const AVAILABILITY = { ok: '', missing: ' (file missing)', rejected: ' (path outside the session)' };

  function renderTask(model, input) {
    const node = section('Task');
    input.type = 'text';
    input.id = 'task';
    input.value = model.task;
    input.setAttribute('aria-label', 'Task');
    input.addEventListener('input', () => send({ intent: 'setTask', task: input.value }));
    node.append(input);
    const row = el('p');
    if (model.isOverridden) row.append(button('Reset to suggested task', { intent: 'resetTask' }));
    if (model.suggestionChanged) {
      row.append(el('span', 'The suggestion changed since you edited this task.', 'warn'));
    }
    node.append(row);
    return node;
  }

  function renderContext(model) {
    const node = section('Context');
    if (model.artifacts.length === 0) {
      node.append(el('p', 'No context from the source.', 'muted'));
      return node;
    }
    const table = el('table');
    const head = el('tr');
    for (const label of ['Name', 'Source output', 'File']) head.append(el('th', label));
    table.append(head);
    for (const artifact of model.artifacts) {
      const row = el('tr');
      row.append(el('td', artifact.name, 'mono'), el('td', artifact.output, 'mono'));
      const cell = el('td');
      if (artifact.availability === 'ok') {
        cell.append(button(artifact.path, { intent: 'openSourceOutput', output: artifact.output }, 'link'));
      } else {
        cell.append(el('span', artifact.path + AVAILABILITY[artifact.availability], 'warn mono'));
      }
      row.append(cell);
      table.append(row);
    }
    node.append(table);
    return node;
  }

  function renderTarget(model) {
    const node = section('Target workflow');
    const row = el('p');
    row.append(el('span', model.target.workflow, 'mono'));
    if (model.target.file) {
      row.append(document.createTextNode(' '), button(model.target.file, { intent: 'openTargetWorkflow' }, 'link'));
    }
    node.append(row);
    if (model.target.error) {
      node.append(el('p', model.target.error, 'warn'));
      node.append(button('Recheck', { intent: 'recheck' }));
    }
    return node;
  }

  function renderChildren(model) {
    if (model.children.length === 0) return null;
    const node = section('Sessions');
    const list = el('ul');
    for (const child of model.children) {
      const item = el('li');
      item.append(button(child.title, { intent: 'openSession', sessionId: child.sessionId }, 'link'));
      item.append(el('span', ' ' + child.state + ' ', 'muted'));
      if (child.isActive) {
        item.append(button('Open task', { intent: 'openChildTask', sessionId: child.sessionId }));
      }
      list.append(item);
    }
    node.append(list);
    return node;
  }

  function renderFooter(model, transient, input) {
    const footer = el('footer');
    const isBlocked = Boolean(model.launchBlock) || Boolean(transient.pending);
    const hasActive = model.children.some((child) => child.isActive);
    const task = () => input.value;
    footer.append(button('Back to results', { intent: 'openResults' }));
    footer.append(button('Prepare', () => ({ intent: 'prepare', task: task() }), '', isBlocked));
    const label = transient.pending ? 'Starting…' : hasActive ? 'Run another session' : 'Run ' + model.target.workflow;
    footer.append(button(label, () => ({ intent: 'run', task: task() }), 'primary', isBlocked));
    return footer;
  }

  function render(model, transient) {
    const previous = document.getElementById('task');
    const edited =
      previous !== null && document.activeElement === previous
        ? { value: previous.value, start: previous.selectionStart, end: previous.selectionEnd }
        : null;
    root.replaceChildren();
    if (model.availability === 'unavailable') {
      root.append(el('h1', 'Source session unavailable'), el('p', model.sourceId, 'meta mono'));
      root.append(button('Back to results', { intent: 'openResults' }));
      return;
    }
    const input = el('input');
    const header = el('header');
    header.append(el('h1', 'Next: ' + model.target.workflow));
    const meta = el('p', null, 'meta');
    meta.append(document.createTextNode('From '));
    meta.append(button(model.sourceTitle, { intent: 'openResults' }, 'link'));
    meta.append(document.createTextNode(' · ' + model.sourceState));
    header.append(meta);
    root.append(header);
    if (model.launchBlock) root.append(el('p', model.launchBlock, 'warn'));
    if (transient.error) root.append(el('p', transient.error, 'error'));
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

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || message.type !== 'model' || typeof message.revision !== 'number') return;
    if (message.revision <= revision) return;
    revision = message.revision;
    vscode.setState(message.identity);
    render(message.model, message.transient || { pending: null, error: null });
  });

  vscode.postMessage({ type: 'ready' });
})();
