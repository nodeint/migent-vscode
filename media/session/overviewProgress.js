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

  function countText(count) {
    return tokenFormat.format(count).replace('K', 'k');
  }

  function tipped(label, tip) {
    const node = el('span', label);
    if (tip) node.setAttribute('data-tip', tip);
    return node;
  }

  /**
   * The usage cluster `M$ | X in · Y out | Z cw · N cr`. Every figure is one field and nothing is added together; a
   * zero is shown, a null is left out together with a group (and its bar) that ends up empty. `options.cost` is the
   * cost (null leaves the group out), `options.costMissing` the attempts without one: a positive value makes it
   * `M$+`. Null when there is nothing to show.
   */
  function usageNode(usage, options) {
    if (!usage) return null;
    const copy = text.progress.usage;
    const cost = options && options.cost;
    const costMissing = (options && options.costMissing) || 0;
    const groups = [];
    if (isNumber(cost)) {
      const amount = cost.toFixed(2);
      groups.push([tipped(
        costMissing > 0 ? copy.costPartial(amount) : copy.cost(amount),
        costMissing > 0 ? copy.costMissingTip(costMissing) : null,
      )]);
    }
    const tokens = [];
    if (isNumber(usage.inputTokens)) tokens.push(tipped(copy.input(countText(usage.inputTokens))));
    if (isNumber(usage.outputTokens)) {
      const tip = isNumber(usage.reasoningTokens)
        ? copy.outputTipReasoning(countText(usage.reasoningTokens))
        : copy.outputTip;
      tokens.push(tipped(copy.output(countText(usage.outputTokens)), tip));
    }
    groups.push(tokens);
    const cache = [];
    if (isNumber(usage.cacheWriteTokens)) {
      cache.push(tipped(copy.cacheWrite(countText(usage.cacheWriteTokens)), copy.cacheWriteTip));
    }
    if (isNumber(usage.cacheReadTokens)) {
      cache.push(tipped(copy.cacheRead(countText(usage.cacheReadTokens)), copy.cacheReadTip));
    }
    groups.push(cache);
    return ui.timeline.figures(groups);
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
      ui.timeline.sub([entry.model, entry.effort], usageNode(usage, { cost: usage && usage.costUsd })),
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
   * The section head's trailing totals: `active` (the sum of the attempt durations) and `wall` (the session's elapsed
   * time) above the summed usage cluster. Each part is left out when unknown; null when nothing is known.
   */
  function totalsNode(totals) {
    const times = [];
    const active = durationText(totals.activeSeconds);
    const wall = durationText(totals.wallSeconds);
    if (active !== null) times.push(text.progress.active(active));
    if (wall !== null) times.push(text.progress.wall(wall));
    const usage = totals.usage
      ? usageNode(totals.usage, { cost: totals.usage.costUsd, costMissing: totals.costMissing })
      : null;
    return ui.timeline.totals([times.length > 0 ? el('span', times.join(' · ')) : null, usage]);
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
      note: progress.kind === 'stages' ? text.progress.note : text.progress.roleNote,
      count: built.attempts.length >= 1 ? text.progress.attempts(built.attempts.length) : undefined,
      actions: totals === null ? undefined : [totals],
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
