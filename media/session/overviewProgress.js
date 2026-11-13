// Progress and Latest activity of the Overview tab. Progress is a timeline (no control, no intent): one entry per
// attempt of every stage, in the order they ran, then the stages that never ran. The shared kit in media/shared
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

  const tokenFormat = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

  function isNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function durationText(seconds) {
    return isNumber(seconds) ? utils.formatDuration(seconds * 1000) : null;
  }


  function tipped(label, tip) {
    const node = el('span', label);
    if (tip) node.setAttribute('data-tip', tip);
    return node;
  }

  function countText(count) {
    return tokenFormat.format(count).replace('K', 'k');
  }

  /** The token breakdown `X in · Y out · Z cw · N cr` of the fields that are known; null when none is. */
  function tokensText(usage) {
    const copy = text.progress.usage;
    const parts = [
      [usage.inputTokens, copy.input],
      [usage.outputTokens, copy.output],
      [usage.cacheWriteTokens, copy.cacheWrite],
      [usage.cacheReadTokens, copy.cacheRead],
    ].filter(([count]) => isNumber(count)).map(([count, label]) => label(countText(count)));
    return parts.length === 0 ? null : parts.join(' · ');
  }

  /**
   * Null without metrics. The cost, `M$`, or "no cost record" when the metrics have none; the tooltip carries the token breakdown.
   * `options.costMissing` is the attempts without a cost: a positive value makes it `M$+` and adds a line to the tip.
   */
  function usageNode(usage, options) {
    if (!usage) return null;
    const copy = text.progress.usage;
    const cost = usage ? usage.costUsd : null;
    const costMissing = (options && options.costMissing) || 0;
    const hasCost = isNumber(cost);
    const label = !hasCost ? copy.noCost
      : costMissing > 0 ? copy.costPartial(cost.toFixed(2)) : copy.cost(cost.toFixed(2));
    const tips = [tokensText(usage), hasCost && costMissing > 0 ? copy.costMissingTip(costMissing) : null]
      .filter(Boolean);
    return tipped(label, tips.length > 0 ? tips.join('; ') : null);
  }

  /** The reason label as plain text, or null when the data does not say why the attempt ran. */
  function reasonText(reason) {
    if (!reason) return null;
    if (reason.kind === 'answer') return text.progress.afterAnswer;
    if (reason.kind === 'revise') return text.progress.reviseFrom(reason.from.stage, reason.from.attempt);
    return text.progress.routedFrom(reason.from.stage, reason.from.attempt);
  }

  /** The label of why the attempt ran. `resumes` is only its tooltip, so without a label there is none. */
  function reasonNode(entry) {
    const label = reasonText(entry.reason);
    if (label === null) return null;
    const node = el('span', label, 'mg-muted');
    if (entry.resumes) node.setAttribute('data-tip', text.progress.resumes(entry.resumes.stage, entry.resumes.attempt));
    return node;
  }

  /** The marker tooltip: the state name and the absolute times; the state name also reaches assistive technology. */
  function markerTip(status, entry) {
    const parts = [status.text];
    const started = entry.createdAt ? utils.describeTime(entry.createdAt) : null;
    const finished = entry.completedAt ? utils.describeTime(entry.completedAt) : null;
    if (started !== null) parts.push(text.progress.started(started.title));
    if (finished !== null) parts.push(text.progress.finished(finished.title));
    return parts.join(' · ');
  }

  /** An attempt that ended by asking shows the question state instead of its run state. */
  function markerStatus(entry) {
    return entry.asked ? statusOf('question') : statusOf(entry.state);
  }

  function askedBadge() {
    return ui.statusIndicator({ ...header.sessionStates.question, text: text.progress.asked });
  }

  /**
   * One ran attempt as a timeline entry: the dot (state), the stage with its number, decision, asked badge and
   * reason, the duration, then the model and effort with the usage, and a blocker when there is one.
   */
  function attemptItem(entry, name, tone) {
    const status = markerStatus(entry);
    const main = [name, text.progress.attemptNumber(entry.attempt)];
    if (entry.decision !== null && entry.decision !== undefined) main.push(decisionBadge(entry.decision));
    if (entry.asked) main.push(askedBadge());
    main.push(reasonNode(entry));
    const usage = entry.usage || null;
    return ui.timeline.item({ marker: ui.timeline.marker(status, { tip: markerTip(status, entry) }), tone }, [
      ui.timeline.head(main, [durationText(entry.wallSeconds)]),
      ui.timeline.sub([entry.model, entry.effort, usageNode(usage)]),
      ui.timeline.note(entry.blocker),
      ui.timeline.note(entry.error),
    ]);
  }

  /** A stage that never ran: an empty dot and muted text. */
  function notRunItem(row) {
    const status = statusOf(row.state);
    return ui.timeline.item({ marker: ui.timeline.marker(status), tone: 'muted' }, [ui.timeline.head([row.id])]);
  }

  /**
   * The attempts in the order they ran (by execution order), then the stages that never ran in workflow order. The
   * current stage tones its latest attempt. Returns the entries and the attempts they show.
   */
  function stageItems(rows) {
    const ran = [];
    const notRun = [];
    for (const row of rows) {
      if (row.history.length === 0) {
        notRun.push(notRunItem(row));
        continue;
      }
      const last = row.history.length - 1;
      row.history.forEach((entry, index) => ran.push({
        order: entry.order,
        entry,
        item: attemptItem(entry, row.id, row.isCurrent && index === last ? 'info' : undefined),
      }));
    }
    ran.sort((left, right) => left.order - right.order);
    return { items: [...ran.map((one) => one.item), ...notRun], attempts: ran.map((one) => one.entry) };
  }

  function executionItems(rows) {
    return {
      items: rows.map((row) => attemptItem(row, row.stage || row.executionId, row.isCurrent ? 'info' : undefined)),
      attempts: rows,
    };
  }

  /**
   * The section note: `active` (the sum of the attempt durations), `wall` (the session's elapsed time) and the summed
   * cost, joined by a dot. Each part is left out when unknown; null when nothing is known.
   */
  function totalsNode(totals) {
    const parts = [];
    const active = durationText(totals.activeSeconds);
    const wall = durationText(totals.wallSeconds);
    if (active !== null) parts.push(el('span', text.progress.active(active)));
    if (wall !== null) parts.push(el('span', text.progress.wall(wall)));
    const usage = usageNode(totals.usage, { costMissing: totals.costMissing });
    if (usage) parts.push(usage);
    if (parts.length === 0) return null;
    const node = el('span', null, 'mg-progress-totals');
    parts.forEach((part, index) => {
      if (index > 0) node.append(el('span', ' · '));
      node.append(part);
    });
    return node;
  }

  function renderProgress(model) {
    const progress = model.progress;
    if (progress.kind === 'empty') {
      return ui.section(text.progress.title, {
        note: text.progress.note,
        children: [ui.empty(text.progress.empty)],
      });
    }
    const built = progress.kind === 'stages' ? stageItems(progress.rows) : executionItems(progress.rows);
    const children = built.items.length === 0 ? [ui.empty(text.progress.empty)] : [ui.timeline(built.items)];
    const totals = totalsNode(progress.totals || {});
    return ui.section(text.progress.title, {
      note: totals || (progress.kind === 'stages' ? text.progress.note : text.progress.roleNote),
      count: built.attempts.length >= 1 ? text.progress.attempts(built.attempts.length) : undefined,
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
