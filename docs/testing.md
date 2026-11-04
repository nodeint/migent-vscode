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

- `captured/` holds real files written by migent 0.3.1, redacted (see its
  [README](../src/core/fixtures/captured/README.md)). Tests that need a project
  layout copy from it into a temporary directory.
- `synthetic/` holds hand-written files for shapes no captured sample covers
  (see its [README](../src/core/fixtures/synthetic/README.md)). Name them as
  synthetic in test titles, and replace them when a captured sample appears.

### Extension-host integration tests

`pnpm test:integration` builds the extension and `src/integration/` with esbuild, downloads VS Code
through `@vscode/test-electron`, and runs the suite concurrently against the minimum
supported version (`engines.vscode`) and the latest stable in separate workspaces and profiles. Files named
`*.integration.test.ts` are excluded from Vitest. Each run copies
`src/integration/fixtures/workspace/` to a temporary folder; it sets
`.gitignore` ignoring `.migent`. Pass `--versions a,b` to choose versions and
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
`capability.integration.test.ts` change `migent.cli.*` settings and check the diagnostic node, the
capability states and Recheck; the fixture workspace points `migent.cli.path` at
`fake-migent.js` (run with `node`), so they do not depend on an installed CLI. The scenarios in
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
