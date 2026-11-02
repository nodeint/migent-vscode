# Phase 3c: Reply and notifications

Part of [`vscode-extension.md`](./vscode-extension.md). Builds on the CLI runner, operation gate, target selection and capability reasons in [`03-control.md`](./03-control.md). Independent of [`03b-downstream-handoff.md`](./03b-downstream-handoff.md). [`03a-human-input.md`](./03a-human-input.md) depends on this plan because it reuses the notification infrastructure here for its Question notification (dependency graph: 3 → 3c → 3a). Ship before 03a. Next phase: [`04-release.md`](./04-release.md).

Scope: ordinary Blocked-stage Reply with durable drafts, state-transition notifications, quota waits, and the secondary actions (Run next stage once, Continue without reply, Repair, Doctor), plus the "Initialize project" welcome action. Structured `question` batches are not ordinary blockers and belong to 03a; do not conflate them.

## 1. Commands

| Command | Behavior |
|---|---|
| `migent.session.reply` | Ordinary Blocked stages only: show the obstacle, previous response, stage/attempt, and an optional free-text reply draft. Pick the blocked stage if several exist, then `continue --stage <stage> --reply-file <path>`. Quota waits have no Reply action. Structured `question` batches use Answer questions instead. |
| `migent.session.continueOnce` | Label `Run next stage once`; description: dispatch the next eligible stage once, without resetting revision counts (`--once`). Keep it in secondary actions. |
| `migent.session.continueWithoutReply` | `session continue` with no reply, offered only for an ordinary blocker; explain that the agent is told to continue. Not available for pending human questions. |
| `migent.session.retryQuota` | The quota `Retry` primary action: runs `migent.session.continue` through the same gate, enabled only at/after `retry_at` (or when no `retry_at` exists and the user explicitly retries). Never automatic. |
| `migent.session.repair` | `session repair` (confirm first) |
| `migent.doctor` | `migent doctor --json` shown in Output or a light webview |

Welcome view gains "Initialize project" (`migent init`, driven by Quick Pick prompts).

Secondary menus hold `Run next stage once`, `Continue without reply` (ordinary blocker only, clearly explained), `Repair…` and logs. An unanswered human question cannot be bypassed by Continue without a reply: the CLI keeps it pending.

All commands use the phase 3 runner, operation gate, target selection and write-capability checks; none adds its own spawn path.

## 2. Reply drafts

Ordinary blocker reply drafts are extension-owned files keyed by `(project URI, session id, blocked execution id)`; stage name alone is insufficient when an attempt changes. Persist drafts across editor closure and window reload without changing session contract files. Keep a draft through save, spawn, transport or CLI failures. CLI exit alone is not acknowledgment; reconcile evidence that the reply was consumed, not merely that the old execution was superseded. Only then archive/delete the submitted snapshot and preserve newer edits. Closing an editor keeps its draft; `Discard reply…` requires confirmation. Revalidate the target before Send.

Keep the blocker in the Reply editor; do not prepend a generic `Session context` card.

## 3. Notifications

- Notifications (each type can be disabled in settings): Blocked ("Reply" button), Failed ("Continue" / "View log" buttons), Quota (with `retry_at`, and a reminder when it expires), Completed ("Open result" button). A Completed notification never opens a picker, Next step or a downstream run (see 03b).
- Question (`migent.notifications.question`, default true) is specified and shipped with 03a; it reuses this phase's dedupe, grouping and activation-time rules.
- Only notify on state transitions that happen **after** the extension activates, to avoid a flood when a window opens. On reload, do not replay old completion notifications.
- Deduplicate by session and execution; group/update repeated notifications per session. One session's updates must not dismiss another session's notification. Notifications capture their target.
- Every failure includes a concise cause, project/session, stage/attempt and links to the exact response/verify file for that execution. Preserve typed exit categories for diagnostics; user-facing copy describes the consequence and next action.
- Keep the blocker, failure or quota reason in the session tooltip/timeline after a notification is dismissed.
- Restore focus to the reply after an unsuccessful operation; do not replace an actively edited document because a background session changed.

## 4. Quota waits

Quota is a waiting reason, not a new persisted status or a human-input blocker; derive displayState from the existing contract. Show the absolute local retry time with timezone and a countdown. At expiry notify once and enable Retry; never auto-restart. If no retry time is available, say so instead of inventing one. Reconcile eligibility before reminding and after window reload.

## 5. Settings introduced

`migent.notifications.*` (blocked / failed / quota / completed; `question` is added by 03a).

## 6. Tests

- Reply: two blocked executions, stage re-blocking after a successful reply, reply draft recovery after reload, failed save/spawn/reply submission, and preserving edits made during Send.
- Exact response/verify links for stage attempts.
- Block reasons: ordinary blocker versus quota versus pending question each expose the right action; Continue without reply is offered only for ordinary blockers.
- Quota expiry without auto-run, absence of `retry_at`, and reminder reconciliation after reload.
- Notification deduplication, activation-time filtering, per-session grouping, and no replay of old notifications after reload.
- Repair confirmation, `Run next stage once` without resetting revision counts, Doctor output, and Initialize project.

## Done when

- Reply works for a Blocked session, and the reply text survives closing/reopening and simulated submission failures.
- Ordinary blockers, quota waits and failures each expose an explanation and a relevant next action; notifications never replay on activation.
- Quota expiry notifies once and enables Retry without auto-restart.
- Run next stage once, Continue without reply, Repair (with confirmation), Doctor and Initialize project each work from their documented entry point and use the phase 3 gate and capability checks.
- Stop and Continue from phase 3 remain unaffected.

## Design reference

[`designs/03-control-ui.html`](../designs/03-control-ui.html) is the shared preview for phases 3 and 3c. The 3c scenarios are multi-stage Reply with draft recovery, quota countdown with expiry, and notification states. Its behavior is a sketch, not protocol coverage; the tests above govern.
