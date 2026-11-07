// Results overview page. Read-only: it renders the model the extension posts and sends intents that carry
// identity only (a key, a name or a closed action name), never a path or a command. Every string is set with
// textContent. The shared helpers in media/shared/page.js load first (see docs/ui.md).
(function () {
  'use strict';

  const { el, section, connect, details, sessionHeader } = window.MigentPage;
  const root = document.getElementById('root');

  /** A native button that sends `intent`. `kind` is a base.css button modifier. */
  function action(label, intent, kind) {
    const node = el('button', label, 'mg-btn mg-btn--' + kind);
    node.type = 'button';
    node.addEventListener('click', () => page.send(intent));
    return node;
  }

  function sessionAction(name) {
    return { intent: 'sessionAction', action: name };
  }

  const FILE_STATE = { ok: '', missing: ' (file missing)', rejected: ' (path outside the session)' };

  function renderHeader(model) {
    return sessionHeader(page, {
      state: model.state,
      title: model.title,
      workflowId: model.workflowId,
      meta: model.meta,
      current: 'results',
      tabs: [
        ...(model.meta.pendingQuestions > 0
          ? [{ key: 'questions', label: 'Questions', onSelect: () => page.send(sessionAction('answerQuestions')) }]
          : []),
        { key: 'results', label: 'Results' },
        { key: 'metrics', label: 'Metrics', onSelect: () => page.send(sessionAction('openMetrics')) },
        { key: 'workflow', label: 'Workflow', onSelect: () => page.send(sessionAction('openWorkflow')) },
        { key: 'task', label: 'Task', onSelect: () => page.send(sessionAction('openTask')) },
      ],
      menuItems: [{ label: 'Open questions', onSelect: () => page.send(sessionAction('openQuestions')) }],
    });
  }

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
    const node = section('Outputs', 'mg-section');
    if (model.outputs.rows.length === 0 && !model.outputs.directoryError) {
      node.append(el('p', 'No published outputs.', 'mg-muted'));
      return node;
    }
    const list = el('ul', null, 'mg-list');
    for (const row of model.outputs.rows) list.append(outputRow(row));
    node.append(list);
    if (model.outputs.directoryError) {
      node.append(el('p', 'Cannot read outputs/ (' + model.outputs.directoryError + ')', 'mg-error'));
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

  function suggestionDetails(suggestion) {
    const node = details('card:' + suggestion.workflow, 'Details');
    let declared = 'Declaration could not be read.';
    if (suggestion.declared === true) declared = 'Declared by the workflow.';
    else if (suggestion.declared === false) declared = 'Not declared by the workflow.';
    node.append(el('p', declared, 'mg-muted'));
    if (suggestion.artifacts.length > 0) {
      const list = el('ul', null, 'results-plain-list');
      for (const artifact of suggestion.artifacts) {
        const note = artifact.availability === 'ok' ? '' : ' (' + artifact.availability + ')';
        list.append(el('li', artifact.name + ' <- output ' + artifact.output + ' · ' + artifact.path + note, 'mg-mono'));
      }
      node.append(list);
    }
    if (suggestion.target !== 'not-found') {
      node.append(action('Open workflow file', { intent: 'openTargetWorkflow', workflow: suggestion.workflow }, 'secondary'));
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
    if (TARGET_TEXT[suggestion.target]) group.append(el('p', TARGET_TEXT[suggestion.target], 'mg-warn results-note'));
    group.append(suggestionDetails(suggestion));
    return group;
  }

  function renderNext(model) {
    const node = section('Next steps', 'mg-section');
    const next = model.next;
    if (next.state !== 'ok') {
      const text = NEXT_TEXT[next.state] + (next.detail ? ' (' + next.detail + ')' : '');
      node.append(el('p', text, next.state === 'missing' ? 'mg-muted' : 'mg-warn'));
    } else {
      if (next.suggestions.length === 0) node.append(el('p', 'No suggestions in next.json.', 'mg-muted'));
      for (const suggestion of next.suggestions) node.append(renderSuggestion(suggestion));
    }
    if (next.state !== 'missing') {
      const file = details('next-json', 'next.json');
      file.append(action('Open next.json', { intent: 'openNextFile' }, 'secondary'));
      node.append(file);
    }
    return node;
  }

  function renderChildren(children) {
    const node = section('Child sessions', 'mg-section');
    const list = el('ul', null, 'mg-list');
    for (const child of children) {
      const text = child.task || child.title;
      const row = el('button', null, 'mg-row');
      row.type = 'button';
      // The page only shortens the task visually (CSS clamp); the text and the tooltip stay complete.
      row.title = text;
      const main = el('span', null, 'mg-row-main');
      main.append(el('span', text, 'results-clamp'), el('span', child.sessionId, 'results-id mg-muted mg-mono'));
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
      node.append(el('p', 'Handoff details are not in the expected shape (' + provenance.reason + ').', 'mg-warn'));
      node.append(action('Open manifest', { intent: 'openManifest' }, 'secondary'));
      return node;
    }
    node.append(el('h3', 'Handoff'));
    const list = el('ul', null, 'results-plain-list');
    for (const artifact of provenance.artifacts) {
      const item = el('li');
      item.append(el('span', artifact.name + ' <- output ' + artifact.output + ' · ', 'mg-mono'));
      if (artifact.localState === 'ok') {
        item.append(action(artifact.path, { intent: 'openHandoffFile', name: artifact.name }, 'link'));
      } else {
        item.append(el('span', artifact.path + FILE_STATE[artifact.localState], 'mg-warn mg-mono'));
      }
      item.append(el('div', 'sha256 ' + artifact.sha256, 'mg-muted mg-mono'));
      if (artifact.sourcePath) item.append(el('div', 'source path ' + artifact.sourcePath, 'mg-muted mg-mono'));
      list.append(item);
    }
    node.append(list);
    return node;
  }

  function renderDetails(source) {
    const node = details('details', 'Details');
    node.append(el('h3', 'Source session'));
    if (source.availability === 'retained') {
      const row = el('p');
      row.append(action(source.title || source.sessionId, { intent: 'openSession', sessionId: source.sessionId }, 'link'));
      row.append(el('span', ' ' + source.sessionId, 'mg-muted mg-mono'));
      node.append(row);
    } else {
      node.append(el('p', source.sessionId, 'mg-mono'));
      const hint =
        source.availability === 'hidden'
          ? 'Show more in the Sessions view to load the source.'
          : 'The source session was not found.';
      node.append(el('p', hint, 'mg-muted'));
    }
    node.append(renderProvenance(source.provenance));
    return node;
  }

  function render(model) {
    root.replaceChildren();
    if (model.availability === 'unavailable') {
      root.append(el('h1', 'Session unavailable', 'mg-title'));
      root.append(
        el(
          'p',
          'This session is not loaded, was removed, or is hidden by the session limit. ' + model.sessionId,
          'mg-subtitle',
        ),
      );
      return;
    }
    root.append(renderHeader(model), renderOutputs(model), renderNext(model));
    if (model.children.length > 0) root.append(renderChildren(model.children));
    if (model.source) root.append(renderDetails(model.source));
  }

  const page = connect({ render });
})();
