// Progress and Latest activity of the Overview tab. Read-only rows: a row is never a button and sends no intent.
// The shared kit in media/shared loads first; this file loads after `overviewCopy.js`.
(function () {
  'use strict';

  const ui = window.MigentUi;
  const { el } = ui;
  const text = window.MigentSessionOverviewCopy;

  /** The color of a row's state, from the tokens the shared styles already define. */
  const TONES = {
    running: 'info',
    failed: 'error',
    blocked: 'warn',
    cancelled: 'warn',
    stopped: 'muted',
  };

  function statePill(state, isCurrent) {
    const tone = TONES[state] || (isCurrent ? 'info' : null);
    return el('span', text.progress.state[state] || state, 'mg-pill' + (tone ? ' mg-status--' + tone : ''));
  }

  function metaLine(parts) {
    const values = parts.filter((part) => part !== null && part !== '');
    return values.length === 0 ? null : el('span', values.join(' · '), 'mg-row-meta mg-muted');
  }

  function stageRow(row) {
    const main = el('span', null, 'mg-row-main');
    main.append(el('span', row.id), statePill(row.state, row.isCurrent));
    const item = el('li');
    const node = el('div', null, 'mg-row');
    node.append(main);
    const meta = metaLine([
      row.attempts === null ? null : text.progress.attempt(row.attempts),
      row.decision === null ? null : text.progress.decision(row.decision),
    ]);
    if (meta !== null) node.append(meta);
    item.append(node);
    return item;
  }

  function executionRow(row) {
    const main = el('span', null, 'mg-row-main');
    main.append(el('span', row.stage || row.executionId), statePill(row.state, row.isCurrent));
    const item = el('li');
    const node = el('div', null, 'mg-row');
    node.append(main);
    const meta = metaLine([
      text.progress.attempt(row.attempt),
      row.decision === null ? null : text.progress.decision(row.decision),
    ]);
    if (meta !== null) node.append(meta);
    item.append(node);
    return item;
  }

  function renderProgress(model) {
    const progress = model.progress;
    if (progress.kind === 'empty') {
      return ui.section(text.progress.title, { children: [el('p', text.progress.empty, 'mg-empty')] });
    }
    const items = progress.kind === 'stages' ? progress.rows.map(stageRow) : progress.rows.map(executionRow);
    const children = [];
    if (items.length === 0) {
      children.push(el('p', text.progress.empty, 'mg-empty'));
    } else {
      const list = el('ul', null, 'mg-list');
      list.append(...items);
      children.push(list);
    }
    return ui.section(text.progress.title, {
      count: items.length === 0 ? undefined : String(items.length),
      children,
    });
  }

  function activityLine(line) {
    const item = el('li');
    item.append(el('span', line, 'mg-mono'));
    return item;
  }

  /** The block is absent unless the host read events, which it does only while the session is Running. */
  function renderActivity(model) {
    if (!model.activity.visible) return null;
    const children = [];
    if (model.activity.lines.length === 0) {
      children.push(el('p', text.activity.empty, 'mg-empty'));
    } else {
      const list = el('ul', null, 'mg-list');
      list.append(...model.activity.lines.map(activityLine));
      children.push(list);
    }
    return ui.section(text.activity.title, { children });
  }

  window.MigentSessionOverviewProgress = { renderProgress, renderActivity };
})();
