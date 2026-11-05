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
folder is an empty anchor, so the window is multi-root from the start (adding a folder to a single-folder window
restarts the extension host on 1.90). Every scenario and every watcher probe case gets its own folder, copied from
`src/integration/fixtures/workspace/` (its `.gitignore` ignores `.migent`), added with
`updateWorkspaceFolders` and handed over once a sentinel file proves its watcher is live. Nothing is shared between
cases, so no case waits for a previous case's `.migent/` to disappear. Folders are removed from the workspace after
each case but deleted only when the run ends, because deleting a directory VS Code is still unwatching caused
`EPERM`/`EBUSY` storms on Windows. `fake-migent.js` records the pid of every process it starts in
`fake-pids.log`; a case fails if any of them is still alive after it, and a case that does not finish within two
minutes fails by name.

When a case fails, the run reports every failed case as `[suite] case name`, the message and the
`src/...:line:column` of the failing test line (bundle frames are mapped through the source map by
`failureReport.ts`). The same list is in the thrown error, the runner output, `dist-test/integration-failure-<version>.json`
and, on GitHub Actions, as error annotations. Each case also logs `RUN`, `PASS` or `FAIL` with its duration in the
VS Code log. Pass `--versions a,b` to choose versions, `--file reply` to run only suites whose
file name contains the text (`watcherProbe` selects the probe), and `--case "empty reply"` to run only cases whose
name contains the text (both case-insensitive, combinable; a filter that matches nothing fails, and the watcher probe
is skipped unless `--file` names it), for example `pnpm test:integration --versions 1.90.0 --file reply`. Pass
`--exclude` to also set `files.watcherExclude` for `**/.migent/**`. VS Code then
delivers no watcher events for `.migent`; this is a known limitation that the
user controls, so that mode only reports and never fails. Reports are written to
`dist-test/probe-report-<requested-version>.json` (for example, `stable`). On Linux, run under a display server
(`xvfb-run -a pnpm test:integration`).

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
(groups, icons, Unknown reasons, badge, questions and history, execution files,
selection and active editor staying put, Show more, commands). The scenarios in
`capability.integration.test.ts` change the extension host's `PATH` and check the diagnostic node, the
capability states and Recheck; `scripts/integration/run.mjs` puts a `migent` launcher for
`fake-migent.js` (run with `node`) first on `PATH`, so they do not depend on an installed CLI. The scenarios in
`timeline.integration.test.ts` open the timeline document, append and truncate `events.jsonl`, and check
log channels and that no tail outlives its consumer; `statusBar.integration.test.ts` checks the status bar
text and hidden state; `results.integration.test.ts` opens Results panels from a Completed row, checks that
reopening reuses the panel, that a `sessionAction` intent runs the session command for the panel's own session
(and an unknown action nothing), that page intents open real files by identity (and invalid ones nothing),
lineage navigation, background updates without focus changes, and that closing a panel releases its `outputs/`
watcher. The page script itself is not driven; the host's last posted model and message handler are. They are
skipped in `--exclude` mode, where no events arrive.

`nextStep.integration.test.ts` drives the Next step host through the fixture CLI, which records
`prior_session_id` and logs the argv of `session run` and `session prepare`. It covers one child from concurrent
Run calls, `--prior` without `--task` for the default task, Prepare writing the chosen task to `task.md`, and
hostile or whitespace-only requests reaching no CLI call.

`reply.integration.test.ts` drives `ReplyService` against the fixture CLI's ordinary-blocker reply
(`MIGENT_FAKE_REPLY`: consume, ignore or reject): the draft keeps the blocker and is found again by a new service,
the exact argv of a send, a rejected send keeping the draft, a superseding execution without the reply being
unconfirmed, edits made while sending (on disk or unsaved in the editor) being kept, a no longer blocked session and
an empty reply. Notifications and Quick Picks are not driven; their rules are covered by `transitions.test.ts`,
`notificationGate.test.ts` and `replyFlow.test.ts`.

`questions.integration.test.ts` drives the answer panels through their message handler against the fixture CLI's
`session continue --reply-file`, whose `MIGENT_FAKE_ANSWER` mode selects record, reject, garble (unreadable
`questions.json`), followup (exit 9 with a new batch) or fail-after-record. It covers recorded and rejected
replies, an unconfirmed submission restored after closing the panel, stale batches and the archived draft,
generation-checked edits, lock/recipient/schema blocks and a standalone role session. The page script is not run.

The fixture CLI enforces `--stage` targeting (only that stage's pending batch, answered whole) and logs each
`session continue --reply-file` argv to `fake-argv.log` in the project, so tests assert the exact arguments (a role
session passes no `--stage`). `MIGENT_FAKE_ANSWER_DELAY_MS` delays the reply so a test can observe the recovery
record while the CLI runs.

### Session drafts (CLI 0.3.5)

The fixture CLI models the draft lifecycle by default. `session prepare` writes an empty `task.md` and a
`workflow.yaml`. `session run --session` rejects a draft whose `id` differs from the manifest, or an empty `task.md`,
with exit 2 before writing anything; otherwise it freezes the draft as `workflow.frozen.yaml`. `session continue`
keeps the frozen copy, and `--refresh-workflow` re-freezes from the draft. `MIGENT_FAKE_LEGACY=1` restores the 0.3.1
behavior (no draft, no `task.md`), which the legacy scenarios in `control.integration.test.ts` use.

Those scenarios cover Prepare returning `workflow.yaml` only when it exists, opening it (and a vanished file),
Continue sending no `--refresh-workflow` for a drafted session while a session without `workflow.yaml` still compares
and adopts, and a rejected draft releasing the gate so that a corrected draft runs. A drafted session whose
`workflow.yaml` was deleted falls back to the legacy comparison through the same code path.

`failureText.test.ts` covers the wording of failure messages. Notifications and their buttons are not driven, so check
them by hand in VS Code:

1. Prepare a session from the Sessions view or the Command Palette: no notification appears, `task.md` opens, and the
   session's `workflow.yaml` opens from the session's files in the Sessions tree. The Next step page's Prepare still
   shows a notification offering **Open workflow.yaml**.
2. Edit the draft's `id`, then Save & Run: the error names `workflow.yaml`, the session stays prepared, and after
   fixing the `id` Save & Run starts it.
3. Leave `workflow.yaml` with unsaved edits and use Save & Run: the run is refused with a message. Save & Run saves
   `task.md` only, never `workflow.yaml`.
4. Continue a started session after editing its draft or a workflow in `.migent/workflows`: no workflow prompt appears.
