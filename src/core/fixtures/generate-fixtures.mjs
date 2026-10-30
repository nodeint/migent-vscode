// One-off generator for redacted session fixtures (plans/01-core.md scope).
// Run: node test/fixtures/generate-fixtures.mjs  (then delete or keep for reference)
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "sessions");
const T0 = "2026-10-26T09:00:00.000+00:00";
const T1 = "2026-10-26T09:10:00.000+00:00";
const T2 = "2026-10-26T09:20:00.000+00:00";

function session(name, files) {
  const dir = path.join(root, name);
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(dir, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content.trimStart().replace(/\n$/, "\n"));
  }
}

const manifest = (overrides = {}) =>
  `session_id: 00000000-0000-4000-8000-000000000001
title: "Plan the feature"
workflow_id: plan
workflow_path: .migent/workflows/plan.yaml
created_at: ${T0}
prior_session_id: 00000000-0000-4000-8000-0000000000ff
schema_version: 2
${Object.entries(overrides).map(([k, v]) => `${k}: ${v}`).join("\n")}`;

const manifestNoTitle = `session_id: 00000000-0000-4000-8000-000000000001
workflow_id: plan
workflow_path: .migent/workflows/plan.yaml
task: "Plan the feature"
created_at: ${T0}
schema_version: 2
`;

const status = (overrides = {}) =>
  JSON.stringify(
    {
      session_id: "00000000-0000-4000-8000-000000000001",
      status: "active",
      title: "Plan the feature",
      workflow_id: "plan",
      workflow_path: ".migent/workflows/plan.yaml",
      created_at: T0,
      prior_session_id: "00000000-0000-4000-8000-0000000000ff",
      updated_at: T2,
      task_sha256: "0".repeat(64),
      latest_provider_event: { v: 2, seq: 5, event: "provider.turn_completed", timestamp: T1, execution_id: "0001-plan--attempt-01", stage_id: "plan", summary: "completed", provider: "claude", details: {}, data: {} },
      latest_execution_id: "0001-plan--attempt-01",
      latest_execution_status: "completed",
      latest_stage_id: "plan",
      ...overrides,
    },
    null,
    2,
  ) + "\n";

const execution = (overrides = {}) =>
  JSON.stringify(
    {
      session_id: "00000000-0000-4000-8000-000000000001",
      execution_id: "0001-plan--attempt-01",
      execution_order: 1,
      stage_id: "plan",
      stage_attempt: 1,
      provider: "claude",
      model: "sonnet",
      options: {},
      agent_id: "00000000-0000-0000-0000-000000000001",
      resumes_execution_id: null,
      status: "completed",
      schema_version: 1,
      created_at: T0,
      artifact_directory: "artifacts",
      completed_at: T1,
      hostname: "REDACTED_HOST",
      owner_pid: 1000,
      provider_pid: 2000,
      outcome: { status: "complete" },
      ...overrides,
    },
    null,
    2,
  ) + "\n";

const events = (...lines) => lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
const ev = (seq, event, extra = {}) => ({ v: 2, seq, event, timestamp: T1, ...extra });

const completedEvents = events(
  ev(1, "session.created", { data: { workflow_id: "plan", prepared: true } }),
  ev(2, "session.activated", { data: { from: "prepared" } }),
  ev(3, "execution.started", { execution_id: "0001-plan--attempt-01", stage_id: "plan", data: { execution_order: 1, stage_attempt: 1 } }),
  ev(4, "execution.completed", { execution_id: "0001-plan--attempt-01", stage_id: "plan", data: { outcome: { status: "complete", decision: "approved" } } }),
  ev(5, "session.completed", { data: {} }),
);

// --- completed -----------------------------------------------------------------
session("completed", {
  "manifest.yaml": manifest(),
  "status.json": status({
    status: "completed",
    updated_at: T2,
    outputs: { plan: { path: "outputs/plan.md", source_execution_id: "0001-plan--attempt-01", published_by_execution_id: "0001-plan--attempt-01" } },
    latest_decision: "approved",
    terminal_execution_id: "0001-plan--attempt-01",
  }),
  "events.jsonl": completedEvents,
  "executions/0001-plan--attempt-01/execution.json": execution(),
});

// --- active-stopped (active, no lock, last execution not failed) ---------------
session("active-stopped", {
  "manifest.yaml": manifestNoTitle.replace("task: \"Plan the feature\"\n", "title: \"Plan the feature\"\n"),
  "status.json": status(),
  "events.jsonl": events(
    ev(1, "session.created", { data: { workflow_id: "plan" } }),
    ev(2, "execution.started", { execution_id: "0001-plan--attempt-01", stage_id: "plan", data: {} }),
    ev(3, "execution.completed", { execution_id: "0001-plan--attempt-01", stage_id: "plan", data: { outcome: { status: "complete" } } }),
  ),
  "executions/0001-plan--attempt-01/execution.json": execution(),
});

// --- failed (active, no lock, latest_execution_status = failed) ----------------
session("failed", {
  "manifest.yaml": manifest(),
  "status.json": status({ latest_execution_status: "failed" }),
  "events.jsonl": events(
    ev(1, "session.created", { data: { workflow_id: "plan" } }),
    ev(2, "execution.started", { execution_id: "0001-plan--attempt-01", stage_id: "plan", data: {} }),
    ev(3, "execution.failed", { execution_id: "0001-plan--attempt-01", stage_id: "plan", data: { error: "verify failed" } }),
  ),
  "executions/0001-plan--attempt-01/execution.json": execution({ status: "failed", completed_at: T1, outcome: { status: "error" } }),
});

// --- blocked -------------------------------------------------------------------
session("blocked", {
  "manifest.yaml": manifest(),
  "status.json": status({
    status: "blocked",
    blocked_by_execution_id: "0001-plan--attempt-01",
    blocked_by_execution_ids: ["0001-plan--attempt-01"],
    blocked_by_stage_id: "plan",
  }),
  "events.jsonl": events(
    ev(1, "session.created", { data: { workflow_id: "plan" } }),
    ev(2, "execution.started", { execution_id: "0001-plan--attempt-01", stage_id: "plan", data: {} }),
    ev(3, "execution.blocked", { execution_id: "0001-plan--attempt-01", stage_id: "plan", data: { blocker: "needs a decision" } }),
    ev(4, "session.blocked", { data: { reason: "needs a decision" } }),
  ),
  "executions/0001-plan--attempt-01/execution.json": execution({ status: "blocked", outcome: { status: "blocked", blocker: "needs a decision" } }),
});

// --- cancelled -----------------------------------------------------------------
session("cancelled", {
  "manifest.yaml": manifest(),
  "status.json": status({ status: "cancelled" }),
  "events.jsonl": events(
    ev(1, "session.created", { data: { workflow_id: "plan" } }),
    ev(2, "execution.started", { execution_id: "0001-plan--attempt-01", stage_id: "plan", data: {} }),
    ev(3, "execution.cancelled", { execution_id: "0001-plan--attempt-01", stage_id: "plan", data: {} }),
    ev(4, "session.cancelled", { data: {} }),
  ),
  "executions/0001-plan--attempt-01/execution.json": execution({ status: "cancelled", outcome: { status: "cancelled" } }),
});

// --- prepared ------------------------------------------------------------------
session("prepared", {
  "manifest.yaml": `session_id: 00000000-0000-4000-8000-000000000001
title: "Plan the feature"
workflow_id: plan
workflow_path: .migent/workflows/plan.yaml
created_at: ${T0}
schema_version: 2
`,
  "status.json": status({ status: "prepared", latest_execution_id: null, latest_execution_status: null, latest_stage_id: null }),
  "events.jsonl": events(ev(1, "session.created", { data: { workflow_id: "plan", prepared: true } })),
});

// --- running (fake live lock; tests rewrite pid/host/heartbeat) ----------------
session("running", {
  "manifest.yaml": manifest(),
  "status.json": status({ status: "active", latest_execution_status: "running" }),
  "session.lock": JSON.stringify({ pid: 999999, host: "REDACTED_HOST", started_at: T0, heartbeat_at: T0, nonce: "0".repeat(24) }, null, 2) + "\n",
  "events.jsonl": events(
    ev(1, "session.created", { data: { workflow_id: "plan" } }),
    ev(2, "execution.started", { execution_id: "0001-plan--attempt-01", stage_id: "plan", data: {} }),
  ),
  "executions/0001-plan--attempt-01/execution.json": execution({ status: "running", completed_at: null }),
});

// --- stale-lock ----------------------------------------------------------------
session("stale-lock", {
  "manifest.yaml": manifest(),
  "status.json": status({ status: "active", latest_execution_status: "running" }),
  "session.lock": JSON.stringify({ pid: 999999, host: "REDACTED_HOST", started_at: T0, heartbeat_at: T0, nonce: "0".repeat(24) }, null, 2) + "\n",
  "events.jsonl": events(ev(1, "session.created", { data: { workflow_id: "plan" } })),
});

// --- corrupt-status (status.json did not parse) --------------------------------
session("corrupt-status", {
  "manifest.yaml": manifest(),
  "status.json": "{\n  \"session_id\": \"00000000-0000-4000-8000-000000000001\",\n  \"status\": \"active\",",
});

// --- unknown-schema ------------------------------------------------------------
session("unknown-schema", {
  "manifest.yaml": manifest({ schema_version: 99 }),
  "status.json": status({ status: "active" }),
});

console.log("fixtures written to", root);
