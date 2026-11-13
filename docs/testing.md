# Testing

Use this guide when selecting and writing tests. Run the checks appropriate to
the change before and after implementation; the
[contribution guide](../CONTRIBUTING.md#verification) lists the commands.

## Select test cases

Write high-value logic cases that protect important behavior and can catch
meaningful regressions. Prioritize:

- Distinct outcomes and critical rules.
- Boundaries and failure handling.
- State transitions where a defect would matter.

Cover the affected behavior and its material risks. A small test count does not
replace verification of an important outcome.

### Keep the suite focused

Choose representative inputs for equivalent cases instead of testing every
combination. Minimize medium-value cases that add little confidence relative to
their maintenance cost. Avoid duplicate cases and tests that merely mirror
implementation details or documentation prose.

## Write assertions

Check observable behavior and ensure each assertion can distinguish a regression
from a correct result.

## Verify behavior changes

Core tests use fixtures and temporary directories without launching VS Code.

For extension commands, activation, or UI changes, also verify the behavior in
VS Code and describe the manual steps in the PR.

### Fixtures

Core tests read two fixture sets in place under `src/core/fixtures/`:

- `captured/` holds real files written by migent 0.3.1 (and 0.3.5 for session drafts), redacted (see its
  [README](../src/core/fixtures/captured/README.md)). Tests that need a project
  layout copy from it into a temporary directory.
- `synthetic/` holds hand-written files for shapes no captured sample covers
  (see its [README](../src/core/fixtures/synthetic/README.md)). Name them as
  synthetic in test titles, and replace them when a captured sample appears.

### Extension-host integration tests

`pnpm test:integration` builds the extension and `src/integration/` with esbuild, downloads VS Code
through `@vscode/test-electron`, and runs the suite concurrently against the minimum
supported version (`engines.vscode`) and the latest stable in separate scratch trees and profiles. Files named
`*.integration.test.ts` are excluded from Vitest. Each run opens VS Code from a `.code-workspace` file whose only
folder is an empty anchor, so the window is multi-root from the start (a guard against the extension-host restart
that adding a folder to a single-folder window can cause). Every scenario and every watcher probe case
gets its own folder, copied from `src/integration/fixtures/workspace/` (its `.gitignore` ignores `.migent`), added with
`updateWorkspaceFolders` and, in the real-watcher pass, handed over once a sentinel file proves its watcher is live.
Nothing is shared between
cases, so no case waits for a previous case's `.migent/` to disappear. Folders are removed from the workspace after
each case but deleted only when the run ends, because deleting a directory VS Code is still unwatching caused
`EPERM`/`EBUSY` storms on Windows. `fake-migent.js` records the pid of every process it starts in
`fake-pids.log`; a case fails if any of them is still alive after it, and a case that does not finish within 30 seconds
fails by name.

When a case fails, the run reports every failed case as `[suite] case name`, the message and the
`src/...:line:column` of the failing test line (bundle frames are mapped through the source map by
`failureReport.ts`). The same list is in the thrown error, the runner output, `dist-test/integration-failure-<version>.json`
and, on GitHub Actions, as error annotations. Each case also logs `RUN`, `PASS` or `FAIL` with its duration in the
VS Code log. Pass `--versions a,b` to choose versions, `--file reply` to run only suites whose
file name contains the text (`watcherProbe` selects the probe), and `--case "empty reply"` to run only cases whose
name contains the text (both case-insensitive, combinable; a filter that matches nothing fails, and the watcher probe
is skipped unless `--file` names it), for example `pnpm test:integration --versions 1.93.0 --file reply`. Pass
`--exclude` to also set `files.watcherExclude` for `**/.migent/**`. VS Code then
delivers no watcher events for `.migent`; this is a known limitation that the
user controls, so that mode only reports and never fails. Reports are written to
`dist-test/probe-report-<requested-version>.json` (for example, `stable`). On Linux, run under a display server
(`xvfb-run -a pnpm test:integration`).

Each version runs two passes, reported separately as `[polling pass]` and `[real-watcher pass]`. The polling pass
sets `MIGENT_IT_WATCH=poll` in the extension host, so `activate` builds `ProjectRegistry` with
`src/vscode/pollingWatchBackend.ts` instead of `vscodeWatchBackend`. That test-only backend scans each watched folder
every 50 ms and compares `mtimeMs` and `size`, so it holds no OS watch handles and cannot fail with `EPERM`. It runs
every suite and skips the watcher probe. The real-watcher pass runs only the `watcherProbe` suite on VS Code's own
watcher, which keeps that behavior covered. Both passes receive `--file` and `--case`; the extension host decides what
they select (`src/integration/filters.ts`), so `--file watcherProbe --case P1` and
`--file watcherProbe.integration.test.ts` run the real pass, and a `--file` that names no probe makes it a no-op. A bare
`--case` skips the real pass. Production never reads `MIGENT_IT_WATCH`. CI limits the integration step to 10 minutes,
below the job's 15, and uploads `dist-test/` (logs and failure reports) as `integration-<os>` even when the step fails
or times out.

The watcher probe exercises VS Code's non-recursive file watchers and records
their results in that report.

The fixture CLI `fake-migent.js` also implements `session prepare`, `run`, `continue` and `cancel` by writing
session files in the project, so `control.integration.test.ts` drives the control service through the real runner,
gate, watcher and store: concurrent Run, Stop then Continue, Prepare then Save & Run, foreign and own locks, and
gate release after a failed command. Quick Pick and Input Box prompts are not driven.

After the watcher probe, the suite runs the host scenarios in
`monitoring.integration.test.ts`. They activate the extension in the fixture
workspace and write files from Node, as the Migent CLI would, then wait for the
registry, store and catalog to follow: a project appearing and disappearing, a
session whose marker arrives late, deleted and recreated folders, workflow and
config edits, retained execution watchers, and `migent.refresh`. The scenarios in
`sessionsTree.integration.test.ts` read the Sessions provider as VS Code would
(groups, icons, Unknown reasons, badge, session children limited to Files and stage attempts, execution files,
selection and active editor staying put, Show more, commands). The scenarios in
`capability.integration.test.ts` change the extension host's `PATH` and check the diagnostic node, the
capability states and Recheck. `scripts/integration/run.mjs` creates a `migent` launcher for
`fake-migent.js` (run with `node`) and the test entry puts its directory first on the extension host's
`PATH`, so the suite never uses an installed CLI; this matters on macOS, where VS Code merges the login
shell's `PATH` ahead of the one the runner passes. The scenarios in
`timeline.integration.test.ts` open the timeline document, append and truncate `events.jsonl`, and check
log channels and that no tail outlives its consumer; `statusBar.integration.test.ts` checks the status bar
text and hidden state; `overview.integration.test.ts` opens the Session panel on its Overview tab from a session row
(Completed, or Running until it completes in place), checks that
reopening reuses the panel, that a `sessionAction` intent runs the session command for the panel's own session
(and an unknown action nothing), that page intents open real files by identity (and invalid ones nothing),
lineage navigation, background updates without focus changes, and that closing a panel releases its `outputs/`
watcher. It also appends `events.jsonl` to a Running session and checks that the posted model's Latest activity
follows without changing focus or opening another panel. The pickers are driven through the flow's replaceable
`NextStepUi`. They are skipped in `--exclude` mode, where no events arrive.

The Overview page's pure parts have their own tests: `sessionSummary.test.ts` derives the Status facts,
`overviewActions.test.ts` holds the state action table, `sessionProgress.test.ts` maps stages or executions to
rows (with each attempt's model, effort, blocker, error, duration, tokens and resume or route reference, and none of
them without `metrics.json`), `sessionActivity.test.ts` bounds and formats the activity lines, and
`overviewModel.test.ts` composes them without reading disk. `overviewPage.test.ts` renders the fixed block order
and the Progress timeline against the fake DOM, and `uiKit.test.ts` covers the `ui.timeline` parts.

`nextStep.integration.test.ts` drives the Next step flow through the fixture CLI, which records
`prior_session_id` and logs the argv of `session run` and `session prepare`. It covers one child from concurrent
Run calls, `--prior` without `--task` for the default task, Prepare writing the chosen task to `task.md`, a
whitespace-only Run task reaching no CLI call, the entered Prepare title, cancelling, the remembered task, Compose in editor
and Open existing session creating no new session. One scenario also drives the real quick pick and input boxes through
VS Code's quick-open commands: Escape on each prompt, then Prepare with the prefilled title.

`reply.integration.test.ts` drives `ReplyService` against the fixture CLI's ordinary-blocker reply
(`MIGENT_FAKE_REPLY`: consume, ignore or reject): the draft keeps the blocker and is found again by a new service,
the exact argv of a send, a rejected send keeping the draft, a superseding execution without the reply being
unconfirmed, edits made while sending (on disk or unsaved in the editor) being kept, a no longer blocked session and
an empty reply. The fixture CLI also answers a reply to a cancelled workflow stage (interrupted wording) and to a role
session (no `--stage`, `## Role` prefix), so the suite covers their argv, draft settlement, a stale target being refused,
a completed role session reopening as Running and returning to Recent with the counts following, and quick text
becoming the draft body without overwriting an existing draft. Quick Picks and the input box are not driven, and
neither are notification buttons in the test host. Notifications are covered at the boundary with a mocked `vscode`:
`notices.test.ts` (the facade: severity, buttons, picked key, modal confirmations, progress) and `notifier.test.ts` and
`questionNotifier.test.ts` (when a notification fires, queueing, which command a button runs, the settings), plus
`deleteSession.test.ts` for the delete ids. Their rules are covered by `transitions.test.ts`, `notificationGate.test.ts`,
`batchWatch.test.ts` and `replyFlow.test.ts`; the catalog's exact wording by `src/text/notices.test.ts`. A test that
asserts notification text reads it from the catalog (`NOTICES`), as webview text is read from `MigentCopy`. Clicking
a real notification button stays a manual check.

`questions.integration.test.ts` drives the Session panel's Questions tab through its message handler against the
fixture CLI's `session continue --reply-file`, whose `MIGENT_FAKE_ANSWER` mode selects record, reject, garble (unreadable
`questions.json`), followup (exit 9 with a new batch) or fail-after-record. It covers recorded and rejected
replies, an unconfirmed submission restored after closing the panel, stale batches and the archived draft,
generation-checked edits, lock/recipient/schema blocks, a standalone role session and switching between the batches of
one session inside the same panel. The page script is not run.

The fixture CLI enforces `--stage` targeting (only that stage's pending batch, answered whole) and logs each
`session continue --reply-file` argv to `fake-argv.log` in the project, so tests assert the exact arguments (a role
session passes no `--stage`). `MIGENT_FAKE_ANSWER_DELAY_MS` delays the reply so a test can observe the recovery
record while the CLI runs.

`src/integration/fixtureConformance.test.ts` runs the fixture CLI's JSON paths the extension uses (`session prepare`,
`get clients`, `get models`, `get options --native`, `doctor --json`, `workflow validate --json` and the
`workflow save` and `config save` envelopes) and checks each output against the matching
`@nodeint/migent-contracts` schema, so the fixture cannot drift from the real CLI unnoticed.
`src/core/contractBinding.test.ts` pins the result types of the lenient parsers to the contract field types at compile
time.

### Numeric ids and rename

`src/core/fixtures/captured/numeric-ids-0.5.6` is a session captured from CLI 0.5.6 (id `1`, renamed once), and
`synthetic/numeric-ids-unquoted` holds manifests with unquoted integer ids and a numeric `prior_session_id`.
The fixture CLI implements `session rename` (it writes only `title.json`, takes no lock) and, with
`MIGENT_FAKE_IDS=numeric`, gives new sessions numeric ids.

### Session drafts and CLI 0.6.0 behavior

The fixture CLI models 0.6.0 by default. `session prepare` writes an empty `task.md` and a schema 7 `workflow.yaml`.
`session run --session` rejects a draft whose `id` differs from the manifest, or an empty `task.md`, with exit 2
before writing anything; otherwise it freezes the draft as `workflow.frozen.yaml`. `session continue` keeps the
frozen copy, and `--refresh-workflow` re-freezes from the draft. `MIGENT_FAKE_PREFLIGHT=fail` makes `session run`
print `Preflight failed: ...` and exit 2 without creating or freezing anything, unless `--skip-preflight` is passed.
A failed execution writes its `failure.md`, and `workflow validate` and `get` (including `get clients` and
`get models`) are implemented; `get providers` exits 2 as in 0.5.0 and later.
`MIGENT_FAKE_LEGACY=1` restores the 0.3.1 behavior (no draft, no `task.md`, no 0.4.0 commands, `--version` reports
0.3.1), which `capability.integration.test.ts` uses for the old CLI path.

Those scenarios cover Prepare returning the session's `workflow.yaml`, opening it (and a vanished file), Continue
sending no `--refresh-workflow` for a drafted session while a session without `workflow.yaml` still compares and
adopts, a rejected draft releasing the gate so that a corrected draft runs, a failed preflight leaving the session
prepared so the fixed draft can run, and a failed execution writing `failure.md`. A drafted session whose
`workflow.yaml` was deleted falls back to the legacy comparison through the same code path.

`failureText.test.ts` covers the wording of failure messages. Notifications and their buttons are not driven, so check
them by hand in VS Code:

1. Prepare a session from the Sessions view or the Command Palette: no notification appears, `task.md` opens, and the
   session's `workflow.yaml` opens from the session's files in the Sessions tree. The Next step flow's Prepare still
   shows a notification offering **Open workflow.yaml**.
2. Edit the draft's `id`, then Save & Run: the error names `workflow.yaml`, the session stays prepared, and after
   fixing the `id` Save & Run starts it.
3. Leave `workflow.yaml` with unsaved edits and use Save & Run: the run is refused with a message. Save & Run saves
   `task.md` only, never `workflow.yaml`.
4. Continue a started session after editing its draft or a workflow in `.migent/workflows`: no workflow prompt appears.
