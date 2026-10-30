# Phase 3: Control

Part of [`vscode-extension.md`](./vscode-extension.md). Previous: [`02-monitoring.md`](./02-monitoring.md). Included subplans: [`03a-human-input.md`](./03a-human-input.md), [`03b-downstream-handoff.md`](./03b-downstream-handoff.md). Next phase: [`04-release.md`](./04-release.md).

Prerequisite: [`session-cancel.md`](./session-cancel.md) has landed (the Stop button needs `migent session cancel`).

Scope: `cli/` (locate, invoke, runner, version), the write commands, `withProgress`, and notifications, including the structured human-question flow detailed in [`03a-human-input.md`](./03a-human-input.md). Decision: processes always survive closing VS Code (detached, no setting). Test early that the `detached` child behaves on Windows (no console window, survives extension host exit).

Downstream Run/Prepare with `--prior`, separate Next step pages and lineage/recovery are part of phase 3 under [`03b-downstream-handoff.md`](./03b-downstream-handoff.md). Results only adds suggestions and retains its original content/header; selecting a suggestion opens Next step separately.

## 1. Command execution (`cli/`)

- **Short commands** (`--version`, `session show --json`, `prepare`): `execFile` with a timeout, parse JSON, typed errors.
- **Long commands** (`session run`, `session continue`): `spawn` with `windowsHide: true`, `stdio` read (stderr is a line-based log), `detached: true` on POSIX so the process survives a window reload. On Windows, separately verify that the child keeps running after the extension host exits. No shell; pass `argv` directly.
- Environment: inherited from VS Code; extra variables can be set via the `migent.env` setting.
- Result: map the exit code to an enum (`Completed | NotFinished | StageFailed | VerifyExhausted | Quota | AwaitingAnswer | Cancelled | ConfigError`), with the `response:` or `verify:` line from stderr so the related file can be opened quickly. Exit codes: 0 done, 1 not finished, 3 stage_failed, 6 verify_exhausted, 7 verify, 8 quota, 9 awaiting human answers, 130 cancelled. Exit 9 is not a failure; inspect the selected stage's pending batch and overall session separately.
- Concurrency: `SessionLock` remains authoritative. Acquire an in-memory operation gate per `(project URI, session id)` before spawning, so clicks from the editor, tree and Command Palette cannot submit competing commands. Disable conflicting writes during Starting, Sending reply, Repairing and Stopping as well as Running. Never lock unrelated sessions or prevent creating a new session because another session has a live lock.
- `--max-dispatches` and similar flags come from settings, not from a prompt each time.

Commands call the CLI, and the result comes back through the watcher; commands never update the store directly.

**Command lifecycle:** keep transient operation state separate from the disk-derived session snapshot. Show `Starting…` immediately, then `Running` only after reconciliation observes the lock/execution. CLI exit alone does not prove a persisted state transition: re-read the affected session and release the gate after reconciliation. Spawn errors, timeouts and failed saves clear the operation with a useful error; they must not fabricate a Running/Completed/Cancelled snapshot. A successful submission without an observable transition gets a bounded reconciliation wait, then `Status not confirmed` with `Refresh` and `View log` (never silently re-enable a potentially duplicate run). Check capability, lock, session state and target identity again immediately before dispatch.

## 2. Commands

| Command | Behavior |
|---|---|
| `migent.session.run` | Quick Pick workflow → Input Box task → run. An Input Box button switches directly to `Compose in editor`, preserving entered text; no extra short/long chooser. Remember the last workflow per project as a suggestion, never silently run it. |
| `migent.session.prepare` | Select workflow, enter a title, create a prepared session, open editable `task.md`. Show `Save & Run` in the editor title, bound to that document's project/session. |
| `migent.session.start` | Save that session's dirty `task.md`, validate non-empty content, then `run --session --workflow`. On save/validation failure keep the editor and draft; do not start the CLI. |
| `migent.session.continue` | `session continue`; if the workflow changed, offer `View changes`, `Use session version`, `Use updated workflow`, `Cancel`. Explain that ordinary Continue resets revision counts. Return from the diff to the same decision and target. |
| `migent.session.continueOnce` | Label `Run next stage once`; description: dispatch the next eligible stage once, without resetting revision counts (`--once`). Keep it in secondary actions. |
| `migent.session.reply` | Ordinary Blocked stages only: show the obstacle, previous response, stage/attempt, and an optional free-text reply draft. Pick the blocked stage if several exist, then `continue --stage <stage> --reply-file <path>`. Quota waits have no Reply action. Structured `question` batches use Answer questions instead. |
| `migent.session.answerQuestions` | Open the selected pending human batch, validate every question, and submit a JSON answer map with `continue --stage <stage> --reply-file <path>`. Full behavior in [`03a-human-input.md`](./03a-human-input.md), including standalone role sessions, mixed statuses, drafts, acceptance and continuation recovery. |
| `migent.session.cancel` | `session cancel <id>`; show `Sending stop request…` then `Waiting for session to stop…`. Show `Cancelled` only when persisted state confirms it. |
| `migent.session.repair` | `session repair` (confirm first) |
| `migent.doctor` | `migent doctor --json` shown in Output or a light webview |
| `migent.session.openNextStep` | Open the separate page bound to a Completed source and suggested target; preserve Results and its header actions. |
| `migent.session.runDownstream` | Explicit new-session Run with `--workflow <target> --prior <source>` and optional task override; reconcile the real child and CLI-bound snapshots. Never auto-run on completion. |
| `migent.session.prepareDownstream` | Prepare with the captured prior/target, then open real `task.md`. Save & Run binds context using current target/model settings; failed bind stays Prepared and keeps the task. |

The Workflows view and native YAML opening already exist in phase 2. Add an inline `Run` action to each valid workflow and an editor-title action for its YAML document. Invoke `migent.session.run` with the captured project/file target, skip the workflow picker, and go directly to task entry (with Compose in editor). Save a dirty workflow document before dispatch; abort on save/parse failure and retain the editor. Invalid workflows, incompatible CLI and read-only projects expose a reason rather than a runnable action. Running another session must not disable creating a new session from a workflow.

Downstream launches additionally use a local source/target launch gate before a child id is known; switch to normal per-child tracking once reconciled. Keep source Completed and unrelated workflows usable. `next.json.argv` is never executed directly, and an uncertain command result is reconciled before retrying. Source completion notifications keep Open result, not an automatic downstream launch or picker.

Every write command checks: the CLI version is sufficient, no live lock belongs to another process, and the project is not in read-only mode.

Question form opening/drafting is not a write command. It remains available with pending human questions while another branch runs or the CLI is unavailable; submission waits for capability/lock checks. An unanswered question cannot be bypassed by Continue without a reply: the CLI keeps it pending. Do not conflate questions with ordinary blockers.

**Target selection:** commands invoked from the Command Palette must pick an eligible session, showing title, project, short id, workflow, stage and status. Never use a stale tree selection as an implicit target. Context-menu commands use the clicked session; editor-title commands use the document's session. Capture that identity for the entire async flow; selecting another tree row must not redirect a confirmation, reply or CLI command. With no eligible sessions, explain why and link to Run, Refresh or the affected session. Resolve the project first for project-scoped commands when the workspace has several Migent projects.

**Primary actions:** Prepared → `Save & Run`; Running → `Stop`; Question → `Answer questions`; ordinary Blocked → `Reply` / obstacle inspection; quota wait → disabled `Retry in …`, enabled `Retry` at `retry_at`; Failed → `Inspect failure`; Stopped/Cancelled → `Continue`; Completed → `Open result`. Also expose Answer questions for pending human batches in Running/Blocked sessions and on the corresponding stage nodes; do not hide them behind the primary displayState. Secondary menus hold `Run next stage once`, `Continue without reply` (ordinary blocker only, clearly explained), `Repair…` and logs. Failed sessions still expose Continue after inspecting diagnostics; do not imply that retry resolves the cause. Use native tree inline actions, editor-title actions, Quick Picks and documents, except the batch answer webview specified in phase 3a; the HTML preview's generic contextual strip/cards do not imply a new production dashboard.

**Drafts and saves:** `task.md` is the real prepared-session file. Ordinary blocker reply drafts are extension-owned files keyed by `(project URI, session id, blocked execution id)`; stage name alone is insufficient when an attempt changes. Persist drafts across editor closure and window reload without changing session contract files. Keep a draft through save, spawn, transport or CLI failures. CLI exit alone is not acknowledgment; reconcile evidence that the reply was consumed, not merely that the old execution was superseded. Only then archive/delete the submitted snapshot and preserve newer edits. Closing an editor keeps its draft; `Discard reply…` requires confirmation. Revalidate the target before Send. Structured question drafts are keyed per originating execution/question and follow the stricter recorded-answer reconciliation in phase 3a: answers can be durable even when the next dispatch fails, so retry continuation without resending those answers.

**Keep editors compact:** do not prepend a generic `Session context` card to every document. Session identity/state belongs in the title/actions; `View log` is a direct secondary action. Keep the blocker/question in the Reply editor, diagnostics in the failure document, and status explanations in tooltip/timeline text. File viewers open directly on their content.

**Capability reasons:** compute availability per project and per target session, returning a reason and recovery action. Missing/old CLI → install/configure instructions (include detected and required versions); project read-only → explain why; another process's live lock → show PID/host/last heartbeat and `Refresh`/`View log`. Keep monitoring and unrelated sessions available. Distinguish an extension-owned runner (Stop allowed) from a foreign live lock (writes blocked).

Welcome view gains "Initialize project" (`migent init`, driven by Quick Pick prompts) and "Run workflow".

## 3. Progress and notifications

- `window.withProgress` (Notification location, cancellable) for a run started by the extension itself; cancelling calls `session cancel`.
- Notifications (each type can be disabled in settings): Blocked ("Reply" button), Failed ("Continue" / "View log" buttons), Quota (with `retry_at`, and a reminder when it expires), Completed ("Open result" button).
- Question (`migent.notifications.question`, default true): identify the pending stage/count and offer Answer questions, even if another branch keeps the session Running/Blocked. Deduplicate by originating batch and do not replay historical pending batches on startup.
- Only notify on state transitions that happen **after** the extension activates, to avoid a flood when a window opens.
- The per-session Output Channel now also receives stderr lines of commands the extension runs.

- Every failure includes a concise cause, project/session, stage/attempt and links to the exact response/verify file for that execution. Preserve typed exit categories for diagnostics; user-facing copy describes the consequence and next action. Config failures lead to Settings/Doctor rather than a blind retry.
- Keep the blocker, failure or quota reason in the session tooltip/timeline after a notification is dismissed. Quota is a waiting reason, not a new persisted status or a human-input blocker; derive displayState from the existing contract. Show the absolute local retry time with timezone and a countdown. At expiry notify once and enable Retry; never auto-restart. If no retry time is available, say so instead of inventing one. Reconcile eligibility before reminding and after window reload.
- Group/update repeated notifications per session and execution; one session's updates must not dismiss another session's progress. Notifications capture their target. Restore focus to the task/reply after an unsuccessful operation; do not replace an actively edited document because a background session changed.
- Progress says `Continues after closing VS Code`. On reload, discover existing locks/executions and resume monitoring without spawning another runner or replaying old completion notifications. Show the latest known event time so a quiet provider is distinguishable from a disconnected monitor.
- If Stop is not confirmed within 15 seconds, retain `Stop not confirmed` and offer `Refresh`/`View log`; do not report cancellation or offer a duplicate Continue/Repair while the process may still hold the lock. No force-kill fallback in this phase.

## 4. Settings introduced

`migent.run.maxDispatches` (20, passed as `--max-dispatches`), `migent.run.progress` (true, passed as `--progress`), `migent.notifications.*` (blocked / failed / quota / question / completed), `migent.env` (`{}`).

## 5. Tests

- Mock `child_process` to check arguments, exit-code mapping, `windowsHide`, and line-based stderr handling.
- Integration with a `fake-provider.mjs` like migent's `integration/`.
- Verify action eligibility/primary action for each state, block reason, foreign lock and pending operation. Test that one locked session does not disable Run or another session's Continue.
- Verify explicit Palette targeting, stable targets across async confirmations/diffs, and exact response/verify links for stage attempts.
- Cover dirty/empty task, failed save/spawn/reply submission, reply draft recovery after reload, two blocked executions, stage re-blocking after a successful reply, and preserving edits made during Send.
- Cover Starting before watcher updates, repeated clicks across UI entry points, reconciliation timeout, Stop timeout, and gate cleanup after a command error.
- Cover workflow diff decisions, quota expiry without auto-run, notification deduplication, and reattachment after reload without duplicate dispatches or old notifications.
- Cover exit 9, mixed Running/Blocked sessions with pending questions, whole-batch JSON replies and the separate recorded-answer/continued-execution states in phase 3a.

## Done when

- The `plan` workflow runs end to end from the Command Palette.
- Cancelling midway on Windows yields exit 130 and Continue can resume.
- Reply works for a Blocked session.
- Two places pressing Run at once produce no strange errors.
- Palette commands always show the target before dispatch. Task/reply text survives closing/reopening and simulated submission failures.
- Starting/Stopping and timeout recovery are visible; UI never claims a persisted transition before reconciliation.
- Ordinary blockers, human questions, quota waits, configuration errors and foreign locks each expose an explanation and a relevant next action.
- The acceptance criteria of [`03a-human-input.md`](./03a-human-input.md) pass before phase 4 release testing.
- The acceptance criteria of [`03b-downstream-handoff.md`](./03b-downstream-handoff.md) pass, including preserved Results/header actions, separate Next step pages, Run/Prepare with prior, deferred binding and uncertain-child recovery.

## Interactive preview

Open [`designs/03-control-ui.html`](../designs/03-control-ui.html) in a browser (keep [`03-control-ui.js`](../designs/03-control-ui.js) and [`project-files-ui.js`](../designs/project-files-ui.js) alongside it). It uses sample data only. Try Project config and workflow YAML editors, Run directly from a workflow, Palette targeting, Compose in editor, Save & Run, multi-stage Reply with draft recovery, workflow diff, quota countdown, submission failure, foreign lock, and Stop timeout. YAML saves change only in-memory sample content; real project files are not read or written. Pending command state and simulated watcher updates are separate. Browser local storage emulates extension-owned drafts, disk snapshots and runner checkpoints, allowing actual page reload to demonstrate recovery without another dispatch; it does not run a real background process. `Reset demo` clears only this prototype's storage key. No CLI or session files are modified. All previews are indexed in [`designs/README.md`](../designs/README.md).
