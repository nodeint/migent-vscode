# Phase 2a: Monitoring data

Part of [phase 2](./02-monitoring.md). Previous: [core](./01-core.md). Next: [2b](./02b-monitoring-watcher.md).

## Scope

Extend the VS Code-independent readers and store to supply the data required by the phase 2 contract. Views consume store projections and do not read disk. Preserve project-scoped session and file identity.

- Read project config and workflow metadata, preserving missing, unreadable and invalid files as distinct outcomes; retain file paths for native editing.
- Read structured session questions and history, grouping pending batches by stage and originating execution. Preserve unsupported or malformed data for diagnostics and raw inspection; do not infer questions from prose or state.
- Supply output records, downstream suggestions, frozen source declarations and observed source/child lineage. Distinguish missing or invalid `next.json` from no declaration and never infer a child.
- Keep blocker/failure details, stage/attempt, event time, retry time and exact response/verify links when available; represent missing information explicitly.
- Maintain lazy loading for details and preserve data needed across snapshot refreshes. Keep completed state independent of downstream metadata errors.

Follow the data contracts and read-only boundaries in [phase 2](./02-monitoring.md), [human input](./03a-human-input.md) and [downstream handoff](./03b-downstream-handoff.md).

## Done when

Core tests cover valid, missing, invalid and unsupported inputs; mixed pending questions; project identity; observed lineage; and snapshot refresh. Existing core behavior and tests remain intact. No VS Code API or writes to Migent files enter core.
