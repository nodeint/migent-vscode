// Results tab of the Session page. Read-only: it renders the model the extension posts and sends intents that carry
// identity only (a key, a name or a closed action name), never a path or a command. Every string is set with
// textContent. The shared helpers in media/shared load first (see docs/ui.md).
(function () {
  'use strict';

  const ui = window.MigentUi;
  const { el, details } = ui;
  const copy = window.MigentCopy;
  const text = window.MigentSessionResultsCopy;

  let page = null;

  const action = (label, intent, kind) => page.action(label, intent, kind);

  const FILE_STATE = { ok: '', missing: copy.file.missing, rejected: copy.file.outsideSession };

  function outputRow(row) {
    if (row.state === 'ok') {
      return ui.listRow({
        main: row.label,
        mainClass: 'mg-row-main--action',
        meta: row.path,
        metaClass: 'mg-mono',
        onClick: () => page.send({ intent: 'openOutput', name: row.key }),
      });
    }
    return ui.listRow({
      main: row.label,
      mainClass: 'mg-warn',
      meta: row.path + FILE_STATE[row.state],
      metaClass: 'mg-mono',
    });
  }

  function renderOutputs(model) {
    const rows = model.outputs.rows;
    const children = [];
    if (rows.length === 0 && !model.outputs.directoryError) {
      children.push(ui.empty(text.outputs.empty));
    } else {
      const list = el('ul', null, 'mg-list');
      for (const row of rows) list.append(outputRow(row));
      children.push(list);
    }
    if (model.outputs.directoryError) children.push(el('p', text.outputs.unreadable(model.outputs.directoryError), 'mg-error'));
    return ui.section(text.outputs.title, { count: String(rows.length), children });
  }

  function suggestionDetails(suggestion) {
    const node = details(copy.details, { key: 'card:' + suggestion.workflow });
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

  /** One frame, two regions: the clickable card on top and, inside the same frame, the Details block under it. */
  function renderSuggestion(suggestion) {
    const group = el('div', null, 'results-suggestion');
    const card = el('button', null, 'mg-card');
    card.type = 'button';
    card.append(el('span', suggestion.workflow, 'mg-card-title'));
    if (suggestion.task) card.append(el('span', suggestion.task, 'mg-card-body'));
    if (suggestion.artifacts.length > 0) {
      const tags = el('span', null, 'mg-tags');
      for (const artifact of suggestion.artifacts) tags.append(ui.pill(artifact.name));
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
    const next = model.next;
    const children = [];
    let note;
    if (next.state !== 'ok') {
      note = text.next.withDetail(text.next.state[next.state], next.detail);
    } else if (next.suggestions.length === 0) {
      children.push(ui.empty(text.next.none));
    } else {
      children.push(...next.suggestions.map(renderSuggestion));
    }
    if (next.state !== 'missing') {
      const file = details(text.next.file, { key: 'next-json' });
      file.append(action(text.next.openFile, { intent: 'openNextFile' }, 'secondary'));
      children.push(file);
    }
    const count = next.state === 'ok' ? String(next.suggestions.length) : undefined;
    return ui.section(text.next.title, { count, note, children });
  }

  function renderChildren(children) {
    const list = el('ul', null, 'mg-list');
    for (const child of children) {
      const task = child.task || child.title;
      list.append(
        ui.listRow({
          // The page only shortens the task visually (CSS clamp); the text and the tooltip stay complete.
          title: task,
          main: [el('span', task, 'results-clamp'), el('span', child.sessionId, 'results-id mg-muted mg-mono')],
          meta: [ui.pill(child.state)],
          onClick: () => page.send({ intent: 'openSession', sessionId: child.sessionId }),
        }),
      );
    }
    return ui.section(text.children.title, { count: String(children.length), children: [list] });
  }

  function renderHandoff(provenance) {
    if (provenance.state === 'none') return null;
    if (provenance.state === 'invalid') {
      return ui.section(text.handoff.title, {
        note: text.handoff.invalid(provenance.reason),
        children: [action(text.handoff.openManifest, { intent: 'openManifest' }, 'secondary')],
      });
    }
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
    return ui.section(text.handoff.title, { count: String(provenance.artifacts.length), children: [list] });
  }

  function renderSource(source) {
    const children = [];
    if (source.availability === 'retained') {
      const row = el('p');
      row.append(action(source.title || source.sessionId, { intent: 'openSession', sessionId: source.sessionId }, 'link'));
      row.append(el('span', ' ' + source.sessionId, 'mg-muted mg-mono'));
      children.push(row);
    } else {
      children.push(el('p', source.sessionId, 'mg-mono'));
      children.push(el('p', source.availability === 'hidden' ? text.source.hidden : text.source.notFound, 'mg-muted'));
    }
    return ui.section(text.source.title, { children });
  }

  function render(root, model, host) {
    page = host;
    root.replaceChildren();
    root.append(renderOutputs(model), renderNext(model));
    if (model.children.length > 0) root.append(renderChildren(model.children));
    if (model.source) {
      root.append(renderSource(model.source));
      const handoff = renderHandoff(model.source.provenance);
      if (handoff) root.append(handoff);
    }
  }

  window.MigentSessionResults = { render };
})();
