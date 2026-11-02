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
through `@vscode/test-electron`, and runs the suite against the minimum
supported version (`engines.vscode`) and the latest stable. Files named
`*.integration.test.ts` are excluded from Vitest. Each run copies
`src/integration/fixtures/workspace/` to a temporary folder; it sets
`.gitignore` ignoring `.migent`. Pass `--versions a,b` to choose versions and
`--exclude` to also set `files.watcherExclude` for `**/.migent/**`. VS Code then
delivers no watcher events for `.migent`; this is a known limitation that the
user controls, so that mode only reports and never fails. Reports are written to
`dist-test/probe-report-<version>.json`. On Linux, run under a display server
(`xvfb-run -a pnpm test:integration`).

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
`fake-migent.js` (run with `node`), so they do not depend on an installed CLI. They are
skipped in `--exclude` mode, where no events arrive.
