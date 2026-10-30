# Phase 3a: Human input

Part of [`vscode-extension.md`](./vscode-extension.md), within **phase 3**, before [`04-release.md`](./04-release.md). Builds on [`01-core.md`](./01-core.md), [`02-monitoring.md`](./02-monitoring.md) and the CLI runner/operation gate in [`03-control.md`](./03-control.md).

Protocol source of truth: Migent's [`docs/human-in-the-loop.md`](https://github.com/nodeint/migent/blob/HEAD/docs/human-in-the-loop.md). The extension consumes its public files and CLI; it does not import the kernel or introduce another question/reply protocol.

## 1. Scope and terminology

- Discover pending human questions, including questions in otherwise Running or Blocked sessions.
- Show one stage's current question batch in an editor webview with single/multiple selection and a free-text alternative for every question.
- Save drafts, validate the whole batch, submit through the CLI, reconcile recorded answers, and show whether continuation actually started.
- Support follow-up rounds, multiple waiting stages, standalone role sessions, history, window reload, and another client answering or superseding a batch.
- Add a dedicated Answer questions action and notification. Keep ordinary blocker Reply available as a separate flow.

`ask: human` is a workflow stage configuration field. The execution outcome is `question`; it is not `question="human"`, a workflow decision, or an ordinary blocker. The question belongs to the stage already doing the work; the extension must not add a synthetic human stage. Verification-only stages cannot ask. A standalone role session can ask without a workflow definition.

Out of scope: authoring agent questions, changing workflow routes, acting as another agent/role recipient, automatically accepting recommendations, or implementing a workflow graph/metrics dashboard.

## 2. Public contract and compatibility

| Source | Extension use |
|---|---|
| `status.json.questions` | Initial pending-question summary and attention count, independent of session displayState. |
| Session `questions.json` | Full records: `id`, `question`, `context`, `selection`, `options`, `stage_id`, `execution_id`, `recipient`, `status`, `answer`; current batches and history. |
| `executions/<execution-id>/questions.json` | Original immutable batch for that execution, with assigned question numbers and option letters. |
| `events.jsonl` | Submitted reply / normalized-answer events and reconciliation evidence; no parsing agent prose. |
| `session show --json` | Targeted CLI inspection when reconciliation or diagnostics require it. |
| `session continue ... --reply-file <path>` | Submit one complete batch through the CLI. |
| CLI exit `9` | `AwaitingAnswer`, not StageFailed or Completed. Inspect persisted state because a selected execution can exit 9 while another branch determines session status. |

Keep schema domains separate: workflow examples enabling `ask: human` use workflow `schema_version: 3`; the session question file uses `schema_version: 1`. Neither implies that the session manifest has version 3. Retain existing manifest readers and add supported versions only against their own documented fixtures. Determine the minimum compatible CLI release from a released version/contract fixture; do not invent a version number in this plan or probe support by submitting a reply.

Question modes are `single` and `multiple`, with 2–26 options and nonempty question/context. Question IDs are the assigned numbers, option IDs are the assigned letters; use stored IDs/order, never labels as identity. Optional `recommended` marks suggested options, never an answer.

Question identity is `(execution_id, id)`, scoped by project URI and session id. Drafts and panels must also capture the stage and exact batch membership/content. A later execution's question `1` is a new question even if its wording is unchanged. Question record statuses are `pending`, `answered`, and `superseded`; never write these statuses from the extension.

On unsupported question schema, malformed records, inconsistent batch membership or unsupported recipient: keep monitoring/raw-file access and show a scoped diagnostic; disable submission for that batch. A missing legacy question file means no structured history is available, not that every old Blocked session has human questions. Do not synthesize options from `response.md`.

## 3. Store, watcher and attention

Extend `core/model.ts`, `core/questions.ts`, `core/questionAnswers.ts` and the session store with validated question records, pending groups and history. Keep parsing, batch fingerprinting, draft validation and payload serialization pure and independent of `vscode`. `core/` never reads extension draft storage.

- Use `status.json.questions` for the initial lightweight pending summary; load the full session question file when pending questions exist or the question/history view opens. Do not load every execution's original batch for every session on startup.
- Watch session and execution `questions.json` alongside status/execution metadata. Coalesce per session, refresh only that session and publish store events; views consume snapshots rather than reading files.
- Group the pending records by stage and originating execution. Preserve the documented history order and assigned option order. Record a fingerprint of the question text, context, mode, options and recommendation metadata for stale-draft checks.
- Session `active` with a live lock still displays Running; pending human questions remain visible on that row and in its children. When no work can run, a session can be `blocked` because of an obstacle while also having pending questions; otherwise it can be `question`. DisplayState alone is not an eligibility test.
- Needs attention includes Question sessions and sessions with pending human questions. Keep Running sessions in their Running group, with a pending-question indicator; do not duplicate the session in two groups.
- Badge/status-bar attention counts are unique sessions, not the number of questions. Tooltip separately reports pending stages/questions and blockers/failures.

Phase 2 exposes a readable question summary/history and Open questions file. Phase 3a adds the interactive answer panel. Missing CLI must not prevent reading questions or saving a draft.

## 4. Entry points and target selection

Command: `migent.session.answerQuestions`. Tree inline action/notification label: **Answer questions** (`Trả lời câu hỏi` in the prototype).

- Palette: pick a session with pending human questions, showing project, title, short id and pending stage count. A session with a live lock is still openable for drafting; sending remains gated.
- If several stages have pending questions, pick the stage/batch with its stage id, originating execution and question count. Blocker reply targets remain distinguishable from question targets.
- Tree stage/question action opens that exact batch directly. Reuse an existing panel for the same `(project, session, stage, execution)` rather than creating duplicates.
- Notifications summarize the waiting stage/count and offer Answer questions. Do not steal focus by opening a panel automatically. Notify once per newly observed batch after activation; suppress old batches on startup and deduplicate file-event updates.
- Keep questions visible while independent branches run. Allow editing/saving a draft, show why Send is unavailable, and enable Send after reconciliation confirms the conflicting live runner has stopped. Never queue an automatic submission when the lock is released.

Capture target identity throughout pickers, panel messages, confirmations and async work. Selecting another session or switching projects cannot redirect a submission. Ordinary Continue without answers does not answer a pending batch; do not present it as an alternative that resolves Question state.

## 5. Answer panel UX

Use one editor webview for the selected stage batch. This is the phase 3 exception to native-first UI: a batch form requires radio groups, checkbox groups, multiline alternatives and one atomic Submit. Task, config, workflows and response files continue using normal editors.

### Layout

- Tab/title identifies the stage; breadcrumb identifies the project, session and originating execution. Keep it compact: no generic Session context card or permanent instructional sidebar copy.
- Display all questions in one scrollable form. Each card shows the question number, question text, its selection mode and the supplied context. Keep short context visible; long context can expand without replacing the form. Options show their letter, label and optional description. A recommended badge does not preselect anything.
- Numbered jump buttons indicate answered/unanswered questions. A persistent footer shows `2/3 answered`, `Later`, and **Submit & continue session**. Enable Submit only when the entire current batch is valid and the target/capability checks allow it. Jump to the first incomplete question on demand.
- Status feedback describes a specific condition: draft saved, submission failed, questions changed, answers recorded, continuation waiting/failed. Avoid tutorials for ordinary editor use.
- Stage/batch switches preserve drafts and scroll/focus per batch. Closing the panel or choosing Later does not submit or discard answers.

### Input modes

| Question | Choice mode | Free-text mode |
|---|---|---|
| `single` | Radio group; exactly one option. | Select `Other — write an answer`; enter nonempty multiline text. |
| `multiple` | Checkbox group; one or more distinct options. | Select `Other — write an answer`; enter nonempty multiline text **instead of** any option selection. |

For multiple questions, implement an explicit mutually exclusive choice/text mode, not an extra additive checkbox. Switching to Other deactivates the option selections; switching back deactivates text. Keep inactive values in the local draft so users can switch back, but validate and serialize only the active mode. A missing/whitespace-only custom answer is incomplete. There is no protocol-level `text` question type; every question already permits free text.

No defaults, no inferred answers, no recommended-option selection on open, and no submit from merely selecting the last answer. Submit once after the user explicitly clicks the batch action. Do not interpret free text such as "approved" as a workflow decision.

### Accessibility

Use labeled fieldsets/radio groups and native checkbox/textarea controls, keyboard navigation, visible focus, accessible option descriptions and errors, and VS Code theme/high-contrast variables. Announce progress/errors without moving focus on each keystroke. Submit is reachable by keyboard; optional Ctrl/Cmd+Enter follows the same whole-batch validation and operation gate. Enter in a textarea inserts a newline.

## 6. Draft persistence and stale batches

Host-managed draft storage lives under the extension's workspace storage, outside `.migent/sessions/`. Key each answer by `(project URI, session id, execution_id, question id)` and store stage id, batch membership/fingerprint, active input mode and both inactive/active draft values. Store panel identity/scroll in lightweight webview state; the host owns the durable draft. Use debounced writes and flush before panel disposal/submission; do not rely only on a webview unload message.

- Restore drafts after panel closure, window reload or remote reconnection only against the same validated batch.
- If a pending question is changed/replaced, mark the draft stale, disable Send and offer Load current questions. Preserve the old draft separately as read-only reference; do not transfer answers to new question numbers automatically.
- A question becoming `superseded` is not evidence that the user's answer was accepted. Inspect the old question records/events and their normalized answers before marking a submission recorded.
- If another client answered the same batch, show its recorded answers read-only, compare any local draft, and do not resend. Keep an unsubmitted conflicting local draft available to copy.
- Explicit Discard draft requires confirmation; Later/Close keep it. Once an exact submitted snapshot is confirmed recorded, archive that snapshot without deleting newer local edits.

## 7. Payload and CLI dispatch

Serialize the complete selected batch as the documented JSON answer map, not comma-separated text, Markdown, or the agent response format:

```json
{
  "1": "A",
  "2": ["A", "C"],
  "3": "Keep the existing files, and explain the migration steps.\nInclude recovery instructions."
}
```

All and only the pending question IDs of the selected stage batch must be present. `single` choices produce one option ID; `multiple` choices produce a distinct array in option order. Free-text mode produces a string and no selected options. Preserve multiline text and JSON escaping; blank detection must not silently rewrite the user's meaningful text. Do not send `{question_id, selected, text}` records as the reply file: those are normalized persisted answers, not the documented input map.

The host validates webview input against the latest store snapshot, acquires the existing per-session operation gate, refreshes the target, verifies its exact batch fingerprint and write capability, then writes a unique submission snapshot under extension storage. Recheck the snapshot/target immediately before dispatch. A save, permission or validation failure leaves the draft intact and does not start the CLI.

For a workflow stage, invoke without a shell:

```text
migent session continue <session-id> --stage <stage-id> --reply-file <absolute-answers.json>
```

Use the bound project as cwd, the normal CLI/environment settings and the shared runner. For a standalone role session, use the same form UI and reply-file map; omit `--stage` when the documented role-session CLI has no stage target. Confirm this behavior against the real standalone-role fixture rather than inventing a workflow/stage identifier.

Keep the submission file immutable until the CLI has consumed it and reconciliation is complete. Clean up consumed temporary files independently of durable drafts; keep an uncertain submission available for diagnostics/reconciliation. Never write generated `questions.json`, `status.json`, execution metadata or events. Do not log full reply contents or environment secrets by default.

## 8. Acceptance and continuation are different states

| UI state | Evidence and behavior |
|---|---|
| Editing | Current pending batch; local answers may be incomplete. No CLI write. |
| Saving / Sending | Gate held, exact answer snapshot saved, CLI dispatched. Prevent duplicate submissions; retain draft. |
| Answers recorded | The original question records are `answered` with matching normalized answers, corroborated by inspection/events as needed. Agent dispatch is not yet assumed. |
| Continuing | A new execution for that stage is observed after the recorded answers. The CLI continues the same provider conversation; the extension does not start a fresh session. |
| Recorded, continuation failed/waiting | Answers are durable but no next execution is confirmed, or subsequent dispatch failed. Show Continue / View log when eligible, using Continue **without the reply file**; never ask the user to resubmit recorded answers. |
| Not recorded / rejected | Inspection confirms pending questions and a rejected/unaccepted reply. Keep the form and draft, show an actionable error, and allow an explicit retry when eligible. |
| Status not confirmed | CLI/connection ended without enough persisted evidence. Retain gate/draft, offer Recheck / View log, and prevent blind resend. |
| Superseded / answered elsewhere | Current batch is no longer this pending batch. Preserve old draft/history and open current data; do not mark local text accepted unless the recorded answer matches. |

Do not equate exit 0, 1 or 9 with acceptance or failure. Exit 9 can follow a successfully answered batch when the agent asks a follow-up; preserve the old answers as history and offer the new batch. Exit 1 can reflect another blocked branch. A Running session can still have another pending batch. In all cases reconcile the original `(execution_id, question id)` records independently of the session's overall state.

Answering does not finish the stage, select a workflow route, reset question numbering globally, consume a workflow revision, or bypass verification. Let the CLI enforce conversation continuity, revision/verification budgets and routing; do not duplicate that logic in the extension.

## 9. Webview boundary

- Host sends validated question/draft DTOs with project/session/stage/execution identity, batch fingerprint and a monotonic view revision. Webview sends edits/submit intent with that identity/revision; stale messages are rejected without losing the draft.
- A webview cannot choose a filesystem path, CLI executable, cwd or arbitrary command. Host derives them from the bound target. Revalidate every submitted question ID, option ID, input mode and string value; DOM validation is not authoritative.
- Render agent/user content as text. No raw HTML/Markdown execution, remote scripts, network fetches or filesystem access in the webview. Open-source-file/log actions are host commands bound to known files.
- Follow the shared webview rules: CSP starting with `default-src 'none'`, external scripts, restricted `localResourceRoots` for extension media, VS Code resource URIs and no unnecessary retained hidden contexts. Persist identity/light UI state with `getState/setState` and restore through a panel serializer; load durable answers/drafts from the host.
- Native file editors, tree selection and other question panels keep their focus when a background batch changes. Update only the relevant panel, with a visible stale/recorded state when necessary.

## 10. Contract checks before implementation is considered complete

1. Pin fixtures/minimum CLI compatibility for question file version 1, workflow version 3 with `ask: human`, mixed-state sessions and standalone role replies. Do not broaden manifest support just because the workflow version changed.
2. Verify literal free text that is also an option ID. In the current CLI reader, a JSON string `"A"` is interpreted as option A when A exists, even if the user chose Other. Detect that ambiguity and explain it without silently changing the answer. An explicit free-text transport would require a documented upstream contract extension; do not invent one in the extension.
3. Preflight re-reading and an extension gate do not close the race where another client replaces a batch between inspection and CLI lock acquisition. The documented command has no expected-execution/batch argument. Track this limitation explicitly, cover it with competing-client tests, and resolve CLI-side batch binding or a documented rejection guarantee before claiming atomic stale-batch protection. Do not invent an unsupported flag or take over Migent's session lock.
4. Verify how the published CLI exposes recorded answers when dispatch fails before a new execution. Recovery must be driven by persisted answers, not an assumed event name or stderr message.

These are integration checks/known protocol limits, not permission to infer answers, mutate generated files or silently weaken identity validation.

## 11. Implementation order and validation

1. **Core contract:** add question/history readers, pending groups, fingerprints, answer validation/JSON serialization and fixtures; extend displayState without hiding mixed Running/Blocked questions.
2. **Monitoring:** wire targeted watchers/store events, question rows, attention counts, native question/history access and exit-9 diagnostics.
3. **Submission:** add the Answer questions command, target selection, capability checks, draft/submission persistence and separate acceptance/continuation reconciliation using the shared operation gate.
4. **Panel:** implement the batch webview, exclusive choice/text modes, draft restore, progress/jumps, stale handling and history. Add `migent.notifications.question` (default true), independent of blocker notifications.
5. **Integration/recovery:** run fake-provider and real CLI contract scenarios, Windows file/runner checks, concurrent-client tests, reload/reconnect and accessibility checks before phase 4 release testing.

Required coverage:

- Single vs multiple, duplicate/unknown option IDs, missing/extra questions, 2 and 26 options, no default selections, recommended options, Unicode, multiline text/code and comma/number-like text serialized through JSON. Choice/text modes exclude each other and preserve inactive drafts.
- Multiple stages both using question `1`, follow-up executions reusing numbers, blockers and pending questions together, active independent branches, standalone role sessions, and ordinary Continue leaving questions unanswered.
- Unsupported schema/recipient, corrupt/temporarily missing files, question history reconstruction, watcher coalescing and missing-CLI read-only monitoring.
- Draft close/reopen/reload, stage switches, disk-save failure, spawn/transport failure, edits newer than a submitted snapshot, answered elsewhere, superseded batches, and late messages from old panels.
- Answers recorded before dispatch failure, exit 9 with a new batch, exit 1 from another branch, CLI validation rejection, uncertain acknowledgment/recheck and simultaneous Submit from two panels/clients. No automatic resend or duplicate agent dispatch.
- Render hostile question/context/text as inert content; reject forged webview targets/paths/IDs. Keyboard-only completion, textarea newlines, focus retention, high contrast and screen-reader feedback.

## Done when

- A real stage configured with `ask: human` stops for questions, appears in the extension, accepts every answer of its current batch through the form, and continues the same stage/provider conversation in a new execution.
- Users can answer each question by its permitted choice mode or free text, answer all questions, and explicitly submit once. Recommended answers are never preselected.
- Pending batches remain discoverable in Running, Blocked and Question sessions; the user can draft while waiting for the runner to release its lock.
- Reload and failed submission do not lose drafts. Recorded answers survive failed continuation and are never resubmitted as a new decision.
- Another stage/round cannot receive this batch's answers; stale changes and unresolved protocol races are surfaced honestly.
- Existing blocker Reply, native task/config/workflow editing, session controls and monitoring remain usable.

## Design reference

[`designs/human-questions-ui.html`](../designs/human-questions-ui.html) is the interaction sketch, not a protocol implementation. Align it during panel implementation: replace its standalone text question with the contract's single/multiple plus Other; make Other replace multiple-choice selections; use stored question IDs/letters and the JSON reply-file map; distinguish `question` from `blocked`, and recorded answers from resumed execution. Its current demo behavior is not an exception to this plan.
