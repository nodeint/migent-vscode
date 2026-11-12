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

  /** The quiet facts of the Status block, as one key-value grid. */
  function pairsOf(summary) {
    // The latest execution and its decision are shown by Progress, so they are not repeated here.
    const pairs = [];
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

  /**
   * The next action of a Completed session as one line that points to Next steps or says nothing is left; a single
   * runnable step adds nothing here because its Next steps card is the action. The host decided it from the launch state of every suggestion.
   */
  function nextStepNode(nextStep) {
    const words = text.status.nextStep;
    if (nextStep.kind === 'choose') return el('span', words.choose(nextStep.count), 'mg-muted');
    if (nextStep.kind === 'blocked') return el('span', words.blocked, 'mg-muted');
    return el('span', words.done, 'mg-muted');
  }

  function renderStatus(model) {
    const { summary, actions, nextStep } = model;
    const children = [];
    const reason = reasonOf(summary);
    const lead = [ui.statusIndicator(stateBadge(summary))];
    if (reason !== null) lead.push(el('span', reason, 'mg-muted'));
    children.push(ui.actions(lead));
    const pairs = pairsOf(summary);
    if (pairs.length > 0) children.push(ui.keyValues(pairs));
    const buttons = [];
    if (actions.primary !== null) buttons.push(actionButton(actions.primary, 'primary'));
    for (const name of actions.secondary) buttons.push(actionButton(name, name === 'stop' ? 'danger' : 'secondary'));
    if (buttons.length > 0) children.push(ui.actions(buttons));
    if (nextStep && nextStep.kind !== 'run') children.push(nextStepNode(nextStep));
    if (buttons.length === 0 && (!nextStep || nextStep.kind === 'run')) children.push(el('span', text.status.noAction, 'mg-muted'));
    return ui.section(text.status.title, {
      note: text.status.note,
      surface: true,
      accent: accentOf(summary.state),
      children,
    });
  }

  function render(root, model, host) {
    page = host;
    const progress = window.MigentSessionOverviewProgress;
    const results = window.MigentSessionResults.sections(model, page);
    // The one section order: Status, Progress, Latest activity, Outputs, Next steps, Child sessions, then the Details grid of the source session (no section).
    const parts = [
      renderStatus(model),
      progress.renderProgress(model),
      progress.renderActivity(model),
      results.outputs,
      results.next,
      results.children,
      results.fromSession,
    ].filter((part) => part !== null);
    root.replaceChildren(ui.stack(parts));
  }

  window.MigentSessionOverview = { render };
})();
