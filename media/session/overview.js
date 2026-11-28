// Overview tab of the Session page. It composes the fixed section order and owns the Status block; the results
// blocks keep their renderer in `results.js`. Read-only: it sends closed session actions only, never a path or a
// command. Every string is set with textContent. The shared kit in media/shared loads first.
(function () {
  'use strict';

  const ui = window.MigentUi;
  const { el } = ui;
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

  /** The Completed session's next-step line; `null` when the host found no next-step facts. */
  function nextStepLine(nextStep) {
    const words = text.status.nextStep;
    if (!nextStep) return null;
    if (nextStep.kind === 'run') return words.run;
    if (nextStep.kind === 'choose') return words.choose(nextStep.count);
    if (nextStep.kind === 'blocked') return words.blocked;
    return words.done;
  }

  /**
   * The message part of the Status card: what the state means, when the header badge does not already say it.
   * Question leads with the pending count; Blocked, Failed and Unknown with their reason; Completed with its next step.
   */
  function messageOf(summary, nextStep) {
    const pending = summary.pendingQuestions > 0 ? text.status.pending(summary.pendingQuestions) : null;
    const parts = [];
    if (summary.state === 'unknown') {
      parts.push((summary.unknownReason !== null && text.status.unknown[summary.unknownReason]) || text.status.reason.unknown);
    } else if (summary.state === 'question') {
      parts.push(pending || text.status.reason.question);
      return parts.join(' ');
    } else if (summary.state === 'blocked' || summary.state === 'failed') {
      parts.push(text.status.reason[summary.state]);
    } else if (summary.state === 'completed') {
      const line = nextStepLine(nextStep);
      if (line !== null) parts.push(line);
    }
    if (pending !== null) parts.push(pending);
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
    if (summary.state === 'running' && summary.runningStage !== null) {
      pairs.push({ label: text.status.labels.stage, value: summary.runningStage, mono: true });
    }
    if (summary.runningSummary !== null) {
      pairs.push({ label: text.status.labels.providerUpdate, value: summary.runningSummary });
    }
    return pairs;
  }

  /** The edge tone of an attention state; a calm state keeps the plain surface. */
  function accentOf(state) {
    if (state === 'failed') return 'error';
    if (state === 'blocked' || state === 'question' || state === 'unknown') return 'warn';
    return undefined;
  }

  /** The Status card: an optional message, an optional details grid, an optional action row, in that order. */
  function renderStatus(model) {
    const { summary, actions, nextStep } = model;
    const children = [];
    const message = messageOf(summary, nextStep);
    if (message !== null) children.push(el('p', message, 'mg-muted'));
    const pairs = pairsOf(summary);
    if (pairs.length > 0) children.push(ui.keyValues(pairs));
    const buttons = [];
    if (actions.primary !== null) buttons.push(actionButton(actions.primary, 'primary'));
    for (const name of actions.secondary) buttons.push(actionButton(name, 'secondary'));
    if (buttons.length > 0) children.push(ui.actions(buttons));
    if (children.length === 0) children.push(el('p', text.status.noAction, 'mg-muted'));
    return ui.section(text.status.title, {
      surface: true,
      accent: accentOf(summary.state),
      children,
    });
  }

  function render(root, model, host) {
    page = host;
    const progress = window.MigentSessionOverviewProgress;
    const results = window.MigentSessionResults.sections(model, page);
    // The one section order: Status, Outputs, Next steps, Progress, Latest activity, Child sessions, then the Details grid of the source session (no section).
    const parts = [
      renderStatus(model),
      results.outputs,
      results.next,
      progress.renderProgress(model),
      progress.renderActivity(model),
      results.children,
      results.fromSession,
    ].filter((part) => part !== null);
    root.replaceChildren(ui.stack(parts));
  }

  window.MigentSessionOverview = { render };
})();
