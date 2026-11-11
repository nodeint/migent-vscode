// Overview tab of the Session page. It composes the fixed section order and owns the Status block; the results
// blocks keep their renderer in `results.js`. Read-only: it sends closed session actions only, never a path or a
// command. Every string is set with textContent. The shared kit in media/shared loads first.
(function () {
  'use strict';

  const ui = window.MigentUi;
  const { el } = ui;
  const header = window.MigentSessionHeader;
  const copy = window.MigentCopy;
  const text = window.MigentSessionOverviewCopy;

  let page = null;

  /** The label of an action, from the shared copy when it already names it. */
  function actionLabel(name) {
    if (name === 'showLog') return copy.menu.viewLog;
    if (name === 'completeSession') return copy.menu.completeSession;
    return text.actions[name] || name;
  }

  function actionButton(name, kind) {
    const hint = text.actionHints[name];
    return ui.button(actionLabel(name), {
      kind,
      size: 'md',
      ...(hint ? { title: hint } : {}),
      onClick: () => page.send({ intent: 'sessionAction', action: name }),
    });
  }

  /** At most one primary action, then the ordered secondary actions; Stop is the only danger. */
  function actionRow(actions) {
    const children = [];
    if (actions.primary !== null) children.push(actionButton(actions.primary, 'primary'));
    for (const name of actions.secondary) children.push(actionButton(name, name === 'stop' ? 'danger' : 'secondary'));
    return ui.actions(children);
  }

  /** The Status badge: the shared state icon and tone, with the Overview copy's label. */
  function stateBadge(summary) {
    const states = header.sessionStates;
    return { ...(states[summary.state] || states.unknown), text: text.status.state[summary.state] || summary.state };
  }

  /** The state line is shown only when it says more than the header badge already does. */
  function reasonOf(summary) {
    if (summary.state === 'unknown') {
      return (summary.unknownReason !== null && text.status.unknown[summary.unknownReason]) || text.status.reason.unknown;
    }
    if (summary.state === 'question') {
      return summary.pendingQuestions > 0 ? text.status.pending(summary.pendingQuestions) : text.status.reason.question;
    }
    const parts = [];
    if (summary.state === 'running' && summary.runningStage !== null) {
      parts.push(text.status.runningStage(summary.runningStage));
    }
    if (summary.state === 'blocked') parts.push(text.status.reason.blocked);
    if (summary.state === 'failed') parts.push(text.status.reason.failed);
    if (summary.pendingQuestions > 0) parts.push(text.status.pending(summary.pendingQuestions));
    return parts.length > 0 ? parts.join(' ') : null;
  }

  /** `HH:MM` in UTC, so the page shows one clock whatever the reader's zone. */
  function utcTime(ms) {
    return Number.isFinite(ms) ? new Date(ms).toISOString().slice(11, 16) : null;
  }

  /** A status icon only: the tooltip names the state, so color is never the only signal. */
  function executionStatus(status) {
    const state = status || 'unknown';
    return ui.statusIndicator({
      ...(header.sessionStates[state] || header.sessionStates.unknown),
      text: text.progress.state[state] || state,
      compact: true,
    });
  }

  /** The quiet facts of the Status block, as one key-value grid. */
  function pairsOf(summary) {
    const pairs = [];
    if (summary.latestExecution !== null) {
      const execution = summary.latestExecution;
      pairs.push({
        label: text.status.labels.latestExecution,
        value: text.status.execution(execution.stage, execution.attempt),
        tools: [executionStatus(execution.status)],
      });
      if (execution.decision !== null) {
        pairs.push({ label: text.status.labels.decision, value: execution.decision });
      }
    }
    for (const blocked of summary.blocked) {
      pairs.push({
        label: text.status.labels.blockedIn,
        value: text.status.execution(blocked.stageId, blocked.attempt),
      });
      if (blocked.blocker !== null) {
        pairs.push({ label: text.status.labels.blocker, value: blocked.blocker, tone: 'warn' });
      }
    }
    if (summary.quotaResetAt !== null) {
      const time = utcTime(summary.quotaResetAt);
      if (time !== null) {
        pairs.push({ label: text.status.labels.quotaResets, value: text.status.quotaReset(time) });
      }
    }
    if (summary.runningSummary !== null) {
      pairs.push({ label: text.status.labels.latestUpdate, value: summary.runningSummary });
    }
    return pairs;
  }

  /** The edge tone of an attention state; a calm state keeps the plain surface. */
  function accentOf(state) {
    if (state === 'failed') return 'error';
    if (state === 'blocked' || state === 'question' || state === 'unknown') return 'warn';
    return undefined;
  }

  function renderStatus(model) {
    const { summary, actions } = model;
    const children = [];
    const reason = reasonOf(summary);
    if (reason !== null) {
      children.push(ui.actions([ui.statusIndicator(stateBadge(summary)), el('span', reason, 'mg-muted')]));
    }
    const pairs = pairsOf(summary);
    if (pairs.length > 0) children.push(ui.keyValues(pairs));
    if (actions.primary !== null || actions.secondary.length > 0) children.push(actionRow(actions));
    return ui.section(text.status.title, {
      note: text.status.note,
      surface: true,
      accent: accentOf(summary.state),
      children,
    });
  }

  function render(root, model, host) {
    page = host;
    const parts = [renderStatus(model), window.MigentSessionOverviewProgress.renderProgress(model)];
    const activity = window.MigentSessionOverviewProgress.renderActivity(model);
    if (activity !== null) parts.push(activity);
    const results = el('div');
    window.MigentSessionResults.render(results, model, page);
    parts.push(...results.children);
    root.replaceChildren(ui.stack(parts));
  }

  window.MigentSessionOverview = { render };
})();
