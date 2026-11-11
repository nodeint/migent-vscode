// Results blocks of the Overview tab. Read-only: it renders the model the extension posts and sends intents that carry
// identity only (a key, a name or a closed action name), never a path or a command. Every string is set with
// textContent. The shared helpers in media/shared load first (see docs/ui.md).
(function () {
  'use strict';

  const ui = window.MigentUi;
  const { el } = ui;
  const header = window.MigentSessionHeader;
  const copy = window.MigentCopy;
  const text = window.MigentSessionResultsCopy;

  let page = null;

  const action = (label, intent, kind) => page.action(label, intent, kind);

  function outputCard(row) {
    if (row.state === 'ok') {
      return ui.itemCard({
        leading: 'file',
        title: row.label,
        meta: [{ text: row.path, mono: true }],
        tip: row.path,
        onClick: () => page.send({ intent: 'openOutput', name: row.key }),
      });
    }
    return ui.itemCard({
      leading: 'file',
      title: row.label,
      meta: [{ text: row.path, mono: true }],
      tip: row.path,
      alerts: [ui.chip(text.outputs.state[row.state], { tone: 'warn' })],
    });
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
    return ui.section(text.outputs.title, {
      note: text.outputs.note,
      count: String(rows.length),
      children,
    });
  }

  function declaredOf(suggestion) {
    if (suggestion.declared === true) return text.suggestion.declared.yes;
    if (suggestion.declared === false) return text.suggestion.declared.no;
    return text.suggestion.declared.unknown;
  }

  function artifactLine(artifact) {
    const line = el('span');
    line.append(el('span', text.suggestion.artifactLine(artifact.name, artifact.output) + ' '));
    line.append(ui.refValue(artifact.path, { kind: 'path' }));
    if (artifact.availability !== 'ok') {
      line.append(el('span', ' (' + artifact.availability + ')', 'mg-warn'));
    }
    return line;
  }

  function suggestionCard(suggestion, index) {
    const pairs = [{ label: text.suggestion.declared.label, value: declaredOf(suggestion) }];
    if (suggestion.artifacts.length > 0) {
      pairs.push({ label: text.suggestion.inputs, value: ui.plainList(suggestion.artifacts.map(artifactLine)) });
    }
    const body = [ui.keyValues(pairs)];
    if (suggestion.target !== 'not-found') {
      body.push(
        action(text.suggestion.openWorkflow, { intent: 'openTargetWorkflow', workflow: suggestion.workflow }, 'secondary'),
      );
    }
    const targetNote = text.suggestion.target[suggestion.target];
    return ui.itemCard({
      key: 'card:' + suggestion.workflow,
      number: index + 1,
      title: suggestion.workflow,
      summary: [suggestion.task || ''],
      alerts: targetNote ? [ui.chip(targetNote, { tone: 'warn' })] : [],
      tools: [
        ui.iconButton(text.suggestion.open, {
          icon: 'go-to-file',
          onClick: () => page.send({ intent: 'openNextStep', workflow: suggestion.workflow }),
        }),
      ],
      body,
    });
  }

  function renderNext(model) {
    const next = model.next;
    const children = [];
    if (next.state === 'missing' || (next.state === 'ok' && next.suggestions.length === 0)) {
      children.push(ui.empty(text.next.none));
    } else if (next.state === 'ok') {
      children.push(ui.stack(next.suggestions.map(suggestionCard), { gap: 'card' }));
    } else {
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
    const actions = next.state === 'ok' ? [action(text.next.openFile, { intent: 'openNextFile' }, 'quiet')] : [];
    const count = next.state === 'ok' ? String(next.suggestions.length) : undefined;
    return ui.section(text.next.title, { note: text.next.note, count, actions, children });
  }

  /** The shared state icon and tone for a child state, named by the state the host reports. */
  function childStatus(state) {
    const key = String(state).toLowerCase();
    return {
      ...(header.sessionStates[key] || header.sessionStates.unknown),
      text: state,
      compact: key === 'completed',
    };
  }

  function childCard(child) {
    const task = child.task || child.title;
    return ui.itemCard({
      title: task,
      titleLines: 2,
      tip: task + ' — ' + child.sessionId,
      status: childStatus(child.state),
      tools: [
        ui.refValue.copyButton(text.children.copyId, () =>
          page.send({ intent: 'copyValue', kind: 'sessionId', sessionId: child.sessionId }),
        ),
      ],
      onClick: () => page.send({ intent: 'openSession', sessionId: child.sessionId }),
    });
  }

  function renderChildren(children) {
    return ui.section(text.children.title, {
      note: text.children.note,
      count: String(children.length),
      children: [ui.stack(children.map(childCard), { gap: 'card' })],
    });
  }

  function handoffCard(artifact) {
    const pairs = [
      { label: text.handoff.localCopy, value: artifact.path, mono: true },
      {
        label: text.handoff.sha256,
        value: ui.refValue(artifact.sha256, { kind: 'hash' }),
        tools: [
          ui.refValue.copyButton(text.handoff.copyHash, () =>
            page.send({ intent: 'copyValue', kind: 'handoffHash', name: artifact.name }),
          ),
        ],
      },
    ];
    if (artifact.sourcePath !== null) {
      pairs.push({
        label: text.handoff.sourcePath,
        value: ui.refValue(artifact.sourcePath, { kind: 'path' }),
        tools: [
          ui.refValue.copyButton(text.handoff.copySourcePath, () =>
            page.send({ intent: 'copyValue', kind: 'handoffSourcePath', name: artifact.name }),
          ),
        ],
      });
    }
    return ui.itemCard({
      key: 'handoff:' + artifact.name,
      title: artifact.name,
      summary: [text.handoff.fromOutput(artifact.output)],
      alerts: artifact.localState === 'ok' ? [] : [ui.chip(text.handoff.state[artifact.localState], { tone: 'warn' })],
      tools: artifact.localState === 'ok'
        ? [
            ui.iconButton(text.handoff.openLocal, {
              icon: 'go-to-file',
              onClick: () => page.send({ intent: 'openHandoffFile', name: artifact.name }),
            }),
          ]
        : [],
      body: [ui.keyValues(pairs)],
    });
  }

  function renderHandoff(provenance) {
    if (provenance.state === 'none') return null;
    if (provenance.state === 'invalid') {
      return ui.section(text.handoff.title, {
        note: text.handoff.note,
        children: [
          ui.banner({
            tone: 'warn',
            lines: [text.handoff.invalid(provenance.reason)],
            actions: [action(text.handoff.openManifest, { intent: 'openManifest' }, 'secondary')],
          }),
        ],
      });
    }
    return ui.section(text.handoff.title, {
      note: text.handoff.note,
      count: String(provenance.artifacts.length),
      children: [ui.stack(provenance.artifacts.map(handoffCard), { gap: 'card' })],
    });
  }

  function renderSource(source) {
    const children = [];
    if (source.availability === 'retained') {
      children.push(
        ui.itemCard({
          title: source.title || text.source.untitled,
          meta: [ui.refValue(source.sessionId, { kind: 'id' })],
          tools: [
            ui.refValue.copyButton(text.source.copyId, () =>
              page.send({ intent: 'copyValue', kind: 'sessionId', sessionId: source.sessionId }),
            ),
          ],
          onClick: () => page.send({ intent: 'openSession', sessionId: source.sessionId }),
        }),
      );
    } else {
      const reason = source.availability === 'hidden' ? text.source.hidden : text.source.notFound;
      children.push(
        ui.itemCard({
          title: source.title || text.source.untitled,
          meta: [reason, ui.refValue(source.sessionId, { kind: 'id' })],
        }),
      );
    }
    return ui.section(text.source.title, { note: text.source.note, children });
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
