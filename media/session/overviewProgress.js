// Progress and Latest activity of the Overview tab. Progress is a flat list of static rows (no control, no intent):
// one per attempt of every stage, in the order they ran, then the stages that never ran. The shared kit in media/shared
// loads first; this file loads after `overviewCopy.js`.
(function () {
  'use strict';

  const ui = window.MigentUi;
  const { el } = ui;
  const header = window.MigentSessionHeader;
  const utils = window.MigentUtils;
  const text = window.MigentSessionOverviewCopy;

  /** The shared state map, so a Progress row and the header badge agree. The state text is always visible. */
  function statusOf(state) {
    const base = header.sessionStates[state] || header.sessionStates.unknown;
    return { ...base, text: text.progress.state[state] || state };
  }

  /** A decision as a status badge with a tone, never plain text. */
  function decisionBadge(decision) {
    const badge = ui.statusIndicator({ ...header.decisionTone(decision), text: decision });
    badge.setAttribute('data-tip', text.progress.decision(decision));
    return badge;
  }

  function timeNode(iso) {
    const described = utils.describeTime(iso);
    if (described === null) return null;
    const node = el('span', described.text);
    node.setAttribute('data-tip', described.title);
    return node;
  }

  /** The quiet meta of a row: the attempt (only when more than one), the decision badge and the time. */
  function metaOf(attempts, decision, completedAt) {
    const meta = [];
    if (attempts !== null && attempts > 1) meta.push(text.progress.attempt(attempts));
    if (decision !== null) meta.push(decisionBadge(decision));
    const time = timeNode(completedAt);
    if (time !== null) meta.push(time);
    return meta;
  }

  /**
   * The stage rows in the order they ran: one per attempt of every stage, sorted by execution order (the attempt is
   * named only when its stage has several), then one row for each stage that never ran, in workflow order. The current
   * stage tones its latest attempt.
   */
  function stageCards(rows) {
    const ran = [];
    const notRun = [];
    for (const row of rows) {
      const tone = row.isCurrent ? 'info' : undefined;
      if (row.history.length === 0) {
        notRun.push(ui.itemCard({ title: row.id, meta: metaOf(row.attempts, row.decision, row.completedAt), status: statusOf(row.state), tone }));
        continue;
      }
      const several = row.history.length > 1;
      const last = row.history.length - 1;
      row.history.forEach((entry, index) => ran.push({
        order: entry.order,
        card: ui.itemCard({
          title: row.id,
          meta: [...(several ? [text.progress.attempt(entry.attempt)] : []), ...metaOf(null, entry.decision, entry.completedAt)],
          status: statusOf(entry.state),
          tone: index === last ? tone : undefined,
        }),
      }));
    }
    ran.sort((left, right) => left.order - right.order);
    return [...ran.map((entry) => entry.card), ...notRun];
  }

  function executionCard(row) {
    return ui.itemCard({
      title: row.stage || row.executionId,
      meta: [text.progress.attempt(row.attempt), ...metaOf(null, row.decision, row.completedAt)],
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
    const cards = progress.kind === 'stages' ? stageCards(progress.rows) : progress.rows.map(executionCard);
    const children = cards.length === 0 ? [ui.empty(text.progress.empty)] : [ui.stack(cards, { gap: 'card' })];
    return ui.section(text.progress.title, {
      note: progress.kind === 'stages' ? text.progress.note : text.progress.roleNote,
      count: cards.length >= 2 ? String(cards.length) : undefined,
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
