// Progress and Latest activity of the Overview tab. Read-only rows: a row is never a button and sends no intent.
// The shared kit in media/shared loads first; this file loads after `overviewCopy.js`.
(function () {
  'use strict';

  const ui = window.MigentUi;
  const header = window.MigentSessionHeader;
  const text = window.MigentSessionOverviewCopy;

  /** The shared state map, so a Progress row and the header badge agree; Completed stays icon-only. */
  function statusOf(state) {
    const base = header.sessionStates[state] || header.sessionStates.unknown;
    return { ...base, text: text.progress.state[state] || state, compact: state === 'completed' };
  }

  function stageCard(row, index) {
    return ui.itemCard({
      number: index + 1,
      title: row.id,
      summary: [
        row.attempts === null ? '' : text.progress.attempt(row.attempts),
        row.decision === null ? '' : text.progress.decision(row.decision),
      ],
      status: statusOf(row.state),
      tone: row.isCurrent ? 'info' : undefined,
    });
  }

  function executionCard(row, index) {
    return ui.itemCard({
      number: index + 1,
      title: row.stage || row.executionId,
      summary: [
        text.progress.attempt(row.attempt),
        row.decision === null ? '' : text.progress.decision(row.decision),
      ],
      status: statusOf(row.state),
      tone: row.isCurrent ? 'info' : undefined,
    });
  }

  function renderProgress(model) {
    const progress = model.progress;
    if (progress.kind === 'empty') {
      return ui.section(text.progress.title, {
        note: text.progress.note,
        children: [ui.empty(text.progress.empty)],
      });
    }
    const cards = progress.kind === 'stages' ? progress.rows.map(stageCard) : progress.rows.map(executionCard);
    const children = cards.length === 0 ? [ui.empty(text.progress.empty)] : [ui.stack(cards, { gap: 'card' })];
    return ui.section(text.progress.title, {
      note: progress.kind === 'stages' ? text.progress.note : text.progress.roleNote,
      count: cards.length === 0 ? undefined : String(cards.length),
      children,
    });
  }

  /** The block is absent unless the host read events, which it does only while the session is Running. */
  function renderActivity(model) {
    if (!model.activity.visible) return null;
    const children = model.activity.lines.length === 0
      ? [ui.empty(text.activity.empty)]
      : [ui.plainList(model.activity.lines, { mono: true })];
    return ui.section(text.activity.title, { note: text.activity.note, surface: true, children });
  }

  window.MigentSessionOverviewProgress = { renderProgress, renderActivity };
})();
