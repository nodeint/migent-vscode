// Stand-in for the Migent CLI in integration tests.
// `--version` answers the capability probe. `session prepare|run|cancel` write the same files the real
// CLI does, in the current directory's `.migent/sessions`, so the extension's watcher and store follow.
//   MIGENT_FAKE_RUN_MS   how long `session run|continue` keeps its lock before completing (default 1500)
//   MIGENT_FAKE_EXIT     exit code a finished run reports instead of 0, with the status left unchanged
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

function create(workflow, title) {
  const id = crypto.randomUUID();
  fs.mkdirSync(dirOf(id), { recursive: true });
  fs.writeFileSync(
    path.join(dirOf(id), 'manifest.yaml'),
    `session_id: ${id}\ntitle: ${JSON.stringify(title)}\nworkflow_id: ${workflow}\n` +
      `created_at: ${new Date().toISOString()}\nschema_version: 2\n`,
  );
  fs.writeFileSync(path.join(dirOf(id), 'task.md'), '');
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

function run() {
  const workflow = option('--workflow');
  const id = option('--session') ?? (args[1] === 'continue' ? args[2] : create(workflow, option('--task') ?? 'task'));
  const lockFile = path.join(dirOf(id), 'session.lock');
  const cancelFile = path.join(dirOf(id), 'cancel.requested');
  const beat = () =>
    writeJson(lockFile, { pid: process.pid, host: os.hostname(), heartbeat_at: new Date().toISOString() });
  beat();
  writeStatus(id, 'active', { workflow_id: workflow, latest_execution_id: '0001-plan--attempt-01' });
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
