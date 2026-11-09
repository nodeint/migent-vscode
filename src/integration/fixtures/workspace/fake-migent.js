// Stand-in for the Migent CLI in integration tests.
// `--version` answers the capability probe. `session prepare|run|cancel` write the same files the real
// CLI does, in the current directory's `.migent/sessions`, so the extension's watcher and store follow.
//   MIGENT_FAKE_RUN_MS   how long `session run|continue` keeps its lock before completing (default 1500)
//   MIGENT_FAKE_EXIT     exit code a finished run reports instead of 0, with the status left unchanged
//   MIGENT_FAKE_ANSWER   how `session continue --reply-file` treats the reply: record (default), reject (exit 1,
//                        nothing recorded), garble (exit 0, questions.json left unreadable), followup (record, then
//                        ask a new batch in the next execution and exit 9), fail-after-record (record, exit 1)
//   MIGENT_FAKE_LEGACY   1 behaves like CLI 0.3.1: `prepare` writes no task.md and no workflow.yaml, `--version` says 0.3.1.
//                        Otherwise it models 0.5.2: `prepare` writes an empty task.md and an editable workflow.yaml;
//                        `run --session` validates the draft (its `id:` must match the manifest, task.md must not be
//                        empty) and exits 2 before writing anything, else freezes it as workflow.frozen.yaml;
//                        `continue` keeps the frozen copy, and `--refresh-workflow` re-freezes from the draft.
//                        A failed execution writes `failure.md`; `workflow validate` and `get` are implemented.
//   MIGENT_FAKE_COMPLETE_WARN  1 makes `session complete` warn on stderr about a missing required artifact (exit 0)
//   MIGENT_FAKE_PREFLIGHT  fail makes `session run` fail the preflight (exit 2, nothing created or frozen) unless
//                        `--skip-preflight` is passed. Ignored in legacy mode.
//   MIGENT_FAKE_REPLY    how `session continue --stage --reply-file` treats a reply to an ordinary blocker (a session
//                        with no questions.json): consume (default; the new execution's prompt carries the reply),
//                        ignore (a new execution without the reply, exit 0), reject (exit 2, nothing written)
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const args = process.argv.slice(2);
// The harness reads this to prove no fake CLI process outlives its scenario.
fs.appendFileSync(path.join(process.cwd(), 'fake-pids.log'), `${process.pid}\n`);
const IS_LEGACY = process.env.MIGENT_FAKE_LEGACY === '1';
const PREFLIGHT_FAILS = process.env.MIGENT_FAKE_PREFLIGHT === 'fail' || process.env.MIGENT_FAKE_PREFLIGHT === '1';
const RUN_MS = Number(process.env.MIGENT_FAKE_RUN_MS ?? 1500);
const TICK_MS = 50;
const CANCEL_WAIT_MS = 5000;

function option(name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

const sessionsDir = path.join(process.cwd(), '.migent', 'sessions');
const dirOf = (id) => path.join(sessionsDir, id);
const draftOf = (id) => path.join(dirOf(id), 'workflow.yaml');
const frozenOf = (id) => path.join(dirOf(id), 'workflow.frozen.yaml');
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value));

function writeStatus(id, state, extra = {}) {
  const file = path.join(dirOf(id), 'status.json');
  const previous = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  writeJson(file, {
    ...previous,
    session_id: id,
    status: state,
    updated_at: new Date().toISOString(),
    ...extra,
  });
}

// Like the real CLI, `prepare` leaves task.md for the caller to write.
function create(workflow, title) {
  const id = crypto.randomUUID();
  fs.mkdirSync(dirOf(id), { recursive: true });
  fs.writeFileSync(
    path.join(dirOf(id), 'manifest.yaml'),
    `session_id: ${id}\ntitle: ${JSON.stringify(title)}\nworkflow_id: ${workflow}\n` +
      `created_at: ${new Date().toISOString()}\nschema_version: 2\n` +
      (option('--prior') === undefined ? '' : `prior_session_id: ${option('--prior')}\n`),
  );
  return id;
}

// `session prepare`: an empty task.md and an editable copy of the workflow (CLI 0.3.5 and later).
function writeDraft(id, workflow) {
  fs.writeFileSync(path.join(dirOf(id), 'task.md'), '');
  fs.writeFileSync(
    draftOf(id),
    `# Session workflow draft. Edit this file before starting the session.
schema_version: 7
id: ${workflow}
stages: []
`,
  );
}

// `session run --session`: reject a bad draft before anything is written, else freeze it (CLI 0.3.5 and later).
function startDraft(id) {
  const manifestFile = path.join(dirOf(id), 'manifest.yaml');
  const expected = /^workflow_id: (.*)$/m.exec(fs.readFileSync(manifestFile, 'utf8'))?.[1];
  const found = /^id: (.*)$/m.exec(fs.readFileSync(draftOf(id), 'utf8'))?.[1];
  if (found !== expected) {
    console.error(`migent: Session workflow id is ${found}, not ${expected}. Do not change id in workflow.yaml.`);
    process.exit(2);
  }
  if (fs.readFileSync(path.join(dirOf(id), 'task.md'), 'utf8').trim() === '') {
    console.error(`migent: Session ${id} has no task.md or it is empty. Write .migent/sessions/${id}/task.md before starting.`);
    process.exit(2);
  }
  fs.copyFileSync(draftOf(id), frozenOf(id));
}

function prepare() {
  fs.appendFileSync(path.join(process.cwd(), 'fake-argv.log'), JSON.stringify(args) + '\n');
  const id = create(option('--workflow'), args[2]);
  if (!IS_LEGACY) writeDraft(id, option('--workflow'));
  writeStatus(id, 'prepared', { title: args[2], workflow_id: option('--workflow') });
  console.error(`[migent] session_id: ${id}`);
  console.log(
    JSON.stringify({
      session_id: id,
      title: args[2],
      status: 'prepared',
      task_path: `.migent/sessions/${id}/task.md`,
      ...(IS_LEGACY ? {} : { workflow_path: `.migent/sessions/${id}/workflow.yaml` }),
    }),
  );
}


// What a reply resumes, read from the session like the real CLI does: a role session names its role in the manifest
// (and takes no `--stage`), a cancelled session's reply is an interrupted turn, and a blocked one resumes its blocker.
function replyContext(id) {
  const manifestFile = path.join(dirOf(id), 'manifest.yaml');
  const role = fs.existsSync(manifestFile) ? /^role: (.+)$/m.exec(fs.readFileSync(manifestFile, 'utf8'))?.[1] ?? null : null;
  const status = JSON.parse(fs.readFileSync(path.join(dirOf(id), 'status.json'), 'utf8'));
  return {
    role,
    stage: option('--stage') ?? role ?? 'plan',
    interrupted: status.status === 'cancelled',
    resumes: status.blocked_by_execution_ids?.[0] ?? status.latest_execution_id ?? null,
  };
}

// The user turn the real CLI records (`stage-reply` template, with the `role-run` responsibilities for a role).
function replyTurn(context, text) {
  const lead = context.interrupted ? 'Your previous turn was stopped by the human before it finished. Their message:\n\n' : '';
  const body = `## Human reply\n\n${lead}${text.trim()}`;
  return context.role === null ? body : `## Role\n\n- Be terse.\n\n${body}`;
}

// An ordinary blocker has no questions: the reply becomes the prompt of the stage's next attempt.
function replyBlocker(id) {
  const mode = process.env.MIGENT_FAKE_REPLY ?? 'consume';
  if (mode === 'reject') {
    console.error('reply rejected: configuration error');
    process.exit(2);
  }
  const text = fs.readFileSync(option('--reply-file'), 'utf8');
  const context = replyContext(id);
  const stage = context.stage;
  const dir = path.join(dirOf(id), 'executions', `0002-${stage}--attempt-02`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'execution.json'), JSON.stringify({ stage_id: stage, resumes_execution_id: context.resumes }));
  // The real CLI records the reply as its own user turn (`## Human reply`) in the execution's conversation.json history.
  const turn = mode === 'ignore' ? 'Continue.' : replyTurn(context, text);
  fs.writeFileSync(path.join(dir, 'conversation.json'), JSON.stringify({ history: [{ role: 'user', content: turn }] }));
}

// `session continue --reply-file`: normalize the reply map into the question records, as the real CLI does.
function answer(id) {
  // Every call is logged so tests can assert the exact argv the extension used.
  fs.appendFileSync(path.join(process.cwd(), 'fake-argv.log'), JSON.stringify(args) + '\n');
  const mode = process.env.MIGENT_FAKE_ANSWER ?? 'record';
  // `slow` records normally but only after a pause, so a test can observe the submission while it is in flight.
  // A hold file makes the answer wait until the test deletes it, so a test can act while the CLI is surely in flight.
  const hold = process.env.MIGENT_FAKE_ANSWER_HOLD;
  if (hold) {
    fs.writeFileSync(hold, 'held');
    while (fs.existsSync(hold)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
  if (process.env.MIGENT_FAKE_ANSWER_DELAY_MS) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.env.MIGENT_FAKE_ANSWER_DELAY_MS));
  const file = path.join(dirOf(id), 'questions.json');
  if (!fs.existsSync(file)) return replyBlocker(id);
  if (mode === 'reject') {
    console.error('reply rejected: invalid answer');
    process.exit(1);
  }
  if (mode === 'garble') {
    fs.writeFileSync(file, '{ not json');
    process.exit(0);
  }
  const reply = JSON.parse(fs.readFileSync(option('--reply-file'), 'utf8'));
  const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  // Like the real CLI: `--stage` selects that stage's pending batch; without it the session's only batch.
  const stage = option('--stage');
  const target = stored.questions.filter((record) => record.status === 'pending' && (stage === undefined || record.stage_id === stage));
  const stages = new Set(target.map((record) => record.stage_id));
  if (target.length === 0 || (stage === undefined && stages.size > 1)) {
    console.error('no single pending question batch to answer; pass --stage');
    process.exit(2);
  }
  // The whole batch is answered at once: every id, and only those.
  const expected = target.map((record) => record.id).sort().join(',');
  if (Object.keys(reply).sort().join(',') !== expected) {
    console.error('reply must answer every pending question of the batch');
    process.exit(2);
  }
  for (const record of target) {
    const value = reply[record.id];
    const ids = record.options.map((entry) => entry.id);
    const selected = Array.isArray(value) ? value : ids.includes(value) ? [value] : [];
    record.status = 'answered';
    // Like the real CLI, `text` is present only for a free-text answer.
    record.answer = typeof value === 'string' && selected.length === 0 ? { selected, text: value } : { selected };
    record.answered_at = new Date().toISOString();
  }
  if (mode === 'followup') {
    stored.questions.push(
      ...JSON.parse(JSON.stringify(stored.questions.filter((record) => record.status === 'answered'))).map(
        (record) => ({ ...record, status: 'pending', answer: null, answered_at: null, execution_id: '0002-plan--attempt-02' }),
      ),
    );
  }
  writeJson(file, stored);
  const pending = stored.questions.filter((record) => record.status === 'pending');
  writeStatus(id, pending.length > 0 ? 'question' : 'active', { questions: pending });
  if (mode === 'followup') process.exit(9);
  if (mode === 'fail-after-record') process.exit(1);
}

// CLI 0.3.6 `session run`: the doctor checks over the whole workflow run before anything is created or frozen.
function preflight() {
  if (IS_LEGACY || !PREFLIGHT_FAILS || args.includes('--skip-preflight')) return;
  console.error('workflow    failed');
  console.error('  client claude-code is not on PATH');
  console.error('Preflight failed: fix the problems above and run again, or pass --skip-preflight.');
  process.exit(2);
}

// CLI 0.3.6 writes a readable report for an execution that failed, next to its other files.
function writeFailureReport(id, executionId, code) {
  if (IS_LEGACY || ![1, 3, 4, 5, 6, 7].includes(code)) return;
  const dir = path.join(dirOf(id), 'executions', executionId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'failure.md'),
    `# Stage plan failed\n\n- exit code: ${code}\n- client: fake\n- model: fake\n\n` +
      'The fake CLI stopped before the stage completed.\n',
  );
}

function run() {
  if (option('--reply-file') === undefined) {
    fs.appendFileSync(path.join(process.cwd(), 'fake-argv.log'), JSON.stringify(args) + '\n');
  }
  if (args[1] === 'run') preflight();
  const workflow = option('--workflow');
  const id = option('--session') ?? (args[1] === 'continue' ? args[2] : create(workflow, option('--task') ?? 'task'));
  if (option('--reply-file') !== undefined) answer(id);
  if (!IS_LEGACY && fs.existsSync(draftOf(id))) {
    if (args[1] === 'run') {
      if (!fs.existsSync(frozenOf(id))) startDraft(id);
    } else if (args.includes('--refresh-workflow')) {
      fs.copyFileSync(draftOf(id), frozenOf(id));
    }
  }
  const lockFile = path.join(dirOf(id), 'session.lock');
  const cancelFile = path.join(dirOf(id), 'cancel.requested');
  const beat = () =>
    writeJson(lockFile, { pid: process.pid, host: os.hostname(), heartbeat_at: new Date().toISOString() });
  beat();
  const replyStage = option('--reply-file') === undefined ? 'plan' : replyContext(id).stage;
  const executionId = option('--reply-file') === undefined ? '0001-plan--attempt-01' : `0002-${replyStage}--attempt-02`;
  if (option('--reply-file') !== undefined) {
    const dir = path.join(dirOf(id), 'executions', executionId);
    fs.mkdirSync(dir, { recursive: true });
    // Keep what `replyBlocker` recorded (the execution it resumes) instead of overwriting it.
    const recordFile = path.join(dir, 'execution.json');
    const kept = fs.existsSync(recordFile) ? JSON.parse(fs.readFileSync(recordFile, 'utf8')) : {};
    writeJson(recordFile, { execution_id: executionId, stage_id: replyStage, status: 'running', ...kept });
  }
  writeStatus(id, 'active', { workflow_id: workflow, latest_execution_id: executionId });
  console.error(`[migent] session_id: ${id}`);
  console.error('[migent] stage plan started');
  const startedAt = Date.now();
  const timer = setInterval(() => {
    beat();
    if (fs.existsSync(cancelFile)) {
      clearInterval(timer);
      fs.rmSync(cancelFile, { force: true });
      writeStatus(id, 'cancelled');
      fs.rmSync(lockFile, { force: true });
      process.exit(130);
    }
    if (Date.now() - startedAt >= RUN_MS) {
      clearInterval(timer);
      const code = Number(process.env.MIGENT_FAKE_EXIT ?? 0);
      if (code === 0) writeStatus(id, 'completed');
      writeFailureReport(id, executionId, code);
      fs.rmSync(lockFile, { force: true });
      process.exit(code);
    }
  }, TICK_MS);
}

function cancel() {
  const id = args[2];
  const lockFile = path.join(dirOf(id), 'session.lock');
  if (!fs.existsSync(lockFile)) {
    console.error(`Session ${id} is not running.`);
    process.exit(2);
  }
  fs.writeFileSync(path.join(dirOf(id), 'cancel.requested'), '');
  const startedAt = Date.now();
  const timer = setInterval(() => {
    const isStopped = !fs.existsSync(lockFile);
    if (!isStopped && Date.now() - startedAt < CANCEL_WAIT_MS) return;
    clearInterval(timer);
    console.log(JSON.stringify({ session_id: id, cancelled: isStopped, status: isStopped ? 'cancelled' : 'active' }));
    process.exit(isStopped ? 0 : 1);
  }, TICK_MS);
}

// `session complete` (CLI 0.5.2): a stopped workflow session becomes completed; refused (exit 2) when it is missing,
// prepared, a role session or running. Already completed is a no-op success.
function complete() {
  fs.appendFileSync(path.join(process.cwd(), 'fake-argv.log'), JSON.stringify(args) + '\n');
  const id = args[2];
  const dir = dirOf(id);
  const statusFile = path.join(dir, 'status.json');
  const refuse = (reason) => {
    console.error(`migent: ${reason}`);
    process.exit(2);
  };
  if (!fs.existsSync(statusFile)) refuse(`Session ${id} was not found.`);
  if (/^role:/m.test(fs.readFileSync(path.join(dir, 'manifest.yaml'), 'utf8'))) refuse(`Session ${id} is a role session.`);
  if (fs.existsSync(path.join(dir, 'session.lock'))) refuse(`Session ${id} is running.`);
  const current = JSON.parse(fs.readFileSync(statusFile, 'utf8')).status;
  if (current === 'prepared') refuse(`Session ${id} is prepared and has not run.`);
  if (current === 'completed') return;
  if (process.env.MIGENT_FAKE_COMPLETE_WARN === '1') console.error('warning: required artifact "plan" was not produced');
  writeStatus(id, 'completed', { completion_method: 'manual' });
}

function workflowValidate() {
  const draft = args[2];
  const asJson = args.includes('--json');
  const emit = (code, valid, diagnostics) => {
    if (asJson) {
      console.log(JSON.stringify({ schema_version: 1, command: 'workflow.validate', valid, diagnostics }));
    } else {
      for (const item of diagnostics) console.error(`${item.severity}: ${item.message} [${item.code}]`);
      if (valid) console.log('Valid.');
    }
    process.exit(code);
  };
  if (draft === undefined || draft.startsWith('-')) {
    return emit(2, false, [{ severity: 'error', code: 'invalid-invocation', message: 'Pass a workflow draft file.' }]);
  }
  let text;
  try {
    text = fs.readFileSync(path.resolve(process.cwd(), draft), 'utf8');
  } catch (error) {
    return emit(2, false, [{ severity: 'error', code: 'draft-unreadable', message: `Unable to read draft: ${error.message}` }]);
  }
  let document = null;
  if (draft.endsWith('.json')) {
    try {
      document = JSON.parse(text);
    } catch (error) {
      return emit(1, false, [{ severity: 'error', code: 'syntax', message: error.message }]);
    }
  }
  const id = document === null ? /^id:\s*(\S.*)$/m.exec(text)?.[1] : document.id;
  if (typeof id !== 'string' || id.trim() === '') {
    return emit(1, false, [{ severity: 'error', code: 'invalid-value', path: ['id'], message: 'id is required.' }]);
  }
  return emit(0, true, []);
}

function workflowViews() {
  const directory = path.join(process.cwd(), '.migent', 'workflows');
  let names;
  try {
    names = fs.readdirSync(directory).filter((name) => /\.ya?ml$/.test(name)).sort();
  } catch {
    return [];
  }
  return names.map((file) => {
    const text = fs.readFileSync(path.join(directory, file), 'utf8');
    return {
      name: /^id:\s*(\S.*)$/m.exec(text)?.[1] ?? file.replace(/\.ya?ml$/, ''),
      file,
      stages: (text.match(/^\s*-\s+id:/gm) ?? []).length,
      roles: [],
      problems: [],
    };
  });
}

function get() {
  const type = args[1];
  let name;
  let session;
  for (let at = 2; at < args.length; at += 1) {
    const value = args[at];
    if (value === '--session') {
      session = args[at + 1];
      at += 1;
    } else if (value === '-o' || value === '--output') {
      at += 1;
    } else if (!value.startsWith('-') && name === undefined) {
      name = value;
    }
  }
  const format = args.includes('--json') ? 'json' : option('-o') ?? option('--output') ?? 'human';
  const print = (value) => console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  const unknown = (resource) => {
    console.error(`Unknown resource type: ${resource}. Valid types: workflow|workflows, role|roles, model|models, config.`);
    process.exit(2);
  };
  if (type === 'config') {
    if (name !== undefined || format === 'name') {
      console.error(name !== undefined ? 'config takes no name.' : '-o name is not valid for config.');
      process.exit(2);
    }
    const file = path.join(process.cwd(), '.migent', 'config.yaml');
    const text = fs.readFileSync(file, 'utf8');
    print(format === 'json' ? { path: '.migent/config.yaml', text } : text);
    return;
  }
  if (type === 'workflow' || type === 'workflows' || type === 'wf') {
    if (session !== undefined) {
      const draft = path.join(dirOf(session), 'workflow.yaml');
      const frozen = path.join(dirOf(session), 'workflow.frozen.yaml');
      const file = fs.existsSync(draft) ? draft : frozen;
      if (!fs.existsSync(file)) {
        console.error(`No session workflow found for ${session}.`);
        process.exit(2);
      }
      print(format === 'json' ? { name: session, file: path.relative(process.cwd(), file), text: fs.readFileSync(file, 'utf8') } : fs.readFileSync(file, 'utf8'));
      return;
    }
    const views = workflowViews();
    if (name === undefined) {
      if (format === 'name') print(views.map((view) => view.name).join('\n'));
      else if (format === 'json') print(views);
      else print(views.map((view) => `${view.name}  ${view.file}`).join('\n'));
      return;
    }
    const view = views.find((candidate) => candidate.name === name || candidate.file === name || candidate.file === `${name}.yaml`);
    if (view === undefined) {
      console.error(`Workflow not found: ${name}.`);
      process.exit(2);
    }
    print(format === 'json' ? view : `${view.name}  ${view.file}`);
    return;
  }
  if (type === 'clients' || type === 'models') {
    // Machine resources of 0.5.0: a plain array, exit 0. `opencode` is not on PATH; `grok` has no models.
    print(
      type === 'clients'
        ? [
            { kind: 'client', name: 'claude-code', command: 'claude', available: true, path: '/bin/claude', effort_option: 'effort', problems: [] },
            { kind: 'client', name: 'codex', command: 'codex', available: true, path: '/bin/codex', effort_option: null, problems: [] },
            { kind: 'client', name: 'grok', command: 'grok', available: true, path: '/bin/grok', effort_option: null, problems: [] },
            { kind: 'client', name: 'opencode', command: 'opencode', available: false, path: null, effort_option: null, problems: ['opencode is not on PATH.'] },
          ]
        : [
            { kind: 'model', name: 'sonnet', client: 'claude-code', default: false },
            { kind: 'model', name: 'opus', client: 'claude-code', default: true },
            { kind: 'model', name: 'gpt-5', client: 'codex', default: true },
            { kind: 'model', name: 'oc', client: 'opencode', default: true },
          ],
    );
    return;
  }
  if (type === 'role' || type === 'roles') {
    if (name !== undefined) {
      console.error(`${type} not found: ${name}.`);
      process.exit(2);
    }
    print(format === 'name' ? '' : []);
    return;
  }
  return unknown(type);
}

if (args[0] === '--version') {
  console.log(IS_LEGACY ? 'migent 0.3.1' : 'migent 0.5.2');
} else if (args[0] === 'workflow' && args[1] === 'validate' && !IS_LEGACY) {
  workflowValidate();
} else if (args[0] === 'get' && args[1] === 'providers' && !IS_LEGACY) {
  console.error('error: unknown resource type providers (removed in 0.5.0)');
  process.exit(2);
} else if (args[0] === 'get' && !IS_LEGACY) {
  get();
} else if (args[0] === 'session' && args[1] === 'prepare') {
  prepare();
} else if (args[0] === 'session' && args[1] === 'run') {
  run();
} else if (args[0] === 'session' && args[1] === 'continue') {
  run();
} else if (args[0] === 'session' && args[1] === 'cancel') {
  cancel();
} else if (args[0] === 'session' && args[1] === 'complete' && !IS_LEGACY) {
  complete();
} else {
  console.error(`fake-migent: unsupported command ${args.join(' ')}`);
  process.exit(2);
}
