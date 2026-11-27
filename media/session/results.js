// Results blocks of the Overview tab. Read-only: it renders the model the extension posts and sends intents that carry
// identity only (a key, a name or a closed action name), never a path or a command. Every string is set with
// textContent. It builds the sections; `overview.js` owns their order. The shared helpers in media/shared load first
// (see docs/ui.md).
(function () {
  'use strict';

  const ui = window.MigentUi;
  const { el } = ui;
  const header = window.MigentSessionHeader;
  const utils = window.MigentUtils;
  const text = window.MigentSessionResultsCopy;

  let page = null;

  const action = (label, intent, kind) => page.action(label, intent, kind);

  /** A section shows its count chip only when it holds two or more items. */
  const countOf = (count) => (count >= 2 ? String(count) : undefined);

  /** A quiet relative time with the absolute time in the tooltip; null when the time is unknown. */
  function timeNode(iso) {
    const described = utils.describeTime(iso);
    if (described === null) return null;
    const node = el('span', described.text);
    node.setAttribute('data-tip', described.title);
    return node;
  }

  /** The path of an output adds information only when it is not `outputs/<name>.<ext>`. */
  function pathAddsInfo(row) {
    if (!row.path.startsWith('outputs/')) return true;
    const rest = row.path.slice('outputs/'.length);
    return rest !== row.label && rest.replace(/\.[^/.]+$/, '') !== row.label;
  }

  function outputMeta(row) {
    const meta = [];
    if (row.state !== 'ok' || pathAddsInfo(row)) meta.push({ text: row.path, mono: true });
    if (row.stage !== null && row.attempt !== null) meta.push(text.outputs.publishedBy(row.stage, row.attempt));
    const time = timeNode(row.publishedAt);
    if (time !== null) meta.push(time);
    return meta;
  }

  function outputCard(row) {
    const base = { leading: 'file', title: row.label, meta: outputMeta(row) };
    if (row.state === 'ok') {
      return ui.itemCard({ ...base, onClick: () => page.send({ intent: 'openOutput', name: row.key }) });
    }
    return ui.itemCard({ ...base, alerts: [ui.chip(text.outputs.state[row.state], { tone: 'warn' })] });
  }

  function renderOutputs(model) {
    const rows = model.outputs.rows;
    const children = [];
    if (rows.length === 0 && !model.outputs.directoryError) {
      children.push(ui.empty(text.outputs.empty));
    } else if (rows.length > 0) {
      children.push(ui.stack(rows.map(outputCard), { gap: 'card' }));
    }
    if (model.outputs.directoryError) {
      children.push(ui.alertLine(text.outputs.unreadable(model.outputs.directoryError), { tone: 'error' }));
    }
    return ui.section(text.outputs.title, { note: text.outputs.note, count: countOf(rows.length), children });
  }

  /**
   * One suggestion as a simple card. A launchable step is a link card that runs it; an invalid or duplicate target
   * opens its workflow file; any other blocked step is a static card with its reason chip.
   */
  function suggestionCard(suggestion) {
    const launch = suggestion.launch;
    const ready = launch.state === 'ready';
    const summary = [suggestion.task || ''];
    for (const by of suggestion.recommendedBy) summary.push(text.recommendation.by(by.stageId, by.reason));
    if (suggestion.children.length > 0) summary.push(text.suggestion.ran(suggestion.children[0].title));
    const chips = suggestion.recommendedBy.length > 0 ? [ui.chip(text.recommendation.recommended, { tone: 'ok' })] : [];
    const card = { title: suggestion.workflow, summary };
    if (ready) {
      return ui.itemCard({
        ...card,
        alerts: chips,
        leading: 'play',
        onClick: () => page.send({ intent: 'openNextStep', workflow: suggestion.workflow }),
      });
    }
    const alerts = [...chips, ui.chip(text.suggestion.block[launch.reason], { tone: 'warn' })];
    if (suggestion.target === 'invalid' || suggestion.target === 'duplicate') {
      return ui.itemCard({
        ...card,
        alerts,
        onClick: () => page.send({ intent: 'openTargetWorkflow', workflow: suggestion.workflow }),
      });
    }
    return ui.itemCard({ ...card, alerts });
  }

  /** One note line for a recommendation entry no card shows; a flagged entry adds its warning in the warn tone. */
  function recommendationNote(note) {
    const workflow = note.workflow === null ? text.recommendation.none : note.workflow;
    const line = text.recommendation.note(note.stageId, workflow, note.reason);
    if (note.warning === null) return ui.alertLine(line, { tone: 'info' });
    return ui.alertLine(text.recommendation.warned(line, note.warning), { tone: 'warn' });
  }

  /** The recommendations beside the cards: entry notes, or one warning line when the file cannot be used. */
  function recommendationNodes(recommendations) {
    if (recommendations.state === 'missing') return [];
    if (recommendations.state !== 'ok') {
      const line = text.recommendation.state[recommendations.state];
      return [ui.alertLine(text.next.withDetail(line, recommendations.detail), { tone: 'warn' })];
    }
    return recommendations.notes.map(recommendationNote);
  }

  /**
   * Next steps show with suggestions, an unusable next.json or any recommendation content; otherwise there is
   * nothing to say. Recommendations are informational: they mark cards and add notes, never a card action.
   */
  function renderNext(model) {
    const next = model.next;
    const recommendations = recommendationNodes(next.recommendations);
    const hasCards = next.state === 'ok' && next.suggestions.length > 0;
    const unusable = next.state !== 'ok' && next.state !== 'missing';
    if (!hasCards && !unusable && recommendations.length === 0) return null;
    const children = [];
    if (hasCards) {
      children.push(ui.stack(next.suggestions.map(suggestionCard), { gap: 'card' }));
    } else if (unusable) {
      const lines = [text.next.state[next.state]];
      if (next.detail !== null) lines.push({ text: next.detail, className: 'mg-muted mg-mono' });
      children.push(
        ui.banner({
          tone: 'warn',
          lines,
          actions: [action(text.next.openFile, { intent: 'openNextFile' }, 'secondary')],
        }),
      );
    }
    if (recommendations.length > 0) children.push(ui.stack(recommendations, { gap: 'card' }));
    const count = next.state === 'ok' ? countOf(next.suggestions.length) : undefined;
    return ui.section(text.next.title, { note: text.next.note, count, children });
  }

  /** The shared state icon and tone for a child state, named by the state the host reports. */
  function childStatus(state) {
    const key = String(state).toLowerCase();
    return { ...(header.sessionStates[key] || header.sessionStates.unknown), text: state };
  }

  function childCard(child) {
    const task = child.task || child.title;
    const meta = [ui.refValue(child.sessionId, { kind: 'id' })];
    if (child.stageId) meta.push(child.stageId);
    const time = timeNode(child.createdAt);
    if (time !== null) meta.push(time);
    return ui.itemCard({
      title: task,
      titleLines: 2,
      meta,
      status: childStatus(child.state),
      onClick: () => page.send({ intent: 'openSession', sessionId: child.sessionId }),
    });
  }

  function renderChildren(children) {
    return ui.section(text.children.title, {
      note: text.children.note,
      count: countOf(children.length),
      children: [ui.stack(children.map(childCard), { gap: 'card' })],
    });
  }

  /** A link-style button that opens what a Details value names. */
  function linkValue(label, message) {
    return ui.button(label, { kind: 'link', size: 'md', onClick: () => page.send(message) });
  }

  /** The parent session row: a link to it while it is retained, else its title and why it cannot be opened. */
  function parentPair(source) {
    const title = source.title || text.fromSession.untitled;
    if (source.availability === 'retained') {
      return { label: text.fromSession.upstream, value: linkValue(title, { intent: 'openSession', sessionId: source.sessionId }) };
    }
    const reason = source.availability === 'hidden' ? text.fromSession.hidden : text.fromSession.notFound;
    return { label: text.fromSession.upstream, value: title + ' — ' + reason };
  }

  /** One handed-over file: its path opens the local copy, or a warning chip says why it cannot. */
  function artifactPair(artifact) {
    if (artifact.localState === 'ok') {
      return { label: artifact.name, value: linkValue(artifact.path, { intent: 'openHandoffFile', name: artifact.name }) };
    }
    const file = el('span');
    file.append(ui.refValue(artifact.path, { kind: 'path' }), ' ', ui.chip(text.fromSession.state[artifact.localState], { tone: 'warn' }));
    return { label: artifact.name, value: file };
  }

  /**
   * The parent session and the files it handed over, as one Details grid of label and value at the end of the page
   * (no section; open until the reader closes it), with links for what opens.
   */
  function renderFromSession(source) {
    const provenance = source.provenance;
    const pairs = [parentPair(source)];
    if (provenance.state === 'ok') pairs.push(...provenance.artifacts.map(artifactPair));
    const details = ui.details(text.fromSession.details, { key: 'from-session-details', open: true, ruled: true });
    details.append(ui.keyValues(pairs));
    if (provenance.state !== 'invalid') return details;
    const children = [details];
    if (provenance.state === 'invalid') {
      children.push(
        ui.banner({
          tone: 'warn',
          lines: [text.fromSession.invalid(provenance.reason)],
          actions: [action(text.fromSession.openManifest, { intent: 'openManifest' }, 'secondary')],
        }),
      );
    }
    return ui.stack(children);
  }

  /** The sections by name; `overview.js` places them. A section with nothing to show is null. */
  function sections(model, host) {
    page = host;
    return {
      outputs: renderOutputs(model),
      next: renderNext(model),
      children: model.children.length > 0 ? renderChildren(model.children) : null,
      fromSession: model.source ? renderFromSession(model.source) : null,
    };
  }

  window.MigentSessionResults = { sections };
})();
