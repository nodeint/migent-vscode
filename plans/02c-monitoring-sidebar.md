# Phase 2c: Sidebar and status

Part of [phase 2](./02-monitoring.md). Previous: [2b](./02b-monitoring-watcher.md). Next: [2d](./02d-monitoring-content.md).

## Scope

Implement the Sessions, Workflows and Project tree views, welcome state, refresh and status bar using the store. Apply the grouping, labels, execution ordering, context values, tooltips and native file targets in the [phase 2 contract](./02-monitoring.md).

- Keep Running sessions with pending questions in Running, with a visible indicator and question/history nodes; count each attention session once. Show a separate breakdown of pending stages and questions.
- Preserve project/file identities, tree expansion, selection and editor focus on background updates. Show the session limit and Show more behavior.
- Show invalid workflows and unavailable config with their real paths and diagnostics. Keep project and workflow browsing available without sessions or a working CLI; distinguish empty data from read errors.
- Show running and attention counts together in the status bar. Wire completed rows to the Results target provided by 2d; individual files retain native targets.

## Done when

Verify single and multi-root workspaces, duplicate IDs, mixed Running/Blocked questions, empty/error states, workflow changes and focus preservation. Verify unique badge/status counts and that all displayed nodes consume store data.
