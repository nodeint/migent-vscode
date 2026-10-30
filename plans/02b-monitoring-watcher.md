# Phase 2b: Project discovery and watching

Part of [phase 2](./02-monitoring.md). Previous: [2a](./02a-monitoring-data.md). Next: [2c](./02c-monitoring-sidebar.md).

## Scope

- Discover projects in workspace folders and bind each to its own store and watcher lifecycle, including workspace changes.
- Watch the session, execution, config and workflow paths specified in [phase 2](./02-monitoring.md), using concrete relative patterns suitable for hidden `.migent` directories.
- Debounce per session for 150 ms and refresh only the affected session. Handle creation, deletion and changes without confusing identical session IDs in different projects.
- Refresh only affected project metadata for config/workflow events. Tail events only for running sessions or open logs; poll locks every 10 seconds only while a session is running.
- Dispose watchers, timers and subscriptions correctly. Preserve store notifications and avoid editor focus changes.

## Done when

Tests cover coalescing, targeted refresh, project isolation, lifecycle and timer/tail eligibility. Verify hidden-directory watcher events on Windows, including a session started externally and a hard-killed runner. Idle projects have no polling timer.
