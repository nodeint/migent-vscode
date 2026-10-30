# Phase 2e: CLI compatibility and integration

Part of [phase 2](./02-monitoring.md). Previous: [2d](./02d-monitoring-content.md). Next: [phase 3](./03-control.md).

## Scope

- Add `migent.cli.path`, `migent.cli.minVersion` and `migent.sessions.limit`, and the phase 2 command contributions.
- Check the configured CLI version against the minimum; show detected and required versions and executable path where known, installation instructions, Open Settings and Recheck. Missing or incompatible CLI must not disable disk-based browsing.
- Complete the welcome and diagnostics flows, retaining readable sessions and avoiding phase 3 control operations. Detect cancel capability for later control UI.
- Exercise the full [phase 2 acceptance checklist](./02-monitoring.md#done-when), including the [human input](./03a-human-input.md) and [downstream handoff](./03b-downstream-handoff.md) read-only boundaries.

## Done when

Run the applicable test, lint, typecheck, build and package checks and compare with baseline. In VS Code on Windows, verify external session transitions, hidden-directory watching, multi-root identity, native YAML editing, focus retention, questions, Results and missing/incompatible CLI. Record any unverified environments and confirm idle operation has no polling timer.
