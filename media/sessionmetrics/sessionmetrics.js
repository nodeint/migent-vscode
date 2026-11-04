// Session Metrics page. Read-only: it renders the model the extension posts and sends intents that carry
// identity only (a closed action name), never a path, a command or argv. Every string is set with
// textContent; bars are <progress> elements sized through properties. The shared helpers in
// media/shared/page.js load first (see docs/ui.md).
(function () {
  'use strict';

  const { el, section, connect, details, sessionHeader } = window.MigentPage;
  const root = document.getElementById('root');
  const numberFormat = new Intl.NumberFormat('en-US');
  const NONE = '—';

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
  const MS_PER_SECOND = 1000;

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

  /** Session wall time: from the metrics when recorded, else the status timestamps. */
  function wallSeconds(model) {
    if (model.metrics.kind === 'ok' && isNumber(model.metrics.totals.wallSeconds)) return model.metrics.totals.wallSeconds;
    return isNumber(model.durationMs) ? model.durationMs / MS_PER_SECOND : null;
  }

  function renderHeader(model) {
    const completed = formatDateTime(model.completedAt);
    const wall = wallSeconds(model);
    return sessionHeader(page, {
      state: model.state,
      title: model.title,
      subtitle: [
        model.workflowId,
        model.sessionId,
        completed === null ? null : 'completed ' + completed,
        wall === null ? null : formatSeconds(wall),
      ],
      current: 'metrics',
      openResults: { intent: 'openResults' },
      menuItems: [{ label: 'Open metrics.json', onSelect: () => page.send({ intent: 'openMetricsFile' }) }],
    });
  }

  function banner(isError) {
    const node = el('div', null, 'metrics-banner' + (isError ? ' metrics-banner--error' : ''));
    const icon = el('span', isError ? '✗' : '⚠', isError ? 'mg-error' : 'mg-warn');
    icon.setAttribute('aria-hidden', 'true');
    const body = el('div');
    node.append(icon, body);
    return { node, body };
  }

  function renderUnavailableMetrics(metrics) {
    if (metrics.kind === 'missing') {
      const { node, body } = banner(false);
      body.append(
        el('p', 'No metrics recorded for this session.'),
        el(
          'p',
          'Migent writes metrics.json when a workflow session completes. Sessions completed before metrics existed, or agent sessions, have none.',
          'mg-muted',
        ),
      );
      return node;
    }
    const { node, body } = banner(true);
    const title = metrics.kind === 'unreadable' ? 'metrics.json cannot be read.' : 'metrics.json cannot be used.';
    body.append(
      el('p', title),
      el('p', metrics.error, 'mg-muted mg-mono'),
      el('p', 'The file stays on disk. The session state above comes from status.json.', 'mg-muted'),
    );
    const row = el('p', null, 'metrics-block');
    row.append(action('Open metrics.json', { intent: 'openMetricsFile' }, 'secondary'));
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
      const providers = [...new Set(missing.map((execution) => execution.provider).filter((name) => name))];
      const total = isNumber(totals.executions) ? ' of ' + totals.executions : '';
      const which = providers.length > 0 ? ' (' + providers.join(', ') + ')' : '';
      body.append(
        el('p', 'Cost is partial.'),
        el(
          'p',
          missing.length + total + ' executions did not report a cost' + which + ', so ' + money(totals.usage.costUsd) + ' understates this session.',
          'mg-muted',
        ),
      );
    }
    if (uncaptured) {
      body.append(el('p', totals.uncapturedTurns + ' turn(s) captured no usage at all.', 'mg-warn'));
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
  function counted(value, zeroText, suffix) {
    if (!isNumber(value)) return 'not recorded';
    return value > 0 ? value + suffix : zeroText;
  }

  function renderStats(metrics) {
    const t = metrics.totals;
    const grid = el('dl', null, 'metrics-stats');
    const hasActiveShare = isNumber(t.activeSeconds) && isNumber(t.wallSeconds) && t.wallSeconds > 0;
    const missingCount = missingCostExecutions(metrics).length;
    const skipped = counted(t.skipped, 'no skips', ' skipped');
    const uncaptured = counted(t.uncapturedTurns, 'all captured', ' uncaptured');
    const verifyRed = isNumber(t.verifyRed) && t.verifyRed > 0;
    let costNote = 'not recorded';
    if (t.costPartial === true) costNote = 'partial — ' + missingCount + ' executions missing';
    else if (t.costPartial === false) costNote = isNumber(t.usage.costUsd) ? 'reported by every execution' : 'no execution reported a cost';
    grid.append(
      stat('Wall time', formatSeconds(t.wallSeconds), 'first start to last finish'),
      stat(
        'Active time',
        formatSeconds(t.activeSeconds),
        hasActiveShare ? Math.round((t.activeSeconds / t.wallSeconds) * PERCENT) + '% of wall' : null,
      ),
      stat('Executions', count(t.executions), skipped),
      stat('Turns', count(t.turns), uncaptured),
      stat('Revisions', count(t.revisions), 'route backs, not retries'),
      stat(
        'Verify',
        formatSeconds(t.verifySeconds),
        verifyRed ? t.verifyRed + ' red run(s)' : counted(t.verifyRed, 'no red runs', ''),
        verifyRed ? 'warn' : null,
      ),
      stat('Known cost', money(t.usage.costUsd), costNote, t.costPartial === true ? 'warn' : null),
      stat(
        'Failures',
        count(t.failedExecutions),
        count(t.blocked) + ' blocked · ' + count(t.cancelled) + ' cancelled',
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
    const node = section('Stages', 'mg-section');
    if (metrics.stages.length === 0) {
      node.append(el('p', 'No stages recorded.', 'mg-muted'));
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
      const parts = [count(stage.executions) + ' executions'];
      if (isNumber(stage.skipped) && stage.skipped > 0) parts.push(stage.skipped + ' skipped');
      if (isNumber(stage.revisions) && stage.revisions > 0) parts.push(stage.revisions + ' revisions');
      if (isNumber(stage.failed) && stage.failed > 0) parts.push(stage.failed + ' failed');
      if (isNumber(stage.blocked) && stage.blocked > 0) parts.push(stage.blocked + ' blocked');
      meta.append(el('span', parts.join(' · ')));
      row.append(main, meta);
      const item = el('li');
      item.append(row);
      list.append(item);
    });
    node.append(list);
    node.append(
      el('p', 'Bar length is the wall time spent in that stage across all its attempts. Skipped rows add no time.', 'mg-muted'),
    );
    return node;
  }

  const TOKEN_FIELDS = [
    ['Input', 'inputTokens'],
    ['Output', 'outputTokens'],
    ['Reasoning', 'reasoningTokens'],
    ['Cache read', 'cacheReadTokens'],
    ['Cache write', 'cacheWriteTokens'],
  ];

  function providerKey(execution) {
    return execution.provider === null ? 'No role' : execution.provider + '/' + (execution.model || NONE);
  }

  function providerRows(metrics) {
    const byProvider = new Map();
    for (const execution of metrics.executions) {
      if (isSkipped(execution)) continue;
      const key = providerKey(execution);
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

  function providerMeta(entry) {
    const executions = entry.executions + ' executions';
    if (entry.reported === 0) return executions + ' · no cost reported';
    if (entry.missing === 0) return executions + ' · ' + money(entry.known);
    return executions + ' · ' + money(entry.known) + ' known · ' + entry.missing + ' missing';
  }

  function renderUsage(metrics) {
    const node = section('Usage', 'mg-section');
    const usage = metrics.totals.usage;
    const longest = Math.max(1, ...TOKEN_FIELDS.map(([, field]) => (isNumber(usage[field]) ? usage[field] : 0)));
    const list = el('ul', null, 'mg-list');
    for (const [label, field] of TOKEN_FIELDS) {
      const row = el('div', null, 'mg-row');
      const main = el('div', null, 'mg-row-main');
      main.append(el('span', label));
      if (isNumber(usage[field])) main.append(bar(usage[field], longest, true));
      row.append(main, el('span', count(usage[field]), 'mg-row-meta'));
      const item = el('li');
      item.append(row);
      list.append(item);
    }
    node.append(list);
    node.append(el('p', 'Input excludes cache reads. Reasoning is reported beside output, not added to it.', 'mg-muted'));

    node.append(el('h3', 'Providers'));
    const rows = providerRows(metrics);
    if (rows.size === 0) {
      node.append(el('p', 'No execution ran.', 'mg-muted'));
      return node;
    }
    const providers = el('ul', null, 'mg-list');
    for (const [name, entry] of rows) {
      const row = el('div', null, 'mg-row');
      row.append(el('span', name, 'mg-row-main mg-mono'), el('span', providerMeta(entry), 'mg-row-meta'));
      const item = el('li');
      item.append(row);
      providers.append(item);
    }
    node.append(providers);
    return node;
  }

  function statusLabel(execution) {
    if (execution.status === 'failed') return { text: 'Failed', tone: 'mg-error' };
    if (execution.status === 'cancelled') return { text: 'Cancelled', tone: 'mg-warn' };
    if (execution.status === 'skipped') return { text: 'Skipped', tone: 'mg-muted' };
    if (execution.status === 'completed') {
      const decision = execution.decision ? ' · ' + execution.decision : '';
      return { text: 'Completed' + decision, tone: execution.decision === 'revise' ? 'mg-warn' : '' };
    }
    return { text: execution.status.charAt(0).toUpperCase() + execution.status.slice(1), tone: '' };
  }

  function fact(list, label, value) {
    list.append(el('dt', label), el('dd', value));
  }

  function executionSummary(execution) {
    const line = el('span', null, 'metrics-exec-summary');
    const title = el('span', null, 'metrics-exec-title');
    const attempt = execution.attempt === null ? '' : ' · attempt ' + execution.attempt;
    title.append(el('span', '#' + execution.order + ' ' + execution.stageId + attempt, 'mg-mono'));
    if (execution.role) title.append(el('span', '  ' + execution.role, 'mg-muted'));
    const meta = el('span', null, 'metrics-exec-meta');
    const label = statusLabel(execution);
    const pill = el('span', label.text, 'mg-pill');
    meta.append(pill);
    if (isSkipped(execution)) {
      meta.append(el('span', 'did not run', 'mg-muted'));
    } else {
      meta.append(
        el('span', execution.provider === null ? 'no role' : providerKey(execution), 'mg-muted'),
        el('span', formatSeconds(execution.wallSeconds)),
        el('span', isNumber(execution.usage.costUsd) ? money(execution.usage.costUsd) : 'no cost', isNumber(execution.usage.costUsd) ? 'mg-muted' : 'mg-warn'),
      );
    }
    line.append(title, meta);
    return line;
  }

  function costFact(execution) {
    const missing = execution.usageMissing.costUsd;
    if (!isNumber(execution.usage.costUsd)) {
      if (!isNumber(missing)) return 'Not recorded';
      return missing > 0 ? 'Not reported (' + missing + ' turn(s) missing)' : 'None (no billable turn)';
    }
    return money(execution.usage.costUsd) + (isNumber(missing) && missing > 0 ? ' (partial: ' + missing + ' turn(s) missing)' : '');
  }

  function renderVerify(verify) {
    const block = el('div');
    block.append(el('h3', 'Verify'));
    const list = el('dl', null, 'metrics-kv');
    fact(list, 'Runs', count(verify.runs));
    fact(list, 'Red runs', count(verify.red));
    fact(list, 'First pass', verify.firstPass === null ? NONE : verify.firstPass ? 'yes' : 'no');
    if (verify.failedCommands.length > 0) {
      const commands = el('ul', null, 'metrics-plain');
      for (const command of verify.failedCommands) commands.append(el('li', command, 'mg-mono'));
      const cell = el('dd');
      cell.append(commands);
      list.append(el('dt', 'Failed commands'), cell);
    }
    block.append(list);
    return block;
  }

  function executionBody(execution) {
    const body = el('div', null, 'metrics-exec-body');
    body.append(el('h3', 'Timing and state'));
    const facts = el('dl', null, 'metrics-kv');
    fact(facts, 'Status', execution.status + (execution.decision ? ' · ' + execution.decision : ''));
    if (isSkipped(execution)) {
      fact(facts, 'Skip reason', execution.skipReason || 'No reason recorded');
    } else {
      fact(facts, 'Provider', execution.provider === null ? 'No role; Migent runs the verify list' : providerKey(execution));
    }
    const started = formatTime(execution.createdAt);
    const finished = formatTime(execution.completedAt);
    if (started) fact(facts, 'Started', started);
    if (finished) fact(facts, 'Finished', finished);
    if (!isSkipped(execution)) {
      fact(facts, 'Wall / verify', formatSeconds(execution.wallSeconds) + ' / ' + formatSeconds(execution.verifySeconds));
      fact(facts, 'Turns', count(execution.turns));
      fact(facts, 'Cost', costFact(execution));
    }
    if (execution.resumesExecutionId) fact(facts, 'Resumes', execution.resumesExecutionId);
    if (execution.routedFrom) fact(facts, 'Routed from', execution.routedFrom);
    body.append(facts);

    if (isSkipped(execution)) return body;
    body.append(el('h3', 'Tokens'));
    const tokens = el('dl', null, 'metrics-kv');
    for (const [label, field] of TOKEN_FIELDS) fact(tokens, label, count(execution.usage[field]));
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
    const node = section('Executions', 'mg-section');
    if (metrics.executions.length === 0) {
      node.append(el('p', 'No executions recorded.', 'mg-muted'));
      return node;
    }
    node.append(el('p', 'In execution order. Expand a row for timings, tokens and verify results.', 'mg-muted'));
    const list = el('div');
    metrics.executions.forEach((execution, index) => {
      list.append(executionDetails(execution, index === metrics.executions.length - 1));
    });
    node.append(list);
    return node;
  }

  function renderDetails(model) {
    const node = details('details', 'Details');
    const body = el('div');
    const facts = el('dl', null, 'metrics-kv');
    fact(facts, 'Session', model.sessionId);
    if (model.workflowId) fact(facts, 'Workflow', model.workflowId);
    const completed = formatDateTime(model.completedAt);
    if (completed) fact(facts, 'Completed', completed);
    fact(facts, 'Record', 'Written by Migent when the session completed; it does not change afterwards.');
    body.append(facts);
    const row = el('p', null, 'metrics-block');
    row.append(action('Open metrics.json', { intent: 'openMetricsFile' }, 'secondary'));
    body.append(row);
    node.append(body);
    return node;
  }

  function render(model) {
    root.replaceChildren();
    if (model.availability === 'unavailable') {
      root.append(el('h1', 'Session unavailable', 'mg-title'));
      root.append(
        el(
          'p',
          'This session is not loaded, was removed, or is hidden by the session limit. ' + model.sessionId,
          'mg-subtitle',
        ),
      );
      return;
    }
    root.append(renderHeader(model));
    const metrics = model.metrics;
    if (metrics.kind !== 'ok') {
      root.append(renderUnavailableMetrics(metrics));
      return;
    }
    const warning = costWarning(metrics);
    if (warning) root.append(warning);
    root.append(renderStats(metrics), renderStages(metrics), renderUsage(metrics), renderExecutions(metrics), renderDetails(model));
  }

  const page = connect({ render });
})();
