# Phase 2d: Content and results

Part of [phase 2](./02-monitoring.md). Previous: [2c](./02c-monitoring-sidebar.md). Next: [2e](./02e-monitoring-integration.md).

## Scope

Implement the read-only content entry points in [phase 2](./02-monitoring.md): native task, prompt, response, output, artifact, question, config and workflow files; copy ID and reveal; aggregated timeline and per-session output channel.

Provide a reusable Results overview with output links and Open result, Task, View log and menu actions. Add compact read-only suggestions, raw metadata and target-definition inspection, and observed source/child links. Task and log actions remain bound to the source; no Run/Prepare form is introduced. Missing or invalid `next.json` must not hide outputs or change completed state.

## Done when

Verify completed-row click and Open result reach the same overview, output nodes open real files, and logs update without stealing focus. Verify question history and malformed metadata remain inspectable and that no extension action writes generated session files.
