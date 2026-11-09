// Metrics tab of the Session page. Read-only: it renders the model the extension posts and sends intents that carry
// identity only (a closed action name), never a path, a command or argv. Every string is set with
// textContent; bars are <progress> elements sized through properties. The shared helpers in
// media/shared/page.js load first (see docs/ui.md).
(function () {
  'use strict';

  const { el, section, details, icon } = window.MigentPage;
  const copy = window.MigentCopy;
  const text = window.MigentSessionMetricsCopy;
  const numberFormat = new Intl.NumberFormat('en-US');
  const NONE = '—';

  let page = null;

  /** A native button that sends `intent`. `kind` is a base.css button modifier. */
  function action(label, intent, kind) {
    const node = el('button', label, 'mg-btn mg-btn--' + kind);
    node.type = 'button';
    node.addEventListener('click', () => page.send(intent));
    return node;
  }

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

  function banner(isError) {
    const node = el('div', null, 'mg-banner mg-banner--' + (isError ? 'error' : 'warn'));
    const mark = el('span', null, 'mg-banner__icon');
    mark.append(icon(isError ? 'error' : 'warning'));
    const body = el('div');
    node.append(mark, body);
    return { node, body };
  }

  function renderUnavailableMetrics(metrics) {
    if (metrics.kind === 'missing') {
      const { node, body } = banner(false);
      body.append(
        el('p', text.unavailable.missingTitle),
        el('p', text.unavailable.missingBody, 'mg-muted'),
      );
      return node;
    }
    const { node, body } = banner(true);
    const title = metrics.kind === 'unreadable' ? text.unavailable.unreadable : text.unavailable.unusable;
    body.append(
      el('p', title),
      el('p', metrics.error, 'mg-muted mg-mono'),
      el('p', text.unavailable.stays, 'mg-muted'),
    );
    const row = el('p', null, 'metrics-block');
    row.append(action(text.openFile, { intent: 'openMetricsFile' }, 'secondary'));
    body.append(row);
    return node;
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
    const { node, body } = banner(false);
    if (totals.costPartial === true) {
      const missing = missingCostExecutions(metrics);
      const clients = [...new Set(missing.map((execution) => execution.client).filter((name) => name))];
      const total = isNumber(totals.executions) ? totals.executions : null;
      body.append(
        el('p', text.costWarning.title),
        el('p', text.costWarning.detail(missing.length, total, clients, money(totals.usage.costUsd)), 'mg-muted'),
      );
    }
    if (uncaptured) {
      body.append(el('p', text.costWarning.uncaptured(totals.uncapturedTurns), 'mg-warn'));
    }
    return node;
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
    return grid;
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
    const node = section(text.stages.title, 'mg-section');
    if (metrics.stages.length === 0) {
      node.append(el('p', text.stages.empty, 'mg-muted'));
      return node;
    }
    const seconds = metrics.stages.map((stage) => stageSeconds(metrics, stage.id));
    const longest = Math.max(1, ...seconds.map((value) => (value === null ? 0 : value)));
    const list = el('ul', null, 'mg-list');
    metrics.stages.forEach((stage, index) => {
      const spent = seconds[index];
      const row = el('div', null, 'mg-row');
      const main = el('div', null, 'mg-row-main');
      main.append(el('span', stage.id, 'mg-mono'));
      if (spent !== null) main.append(bar(spent, longest, false));
      const meta = el('span', null, 'mg-row-meta');
      meta.append(el('span', formatSeconds(spent), 'metrics-row-value'));
      const parts = [text.stages.executions(count(stage.executions))];
      if (isNumber(stage.skipped) && stage.skipped > 0) parts.push(text.stages.skipped(stage.skipped));
      if (isNumber(stage.revisions) && stage.revisions > 0) parts.push(text.stages.revisions(stage.revisions));
      if (isNumber(stage.failed) && stage.failed > 0) parts.push(text.stages.failed(stage.failed));
      if (isNumber(stage.blocked) && stage.blocked > 0) parts.push(text.stages.blocked(stage.blocked));
      meta.append(el('span', parts.join(' · ')));
      row.append(main, meta);
      const item = el('li');
      item.append(row);
      list.append(item);
    });
    node.append(list);
    node.append(el('p', text.stages.note, 'mg-muted'));
    return node;
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
    const node = section(text.usage.title, 'mg-section');
    const usage = metrics.totals.usage;
    const longest = Math.max(1, ...TOKEN_FIELDS.map((field) => (isNumber(usage[field]) ? usage[field] : 0)));
    const list = el('ul', null, 'mg-list');
    for (const field of TOKEN_FIELDS) {
      const row = el('div', null, 'mg-row');
      const main = el('div', null, 'mg-row-main');
      main.append(el('span', text.usage.tokens[field]));
      if (isNumber(usage[field])) main.append(bar(usage[field], longest, true));
      row.append(main, el('span', count(usage[field]), 'mg-row-meta'));
      const item = el('li');
      item.append(row);
      list.append(item);
    }
    node.append(list);
    node.append(el('p', text.usage.note, 'mg-muted'));

    node.append(el('h3', text.usage.providers));
    const rows = clientRows(metrics);
    if (rows.size === 0) {
      node.append(el('p', text.usage.noProviders, 'mg-muted'));
      return node;
    }
    const clients = el('ul', null, 'mg-list');
    for (const [name, entry] of rows) {
      const row = el('div', null, 'mg-row');
      row.append(el('span', name, 'mg-row-main mg-mono'), el('span', clientMeta(entry), 'mg-row-meta'));
      const item = el('li');
      item.append(row);
      clients.append(item);
    }
    node.append(clients);
    return node;
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

  function executionSummary(execution) {
    const line = el('span', null, 'metrics-exec-summary');
    const title = el('span', null, 'metrics-exec-title');
    title.append(el('span', text.executions.heading(execution.order, execution.stageId, execution.attempt), 'mg-mono'));
    if (execution.role) title.append(el('span', '  ' + execution.role, 'mg-muted'));
    const meta = el('span', null, 'metrics-exec-meta');
    const label = statusLabel(execution);
    const pill = el('span', label.label, 'mg-pill');
    meta.append(pill);
    if (isSkipped(execution)) {
      meta.append(el('span', text.executions.didNotRun, 'mg-muted'));
    } else {
      meta.append(
        el('span', execution.client === null ? text.executions.noRole : clientKey(execution), 'mg-muted'),
        el('span', formatSeconds(execution.wallSeconds)),
        el('span', isNumber(execution.usage.costUsd) ? money(execution.usage.costUsd) : text.executions.noCost, isNumber(execution.usage.costUsd) ? 'mg-muted' : 'mg-warn'),
      );
    }
    line.append(title, meta);
    return line;
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
    const block = el('div');
    block.append(el('h3', text.verify.title));
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
    block.append(list);
    return block;
  }

  function executionBody(execution) {
    const body = el('div', null, 'metrics-exec-body');
    body.append(el('h3', text.execution.timing));
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
    body.append(facts);

    if (isSkipped(execution)) return body;
    body.append(el('h3', text.execution.tokens));
    const tokens = el('dl', null, 'metrics-kv');
    for (const field of TOKEN_FIELDS) fact(tokens, text.usage.tokens[field], count(execution.usage[field]));
    body.append(tokens);
    if (execution.verify) body.append(renderVerify(execution.verify));
    return body;
  }

  function executionDetails(execution, isLast) {
    const node = details('execution:' + execution.id, '', 'metrics-exec', isLast);
    node.querySelector('summary').append(executionSummary(execution));
    node.append(executionBody(execution));
    return node;
  }

  function renderExecutions(metrics) {
    const node = section(text.executions.title, 'mg-section');
    if (metrics.executions.length === 0) {
      node.append(el('p', text.executions.empty, 'mg-muted'));
      return node;
    }
    node.append(el('p', text.executions.hint, 'mg-muted'));
    const list = el('div');
    metrics.executions.forEach((execution, index) => {
      list.append(executionDetails(execution, index === metrics.executions.length - 1));
    });
    node.append(list);
    return node;
  }

  function renderDetails(model) {
    const node = details('details', copy.details);
    const body = el('div');
    const facts = el('dl', null, 'metrics-kv');
    fact(facts, text.details.session, model.sessionId);
    if (model.workflowId) fact(facts, text.details.workflow, model.workflowId);
    const completed = formatDateTime(model.completedAt);
    if (completed) fact(facts, text.details.completed, completed);
    fact(facts, text.details.record, text.details.recordNote);
    body.append(facts);
    const row = el('p', null, 'metrics-block');
    row.append(action(text.openFile, { intent: 'openMetricsFile' }, 'secondary'));
    body.append(row);
    node.append(body);
    return node;
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
