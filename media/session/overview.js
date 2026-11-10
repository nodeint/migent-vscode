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
    const row = el('div', null, 'mg-actions');
    if (actions.primary !== null) row.append(actionButton(actions.primary, 'primary'));
    for (const name of actions.secondary) row.append(actionButton(name, name === 'stop' ? 'danger' : 'secondary'));
    return row;
  }

  /** The Status badge: the shared state icon and tone, with the Overview copy's label. */
  function stateBadge(summary) {
    const states = header.sessionStates;
    return { ...(states[summary.state] || states.unknown), text: text.status.state[summary.state] || summary.state };
  }

  /** The sentence under the badge: the state's reason, with the facts that explain it. */
  function reasonOf(summary) {
    if (summary.state === 'unknown') {
      return (summary.unknownReason !== null && text.status.unknown[summary.unknownReason]) ||
        text.status.reason.unknown;
    }
    if (summary.state === 'running' && summary.runningStage !== null) {
      return text.status.runningStage(summary.runningStage);
    }
    if (summary.state === 'question' && summary.pendingQuestions > 0) {
      return text.status.pending(summary.pendingQuestions);
    }
    return text.status.reason[summary.state];
  }

  /** `HH:MM` in UTC, so the page shows one clock whatever the reader's zone. */
  function utcTime(ms) {
    return Number.isFinite(ms) ? new Date(ms).toISOString().slice(11, 16) : null;
  }

  function factLine(value, className) {
    return el('p', value, className || 'mg-muted');
  }

  function factsOf(summary) {
    const lines = [];
    if (summary.runningSummary !== null) lines.push(factLine(text.status.update(summary.runningSummary)));
    for (const blocked of summary.blocked) {
      lines.push(factLine(text.status.blockedAt(blocked.stageId, blocked.attempt)));
      if (blocked.blocker !== null) lines.push(factLine(text.status.blocker(blocked.blocker), 'mg-warn'));
    }
    if (summary.quotaResetAt !== null) {
      const time = utcTime(summary.quotaResetAt);
      if (time !== null) lines.push(factLine(text.status.quotaReset(time)));
    }
    if (summary.pendingQuestions > 0 && summary.state !== 'question') {
      lines.push(factLine(text.status.pending(summary.pendingQuestions)));
    }
    if (summary.latestExecution !== null) {
      const execution = summary.latestExecution;
      lines.push(
        factLine(text.status.latest(execution.stage, execution.attempt, execution.status || text.status.unknownExecution)),
      );
      if (execution.decision !== null) lines.push(factLine(text.status.decision(execution.decision)));
    }
    return lines;
  }

  function renderStatus(model) {
    const { summary, actions } = model;
    const children = [];
    const line = el('div', null, 'mg-actions');
    line.append(ui.statusIndicator(stateBadge(summary)), el('span', reasonOf(summary), 'mg-muted'));
    children.push(line, ...factsOf(summary));
    if (actions.primary !== null || actions.secondary.length > 0) children.push(actionRow(actions));
    return ui.section(text.status.title, { surface: true, children });
  }

  function render(root, model, host) {
    page = host;
    const stack = el('div', null, 'mg-stack');
    const activity = window.MigentSessionOverviewProgress.renderActivity(model);
    stack.append(renderStatus(model), window.MigentSessionOverviewProgress.renderProgress(model));
    if (activity !== null) stack.append(activity);
    const results = el('div');
    window.MigentSessionResults.render(results, model, page);
    stack.append(...results.children);
    root.replaceChildren(stack);
  }

  window.MigentSessionOverview = { render };
})();
