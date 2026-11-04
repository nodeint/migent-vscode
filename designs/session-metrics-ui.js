'use strict';

/* Sample data mirrors migent's documented metrics.json shape. `partial` and `many` are the real files
   .migent/sessions/1df4aac7… and .migent/sessions/5f8992e6…; the other scenarios demonstrate edge states.
   Execution usage is [input, output, reasoning, cacheRead, cacheWrite] tokens. */
const SCENARIOS = {
  partial: {
    kind: 'ok',
    workflow: 'plan',
    title: 'Shared webview UI foundation and Results header',
    sessionId: '1df4aac7-1c89-41c6-9c31-dedbf0b7c7de',
    completedAt: '2026-11-04 04:03',
    totals: {
      executions: 4, skipped: 0, wallSeconds: 292.9, activeSeconds: 292.7, verifySeconds: 0, turns: 4,
      uncapturedTurns: 0, input: 58459, output: 21945, reasoning: 2543, cacheRead: 1684648,
      cacheWrite: 78959, costUsd: 1.2943376, costMissing: 2, costPartial: true,
      failed: 0, blocked: 0, verifyRed: 0, revisions: 1,
    },
    stages: {
      plan: { executions: 2, skipped: 0, revisions: 1, failed: 0, blocked: 0 },
      review_plan: { executions: 2, skipped: 0, revisions: 0, failed: 0, blocked: 0 },
    },
    executions: [
      { order: 1, stage: 'plan', attempt: 1, role: 'planner', provider: 'claude', model: 'opus',
        status: 'completed', decision: null, wall: 181.5, verifySeconds: 0, turns: 1,
        costUsd: 1.0406806, costMissing: 0, usage: [30, 15740, 1602, 882003, 68670],
        started: '03:58:34', finished: '04:01:35' },
      { order: 2, stage: 'review_plan', attempt: 1, role: 'reviewer', provider: 'codex', model: 'gpt-6.1-sol',
        status: 'completed', decision: 'revise', wall: 48.8, verifySeconds: 0, turns: 1,
        costUsd: null, costMissing: 1, usage: [44910, 1535, 294, 178688, 0],
        started: '04:01:35', finished: '04:02:24' },
      { order: 3, stage: 'plan', attempt: 2, role: 'planner', provider: 'claude', model: 'opus',
        status: 'completed', decision: null, wall: 43.6, verifySeconds: 0, turns: 1,
        costUsd: 0.253657, costMissing: 0, usage: [10, 4174, 630, 439125, 10289],
        started: '04:02:24', finished: '04:03:08', resumeFrom: '0001-plan--attempt-01', routedFrom: '0002-review_plan--attempt-01' },
      { order: 4, stage: 'review_plan', attempt: 2, role: 'reviewer', provider: 'codex', model: 'gpt-6.1-sol',
        status: 'completed', decision: 'approved', wall: 18.9, verifySeconds: 0, turns: 1,
        costUsd: null, costMissing: 1, usage: [13509, 496, 17, 184832, 0],
        started: '04:03:08', finished: '04:03:26', resumeFrom: '0002-review_plan--attempt-01' },
    ],
  },
  verify: {
    kind: 'ok',
    workflow: 'implement',
    title: 'Tighten the session reader and its error states',
    sessionId: 'demo-verify-0001',
    completedAt: '2026-11-04 07:12',
    totals: {
      executions: 3, skipped: 0, wallSeconds: 830, activeSeconds: 812, verifySeconds: 140, turns: 3,
      uncapturedTurns: 0, input: 1200, output: 24000, reasoning: 3200, cacheRead: 900000,
      cacheWrite: 12000, costUsd: 2.4, costMissing: 0, costPartial: false,
      failed: 0, blocked: 0, verifyRed: 2, revisions: 0,
    },
    stages: {
      implement: { executions: 2, skipped: 0, revisions: 0, failed: 0, blocked: 0 },
      verify: { executions: 1, skipped: 0, revisions: 0, failed: 0, blocked: 0 },
    },
    executions: [
      { order: 1, stage: 'implement', attempt: 1, role: 'developer', provider: 'claude', model: 'sonnet',
        status: 'completed', decision: null, wall: 600, verifySeconds: 120, turns: 2,
        costUsd: 1.6, costMissing: 0, usage: [1000, 20000, 2600, 700000, 12000],
        started: '06:58:00', finished: '07:08:00',
        verify: { runs: 3, red: 2, firstPass: false, failedCommands: ['pnpm gate', 'pnpm lint'] } },
      { order: 2, stage: 'verify', attempt: 1, role: null, provider: null, model: null,
        status: 'completed', decision: null, wall: 92, verifySeconds: 20, turns: 0,
        costUsd: null, costMissing: 0, usage: [0, 0, 0, 0, 0],
        started: '07:08:00', finished: '07:09:32',
        verify: { runs: 1, red: 0, firstPass: true, failedCommands: [] } },
      { order: 3, stage: 'review_work', attempt: 1, role: 'reviewer', provider: 'claude', model: 'sonnet',
        status: 'completed', decision: 'approved', wall: 138, verifySeconds: 0, turns: 1,
        costUsd: 0.8, costMissing: 0, usage: [200, 4000, 600, 200000, 0],
        started: '07:10:00', finished: '07:12:18' },
    ],
  },
  missing: {
    kind: 'missing',
    workflow: 'docs',
    title: 'Update contributor guide',
    sessionId: 'demo-missing-0001',
    completedAt: '2026-10-29 09:41',
  },
  invalid: {
    kind: 'invalid',
    workflow: 'plan',
    title: 'Normalize workspace paths',
    sessionId: 'demo-invalid-0001',
    completedAt: '2026-10-29 10:58',
    reason: 'Unexpected end of JSON input',
  },
  many: {
    kind: 'ok',
    workflow: 'implement',
    title: 'Ship the results header redesign end to end',
    sessionId: '5f8992e6-0441-492b-89e2-2063b4281e69',
    completedAt: '2026-11-03 15:02',
    totals: {
      executions: 15, skipped: 0, wallSeconds: 6235.8, activeSeconds: 5129.7, verifySeconds: 0, turns: 15,
      uncapturedTurns: 0, input: 206294, output: 113018, reasoning: 25320, cacheRead: 64593993,
      cacheWrite: 186935, costUsd: 10.0878735, costMissing: 7, costPartial: true,
      failed: 1, blocked: 0, verifyRed: 0, revisions: 6,
    },
    stages: {
      implement: { executions: 8, skipped: 0, revisions: 6, failed: 1, blocked: 0 },
      review_work: { executions: 7, skipped: 0, revisions: 0, failed: 0, blocked: 0 },
    },
    executions: [
      { order: 1, stage: 'implement', attempt: 1, role: 'developer', provider: 'claude', model: 'sonnet',
        status: 'failed', decision: null, wall: 1684.3, verifySeconds: 0, turns: 1,
        costUsd: 3.135059, costMissing: 0, usage: [0, 0, 0, 0, 0], started: '13:21:08', finished: '13:49:12' },
      { order: 2, stage: 'implement', attempt: 2, role: 'developer', provider: 'claude', model: 'sonnet',
        status: 'completed', decision: null, wall: 32.9, verifySeconds: 0, turns: 1,
        costUsd: 0.1496095, costMissing: 0, usage: [4, 1146, 0, 531815, 21240], started: '13:49:12', finished: '13:49:45' },
      { order: 3, stage: 'review_work', attempt: 1, role: 'reviewer', provider: 'codex', model: 'gpt-6.1-sol',
        status: 'completed', decision: 'revise', wall: 298.4, verifySeconds: 0, turns: 1,
        costUsd: null, costMissing: 1, usage: [101661, 10296, 2618, 1846528, 0], started: '13:49:45', finished: '13:54:43' },
      { order: 4, stage: 'implement', attempt: 3, role: 'developer', provider: 'claude', model: 'sonnet',
        status: 'completed', decision: null, wall: 667.5, verifySeconds: 0, turns: 1,
        costUsd: 2.6003891, costMissing: 0, usage: [122, 37112, 7107, 19530811, 68986], started: '13:54:43', finished: '14:05:51' },
      { order: 5, stage: 'review_work', attempt: 2, role: 'reviewer', provider: 'codex', model: 'gpt-6.1-sol',
        status: 'completed', decision: 'revise', wall: 152.1, verifySeconds: 0, turns: 1,
        costUsd: null, costMissing: 1, usage: [33194, 4625, 1823, 1236608, 0], started: '14:05:51', finished: '14:08:23' },
      { order: 6, stage: 'implement', attempt: 4, role: 'developer', provider: 'claude', model: 'sonnet',
        status: 'completed', decision: null, wall: 289.2, verifySeconds: 0, turns: 1,
        costUsd: 0.8943327, costMissing: 0, usage: [38, 10736, 943, 6801487, 26687], started: '14:08:23', finished: '14:13:12' },
      { order: 7, stage: 'review_work', attempt: 3, role: 'reviewer', provider: 'codex', model: 'gpt-6.1-sol',
        status: 'completed', decision: 'revise', wall: 98.2, verifySeconds: 0, turns: 1,
        costUsd: null, costMissing: 1, usage: [15315, 2799, 1201, 813824, 0], started: '14:13:12', finished: '14:14:50' },
      { order: 8, stage: 'implement', attempt: 5, role: 'developer', provider: 'claude', model: 'sonnet',
        status: 'completed', decision: null, wall: 297.7, verifySeconds: 0, turns: 1,
        costUsd: 1.0120617, costMissing: 0, usage: [42, 11573, 2703, 8026197, 23407], started: '14:14:50', finished: '14:19:48' },
      { order: 9, stage: 'review_work', attempt: 4, role: 'reviewer', provider: 'codex', model: 'gpt-6.1-sol',
        status: 'completed', decision: 'revise', wall: 99.3, verifySeconds: 0, turns: 1,
        costUsd: null, costMissing: 1, usage: [12289, 2848, 1040, 898688, 0], started: '14:19:48', finished: '14:21:27' },
      { order: 10, stage: 'implement', attempt: 6, role: 'developer', provider: 'claude', model: 'sonnet',
        status: 'completed', decision: null, wall: 371.9, verifySeconds: 0, turns: 1,
        costUsd: 0.6409487, costMissing: 0, usage: [26, 6672, 1947, 5201207, 13514], started: '14:21:27', finished: '14:27:39' },
      { order: 11, stage: 'review_work', attempt: 5, role: 'reviewer', provider: 'codex', model: 'gpt-6.1-sol',
        status: 'completed', decision: 'revise', wall: 85.8, verifySeconds: 0, turns: 1,
        costUsd: null, costMissing: 1, usage: [10582, 2535, 734, 1154560, 0], started: '14:27:39', finished: '14:29:05' },
      { order: 12, stage: 'implement', attempt: 7, role: 'developer', provider: 'claude', model: 'sonnet',
        status: 'completed', decision: null, wall: 412.9, verifySeconds: 0, turns: 1,
        costUsd: 1.0126108, costMissing: 0, usage: [40, 10319, 1631, 8340168, 18831], started: '14:29:05', finished: '14:35:58' },
      { order: 13, stage: 'review_work', attempt: 6, role: 'reviewer', provider: 'codex', model: 'gpt-6.1-sol',
        status: 'completed', decision: 'revise', wall: 80.3, verifySeconds: 0, turns: 1,
        costUsd: null, costMissing: 1, usage: [8425, 2101, 812, 811776, 0], started: '14:35:58', finished: '14:37:18' },
      { order: 14, stage: 'implement', attempt: 8, role: 'developer', provider: 'claude', model: 'sonnet',
        status: 'completed', decision: null, wall: 225.2, verifySeconds: 0, turns: 1,
        costUsd: 0.642862, costMissing: 0, usage: [24, 6686, 673, 5188740, 14270], started: '14:37:18', finished: '14:41:03' },
      { order: 15, stage: 'review_work', attempt: 7, role: 'reviewer', provider: 'codex', model: 'gpt-6.1-sol',
        status: 'completed', decision: 'approved', wall: 334, verifySeconds: 0, turns: 1,
        costUsd: null, costMissing: 1, usage: [24532, 3570, 2088, 4211584, 0], started: '14:41:03', finished: '14:46:37' },
    ],
  },
};

// RENDER

const root = document.getElementById('root');
const number = new Intl.NumberFormat('en-US');
let toastTimer;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function notify(message) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = el('div', 'metrics-toast');
    toast.id = 'toast';
    toast.setAttribute('role', 'status');
    document.body.append(toast);
  }
  toast.textContent = message;
  toast.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.style.display = 'none'; }, 2600);
}

function duration(seconds) {
  if (seconds === null || seconds === undefined) return '—';
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours > 0) return hours + 'h ' + minutes + 'm';
  if (minutes > 0) return minutes + 'm ' + rest + 's';
  return rest + 's';
}

function money(usd) {
  return '$' + usd.toFixed(2);
}

function status(text, tone) {
  const node = el('span', 'mg-status mg-status--' + tone);
  const icon = el('span', null, { ok: '✓', warn: '⚠', error: '✗' }[tone]);
  icon.setAttribute('aria-hidden', 'true');
  node.append(icon, el('span', null, text));
  return node;
}

function pill(text, tone) {
  return el('span', 'mg-pill' + (tone ? ' mg-pill--' + tone : ''), text);
}

function action(label, kind, intent) {
  const node = el('button', 'mg-btn mg-btn--' + kind, label);
  node.type = 'button';
  node.addEventListener('click', () => { notify('Mô phỏng intent: ' + intent); });
  return node;
}

function section(title) {
  const node = el('section', 'mg-section');
  node.append(el('h2', null, title));
  return node;
}

function renderHeader(m) {
  const header = el('header', 'mg-header');
  header.append(status('Completed', 'ok'));
  header.append(el('h1', 'mg-title', m.title));
  const parts = [m.workflow, m.sessionId, m.completedAt ? 'completed ' + m.completedAt : null];
  if (m.kind === 'ok') parts.push(duration(m.totals.wallSeconds));
  header.append(el('p', 'mg-subtitle', parts.filter(Boolean).join(' · ')));
  const actions = el('div', 'mg-actions');
  actions.append(
    action('Open result', 'primary', 'sessionAction openResult'),
    action('Results', 'secondary', 'openResults'),
    action('Task', 'secondary', 'sessionAction openTask'),
  );
  const more = el('button', 'mg-btn mg-btn--secondary', '⋯');
  more.type = 'button';
  more.setAttribute('aria-label', 'More actions');
  more.setAttribute('aria-haspopup', 'menu');
  more.addEventListener('click', () => { notify('Mô phỏng menu: Copy ID · Reveal · Open metrics.json'); });
  actions.append(more);
  header.append(actions);
  return header;
}

function missingCostExecutions(m) {
  return m.executions.filter((execution) => execution.costMissing > 0);
}

function banner(m) {
  if (m.kind === 'missing') {
    const node = el('div', 'metrics-banner');
    const body = el('div');
    body.append(
      el('p', null, 'No metrics recorded for this session.'),
      el('p', 'mg-muted', 'Migent writes metrics.json when a workflow session completes. Sessions completed before metrics existed, or agent sessions, have none.'),
    );
    node.append(body);
    return node;
  }
  if (m.kind === 'invalid') {
    const node = el('div', 'metrics-banner metrics-banner--error');
    const body = el('div');
    body.append(
      el('p', null, 'metrics.json is not valid JSON.'),
      el('p', 'mg-muted mg-mono', m.reason),
      el('p', 'mg-muted', 'The file stays on disk. The session state above comes from status.json.'),
    );
    const row = el('p');
    row.append(action('Open metrics.json', 'secondary', 'openMetricsFile'));
    body.append(row);
    node.append(body);
    return node;
  }
  const missing = missingCostExecutions(m);
  if (missing.length === 0) return null;
  const providers = [...new Set(missing.map((execution) => execution.provider).filter(Boolean))].join(', ');
  const node = el('div', 'metrics-banner');
  const body = el('div');
  body.append(
    el('p', null, 'Cost is partial.'),
    el('p', 'mg-muted',
      missing.length + ' of ' + m.totals.executions + ' executions did not report a cost' +
      (providers ? ' (' + providers + ')' : '') + ', so ' + money(m.totals.costUsd) + ' understates this session.'),
  );
  if (m.totals.uncapturedTurns > 0) {
    body.append(el('p', 'mg-warn', m.totals.uncapturedTurns + ' turn(s) captured no usage at all.'));
  }
  node.append(body);
  return node;
}

function rendersStat(grid, label, value, note, tone) {
  const cell = el('div', 'metrics-stat');
  cell.append(el('dt', null, label));
  const cellValue = el('dd', null, value);
  cell.append(cellValue);
  if (note) cellValue.append(el('span', 'metrics-note' + (tone ? ' metrics-note--' + tone : ''), note));
  grid.append(cell);
}

function renderStats(m) {
  const t = m.totals;
  const grid = el('dl', 'metrics-stats');
  const activePercent = t.wallSeconds > 0 ? Math.round((t.activeSeconds / t.wallSeconds) * 100) : 0;
  rendersStat(grid, 'Wall time', duration(t.wallSeconds), 'first start to last finish');
  rendersStat(grid, 'Active time', duration(t.activeSeconds), activePercent + '% of wall');
  rendersStat(grid, 'Executions', String(t.executions), t.skipped > 0 ? t.skipped + ' skipped' : 'no skips');
  rendersStat(grid, 'Turns', String(t.turns), t.uncapturedTurns > 0 ? t.uncapturedTurns + ' uncaptured' : 'all captured');
  rendersStat(grid, 'Revisions', String(t.revisions), 'route backs, not retries');
  rendersStat(grid, 'Verify', duration(t.verifySeconds), t.verifyRed > 0 ? t.verifyRed + ' red run(s)' : 'no verify commands', t.verifyRed > 0 ? 'warn' : null);
  const missingCount = m.executions.filter((execution) => execution.costMissing > 0).length;
  rendersStat(grid, 'Known cost', money(t.costUsd), t.costPartial ? 'partial — ' + missingCount + ' executions missing' : 'reported by every execution', t.costPartial ? 'warn' : null);
  rendersStat(grid, 'Failures', String(t.failed), t.blocked + ' blocked · ' + t.verifyRed + ' verify red', t.failed > 0 ? 'warn' : null);
  return grid;
}

function stageSeconds(m, stage) {
  return m.executions
    .filter((execution) => execution.stage === stage)
    .reduce((sum, execution) => sum + execution.wall, 0);
}

function renderStages(m) {
  const node = section('Stages');
  const entries = Object.entries(m.stages);
  const longest = Math.max(1, ...entries.map(([name]) => stageSeconds(m, name)));
  const list = el('ul', 'mg-list');
  for (const [name, stage] of entries) {
    const seconds = stageSeconds(m, name);
    const item = el('li');
    const row = el('div', 'mg-row');
    const main = el('div', 'mg-row-main');
    main.append(el('span', 'mg-mono', name));
    const track = el('div', 'metrics-bar');
    const fill = el('span');
    fill.style.width = Math.max(2, Math.round((seconds / longest) * 100)) + '%';
    track.append(fill);
    main.append(track);
    const meta = el('span', 'mg-row-meta');
    meta.append(el('span', 'metrics-row-value', duration(seconds)));
    const parts = [stage.executions + ' executions'];
    if (stage.revisions > 0) parts.push(stage.revisions + ' revisions');
    if (stage.failed > 0) parts.push(stage.failed + ' failed');
    if (stage.blocked > 0) parts.push(stage.blocked + ' blocked');
    meta.append(el('span', null, parts.join(' · ')));
    row.append(main, meta);
    item.append(row);
    list.append(item);
  }
  node.append(list);
  node.append(el('p', 'mg-muted', 'Bar length is the wall time spent in that stage across all its attempts.'));
  return node;
}

function renderUsage(m) {
  const node = section('Usage');
  const tokens = [
    ['Input', m.totals.input],
    ['Output', m.totals.output],
    ['Reasoning', m.totals.reasoning],
    ['Cache read', m.totals.cacheRead],
    ['Cache write', m.totals.cacheWrite],
  ];
  const longest = Math.max(1, ...tokens.map(([, value]) => value));
  const list = el('ul', 'mg-list');
  for (const [label, value] of tokens) {
    const item = el('li');
    const row = el('div', 'mg-row');
    const main = el('div', 'mg-row-main');
    main.append(el('span', null, label));
    const track = el('div', 'metrics-bar metrics-bar--quiet');
    const fill = el('span');
    fill.style.width = Math.max(1, Math.round((value / longest) * 100)) + '%';
    track.append(fill);
    main.append(track);
    row.append(main, el('span', 'mg-row-meta', number.format(value)));
    item.append(row);
    list.append(item);
  }
  node.append(list);
  node.append(el('p', 'mg-muted', 'Input excludes cache reads. Reasoning is reported beside output, not added to it.'));

  const byModel = new Map();
  for (const execution of m.executions) {
    const key = execution.provider === null ? 'No role (verify stage)' : execution.provider + '/' + execution.model;
    const entry = byModel.get(key) || { executions: 0, known: 0, missing: 0 };
    entry.executions += 1;
    if (execution.costUsd === null) entry.missing += 1;
    else entry.known += execution.costUsd;
    byModel.set(key, entry);
  }
  node.append(el('h3', null, 'Providers'));
  const providers = el('ul', 'mg-list');
  for (const [name, entry] of byModel) {
    const item = el('li');
    const row = el('div', 'mg-row');
    row.append(el('span', 'mg-row-main mg-mono', name));
    const meta = entry.missing === 0
      ? entry.executions + ' executions · ' + money(entry.known)
      : entry.known === 0
        ? entry.executions + ' executions · no cost reported'
        : entry.executions + ' executions · ' + money(entry.known) + ' known · ' + entry.missing + ' missing';
    row.append(el('span', 'mg-row-meta', meta));
    item.append(row);
    providers.append(item);
  }
  node.append(providers);
  return node;
}

function executionStatusPill(execution) {
  if (execution.status === 'failed') return pill('Failed', 'error');
  if (execution.status === 'cancelled') return pill('Cancelled', 'warn');
  if (execution.status === 'skipped') return pill('Skipped');
  if (execution.decision === 'revise') return pill('Completed · revise', 'warn');
  if (execution.decision === 'approved') return pill('Completed · approved');
  return pill('Completed');
}

function executionDetails(execution) {
  const details = el('details', 'mg-details');
  const summary = el('summary');
  const line = el('span', 'metrics-exec-summary');
  const title = el('span', 'metrics-exec-title');
  title.append(el('span', 'mg-mono', '#' + execution.order + ' ' + execution.stage + ' · attempt ' + execution.attempt));
  if (execution.role) title.append(el('span', 'mg-muted', '  ' + execution.role));
  line.append(title);
  const meta = el('span', 'metrics-exec-meta');
  meta.append(executionStatusPill(execution));
  meta.append(el('span', 'mg-muted', execution.provider === null ? 'no role' : execution.provider + '/' + execution.model));
  meta.append(el('span', null, duration(execution.wall)));
  meta.append(el('span', execution.costUsd === null ? 'mg-warn' : 'mg-muted',
    execution.costUsd === null ? 'no cost' : money(execution.costUsd)));
  line.append(meta);
  summary.append(line);
  details.append(summary);

  const body = el('div', 'mg-details-body');
  body.append(el('h3', null, 'Timing and state'));
  const facts = el('dl', 'metrics-kv');
  function fact(label, value) {
    facts.append(el('dt', null, label), el('dd', null, value));
  }
  fact('Status', execution.status + (execution.decision ? ' · ' + execution.decision : ''));
  fact('Provider', execution.provider === null ? 'No role; Migent runs the verify list' : execution.provider + '/' + execution.model);
  if (execution.started) fact('Started', execution.started);
  if (execution.finished) fact('Finished', execution.finished);
  fact('Wall / verify', duration(execution.wall) + ' / ' + duration(execution.verifySeconds));
  fact('Turns', String(execution.turns));
  fact('Cost', execution.costUsd === null
    ? 'Not reported (' + execution.costMissing + ' turn(s) missing)'
    : money(execution.costUsd) + (execution.costMissing > 0 ? ' (partial)' : ''));
  if (execution.resumeFrom) fact('Resumes', execution.resumeFrom);
  if (execution.routedFrom) fact('Routed from', execution.routedFrom);
  body.append(facts);

  body.append(el('h3', null, 'Tokens'));
  const usage = el('dl', 'metrics-kv');
  const tokens = [
    ['Input', execution.usage[0]],
    ['Output', execution.usage[1]],
    ['Reasoning', execution.usage[2]],
    ['Cache read', execution.usage[3]],
    ['Cache write', execution.usage[4]],
  ];
  for (const [label, value] of tokens) {
    usage.append(el('dt', null, label), el('dd', null, number.format(value)));
  }
  body.append(usage);

  if (execution.verify) {
    body.append(el('h3', null, 'Verify'));
    const verify = el('dl', 'metrics-kv');
    const firstPass = execution.verify.firstPass ? 'yes' : 'no';
    verify.append(
      el('dt', null, 'Runs'), el('dd', null, String(execution.verify.runs)),
      el('dt', null, 'Red runs'), el('dd', null, String(execution.verify.red)),
      el('dt', null, 'First pass'), el('dd', null, firstPass),
    );
    if (execution.verify.failedCommands.length > 0) {
      const list = el('ul', 'metrics-plain');
      for (const command of execution.verify.failedCommands) {
        list.append(el('li', 'mg-mono', command));
      }
      const cell = el('dd');
      cell.append(list);
      verify.append(el('dt', null, 'Failed commands'), cell);
    }
    body.append(verify);
  }

  details.append(body);
  return details;
}

function renderExecutions(m) {
  const node = section('Executions');
  node.append(el('p', 'mg-muted', 'In execution order. Expand a row for timings, tokens and verify results.'));
  const list = el('div');
  m.executions.forEach((execution, index) => {
    const details = executionDetails(execution);
    if (index === m.executions.length - 1) details.open = true;
    list.append(details);
  });
  node.append(list);
  return node;
}

function renderDetails(m) {
  const details = el('details', 'mg-details');
  details.append(el('summary', null, 'Details'));
  const body = el('div', 'mg-details-body');
  const facts = el('dl', 'metrics-kv');
  facts.append(el('dt', null, 'Session'), el('dd', 'mg-mono', m.sessionId));
  facts.append(el('dt', null, 'Workflow'), el('dd', 'mg-mono', m.workflow));
  facts.append(el('dt', null, 'Completed'), el('dd', null, m.completedAt));
  facts.append(el('dt', null, 'Record'), el('dd', null, 'Written by Migent when the session completed; it does not change afterwards.'));
  body.append(facts);
  const row = el('p');
  row.append(action('Open metrics.json', 'secondary', 'openMetricsFile'));
  body.append(row);
  details.append(body);
  return details;
}

function render() {
  const scenario = document.getElementById('scenario').value;
  const model = SCENARIOS[scenario];
  document.getElementById('tabTitle').textContent = '✓ ' + model.workflow + ' · Metrics ×';
  root.replaceChildren();
  root.append(renderHeader(model));
  const notice = banner(model);
  if (notice) root.append(notice);
  if (model.kind !== 'ok') return;
  root.append(renderStats(model), renderStages(model), renderUsage(model), renderExecutions(model), renderDetails(model));
}

document.getElementById('scenario').addEventListener('change', render);
render();



