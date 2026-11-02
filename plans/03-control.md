# Phase 3: Control

Part of [`vscode-extension.md`](./vscode-extension.md). Previous: [`02-monitoring.md`](./02-monitoring.md). Follow-on plans: [`03c-reply-notifications.md`](./03c-reply-notifications.md) and [`03b-downstream-handoff.md`](./03b-downstream-handoff.md) depend on this phase; [`03a-human-input.md`](./03a-human-input.md) depends on this phase and on 03c (shared notification infrastructure). Next phase: [`04-release.md`](./04-release.md).

Prerequisite: `session cancel` has landed (the Stop button needs `migent session cancel`).

Scope: `cli/` (locate, invoke, runner, version), the core write commands (run, prepare, save & run, continue, cancel), `withProgress`, target selection, capability reasons, and the operation gate that the follow-on plans reuse. Decision: processes always survive closing VS Code (detached, no setting). Test early that the `detached` child behaves on Windows (no console window, survives extension host exit).

Split of the original phase 3 (each plan is implemented, verified and merged on its own, in dependency order):

| Plan | Owns |
|---|---|
| This file (3) | CLI runner, operation gate, Run / Prepare / Save & Run / Continue / Stop, per-workflow Run, target selection, capability reasons, progress |
| [`03c-reply-notifications.md`](./03c-reply-notifications.md) | Ordinary blocker Reply and drafts, notifications, quota waits, secondary actions (Run next stage once, Repair, Doctor), Initialize project |
| [`03a-human-input.md`](./03a-human-input.md) | Structured human-question form (`migent.session.answerQuestions`), batch JSON submission, drafts and recorded-answer recovery |
| [`03b-downstream-handoff.md`](./03b-downstream-handoff.md) | Next step page, downstream Run/Prepare with `--prior`, lineage and recovery (`migent.session.openNextStep`, `runDownstream`, `prepareDownstream`) |

Dependency graph: 3 → 3c → 3a, and 3 → 3b. Suggested order: 3, 3c, then 3a and 3b in either order. Phase 4 release testing needs all four, and each plan's Done when must pass.

## 1. Command execution (`cli/`)

- **Short commands** (`--version`, `session show --json`, `prepare`): `execFile` with a timeout, parse JSON, typed errors.
- **Long commands** (`session run`, `session continue`): `spawn` with `windowsHide: true`, `stdio` read (stderr is a line-based log), `detached: true` on POSIX so the process survives a window reload. On Windows, separately verify that the child keeps running after the extension host exits. No shell; pass `argv` directly.
- Environment: inherited from VS Code; extra variables can be set via the `migent.env` setting.
- Result: map the exit code to an enum (`Completed | NotFinished | StageFailed | VerifyExhausted | Quota | AwaitingAnswer | Cancelled | ConfigError`), with the `response:` or `verify:` line from stderr so the related file can be opened quickly. Exit codes: 0 done, 1 not finished, 3 stage_failed, 6 verify_exhausted, 7 verify, 8 quota, 9 awaiting human answers, 130 cancelled. Exit 9 is not a failure; inspect the selected stage's pending batch and overall session separately (handled in [`03a-human-input.md`](./03a-human-input.md)).
- Concurrency: `SessionLock` remains authoritative. Acquire an in-memory operation gate before spawning, so clicks from the editor, tree and Command Palette cannot submit competing commands. The gate has two key kinds. A **session key** `(project URI, session id)` covers operations on an existing session. A **launch key** `(project URI, workflow id[, prior source session id])` covers an operation that creates a new session (`migent.session.run`, `prepare`, and the downstream launches in 03b) before a child id exists; hold it until reconciliation identifies the created session or proves none exists, then continue under that session's key. Follow-on plans use these two keys and add no other gate. Disable conflicting writes during Starting, Sending reply, Repairing and Stopping as well as Running. Never lock unrelated sessions or prevent creating a new session because another session has a live lock.
- `--max-dispatches` and similar flags come from settings, not from a prompt each time.

Commands call the CLI, and the result comes back through the watcher; commands never update the store directly.

**Command lifecycle:** keep transient operation state separate from the disk-derived session snapshot. Show `Starting…` immediately, then `Running` only after reconciliation observes the lock/execution. CLI exit alone does not prove a persisted state transition: re-read the affected session and release the gate after reconciliation. Spawn errors, timeouts and failed saves clear the operation with a useful error; they must not fabricate a Running/Completed/Cancelled snapshot. A successful submission without an observable transition gets a bounded reconciliation wait, then `Status not confirmed` with `Refresh` and `View log` (never silently re-enable a potentially duplicate run). Check capability, lock, session state and target identity again immediately before dispatch.

The gate and runner are the shared foundation: the follow-on plans add commands on top of them and must not introduce a second spawn, gate or reconciliation path.

## 2. Commands

| Command | Behavior |
|---|---|
| `migent.session.run` | Quick Pick workflow → Input Box task → run. An Input Box button switches directly to `Compose in editor`, preserving entered text; no extra short/long chooser. Remember the last workflow per project as a suggestion, never silently run it. |
| `migent.session.prepare` | Select workflow, enter a title, create a prepared session, open editable `task.md`. Show `Save & Run` in the editor title, bound to that document's project/session. |
| `migent.session.start` | Save that session's dirty `task.md`, validate non-empty content, then `run --session --workflow`. On save/validation failure keep the editor and draft; do not start the CLI. |
| `migent.session.continue` | `session continue`; if the workflow changed, offer `View changes`, `Use session version`, `Use updated workflow`, `Cancel`. Explain that ordinary Continue resets revision counts. Return from the diff to the same decision and target. |
| `migent.session.cancel` | `session cancel <id>`; show `Sending stop request…` then `Waiting for session to stop…`. Show `Cancelled` only when persisted state confirms it. |

Commands owned by follow-on plans: `reply`, `continueOnce`, `repair`, `doctor` ([`03c`](./03c-reply-notifications.md)); `answerQuestions` ([`03a`](./03a-human-input.md)); `openNextStep`, `runDownstream`, `prepareDownstream` ([`03b`](./03b-downstream-handoff.md)).

The Workflows view and native YAML opening already exist in phase 2. Add an inline `Run` action to each valid workflow and an editor-title action for its YAML document. Invoke `migent.session.run` with the captured project/file target, skip the workflow picker, and go directly to task entry (with Compose in editor). Save a dirty workflow document before dispatch; abort on save/parse failure and retain the editor. Invalid workflows, incompatible CLI and read-only projects expose a reason rather than a runnable action. Running another session must not disable creating a new session from a workflow.

Every write command checks: the CLI version is sufficient, no live lock belongs to another process, and the project is not in read-only mode.

**Target selection:** commands invoked from the Command Palette must pick an eligible session, showing title, project, short id, workflow, stage and status. Never use a stale tree selection as an implicit target. Context-menu commands use the clicked session; editor-title commands use the document's session. Capture that identity for the entire async flow; selecting another tree row must not redirect a confirmation, reply or CLI command. With no eligible sessions, explain why and link to Run, Refresh or the affected session. Resolve the project first for project-scoped commands when the workspace has several Migent projects.

**Primary actions:** one primary action per state, each bound to a command and an owning plan.

| State | Primary action | Command | Owner |
|---|---|---|---|
| Prepared | `Save & Run` | `migent.session.start` | 03 |
| Running | `Stop` | `migent.session.cancel` | 03 |
| Stopped / Cancelled | `Continue` | `migent.session.continue` | 03 |
| Failed | `Inspect failure` (opens the exact response/verify file; Continue stays available afterward) | `migent.session.openResponse` | 02 |
| Completed | `Open result` | `migent.session.openResult` | 02 (suggestions: 03b) |
| Ordinary Blocked | `Reply` / obstacle inspection | `migent.session.reply` | 03c |
| Quota wait | disabled `Retry in …`; enabled `Retry` at `retry_at` | `migent.session.continue` | 03c |
| Question | `Answer questions` | `migent.session.answerQuestions` | 03a |

Failed sessions still expose Continue after inspecting diagnostics; do not imply that retry resolves the cause. Also expose `Answer questions` for pending human batches in Running/Blocked sessions and on the corresponding stage nodes, not hidden behind the primary displayState (03a). Actions owned by a follow-on plan appear only once that plan ships; until then the row shows the read-only phase 2 behavior. Use native tree inline actions, editor-title actions, Quick Picks and documents, except the batch answer webview specified in phase 3a; the HTML preview's generic contextual strip/cards do not imply a new production dashboard.

**Drafts and saves:** `task.md` is the real prepared-session file. Keep its content through save, spawn, transport or CLI failures. Reply drafts are specified in [`03c-reply-notifications.md`](./03c-reply-notifications.md).

**Keep editors compact:** do not prepend a generic `Session context` card to every document. Session identity/state belongs in the title/actions; `View log` is a direct secondary action. Keep diagnostics in the failure document and status explanations in tooltip/timeline text. File viewers open directly on their content.

**Capability reasons:** compute availability per project and per target session, returning a reason and recovery action. Missing/old CLI → install/configure instructions (include detected and required versions); project read-only → explain why; another process's live lock → show PID/host/last heartbeat and `Refresh`/`View log`. Keep monitoring and unrelated sessions available. Distinguish an extension-owned runner (Stop allowed) from a foreign live lock (writes blocked).

Welcome view gains "Run workflow". ("Initialize project" is in 03c.)

## 3. Progress and Stop

- `window.withProgress` (Notification location, cancellable) for a run started by the extension itself; cancelling calls `session cancel`. This progress notification is part of this phase; the event-driven state notifications are in 03c.
- Progress says `Continues after closing VS Code`. On reload, discover existing locks/executions and resume monitoring without spawning another runner. Show the latest known event time so a quiet provider is distinguishable from a disconnected monitor.
- If Stop is not confirmed within 15 seconds, retain `Stop not confirmed` and offer `Refresh`/`View log`; do not report cancellation or offer a duplicate Continue/Repair while the process may still hold the lock. No force-kill fallback in this phase.
- The per-session Output Channel now also receives stderr lines of commands the extension runs.
- Preserve typed exit categories for diagnostics; user-facing copy describes the consequence and next action. Config failures lead to Settings (and to Doctor once 03c ships) rather than a blind retry.
- One session's progress must not dismiss another session's progress. Restore focus to the task after an unsuccessful operation; do not replace an actively edited document because a background session changed.

## 4. Settings introduced

`migent.run.maxDispatches` (20, passed as `--max-dispatches`), `migent.run.progress` (true, passed as `--progress`), `migent.env` (`{}`). Notification settings are in 03c.

## 5. Tests

- Mock `child_process` to check arguments, exit-code mapping, `windowsHide`, and line-based stderr handling.
- Integration with a `fake-provider.mjs` like migent's `integration/`.
- Verify action eligibility/primary action for each state, foreign lock and pending operation. Test that one locked session does not disable Run or another session's Continue.
- Verify explicit Palette targeting and stable targets across async confirmations/diffs.
- Cover dirty/empty task, failed save/spawn submission, and `task.md` preserved through failures.
- Cover Starting before watcher updates, repeated clicks across UI entry points, reconciliation timeout, Stop timeout, and gate cleanup after a command error.
- Cover workflow diff decisions and reattachment after reload without duplicate dispatches.

## Done when

- The `plan` workflow runs end to end from the Command Palette.
- Cancelling midway on Windows yields exit 130 and Continue can resume.
- Two places pressing Run at once produce no strange errors, including before a new session id exists (launch key).
- Palette commands always show the target before dispatch. Task text survives closing/reopening and simulated submission failures.
- Starting/Stopping and timeout recovery are visible; UI never claims a persisted transition before reconciliation.
- Configuration errors and foreign locks each expose an explanation and a relevant next action.
- The runner and operation gate (session key and launch key) expose the interface that 03a, 03b and 03c consume, with no second dispatch path.

## Interactive preview

Open [`designs/03-control-ui.html`](../designs/03-control-ui.html) in a browser (keep [`03-control-ui.js`](../designs/03-control-ui.js) and [`project-files-ui.js`](../designs/project-files-ui.js) alongside it). It uses sample data only and covers this phase plus the reply, quota and notification behavior of 03c. Try Project config and workflow YAML editors, Run directly from a workflow, Palette targeting, Compose in editor, Save & Run, workflow diff, submission failure, foreign lock, and Stop timeout. YAML saves change only in-memory sample content; real project files are not read or written. Pending command state and simulated watcher updates are separate. Browser local storage emulates extension-owned drafts, disk snapshots and runner checkpoints, allowing actual page reload to demonstrate recovery without another dispatch; it does not run a real background process. `Reset demo` clears only this prototype's storage key. No CLI or session files are modified. All previews are indexed in [`designs/README.md`](../designs/README.md).
