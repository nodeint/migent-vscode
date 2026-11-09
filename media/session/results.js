// Results tab of the Session page. Read-only: it renders the model the extension posts and sends intents that carry
// identity only (a key, a name or a closed action name), never a path or a command. Every string is set with
// textContent. The shared helpers in media/shared/page.js load first (see docs/ui.md).
(function () {
  'use strict';

  const { el, section, details } = window.MigentPage;
  const copy = window.MigentCopy;
  const text = window.MigentSessionResultsCopy;

  let page = null;

  /** A native button that sends `intent`. `kind` is a base.css button modifier. */
  function action(label, intent, kind) {
    const node = el('button', label, 'mg-btn mg-btn--' + kind);
    node.type = 'button';
    node.addEventListener('click', () => page.send(intent));
    return node;
  }

  const FILE_STATE = { ok: '', missing: copy.file.missing, rejected: copy.file.outsideSession };

  function outputRow(row) {
    const item = el('li');
    if (row.state === 'ok') {
      const node = el('button', null, 'mg-row');
      node.type = 'button';
      node.append(el('span', row.label, 'mg-row-main mg-row-main--action'), el('span', row.path, 'mg-row-meta mg-mono'));
      node.addEventListener('click', () => page.send({ intent: 'openOutput', name: row.key }));
      item.append(node);
    } else {
      const node = el('div', null, 'mg-row');
      node.append(
        el('span', row.label, 'mg-row-main mg-warn'),
        el('span', row.path + FILE_STATE[row.state], 'mg-row-meta mg-mono'),
      );
      item.append(node);
    }
    return item;
  }

  function renderOutputs(model) {
    const node = section(text.outputs.title, 'mg-section');
    if (model.outputs.rows.length === 0 && !model.outputs.directoryError) {
      node.append(el('p', text.outputs.empty, 'mg-muted'));
      return node;
    }
    const list = el('ul', null, 'mg-list');
    for (const row of model.outputs.rows) list.append(outputRow(row));
    node.append(list);
    if (model.outputs.directoryError) {
      node.append(el('p', text.outputs.unreadable(model.outputs.directoryError), 'mg-error'));
    }
    return node;
  }

  function suggestionDetails(suggestion) {
    const node = details('card:' + suggestion.workflow, copy.details);
    let declared = text.suggestion.declared.unknown;
    if (suggestion.declared === true) declared = text.suggestion.declared.yes;
    else if (suggestion.declared === false) declared = text.suggestion.declared.no;
    node.append(el('p', declared, 'mg-muted'));
    if (suggestion.artifacts.length > 0) {
      const list = el('ul', null, 'results-plain-list');
      for (const artifact of suggestion.artifacts) {
        list.append(
          el(
            'li',
            text.suggestion.artifactLine(artifact.name, artifact.output, artifact.path, artifact.availability),
            'mg-mono',
          ),
        );
      }
      node.append(list);
    }
    if (suggestion.target !== 'not-found') {
      node.append(action(text.suggestion.openWorkflow, { intent: 'openTargetWorkflow', workflow: suggestion.workflow }, 'secondary'));
    }
    return node;
  }

  function renderSuggestion(suggestion) {
    const group = el('div');
    const card = el('button', null, 'mg-card');
    card.type = 'button';
    card.append(el('span', suggestion.workflow, 'mg-card-title'));
    if (suggestion.task) card.append(el('span', suggestion.task, 'mg-card-body'));
    if (suggestion.artifacts.length > 0) {
      const tags = el('span', null, 'mg-tags');
      for (const artifact of suggestion.artifacts) tags.append(el('span', artifact.name, 'mg-pill'));
      card.append(tags);
    }
    card.addEventListener('click', () => page.send({ intent: 'openNextStep', workflow: suggestion.workflow }));
    group.append(card);
    const targetNote = text.suggestion.target[suggestion.target];
    if (targetNote) group.append(el('p', targetNote, 'mg-warn results-note'));
    group.append(suggestionDetails(suggestion));
    return group;
  }

  function renderNext(model) {
    const node = section(text.next.title, 'mg-section');
    const next = model.next;
    if (next.state !== 'ok') {
      const message = text.next.withDetail(text.next.state[next.state], next.detail);
      node.append(el('p', message, next.state === 'missing' ? 'mg-muted' : 'mg-warn'));
    } else {
      if (next.suggestions.length === 0) node.append(el('p', text.next.none, 'mg-muted'));
      for (const suggestion of next.suggestions) node.append(renderSuggestion(suggestion));
    }
    if (next.state !== 'missing') {
      const file = details('next-json', text.next.file);
      file.append(action(text.next.openFile, { intent: 'openNextFile' }, 'secondary'));
      node.append(file);
    }
    return node;
  }

  function renderChildren(children) {
    const node = section(text.children.title, 'mg-section');
    const list = el('ul', null, 'mg-list');
    for (const child of children) {
      const task = child.task || child.title;
      const row = el('button', null, 'mg-row');
      row.type = 'button';
      // The page only shortens the task visually (CSS clamp); the text and the tooltip stay complete.
      row.title = task;
      const main = el('span', null, 'mg-row-main');
      main.append(el('span', task, 'results-clamp'), el('span', child.sessionId, 'results-id mg-muted mg-mono'));
      const meta = el('span', null, 'mg-row-meta');
      meta.append(el('span', child.state, 'mg-pill'));
      row.append(main, meta);
      row.addEventListener('click', () => page.send({ intent: 'openSession', sessionId: child.sessionId }));
      const item = el('li');
      item.append(row);
      list.append(item);
    }
    node.append(list);
    return node;
  }

  function renderProvenance(provenance) {
    const node = el('div');
    if (provenance.state === 'none') return node;
    if (provenance.state === 'invalid') {
      node.append(el('p', text.handoff.invalid(provenance.reason), 'mg-warn'));
      node.append(action(text.handoff.openManifest, { intent: 'openManifest' }, 'secondary'));
      return node;
    }
    node.append(el('h3', text.handoff.title));
    const list = el('ul', null, 'results-plain-list');
    for (const artifact of provenance.artifacts) {
      const item = el('li');
      item.append(el('span', text.handoff.artifact(artifact.name, artifact.output), 'mg-mono'));
      if (artifact.localState === 'ok') {
        item.append(action(artifact.path, { intent: 'openHandoffFile', name: artifact.name }, 'link'));
      } else {
        item.append(el('span', artifact.path + FILE_STATE[artifact.localState], 'mg-warn mg-mono'));
      }
      item.append(el('div', text.handoff.sha256(artifact.sha256), 'mg-muted mg-mono'));
      if (artifact.sourcePath) item.append(el('div', text.handoff.sourcePath(artifact.sourcePath), 'mg-muted mg-mono'));
      list.append(item);
    }
    node.append(list);
    return node;
  }

  function renderDetails(source) {
    const node = details('details', copy.details);
    node.append(el('h3', text.source.title));
    if (source.availability === 'retained') {
      const row = el('p');
      row.append(action(source.title || source.sessionId, { intent: 'openSession', sessionId: source.sessionId }, 'link'));
      row.append(el('span', ' ' + source.sessionId, 'mg-muted mg-mono'));
      node.append(row);
    } else {
      node.append(el('p', source.sessionId, 'mg-mono'));
      const hint =
        source.availability === 'hidden'
          ? text.source.hidden
          : text.source.notFound;
      node.append(el('p', hint, 'mg-muted'));
    }
    node.append(renderProvenance(source.provenance));
    return node;
  }

  function render(root, model, host) {
    page = host;
    root.replaceChildren();
    root.append(renderOutputs(model), renderNext(model));
    if (model.children.length > 0) root.append(renderChildren(model.children));
    if (model.source) root.append(renderDetails(model.source));
  }

  window.MigentSessionResults = { render };
})();
