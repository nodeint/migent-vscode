// Metrics tab of the Session page. Read-only: it renders the model the extension posts and sends intents that carry
// identity only (a closed action name), never a path, a command or argv. Every string is set with
// textContent; bars are <progress> elements sized through properties. The shared helpers in
// media/shared load first (see docs/ui.md).
(function () {
  'use strict';

  const ui = window.MigentUi;
  const { el } = ui;
  const copy = window.MigentCopy;
  const text = window.MigentSessionMetricsCopy;
  const numberFormat = new Intl.NumberFormat('en-US');
  const NONE = '—';

  let page = null;

  const action = (label, intent, kind) => page.action(label, intent, kind);

  const SECONDS_PER_MINUTE = 60;
  const SECONDS_PER_HOUR = 3600;
  const PERCENT = 100;

  function isNumber(value) {
    return typeof value === 'number';
  }

  function count(value) {
    return isNumber(value) ? numberFormat.format(value) : NONE;
  }

  function formatSeconds(seconds) {
    if (!isNumber(seconds)) return NONE;
    const total = Math.max(0, Math.round(seconds));
    const hours = Math.floor(total / SECONDS_PER_HOUR);
    const minutes = Math.floor((total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
    const rest = total % SECONDS_PER_MINUTE;
    if (hours > 0) return hours + 'h ' + minutes + 'm';
    if (minutes > 0) return minutes + 'm ' + rest + 's';
    return rest + 's';
  }

  function money(usd) {
    if (!isNumber(usd)) return NONE;
    if (usd > 0 && usd < 0.01) return '<$0.01';
    return '$' + usd.toFixed(2);
  }

  function parsedDate(iso) {
    if (!iso) return null;
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatDateTime(iso) {
    const date = parsedDate(iso);
    return date === null ? null : date.toLocaleString();
  }

  function formatTime(iso) {
    const date = parsedDate(iso);
    return date === null ? null : date.toLocaleTimeString();
  }

  function renderUnavailableMetrics(metrics) {
    if (metrics.kind === 'missing') {
      return ui.banner({ tone: 'warn', lines: [text.unavailable.missingTitle, text.unavailable.missingBody] });
    }
    const title = metrics.kind === 'unreadable' ? text.unavailable.unreadable : text.unavailable.unusable;
    return ui.banner({
      tone: 'error',
      lines: [title, { text: metrics.error, className: 'mg-muted mg-mono' }, text.unavailable.stays],
      actions: [action(text.openFile, { intent: 'openMetricsFile' }, 'secondary')],
    });
  }

  function isSkipped(execution) {
    return execution.status === 'skipped';
  }

  /** Executions that ran but did not report a cost. Skipped rows never ran, so they are not counted. */
  function missingCostExecutions(metrics) {
    return metrics.executions.filter(
      (execution) => !isSkipped(execution) && isNumber(execution.usageMissing.costUsd) && execution.usageMissing.costUsd > 0,
    );
  }

  function costWarning(metrics) {
    const totals = metrics.totals;
    const uncaptured = isNumber(totals.uncapturedTurns) && totals.uncapturedTurns > 0;
    if (totals.costPartial !== true && !uncaptured) return null;
    const lines = [];
    if (totals.costPartial === true) {
      const missing = missingCostExecutions(metrics);
      const clients = [...new Set(missing.map((execution) => execution.client).filter((name) => name))];
      const total = isNumber(totals.executions) ? totals.executions : null;
      lines.push(text.costWarning.title, text.costWarning.detail(missing.length, total, clients, money(totals.usage.costUsd)));
    }
    if (uncaptured) lines.push({ text: text.costWarning.uncaptured(totals.uncapturedTurns), className: 'mg-warn' });
    return ui.banner({ tone: 'warn', lines });
  }

  function stat(label, value, note, tone) {
    const cell = el('div', null, 'metrics-stat');
    cell.append(el('dt', label));
    const valueNode = el('dd', value);
    if (note) valueNode.append(el('span', note, 'metrics-note' + (tone ? ' metrics-note--' + tone : '')));
    cell.append(valueNode);
    return cell;
  }

  /** A note for a counter: a zero claim only for an explicit 0, "not recorded" for an absent value. */
  function counted(value, zeroText, some) {
    if (!isNumber(value)) return text.notRecorded;
    return value > 0 ? some(value) : zeroText;
  }

  function renderStats(metrics) {
    const t = metrics.totals;
    const grid = el('dl', null, 'metrics-stats');
    const hasActiveShare = isNumber(t.activeSeconds) && isNumber(t.wallSeconds) && t.wallSeconds > 0;
    const missingCount = missingCostExecutions(metrics).length;
    const skipped = counted(t.skipped, text.stats.skippedNone, text.stats.skipped);
    const uncaptured = counted(t.uncapturedTurns, text.stats.uncapturedNone, text.stats.uncaptured);
    const verifyRed = isNumber(t.verifyRed) && t.verifyRed > 0;
    let costNote = text.notRecorded;
    if (t.costPartial === true) costNote = text.stats.costPartial(missingCount);
    else if (t.costPartial === false) costNote = isNumber(t.usage.costUsd) ? text.stats.costComplete : text.stats.costNone;
    grid.append(
      stat(text.stats.wallTime, formatSeconds(t.wallSeconds), text.stats.wallNote),
      stat(
        text.stats.activeTime,
        formatSeconds(t.activeSeconds),
        hasActiveShare ? text.stats.activeShare(Math.round((t.activeSeconds / t.wallSeconds) * PERCENT)) : null,
      ),
      stat(text.stats.executions, count(t.executions), skipped),
      stat(text.stats.turns, count(t.turns), uncaptured),
      stat(text.stats.revisions, count(t.revisions), text.stats.revisionsNote),
      stat(
        text.stats.verify,
        formatSeconds(t.verifySeconds),
        verifyRed ? text.stats.redRuns(t.verifyRed) : counted(t.verifyRed, text.stats.redRunsNone, text.stats.redRuns),
        verifyRed ? 'warn' : null,
      ),
      stat(text.stats.knownCost, money(t.usage.costUsd), costNote, t.costPartial === true ? 'warn' : null),
      stat(
        text.stats.failures,
        count(t.failedExecutions),
        text.stats.failuresNote(count(t.blocked), count(t.cancelled)),
        isNumber(t.failedExecutions) && t.failedExecutions > 0 ? 'warn' : null,
      ),
    );
    return ui.section(text.stats.title, { surface: true, children: [grid] });
  }

  /** A bar showing `value` out of `max`. It is decorative: the number is always shown as text beside it. */
  function bar(value, max, isQuiet) {
    const node = el('progress', null, 'metrics-bar' + (isQuiet ? ' metrics-bar--quiet' : ''));
    node.max = max;
    node.value = value;
    node.setAttribute('aria-hidden', 'true');
    return node;
  }

  function stageSeconds(metrics, stageId) {
    let known = null;
    for (const execution of metrics.executions) {
      if (execution.stageId !== stageId || !isNumber(execution.wallSeconds)) continue;
      known = (known === null ? 0 : known) + execution.wallSeconds;
    }
    return known;
  }

  function renderStages(metrics) {
    if (metrics.stages.length === 0) return ui.section(text.stages.title, { children: [ui.empty(text.stages.empty)] });
    const seconds = metrics.stages.map((stage) => stageSeconds(metrics, stage.id));
    const longest = Math.max(1, ...seconds.map((value) => (value === null ? 0 : value)));
    const list = el('ul', null, 'mg-list');
    metrics.stages.forEach((stage, index) => {
      const spent = seconds[index];
      const main = [el('span', stage.id, 'mg-mono')];
      if (spent !== null) main.push(bar(spent, longest, false));
      const parts = [text.stages.executions(count(stage.executions))];
      if (isNumber(stage.skipped) && stage.skipped > 0) parts.push(text.stages.skipped(stage.skipped));
      if (isNumber(stage.revisions) && stage.revisions > 0) parts.push(text.stages.revisions(stage.revisions));
      if (isNumber(stage.failed) && stage.failed > 0) parts.push(text.stages.failed(stage.failed));
      if (isNumber(stage.blocked) && stage.blocked > 0) parts.push(text.stages.blocked(stage.blocked));
      list.append(ui.listRow({ main, meta: [el('span', formatSeconds(spent), 'metrics-row-value'), el('span', parts.join(' · '))] }));
    });
    return ui.section(text.stages.title, { count: String(metrics.stages.length), note: text.stages.note, children: [list] });
  }

  const TOKEN_FIELDS = Object.keys(text.usage.tokens);

  function clientKey(execution) {
    return execution.client === null ? text.usage.noRole : execution.client + '/' + (execution.model || NONE);
  }

  function clientRows(metrics) {
    const byProvider = new Map();
    for (const execution of metrics.executions) {
      if (isSkipped(execution)) continue;
      const key = clientKey(execution);
      const entry = byProvider.get(key) || { executions: 0, known: 0, reported: 0, missing: 0 };
      entry.executions += 1;
      if (isNumber(execution.usage.costUsd)) {
        entry.known += execution.usage.costUsd;
        entry.reported += 1;
      }
      if (isNumber(execution.usageMissing.costUsd) && execution.usageMissing.costUsd > 0) entry.missing += 1;
      byProvider.set(key, entry);
    }
    return byProvider;
  }

  function clientMeta(entry) {
    const executions = text.usage.provider.executions(entry.executions);
    if (entry.reported === 0) return text.usage.provider.noCost(executions);
    if (entry.missing === 0) return text.usage.provider.cost(executions, money(entry.known));
    return text.usage.provider.costWithMissing(executions, money(entry.known), entry.missing);
  }

  function renderUsage(metrics) {
    const usage = metrics.totals.usage;
    const longest = Math.max(1, ...TOKEN_FIELDS.map((field) => (isNumber(usage[field]) ? usage[field] : 0)));
    const list = el('ul', null, 'mg-list');
    for (const field of TOKEN_FIELDS) {
      const main = [el('span', text.usage.tokens[field])];
      if (isNumber(usage[field])) main.push(bar(usage[field], longest, true));
      list.append(ui.listRow({ main, meta: count(usage[field]) }));
    }
    const rows = clientRows(metrics);
    const clients = el('ul', null, 'mg-list');
    for (const [name, entry] of rows) {
      clients.append(ui.listRow({ main: name, mainClass: 'mg-mono', meta: clientMeta(entry) }));
    }
    const providers = rows.size === 0 ? [ui.empty(text.usage.noProviders)] : [clients];
    return ui.section(text.usage.title, {
      note: text.usage.note,
      children: [list, ui.group(text.usage.providers, { children: providers })],
    });
  }

  function statusLabel(execution) {
    const status = text.executions.status;
    if (execution.status === 'failed') return { label: status.failed, tone: 'mg-error' };
    if (execution.status === 'cancelled') return { label: status.cancelled, tone: 'mg-warn' };
    if (execution.status === 'skipped') return { label: status.skipped, tone: 'mg-muted' };
    if (execution.status === 'completed') {
      return { label: status.completed(execution.decision), tone: execution.decision === 'revise' ? 'mg-warn' : '' };
    }
    return { label: execution.status.charAt(0).toUpperCase() + execution.status.slice(1), tone: '' };
  }

  function fact(list, label, value) {
    list.append(el('dt', label), el('dd', value));
  }

  /** The tone that needs attention, from the same rule as `statusLabel`; null for a neutral state (skipped too). */
  function attentionTone(execution) {
    if (execution.status === 'failed') return 'error';
    if (execution.status === 'cancelled' || (execution.status === 'completed' && execution.decision === 'revise')) return 'warn';
    return null;
  }

  /** The quiet summary of a card: role, status, client, time and cost. A skipped execution never ran. */
  function executionSummary(execution) {
    const parts = [execution.role || '', statusLabel(execution).label];
    if (isSkipped(execution)) {
      parts.push(text.executions.didNotRun);
      return parts;
    }
    parts.push(
      execution.client === null ? text.executions.noRole : clientKey(execution),
      formatSeconds(execution.wallSeconds),
    );
    // A reported cost is part of the quiet line; a missing one is a warning chip (see `executionAlerts`).
    if (isNumber(execution.usage.costUsd)) parts.push(money(execution.usage.costUsd));
    return parts;
  }

  function costFact(execution) {
    const missing = execution.usageMissing.costUsd;
    if (!isNumber(execution.usage.costUsd)) {
      if (!isNumber(missing)) return text.execution.costFact.notRecorded;
      return missing > 0 ? text.execution.costFact.notReported(missing) : text.execution.costFact.none;
    }
    const cost = money(execution.usage.costUsd);
    return isNumber(missing) && missing > 0 ? text.execution.costFact.partial(cost, missing) : cost;
  }

  function renderVerify(verify) {
    const list = el('dl', null, 'metrics-kv');
    fact(list, text.verify.runs, count(verify.runs));
    fact(list, text.verify.redRuns, count(verify.red));
    fact(list, text.verify.firstPass, verify.firstPass === null ? NONE : verify.firstPass ? text.verify.yes : text.verify.no);
    if (verify.failedCommands.length > 0) {
      const commands = el('ul', null, 'metrics-plain');
      for (const command of verify.failedCommands) commands.append(el('li', command, 'mg-mono'));
      const cell = el('dd');
      cell.append(commands);
      list.append(el('dt', text.verify.failedCommands), cell);
    }
    return ui.group(text.verify.title, { children: [list] });
  }

  function executionBody(execution) {
    const facts = el('dl', null, 'metrics-kv');
    fact(facts, text.execution.status, text.execution.withDecision(execution.status, execution.decision));
    if (isSkipped(execution)) {
      fact(facts, text.execution.skipReason, execution.skipReason || text.execution.noSkipReason);
    } else {
      fact(facts, text.execution.client, execution.client === null ? text.execution.noRoleClient : clientKey(execution));
    }
    const started = formatTime(execution.createdAt);
    const finished = formatTime(execution.completedAt);
    if (started) fact(facts, text.execution.started, started);
    if (finished) fact(facts, text.execution.finished, finished);
    if (!isSkipped(execution)) {
      fact(facts, text.execution.wallVerify, formatSeconds(execution.wallSeconds) + ' / ' + formatSeconds(execution.verifySeconds));
      fact(facts, text.execution.turns, count(execution.turns));
      fact(facts, text.execution.cost, costFact(execution));
    }
    if (execution.resumesExecutionId) fact(facts, text.execution.resumes, execution.resumesExecutionId);
    if (execution.routedFrom) fact(facts, text.execution.routedFrom, execution.routedFrom);
    const body = [ui.group(text.execution.timing, { children: [facts] })];
    if (isSkipped(execution)) return body;
    const tokens = el('dl', null, 'metrics-kv');
    for (const field of TOKEN_FIELDS) fact(tokens, text.usage.tokens[field], count(execution.usage[field]));
    body.push(ui.group(text.execution.tokens, { children: [tokens] }));
    if (execution.verify) body.push(renderVerify(execution.verify));
    return body;
  }

  /** The framed chips of a card header: the status that needs attention, and a cost the execution did not report. */
  function executionAlerts(execution) {
    const alerts = [];
    const tone = attentionTone(execution);
    if (tone !== null) alerts.push(ui.chip(statusLabel(execution).label, { tone }));
    if (!isSkipped(execution) && !isNumber(execution.usage.costUsd)) {
      alerts.push(ui.chip(text.executions.noCost, { tone: 'warn' }));
    }
    return alerts;
  }

  function executionCard(execution, isLast) {
    const tone = attentionTone(execution);
    return ui.collapsibleCard({
      key: 'execution:' + execution.id,
      number: execution.order,
      title: text.executions.heading(execution.stageId, execution.attempt),
      summary: executionSummary(execution),
      alerts: executionAlerts(execution),
      warn: tone !== null,
      open: isLast,
      body: executionBody(execution),
    });
  }

  function renderExecutions(metrics) {
    const executions = metrics.executions;
    if (executions.length === 0) {
      return ui.section(text.executions.title, { children: [ui.empty(text.executions.empty)] });
    }
    return ui.section(text.executions.title, {
      count: String(executions.length),
      note: text.executions.hint,
      children: executions.map((execution, index) => executionCard(execution, index === executions.length - 1)),
    });
  }

  function renderDetails(model) {
    const facts = el('dl', null, 'metrics-kv');
    fact(facts, text.details.session, model.sessionId);
    if (model.workflowId) fact(facts, text.details.workflow, model.workflowId);
    const completed = formatDateTime(model.completedAt);
    if (completed) fact(facts, text.details.completed, completed);
    fact(facts, text.details.record, text.details.recordNote);
    const row = el('p', null, 'metrics-block');
    row.append(action(text.openFile, { intent: 'openMetricsFile' }, 'secondary'));
    return ui.section(copy.details, { children: [facts, row] });
  }

  function render(root, model, host) {
    page = host;
    root.replaceChildren();
    const metrics = model.metrics;
    if (metrics.kind !== 'ok') {
      root.append(renderUnavailableMetrics(metrics));
      return;
    }
    const warning = costWarning(metrics);
    if (warning) root.append(warning);
    root.append(renderStats(metrics), renderStages(metrics), renderUsage(metrics), renderExecutions(metrics), renderDetails(model));
  }

  window.MigentSessionMetrics = { render };
})();
