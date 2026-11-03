// Stand-in for the Migent CLI in integration tests.
// `--version` answers the capability probe. `session prepare|run|cancel` write the same files the real
// CLI does, in the current directory's `.migent/sessions`, so the extension's watcher and store follow.
//   MIGENT_FAKE_RUN_MS   how long `session run|continue` keeps its lock before completing (default 1500)
//   MIGENT_FAKE_EXIT     exit code a finished run reports instead of 0, with the status left unchanged
//   MIGENT_FAKE_ANSWER   how `session continue --reply-file` treats the reply: record (default), reject (exit 1,
//                        nothing recorded), garble (exit 0, questions.json left unreadable), followup (record, then
//                        ask a new batch in the next execution and exit 9), fail-after-record (record, exit 1)
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const args = process.argv.slice(2);
const RUN_MS = Number(process.env.MIGENT_FAKE_RUN_MS ?? 1500);
const TICK_MS = 50;
const CANCEL_WAIT_MS = 5000;

function option(name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

const sessionsDir = path.join(process.cwd(), '.migent', 'sessions');
const dirOf = (id) => path.join(sessionsDir, id);
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
      `created_at: ${new Date().toISOString()}\nschema_version: 2\n`,
  );
  return id;
}

function prepare() {
  const id = create(option('--workflow'), args[2]);
  writeStatus(id, 'prepared', { title: args[2], workflow_id: option('--workflow') });
  console.error(`[migent] session_id: ${id}`);
  console.log(
    JSON.stringify({
      session_id: id,
      title: args[2],
      status: 'prepared',
      task_path: `.migent/sessions/${id}/task.md`,
    }),
  );
}


// `session continue --reply-file`: normalize the reply map into the question records, as the real CLI does.
function answer(id) {
  // Every call is logged so tests can assert the exact argv the extension used.
  fs.appendFileSync(path.join(process.cwd(), 'fake-argv.log'), JSON.stringify(args) + '\n');
  const mode = process.env.MIGENT_FAKE_ANSWER ?? 'record';
  // `slow` records normally but only after a pause, so a test can observe the submission while it is in flight.
  if (process.env.MIGENT_FAKE_ANSWER_DELAY_MS) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.env.MIGENT_FAKE_ANSWER_DELAY_MS));
  const file = path.join(dirOf(id), 'questions.json');
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

function run() {
  const workflow = option('--workflow');
  const id = option('--session') ?? (args[1] === 'continue' ? args[2] : create(workflow, option('--task') ?? 'task'));
  if (option('--reply-file') !== undefined) answer(id);
  const lockFile = path.join(dirOf(id), 'session.lock');
  const cancelFile = path.join(dirOf(id), 'cancel.requested');
  const beat = () =>
    writeJson(lockFile, { pid: process.pid, host: os.hostname(), heartbeat_at: new Date().toISOString() });
  beat();
  const executionId = option('--reply-file') === undefined ? '0001-plan--attempt-01' : '0002-plan--attempt-02';
  if (option('--reply-file') !== undefined) {
    const dir = path.join(dirOf(id), 'executions', executionId);
    fs.mkdirSync(dir, { recursive: true });
    writeJson(path.join(dir, 'execution.json'), { execution_id: executionId, stage_id: option('--stage') ?? 'plan', status: 'running' });
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

if (args[0] === '--version') {
  console.log('migent 0.3.1');
} else if (args[0] === 'session' && args[1] === 'prepare') {
  prepare();
} else if (args[0] === 'session' && args[1] === 'run') {
  run();
} else if (args[0] === 'session' && args[1] === 'continue') {
  run();
} else if (args[0] === 'session' && args[1] === 'cancel') {
  cancel();
} else {
  console.error(`fake-migent: unsupported command ${args.join(' ')}`);
  process.exit(2);
}
