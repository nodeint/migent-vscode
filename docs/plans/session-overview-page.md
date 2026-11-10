# Feature: Session Overview page

Status: implemented. Decisions come from the recorded answers in
`.migent/sessions/238678f0-ba9c-46f9-a445-8a5e988a4a54/questions.json`.

## Outcome and scope

The Session page stops being a "Results" page that is empty until a session finishes. Its default tab becomes
**Overview**: one read-only page that explains what the session is doing now, what it waits for, and what it has
produced. Opening a session from the Sessions tree always lands on Overview, including while questions are pending;
an explicit execution target still opens Questions.

Acceptance criteria:

- AC1: Clicking any session row opens Overview, whatever its state or pending questions. A request that names an
  execution keeps its current Questions behavior.
- AC2: Overview renders these blocks in this fixed order: Status, Progress, Latest activity, Outputs, Next steps,
  Child sessions, Source session and Handoff.
- AC3: Status states the current state and its reason, and offers at most one primary action for that state, plus
  the secondary actions listed in the action table below. Reply is no longer a header button on any tab.
- AC4: Progress is stage-based for a workflow session: every workflow stage is listed in workflow order with its
  state, attempt number and latest decision; rows are not clickable. A role session, a session without a readable
  workflow, or a workflow with no stages lists executions instead.
- AC5: Latest activity appears only while the session is Running, shows the five newest complete `events.jsonl`
  events, and never reads `events.jsonl` for any other state.
- AC6: Outputs and Next steps are always present and show an empty notice when they have nothing. Child sessions,
  Source session and Handoff appear only when the session has that data.
- AC7: The tab identity is `overview` everywhere: `SESSION_TABS`, the panel model, the serializer, the editor tab
  icon and its copy. No user-facing "Results" tab remains.
- AC8: The implementation does not add a god module. Status, progress, activity, actions and the existing results
  blocks keep separate owners; `overviewModel.ts` only composes them.
- AC9: Questions, Metrics, Workflow, Next step, output and handoff behavior is unchanged.
- AC10: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` and the affected integration scenarios pass.

Non-goals: the Sessions tree keeps its current children (decision 8A); no Metrics summary block (2J); no `task.md`
block inside Overview (2E); no execution list block (2C); no per-stage duration, cost, client, model or role (7C/7D);
no click action on progress rows (8A); no new notifications, CLI commands or persisted files.

## Current state (evidence)

- The page shell is `media/session/session.js`; its four renderers are `results.js`, `metrics.js`, `workflow.js` and
  `questions.js`. `media/session/results.js` renders only outputs, next steps, children and handoff, and always shows
  an empty notice for outputs and next steps.
- `src/core/sessionPageModel.ts` defines `SESSION_TABS = ['questions', 'results', 'metrics', 'workflow']` and one
  `SessionPageModel` variant per tab. `src/core/resultsModel.ts` builds the Results model and reads `outputs/`,
  `next.json`, `workflow.frozen.yaml`, `manifest.yaml` and child `task.md` on demand.
- `src/vscode/session/panels.ts` owns one panel per `(project, session)`, the serializer default and the page
  descriptor. `src/vscode/session/entry.ts` maps every tab to an editor-tab icon.
- `src/vscode/commands/sessionPageCommands.ts` opens Questions when a batch is pending and Results otherwise.
- `src/core/store.ts` already computes `replyTargets`; `src/core/sessionMeta.ts` exposes `canReply`, `canComplete`,
  `pendingQuestions`, `isRunning` and the header facts. The header currently draws a Reply button on every tab
  (`media/shared/page.js`, `sessionHeader`).
- `src/core/executions.ts` lists execution summaries (status, attempt, decision, failure report, kind) but not the
  blocker text. `src/core/workflows.ts` knows catalog stage ids, not the session's frozen/draft workflow.
- `events.jsonl` is watched at session level (`src/core/watchPlan.ts`, `SESSION_PATTERN`) and surfaces as a `files`
  change with target `events`. `TailManager` reads it only while a timeline or log holds interest.
- `src/core/replyFlow.ts` owns reply eligibility and `quotaFailure`/`describeQuotaReset`; those are reusable without
  new reads.
- Baseline on 2026-11-10: `pnpm typecheck` and `pnpm test` passed. Integration tests were not run.

## Decisions from the answers

| # | Decision |
| :--- | :--- |
| 1A | Rename the Results tab to Overview; keep one tab and move the current results content into it. |
| 2 | Blocks: status summary, stage progress, latest activity, outputs, next steps, child sessions, source/handoff. |
| 3A | Progress is one row per workflow stage; attempt is a number, not a row. |
| 4A | One primary action per state, with secondary links. |
| 5B | Blocks without data stay visible with an empty notice (narrowed by 11A). |
| 6A | Activity only while Running, five newest events. |
| 7B | Clicking a session with pending questions still opens Overview. |
| 8A | The Sessions tree is unchanged. |
| 5C | Remove Reply from the header on every tab; Overview owns it. |
| 7A/7B | A stage row shows its attempt number and the latest decision. No role or client/model. |
| 8A | Progress rows are read-only (the tree keeps its children). |
| 9B | A role session lists its execution turns instead of stages. |
| 10A | Fixed block order, independent of state. |
| 11A | Only Outputs and Next steps always show; Child, Source and Handoff stay conditional. |

## Design

### Module boundaries (no god module)

| Owner | Responsibility | Does not |
| :--- | :--- | :--- |
| `core/overviewModel.ts` (new) | Thin composition: header fields, `summary`, `progress`, `activity`, `actions`, plus the existing results blocks. | Read files itself, pick copy, or decide action eligibility. |
| `core/sessionSummary.ts` (new) | Pure: state reason, running stage/summary, blocked executions and blocker, quota reset, pending questions, latest execution. | Format sentences or send intents. |
| `core/sessionProgress.ts` (new) | Pure: merge the stage plan with execution summaries into stage rows or execution rows. | Read files or workflow YAML. |
| `core/workflowStages.ts` (new) | Read only stage ids, in order, from the session's frozen workflow then its draft. | Read the full workflow form or config. |
| `core/sessionActivity.ts` (new) | Pure: format at most five events as activity lines. | Read `events.jsonl`. |
| `core/overviewActions.ts` (new) | Pure: one primary and ordered secondary `SessionAction`s per state. | Execute commands. |
| `core/resultsModel.ts` (existing) | Keep the results blocks (outputs, next, source, children) and their resolvers. | Grow new overview concerns. |
| `vscode/session/pageModels.ts` | Read executions, the stage plan and events, then call the core builders. | Build DOM. |
| `media/session/overview.js` (new) | Compose the fixed-order sections and render Status and its actions. | Render progress, activity or results blocks. |
| `media/session/overviewProgress.js` (new) | Render Progress and Latest activity. | Own copy for other blocks. |
| `media/session/results.js` (existing) | Keep rendering Outputs, Next steps, Child sessions and Source/Handoff. | Render status, progress or activity. |

### Model shape

`OverviewModel` extends the existing `ResultsModel`, so the common header fields and the four results blocks are not
duplicated. New fields:

```ts
type OverviewModel = ResultsModel & {
  summary: SessionSummary;       // sessionSummary.ts
  progress: SessionProgress;     // sessionProgress.ts
  activity: SessionActivity;     // sessionActivity.ts
  actions: OverviewActions;      // overviewActions.ts
};
```

`SessionProgress` is a closed union: `{ kind: 'stages', rows }` for a readable stage plan, `{ kind: 'executions',
rows }` for a role session or an unreadable plan, and `{ kind: 'empty' }`. `SessionActivity` is `{ visible: false }`
or `{ visible: true, lines: string[] }`. `OverviewActions` is `{ primary: SessionAction | null, secondary:
SessionAction[] }`; danger is a property of the action in the page, not a separate command.

The host passes already-read data into `buildOverviewModel`: the session snapshot, the results input, execution
summaries, the stage plan and the recent events. It reads events only when `displayState.state === 'running'`.

### Actions per state

| State | Primary | Secondary (only when applicable) |
| :--- | :--- | :--- |
| Question | `answerQuestions` (switch to Questions) | none |
| Blocked | `reply` (only when `meta.canReply`) | `showLog` |
| Running | `showLog` | `stop` (danger) |
| Failed | `continue` | `openFailure` (latest execution has a report), `showLog` |
| Stopped, Cancelled | `continue` | `reply` when `meta.canReply`, `completeSession` when `meta.canComplete`, `showLog` |
| Prepared | `start` | `openTask` |
| Completed | none | `reply` when `meta.canReply` (a completed role session's next turn) |
| Unknown | none | none |

`SESSION_ACTIONS` in `core/resultsIntent.ts` gains `start`, `stop`, `continue` and `openFailure`;
`vscode/sessionActions.ts` maps them to `migent.session.start`, `migent.session.cancel`,
`migent.session.continue` and `migent.session.openFailure`. `answerQuestions`, `openTask`, `showLog`,
`completeSession` and `reply` already exist. Every command keeps receiving `{ project, sessionId }` for the panel's
own session, so no picker or active-editor fallback can redirect it.

### Reads, caching and refresh

- **Executions:** `listExecutions` stays the only reader; the Overview builder calls it once per render. It is
  already used by the tree, Metrics and the reply rule. No store cache is added.
- **Stage plan:** `readSessionStagePlan` reads `workflow.frozen.yaml` first, then `workflow.yaml`. It parses only
  `stages[].id`, keeps declaration order, and reports `missing`, `unreadable`, `invalid` or `ok`. This avoids
  loading the full workflow form (config, clients and editor model) just to show stage names.
- **Events:** `readRecentEvents(filePath, 5)` is a bounded backward reader in `core/eventTail.ts`. It reads only
  the tail chunks needed for five complete lines, ignores a torn final line, and parses through the existing
  envelope parser. The host calls it only for Running sessions. Existing session-level watching already reports
  `events.jsonl` changes, so a Running Overview repaints without a new watcher or `TailManager` holder.
- **Refresh:** `SessionPanels.#onChange` already marks a panel dirty for `session` and `files` changes of its own
  session. A Running session's `events` change therefore repaints Overview. No new subscription is needed.
- **Performance risk:** a session with hundreds of executions makes `listExecutions` read every `execution.json`.
  This is the same cost as the tree's attempt list. If it becomes material, cache summaries in `SessionStore` in a
  later task; this plan does not add that cache.

### Results content and empty rules

- Outputs and Next steps keep their current `MigentForm.section` blocks, count chips, notes and `mg-empty` notices.
  They stay on the page in every state, including Prepared, Running and Unknown.
- Child sessions, Source session and Handoff stay conditional exactly as today (11A). A session with none of them
  has no empty frame for those blocks.
- Progress always has a section head and shows a one-line empty notice when there is nothing to list. Activity has
  a section head only while it is visible; outside Running the whole block is absent.
- The section order is fixed by `overview.js`; it never depends on state.

### Naming

- Tab key and model tag: `overview`.
- Header builder: `overviewHeader`; the old `resultsHeader` name is removed with the tab.
- `resultsModel.ts` keeps its name because it owns the results blocks, not the tab. Its model stays the base of
  `OverviewModel`; a later rename is out of scope.
- The Questions page's `openResults` message is renamed to `openOverview` so no internal "results tab" remains.
  `answerModel.ts`, `sessionPageIntent.ts`, `panels.ts` and `questions.js` are updated together.

## Implementation phases

Each phase compiles, has its own tests, and leaves the extension usable. Later phases depend on earlier ones:
P1 -> P2 -> P3 -> P4 -> P5 -> P6 -> P7 -> P8 -> P9 -> P10.

| Phase | Outcome | Status |
| :--- | :--- | :--- |
| P1 | Bounded recent events and activity lines | done |
| P2 | Stage plan and progress rows | done |
| P3 | Status facts and action eligibility | done |
| P4 | Overview model composition and host reads | done |
| P5 | Tab renamed and Overview opens by default | done |
| P6 | Overview shell, Status block and state actions | done |
| P7 | Progress block | done |
| P8 | Latest activity block | done |
| P9 | Results blocks, empty states and cleanup | done |
| P10 | Documentation and full verification | done |

### P1: bounded recent events and activity lines

Files: `src/core/eventTail.ts`, `src/core/sessionActivity.ts` (new), `src/core/eventTail.test.ts`,
`src/core/sessionActivity.test.ts` (new).

Steps:

1. Add `readRecentEvents(filePath: string, limit: number): TailEvent[]` to `eventTail.ts`. Open, `fstat`, read
   backward chunks (the existing 65,536-byte size), stop once `limit + 1` newlines are found or offset 0, keep only
   complete lines, then take the last `limit` and parse them with the existing `parseLine`.
2. Return `[]` for a missing/unreadable file, `limit <= 0`, or a file with no complete line. Never throw.
3. Add `OVERVIEW_ACTIVITY_LIMIT = 5` and `buildActivity(events): { visible: true, lines }` in
   `sessionActivity.ts`, using `formatTimelineLine` for each event. This module is pure and imports no `vscode`.
4. Do not read events for non-Running sessions; that decision belongs to the host in P4.

Acceptance: a 10,000-line file returns its five newest events without reading the whole file; a torn final line is
not returned; a missing file yields nothing. Tests: `eventTail.test.ts` (tail boundary, torn line, empty, limit) and
`sessionActivity.test.ts` (order, limit, format, empty).

### P2: stage plan and progress rows

Files: `src/core/workflowStages.ts` (new), `src/core/sessionProgress.ts` (new),
`src/core/workflowStages.test.ts` (new), `src/core/sessionProgress.test.ts` (new),
`src/core/fixtures/sessions/*` as needed.

Steps:

1. `readSessionStagePlan(projectRoot, sessionId)` reads `workflow.frozen.yaml`, then `workflow.yaml`, and returns
   `{ kind: 'ok', stages: string[] }`, `{ kind: 'missing' }`, `{ kind: 'unreadable', error }` or
   `{ kind: 'invalid', error }`. Parse with `yaml`, keep `stages[].id` in declaration order, skip malformed entries.
2. `buildProgress(input)` takes `{ executions, plan, runningStageIds, latestExecutionId }`. With a non-empty plan it
   returns one row per stage: `{ id, state, attempts, decision, isCurrent }`. State is the latest non-skipped
   execution's status mapped to `not-run`, `running`, `blocked`, `failed`, `stopped`, `cancelled`, `completed` or
   `skipped`; `not-run` means no execution. `attempts` is the latest execution's attempt; `decision` is its
   decision.
3. Append stage ids that have executions but no plan entry, in execution order, so nothing is lost after a workflow
   edit.
4. With no plan, a role session or an unreadable/invalid plan, return `{ kind: 'executions', rows }` with one row per
   execution (`executionId`, `stage`, `attempt`, `state`, `decision`). Ignore nothing: skipped rows are shown.
5. `isCurrent` is true for `runningStageIds` or the latest running execution. Rows are data only; no click intents.

Acceptance: Completed, Failed, Blocked, Cancelled and Running fixtures produce the expected row states; a prepared
session with only `workflow.yaml` lists its stages as `not-run`; a role session lists executions; a malformed plan
falls back to executions. Tests cover the mapping table and the fallback.

### P3: status facts and action eligibility

Files: `src/core/model.ts`, `src/core/executions.ts`, `src/core/executions.test.ts`,
`src/core/sessionSummary.ts` (new), `src/core/sessionSummary.test.ts` (new), `src/core/resultsIntent.ts`,
`src/core/resultsIntent.test.ts`, `src/core/overviewActions.ts` (new), `src/core/overviewActions.test.ts` (new),
`src/core/replyFlow.test.ts` (helper only).

Steps:

1. Add `blocker: string | null` to `ExecutionSnapshot`; read `outcome.blocker` in `summaryFrom`. Update the
   `replyFlow.test.ts` execution helper. This is an additive field, not a new read.
2. `buildSummary(snapshot, executions)` returns `{ state, unknownReason, runningStage, runningSummary,
   blocked: [{ executionId, stageId, attempt, blocker }], quotaResetAt, pendingQuestions, latestExecution, isRunning }`.
   - Running stage and summary: `status.runningStages[0]`, then `status.latestProviderEvent`, then `stageOf`.
   - Blocked: map `status.blockedByExecutionIds` through `parseExecutionId` and join the execution summary's blocker.
   - Failure: the latest execution's status and `hasFailureReport`; quota reset comes from existing `quotaFailure`.
   - Unknown: carry `displayState.unknownReason`; the page owns the words.
3. `overviewActions(snapshot, latestExecution)` implements the action table. Return `SessionAction` ids only.
4. Add `start`, `stop`, `continue`, `openFailure` to `SESSION_ACTIONS`; extend `parseResultsMessage` tests. Do not
   map commands here; that is P5.
5. No page or host behavior changes yet; the functions are pure and have their own tests.

Acceptance: every state maps to the table exactly; `reply` is absent when `meta.canReply` is false and present as a
secondary action for a completed role session; `openFailure` is absent without a report; blocked rows carry the
recorded blocker text when present. Tests: one case per state, plus missing blocker, foreign lock `writable: false`,
a completed role session with a reply target, and Unknown reasons.

### P4: Overview model composition and host reads

Files: `src/core/overviewModel.ts` (new), `src/core/overviewModel.test.ts` (new),
`src/vscode/session/pageModels.ts`, `src/vscode/session/entry.ts` (type only), `src/vscode/session/panels.test.ts`
if needed.

Steps:

1. `buildOverviewModel(input)` calls `buildResultsModel` once and spreads it, then calls `buildSummary`,
   `buildProgress`, `buildActivity` and `overviewActions`. It performs no file reads of its own.
2. Input adds `executions`, `plan`, `events` and the results input. For an unavailable session, return the same
   empty/default shape the results builder already uses, plus `progress: { kind: 'empty' }`,
   `activity: { visible: false }` and no actions.
3. `pageModels.ts` adds `buildOverviewPage(entry, registry)`:
   - `listExecutions(sessionDir(...))`;
   - `readSessionStagePlan(...)`;
   - `readRecentEvents(eventsPath(...), 5)` only when `displayState.state === 'running'`, else `[]`;
   - `buildOverviewModel(...)`.
4. Wire it behind a temporary helper only; the tab still renders Results until P5, so no user-visible change.
5. Test composition with a captured session: results blocks are unchanged, summary/progress/actions are present,
   and events are empty for a non-Running session.

Acceptance: `buildOverviewModel` delegates and never reads disk; `buildOverviewPage` reads events only for Running.
Tests: `overviewModel.test.ts` with captured fixtures, a role session, an unavailable id and non-Running events.

### P5: rename the tab and open Overview by default

Files: `src/core/sessionPageModel.ts`, `src/core/sessionPageIntent.ts`, `src/core/answerModel.ts`,
`src/vscode/session/entry.ts`, `src/vscode/session/panels.ts`, `src/vscode/session/pageModels.ts`,
`src/vscode/commands/sessionPageCommands.ts`, `src/vscode/webview/page.ts`, `media/tab-icons/overview-*.svg` (new),
`media/shared/copy.js`, `media/session/session.js`, `media/session/questions.js`, and their tests.

Steps:

1. Change `SESSION_TABS` to `['questions', 'overview', 'metrics', 'workflow']`; rename the model variant and
   `resultsHeader` to `overviewHeader`; update every import.
2. Change `isTab`, the serializer default, the panel's `#sendEntry` branch and `TAB_ACTIONS.openResult` to
   `'overview'`. `open()` with no explicit tab or batch selects Overview, for a new panel and for an existing one;
   an explicit execution still defaults to `'questions'`.
3. `sessionPageCommands.optionsFor`: `requested.tab ?? (executionId !== undefined ? 'questions' : 'overview')`.
   Pending questions no longer change the default (7B).
4. Extend `tabIcon`'s union with `'overview'` and add one SVG per tone and theme under `media/tab-icons/`. Until the
   icon is confirmed (open question 1), generate them from the codicon named in that answer; do not ship a copy of
   `results-*.svg` as a placeholder.
5. Rename the `openResults` answer/page message to `openOverview` through `answerModel.ts`, `sessionPageIntent.ts`,
   `session.js`, `questions.js` and the panels branch.
6. In `session.js`, rename the tab label key `copy.tab.results` to `copy.tab.overview` and render the current
   `results.js` against `model.overview` as a temporary body. The full shell arrives in P6.
7. Update `sessionPageModel.test.ts`, `sessionCopy.test.ts`, `pageScript.test.ts` fixtures, `questionsPage.test.ts`
   script lists, `panels.test.ts` and the integration scenarios that assert `tab === 'results'` or `state -> Results`.

Acceptance: every session row opens Overview, including Question sessions; an explicit execution opens Questions;
the serializer restores Overview; no `results` tab key remains. Tests: unit and `results.integration.test.ts`
renamed to `overview.integration.test.ts`.

### P6: Overview shell, Status block and state actions

Files: `media/session/overview.js` (new), `media/session/overviewCopy.js` (new), `media/session/session.js`,
`media/session/session.css` (status/action layout only), `media/shared/page.js`, `media/shared/copy.js`,
`src/vscode/session/panels.ts` (descriptor), `src/vscode/webview/overviewPage.test.ts` (new),
`src/vscode/webview/pageScript.test.ts`, `src/vscode/webview/sessionCopy.test.ts`.

Steps:

1. Add `overview.js` with `render(root, model, page)`. It renders the fixed section order and delegates results
   blocks to `window.MigentSessionResults.render`. For now it renders Status and the results blocks; P7 inserts
   Progress between them and P8 inserts Activity.
2. Status uses `MigentForm.section('Status', { surface: true, children })`, `MigentPage.statusIndicator(state)`,
   the summary facts (running stage/summary, blocker text, quota reset, pending question count, latest execution)
   and the action row from `model.overview.actions`.
3. Render one primary with `kind: 'primary'`; `stop` with `kind: 'danger'`; every other action with
   `kind: 'secondary'`. Each button sends `{ intent: 'sessionAction', action: id }`. Never send a command or path.
4. Add `overviewCopy.js` beside `resultsCopy.js`; keep results text in `resultsCopy.js`. Register both copy files
   before their scripts in the `PAGE` descriptor and add `overview.js` to `media/session/panels.ts`.
5. Remove the Reply button from `sessionHeader` and the now-unused `copy.reply`; `pageHeader` keeps its generic
   `actions` option for other pages. Update `pageScript.test.ts` and the docs that mention the header Reply.
6. CSS: only spacing/stack classes from existing tokens. No new color, radius or component style.

Acceptance: Status explains every state; exactly one primary action is drawn per the table; Stop is danger; the
header has no Reply on any tab; Overview actions target the panel's own session. Tests: `overviewPage.test.ts`
drives the fake DOM and asserts section order, primary/secondary/danger, the sent intents and the empty state.
Manual: keyboard order, all four themes, one primary visible at a time.

### P7: Progress block

Files: `media/session/overviewProgress.js` (new), `media/session/overviewCopy.js`,
`media/session/session.css` (progress rows only), `src/vscode/session/panels.ts`,
`src/vscode/webview/overviewPage.test.ts`.

Steps:

1. `MigentSessionOverviewProgress.renderProgress(model)` returns one `MigentForm.section('Progress', ...)`.
   Stage mode: one row per stage, in model order, with the stage id, a state pill/icon, `attempt N` for every stage
   that has run (N is the latest attempt, so a stage on its first run shows `attempt 1`), and the latest decision
   when present. Execution mode: one row per execution with the stage, attempt, state and decision. `isCurrent`
   uses the running tone.
2. Rows are `<div class="mg-row">`, never `<button>`. Do not add open/response/failure intents (8A).
3. Empty model (`kind: 'empty'`) shows one `mg-empty` line naming that there is nothing to list.
4. `overview.js` inserts Progress directly after Status, so the order is Status, Progress, Activity, results.
5. CSS uses existing tokens and `mg-row`, `mg-pill`, `mg-status`; no new component.

Acceptance: a workflow session lists every stage including future ones; a role session lists its turns; attempts and
decisions are visible; rows cannot be clicked or focused as actions. Tests: core mapping in
`sessionProgress.test.ts` and page rendering in `overviewPage.test.ts`.

### P8: Latest activity block

Files: `media/session/overviewProgress.js`, `media/session/overviewCopy.js`,
`src/vscode/webview/overviewPage.test.ts`, `src/integration/overview.integration.test.ts`.

Steps:

1. When `model.activity.visible` is true, render `MigentForm.section('Latest activity', ...)` after Progress with an
   `mg-list` of `mg-mono` lines. Lines come from `core/sessionActivity.ts`; the page never formats an event.
2. When `visible` is false, render nothing: no empty frame, no head (6A).
3. The host already reads events only for Running in P4. Confirm with a test that a non-Running model has no lines
   and that a Running model shows exactly five, oldest first.
4. The section is read-only; there is no link to the timeline (View log stays a Status action).

Acceptance: activity appears only while Running, newest five, no event read for other states. Tests: unit in
`sessionActivity.test.ts`; page test for visible/hidden; integration appends `events.jsonl` to a Running session and
asserts the posted model followed without focus changes.

### P9: Results blocks, empty states and cleanup

Files: `media/session/results.js`, `media/session/resultsCopy.js`, `media/session/overview.js`,
`src/core/resultsModel.ts`, `src/core/resultsModel.test.ts`, `src/vscode/webview/overviewPage.test.ts`.

Steps:

1. Confirm and test the empty rules: Outputs and Next steps always render, with their current `mg-empty` text;
   Children, Source and Handoff render only with data.
2. Render the results blocks after Activity in the fixed order. `results.js` receives the `OverviewModel` (it is a
   `ResultsModel` superset), so no model duplication is needed.
3. Keep the unavailable page (`session.js`) as the existing explanation plus session id; do not draw empty
   Overview sections for it.
4. Remove the unused `resultsPanelTitle` and its test cases; `sessionPageTitle` is the one panel-title rule. Keep
   `resultsModel.ts`, `ResultsModel` and `buildResultsModel` because they own the results blocks.
5. Check the page for leftover "Results" wording in copy, comments and docs. The only remaining `results` names are
   internal block/model names, and `docs/ui.md` says so.

Acceptance: a Prepared session with no outputs and no `next.json` still shows both blocks with an empty notice and
no Child/Source/Handoff frames; a Completed session with data shows all four; an unavailable session shows only the
unavailable explanation. Tests: `resultsModel.test.ts` and `overviewPage.test.ts`.

### P10: Documentation and full verification

Files: `docs/ui.md`, `docs/architecture.md`, `docs/core.md`, `docs/testing.md`, `docs/plans/session-overview-page.md`.

Steps:

1. `docs/ui.md`: rename the tab table row to Overview, list `overview.js` and `overviewProgress.js`, describe the
   fixed section order, the state-action table, the removed header Reply and the new activity/plan readers.
2. `docs/architecture.md`: update the Session page ownership row and the session detail readers row.
   `docs/core.md`: add the bounded recent-event read, the session stage-plan read and the Overview read triggers;
   state that events are read only for Running.
3. `docs/testing.md`: list `overviewPage.test.ts`, `sessionActivity.test.ts`, `sessionProgress.test.ts`,
   `sessionSummary.test.ts` and `overviewActions.test.ts`, and the renamed integration suite.
4. Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` and `pnpm package`.
5. Run `pnpm test:integration --file overview` and the existing session, questions, timeline and metrics suites.
6. Manual pass in VS Code for all four themes, keyboard order, one primary action, danger Stop, the menu, and a
   session changing state while Overview is open.

Acceptance: AC1-AC10 pass; every named test file exists and is discoverable; no doc claims a behavior the code does
not implement.

## Testing map

| Criterion | Test |
| :--- | :--- |
| AC1 | `sessionPageCommands` unit or `overview.integration.test.ts`: a Question session row opens Overview; an execution target opens Questions. |
| AC2 | `overviewPage.test.ts`: asserts the section order by heading text. |
| AC3 | `overviewActions.test.ts` for every state; `overviewPage.test.ts` for one primary, danger Stop and sent intents; `pageScript.test.ts` for no header Reply. |
| AC4 | `sessionProgress.test.ts` (stage order, attempts, decisions, fallback) and `workflowStages.test.ts` (frozen/draft, errors). |
| AC5 | `eventTail.test.ts` (bounded tail), `sessionActivity.test.ts` (limit/order), `overviewModel.test.ts` (not Running => no events), `overview.integration.test.ts` (append while Running). |
| AC6 | `overviewPage.test.ts` and `resultsModel.test.ts` for empty Outputs/Next and conditional Child/Source/Handoff. |
| AC7 | `sessionPageModel.test.ts`, `panels.test.ts`, `sessionCopy.test.ts` and the integration suite for the `overview` tab and serializer. |
| AC8 | Review: `overviewModel.ts` contains composition only; the new modules above have no `vscode` import. |
| AC9 | Existing `questionsPage.test.ts`, `sessionWorkflowPage.test.ts`, metrics tests and the integration suites stay green. |
| AC10 | The commands in P10. |

Unit tests run with `pnpm test`. Integration runs with `pnpm test:integration --file overview`. The page test uses a
small fake DOM like `questionsPage.test.ts`; it does not check layout or themes, so the manual pass is recorded in the
pull request.

## Documentation

- `docs/ui.md`: the Session page tab list, renderer table, Overview sections, the action table and the removed
  header Reply.
- `docs/architecture.md`: the Session page ownership row and the session detail readers row.
- `docs/core.md`: bounded event read, stage-plan read, Overview read triggers and the Running-only event rule.
- `docs/testing.md`: the new unit tests and the renamed integration suite.
- `docs/plans/session-overview-page.md` (this file): update each phase's status as it lands.

`docs/doc-authoring.md` says plans belong outside `docs/`. This file lives here only because the user chose a tracked
`docs/plans/` location; it must not be linked as evidence from a durable document.

## Risks and open questions

Risks:

- `listExecutions` reads every `execution.json` on each Overview render. It matches the tree's cost but grows with
  long sessions. A store cache is deliberately out of scope; measure before adding one.
- A Running session's `events.jsonl` changes fire the existing `files` refresh. The bounded read keeps each repaint
  cheap, but a high-frequency stream still repaints often. The existing 0 ms panel flush coalesces bursts.
- A backward byte reader can split a multibyte UTF-8 character at a chunk boundary. Collect buffers and decode once
  after joining, or use `StringDecoder`; add a test with a multi-byte summary.
- Removing the header Reply means a reader on Questions, Metrics or Workflow must open Overview to reply. This is the
  recorded decision 5C; the Questions tab still owns Answer questions.
- Restoring an old serialized `results` tab now falls back to Overview because `isTab` no longer accepts it. This is
  intended, but the serializer test must cover it.
- `OverviewModel extends ResultsModel` keeps the old type name. Renaming it later is cosmetic and out of scope.

Open questions (answered on 2026-11-10):

1. Overview tab icon: `dashboard`; generate the ten `media/tab-icons/overview-*` files from it.
2. Activity line format: `formatTimelineLine` (`10:15:30 plan#1 started · claude/sonnet`).
3. Question state: only `answerQuestions`; no secondary `showLog`.
4. Copy: the implementer drafts the English copy in `overviewCopy.js`; the user reviews it in the pull request.
