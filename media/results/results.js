// Results overview page. Read-only: it renders the model the extension posts and sends intents that carry
// identity only (a key or a name), never a path or a command. Every string is set with textContent.
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

  function button(label, intent, className) {
    const node = el('button', label, className);
    node.type = 'button';
    node.addEventListener('click', () => send(intent));
    return node;
  }

  function section(title) {
    const node = el('section');
    node.append(el('h2', title));
    return node;
  }

  const FILE_STATE = { ok: '', missing: ' (file missing)', rejected: ' (path outside the session)' };

  function renderHeader(model) {
    const header = el('header');
    header.append(el('h1', model.title));
    const meta = el('p', null, 'meta');
    meta.append(el('span', model.state, 'state'));
    const rest = [model.workflowId, model.completedAt ? 'completed ' + model.completedAt : null, model.sessionId];
    meta.append(document.createTextNode(' · ' + rest.filter((part) => part).join(' · ')));
    header.append(meta);
    return header;
  }

  function renderOutputs(model) {
    const node = section('Outputs');
    if (model.outputs.rows.length === 0 && !model.outputs.directoryError) {
      node.append(el('p', 'No published outputs.', 'muted'));
      return node;
    }
    const list = el('ul');
    for (const row of model.outputs.rows) {
      const item = el('li');
      if (row.state === 'ok') item.append(button(row.label, { intent: 'openOutput', name: row.key }, 'link'));
      else item.append(el('span', row.label, 'warn'));
      item.append(el('span', ' ' + row.path + FILE_STATE[row.state], 'muted mono'));
      list.append(item);
    }
    node.append(list);
    if (model.outputs.directoryError) {
      node.append(el('p', 'Cannot read outputs/ (' + model.outputs.directoryError + ')', 'error'));
    }
    return node;
  }

  const NEXT_TEXT = {
    missing: 'No next-step suggestions (next.json not found).',
    unreadable: 'next.json is unreadable',
    invalid: 'next.json is invalid',
    unsupported: 'next.json has an unsupported schema version',
  };

  const TARGET_TEXT = {
    available: '',
    duplicate: 'More than one workflow file has this id.',
    invalid: 'The target workflow file is invalid.',
    'not-found': 'No workflow with this id in the project.',
  };

  function renderSuggestion(suggestion) {
    const card = el('div', null, 'card');
    const heading = el('h3');
    heading.append(button(suggestion.workflow, { intent: 'openNextStep', workflow: suggestion.workflow }, 'link'));
    card.append(heading);
    if (suggestion.task) card.append(el('p', suggestion.task));
    let declared = 'Declaration could not be read.';
    if (suggestion.declared === true) declared = 'Declared by the workflow.';
    else if (suggestion.declared === false) declared = 'Not declared by the workflow.';
    card.append(el('p', declared, 'muted'));
    if (TARGET_TEXT[suggestion.target]) card.append(el('p', TARGET_TEXT[suggestion.target], 'warn'));
    if (suggestion.artifacts.length > 0) {
      const list = el('ul');
      for (const artifact of suggestion.artifacts) {
        const note = artifact.availability === 'ok' ? '' : ' (' + artifact.availability + ')';
        list.append(el('li', artifact.name + ' <- output ' + artifact.output + ' · ' + artifact.path + note, 'mono'));
      }
      card.append(list);
    }
    if (suggestion.target !== 'not-found') {
      card.append(button('Open workflow file', { intent: 'openTargetWorkflow', workflow: suggestion.workflow }));
    }
    return card;
  }

  function renderNext(model) {
    const node = section('Next steps');
    const next = model.next;
    if (next.state !== 'ok') {
      const text = NEXT_TEXT[next.state] + (next.detail ? ' (' + next.detail + ')' : '');
      node.append(el('p', text, next.state === 'missing' ? 'muted' : 'warn'));
      if (next.canReload) node.append(button('Reload suggestions', { intent: 'reloadSuggestions' }));
      if (next.state !== 'missing') node.append(button('Open next.json', { intent: 'openNextFile' }));
      return node;
    }
    if (next.suggestions.length === 0) node.append(el('p', 'No suggestions in next.json.', 'muted'));
    for (const suggestion of next.suggestions) node.append(renderSuggestion(suggestion));
    node.append(button('Open next.json', { intent: 'openNextFile' }));
    return node;
  }

  function renderProvenance(provenance) {
    const node = el('div');
    if (provenance.state === 'none') return node;
    if (provenance.state === 'invalid') {
      node.append(el('p', 'Handoff details are not in the expected shape (' + provenance.reason + ').', 'warn'));
      node.append(button('Open manifest', { intent: 'openManifest' }));
      return node;
    }
    node.append(el('h3', 'Handoff'));
    const list = el('ul');
    for (const artifact of provenance.artifacts) {
      const item = el('li');
      item.append(el('span', artifact.name + ' <- output ' + artifact.output + ' · ', 'mono'));
      if (artifact.localState === 'ok') {
        item.append(button(artifact.path, { intent: 'openHandoffFile', name: artifact.name }, 'link'));
      } else {
        item.append(el('span', artifact.path + FILE_STATE[artifact.localState], 'warn mono'));
      }
      item.append(el('div', 'sha256 ' + artifact.sha256, 'muted mono'));
      if (artifact.sourcePath) item.append(el('div', 'source path ' + artifact.sourcePath, 'muted mono'));
      list.append(item);
    }
    node.append(list);
    return node;
  }

  function renderSource(source) {
    const node = el('div');
    node.append(el('h3', 'Source session'));
    if (source.availability === 'retained') {
      const row = el('p');
      row.append(
        button(source.title || source.sessionId, { intent: 'openSession', sessionId: source.sessionId }, 'link'),
      );
      row.append(el('span', ' ' + source.sessionId, 'muted mono'));
      node.append(row);
    } else {
      node.append(el('p', source.sessionId, 'mono'));
      const hint =
        source.availability === 'hidden'
          ? 'Show more in the Sessions view to load the source.'
          : 'The source session was not found.';
      node.append(el('p', hint, 'muted'));
    }
    node.append(renderProvenance(source.provenance));
    return node;
  }

  function renderLineage(model) {
    if (!model.source && model.children.length === 0) return null;
    const node = section('Lineage');
    if (model.source) node.append(renderSource(model.source));
    if (model.children.length > 0) {
      node.append(el('h3', 'Child sessions'));
      const list = el('ul');
      for (const child of model.children) {
        const item = el('li');
        item.append(button(child.title, { intent: 'openSession', sessionId: child.sessionId }, 'link'));
        item.append(el('span', ' ' + child.state, 'muted'));
        list.append(item);
      }
      node.append(list);
    }
    return node;
  }

  function render(model) {
    root.replaceChildren();
    if (model.availability === 'unavailable') {
      root.append(el('h1', 'Session unavailable'));
      root.append(
        el(
          'p',
          'This session is not loaded, was removed, or is hidden by the session limit. ' + model.sessionId,
          'meta',
        ),
      );
      return;
    }
    root.append(renderHeader(model), renderOutputs(model), renderNext(model));
    const lineage = renderLineage(model);
    if (lineage) root.append(lineage);
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || message.type !== 'model' || typeof message.revision !== 'number') return;
    if (message.revision <= revision) return;
    revision = message.revision;
    vscode.setState(message.identity);
    render(message.model);
  });

  vscode.postMessage({ type: 'ready' });
})();
