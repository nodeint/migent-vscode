# Core behavior

This guide explains core's state derivation, file reads, and cache lifecycle.
See [Architecture](architecture.md) for module ownership and the upstream
file-format contract.

## How is a session's display state chosen?

[deriveDisplayState](../src/core/displayState.ts) uses the first matching rule:

| Priority | Condition | State |
| :--- | :--- | :--- |
| 1 | Manifest missing/unparsable, manifest schema unsupported, status read failed, or status absent | Unknown |
| 2 | Status is `prepared` | Prepared |
| 3 | Lock is alive | Running |
| 4 | Status is `blocked` | Blocked |
| 5 | Status is `question` | Question |
| 6 | Status is `active` and latest execution status is `failed` | Failed |
| 7 | Status is `active` | Stopped |
| 8 | Status is `cancelled` | Cancelled |
| 9 | Status is `completed` | Completed |
| 10 | Anything else | Unknown |

Thus a live lock overrides Completed, Blocked or Question, but does not override
Prepared or invalid input. `active` alone does not imply Running.

Unknown carries an `unknownReason`, chosen in rule order: `invalid-manifest`,
`unsupported-schema`, `unreadable-status` (the file could not be read),
`invalid-status` (it did not parse after retries), `missing-status`, or
`unrecognized-status` (rule 10). Known states carry none.

`DisplayState.writable` is false only for an alive lock marked `foreignHost`.
It is calculated independently of the state: Unknown can still have
`writable: true`. It is not a complete compatibility or command-authorization
check.

Evidence: [displayState.test.ts](../src/core/displayState.test.ts).

## When is a lock alive?

[probeLock](../src/core/lockProbe.ts) observes the file and local process:

- A lock that cannot be statted yields `none`.
- A parsed local lock requires a live PID and a heartbeat no older than 30 seconds
  by default. A successful PID probe or `EPERM` counts as alive; other probe errors
  count as dead.
- A parsed foreign-host lock skips the PID probe but still requires a fresh
  heartbeat. An invalid heartbeat is stale.
- An unparsable lock uses file mtime. A fresh file counts as alive with unknown
  identity and `foreignHost: true`; an old file is stale.

The result is an observation, not a lock acquisition. Nothing here reserves the
session or guarantees that a later write remains safe.

Evidence: [lockProbe.test.ts](../src/core/lockProbe.test.ts).

## Which files are read, and what happens on failure?

All current readers use synchronous filesystem calls. The store does not schedule
background work; its caller chooses when to scan, refresh, and load details.

| Source | Read trigger | Missing or invalid input |
| :--- | :--- | :--- |
| `manifest.yaml` | Snapshot construction | Returns null; an unavailable manifest makes display state Unknown |
| `status.json` | Snapshot construction | Missing is distinct from error; both result in Unknown display state |
| `session.lock` | Snapshot construction | Uses the lock rules above |
| `executions/*/execution.json` | Explicit `listExecutions` call by the consumer; the store does not hold it | Missing directory yields an empty list; invalid records retain a summary derived from directory identity |
| `events.jsonl` | Explicit `EventTail.poll()` by the consumer; the store does not hold it | Open failure yields no events and preserves the offset; a file smaller than the offset resets the tail (see below) |
| `.migent/workflows/*.{yaml,yml}` | Explicit `scanWorkflows`, or `readWorkflowFile` for one file | Missing, empty and unreadable directories are distinct outcomes; an unparsable or unreadable file stays listed as `invalid` or `unreadable` with its error |
| `.migent/config.yaml` | `readProjectConfig` | `missing`, `ok`, `invalid` (unparsable or not a mapping) or `unreadable`; raw integer `schema_version` or null; no defaults |
| `status.json` `questions`, `outputs` | Snapshot construction (they come with the status read) | Records without `id` and `question` (questions) or `path` (outputs) are skipped; absent keys give empty lists |
| `questions.json` (session) | `readQuestions(sessionDir)` on demand | `missing`, `unreadable`, `invalid`, `unsupported` (schema other than 1) or `ok`; records keep file order; `superseded` is accepted though never observed; an answer outside the observed shapes becomes null |
| `outputs/` | `listOutputs(sessionDir, published)` on demand | Published rows are `ok`, `missing` or `rejected` (path leaves the session directory); unnamed files in `outputs/` get path-only rows; a missing directory is normal and an unlistable one sets `directoryError` |
| `next.json`, `workflow.frozen.yaml` | `readNext`, `readFrozenDownstream` on demand | Independent outcomes (`missing`, `unreadable`, `invalid`, `unsupported` or `ok`; `absent` for the frozen declaration). Artifact paths are checked against the session directory. `declared` is true only when workflow and artifact mapping match the frozen declaration, null when it was not read. `argv` is data, never an action |
| Manifest `handoff` | `readHandoff(manifest, sessionDir)` | `absent`, `invalid` (outside the observed shape) or `ok`; `path` is confined to the target session, `source_path` is text only |
| `executions/<id>/` contents | `listExecutionFiles(executionDir)` on demand | Lists only files that exist: `task.md`, `prompt.md`, `response.md`, `failure.md`, `diagnostics.json`, `questions.json`, `stream.jsonl`, `turns/*/verify.md`, `artifacts/*`. `failure.md` (CLI 0.3.6+) is offered as a failure report; older executions have none and show no extra action |
| Session Files and attempt trees | `listSessionDirectory` on expansion | Lists each directory level; symbolic links are shown as files and are not traversed |

The status reader keeps only the small scalar fields of `latest_provider_event`
(`event`, `summary`, `stage_id`, `execution_id`, `client`, `timestamp`) and
removes the object from `raw`: its `details` and `usage` can be very large.

[readStatus](../src/core/statusReader.ts) makes at most three attempts with 100 ms
between attempts after errors. Missing files return immediately. The wait is
synchronous. JSON syntax errors, non-object roots, and non-ENOENT read failures
use the retry path; nullable/missing fields in a parsed object do not.

[Manifest parsing](../src/core/manifest.ts) retains unsupported numeric schema
versions but marks them unsupported. An absent or non-integer schema version is
normalized to null and currently treated as supported legacy input. Status parsing
does not perform a separate schema-version compatibility check. Consult
[model.ts](../src/core/model.ts) for supported manifest/event versions. Each
file format's version is independent: manifest support is listed on its own and
does not follow the event envelope version.

[Execution summaries](../src/core/executions.ts) are ordered oldest first.
[Workflow entries](../src/core/workflows.ts) are ordered by id, then file name,
and fall back to the filename for a missing id. Successfully parsed YAML with no
usable object body can still produce a filename-based entry; this is not full
workflow validation. Every `ok` entry whose id is shared with another is flagged
`duplicate`; no file wins. [ProjectCatalog](../src/core/projectCatalog.ts) holds
the workflow scan and config for one project, separate from `SessionStore`, and
emits `workflows` or `config` only when a re-read value differs.

Evidence: [manifest tests](../src/core/manifest.test.ts),
[status tests](../src/core/statusReader.test.ts),
[execution tests](../src/core/executions.test.ts), and
[workflow tests](../src/core/workflows.test.ts).

## What does SessionStore own?

One [SessionStore](../src/core/store.ts) holds one snapshot per session for one
`projectRoot`: manifest, status, lock and display state only. It is an in-memory
projection with a default limit of 50 sessions. There is no persistence or
automatic watcher subscription. Executions, events and other per-session files
are not cached by the store; their readers are called on demand.

| Operation | Effect |
| :--- | :--- |
| `load()` | Scans the sessions directory; adds/refreshes snapshots of directories containing a manifest or status marker, removes unseen entries, then applies the limit. A missing or unreadable directory removes every cached snapshot; `scanOutcome` tells the two apart |
| `rescanDirectories()` | Re-lists the sessions directory (names and marker presence) without reading any session; for a directory created or deleted. `refreshSession` keeps the scan lists in step for a single session, so a pending directory becomes eligible when its marker appears |
| `scanOutcome` | Last scan: `missing`, `empty`, `unreadable` or `ok`, with `discovered` directories split into `eligible` (marker present) and `pending` (no marker yet). A change emits `scan` on `onDidChangeProject` |
| `refreshSession(id)` | Builds a snapshot; adds it if absent or replaces it when the compared body changes |
| `all()` / `snapshot(id)` | Returns current cached snapshots; does not refresh disk data |
| `removeSession(id)` | Removes the snapshot, then emits `removed` |

Sessions are ordered by manifest creation time, falling back to status creation
time, then session id. The limit is applied after a full scan and when refresh
adds a session, not before disk reads. It limits retained snapshots rather than
the cost of the initial scan.

Retained sessions are the newest `limit` plus every retention-exempt one
([isRetentionExempt](../src/core/attention.ts)): Running, Prepared, Question,
Blocked, or with pending questions. The retained count can therefore exceed the limit.
`hiddenCount` is eligible sessions minus retained; pending directories are not
counted, and a change of the count emits `scan`. The store keeps ids only for
hidden sessions. `refreshSession` on a hidden id rebuilds its snapshot just to
decide exemption (for example a resumed session) and stays silent while it is
not exempt. A session with neither marker is removed on refresh. `setLimit(n)`
changes the effective limit and rescans (same cost as `load()`).

[attention.ts](../src/core/attention.ts) holds the pure grouping: `groupOf`
(Running; Needs attention for Question, Blocked, Failed, Stopped, Unknown;
Prepared; Recent for Completed and Cancelled), `isCounted` (Blocked, Failed, Question or pending
questions, never Unknown) and `summarize` (unique counts).

[childrenOf](../src/core/handoff.ts) derives lineage children from the retained
snapshots' `prior_session_id`; nothing is cached, and a source outside the
retained set is not resolved.

Change events carry `{project, sessionId, kind}`. Kinds are `added`, `updated`
and `removed`. Subscribing returns an unsubscribe function.
Callers read the resulting snapshot; events do not carry a snapshot payload.

Snapshot comparison uses raw manifest/status content, status-error flag, lock,
display state name, unknown reason, and writable flag. References returned
earlier are not live handles to a replacement snapshot; read `snapshot(id)` again
after an `updated` event.

Evidence: [store.test.ts](../src/core/store.test.ts).

## How are session rows presented?

[sessionPresentation.ts](../src/core/sessionPresentation.ts) holds the plain-text rules for the
Sessions view, so they are tested without VS Code:

- Label: the manifest title, else the status title, workflow id or short id, cut to 60
  characters (the tooltip keeps the full title).
- Description: `workflow · stage · time`, plus `N questions` when questions are pending. Time is the
  elapsed time since start for a Running session and the time since the last update for the others.
  Unknown shows its reason instead (for example `Unsupported schema version 99`).
- Icon: the display state's icon; Unknown uses `question` for an unsupported schema or an unrecognized
  status and `bracket-error` for a missing, unreadable or invalid file.
- Tooltip: state, reason, workflow, stage and attempt, blockers, pending questions, foreign lock, last
  update, the small provider-event fields and, for a failed session whose latest execution hit client quota,
  the failure cause with the reset time when `retry_at` is recorded (`Failed on client quota; resets …`).
  Missing values read "unavailable". Quota is a failure reason, not a wait: since CLI 0.5.1 `session continue`
  reruns the stage at once and ignores `retry_at`.
- `contextValue`: `session.<state>` then `;questions`, `;foreign`, `;outputs`, `;role`, `;reason-<reason>`.
- Node ids never include state, and two projects with the same session id get distinct ids.
- A project shows "No sessions yet" for a missing, empty or marker-less sessions folder, and an error row
  for an unreadable one.

Evidence: [sessionPresentation.test.ts](../src/core/sessionPresentation.test.ts).

## When does the liveness timer run?

[Liveness](../src/core/liveness.ts) is one timer for every project. `update()`
starts a 10-second interval while any store has a Running session and clears it
when none remain; with nothing Running there is no timer. Each tick calls
`refreshSession` for the Running sessions only, so a hard-killed runner leaves
Running once its lock goes stale (30 seconds plus one interval). Callers invoke
`update()` after any session change; `onDidTick` lets a view refresh time-dependent text.

Evidence: [liveness.test.ts](../src/core/liveness.test.ts).

## How does incremental event reading work?

[tailEvents](../src/core/eventTail.ts) accepts a byte offset and returns events
plus the next offset. It consumes only newline-terminated lines. A partial final
line remains in the file and is read again from its beginning on the next call;
there is no separate in-memory remainder buffer.

Malformed records are returned through `rawLine`. Missing/invalid envelope
versions fall back to version 1; versions above the supported maximum retain the
raw line alongside extracted fields. Unknown versions are not silently dropped.

[EventTail](../src/core/eventTail.ts) wraps it for one `events.jsonl`. It owns the
byte offset and the sequence watermark, independent of any session snapshot. Each
`read()` filters numeric sequences against the watermark at the start of the
read, then advances the watermark to the maximum returned sequence. Records
without a sequence are retained. This does not remove duplicate sequence numbers
within the same read batch. Reading events does not update status or display
state; those require a session refresh.

`EventTail` also keeps a bounded history (the most recent 5000 events by
default, oldest first); older events are dropped and counted in `droppedCount`
for a "not shown" marker. `poll()` returns the new events and `truncated`.
When the file is smaller than the offset (a repair rewrote the log), the tail
resets offset, watermark and history, re-reads from byte 0 and reports
`truncated: true` so the consumer re-renders from the start. A failure to open
the file is not truncation. A rewrite that leaves the file at least as large as
the offset is not detectable and is not recovered.

[formatTimelineLine](../src/core/timelineFormat.ts) turns an event into
`10:15:30 plan#1 started · claude/sonnet`. A malformed line or unknown version is
passed through as `[unrecognized] <line>`.

## How is the watcher set planned?

[watchPlan.ts](../src/core/watchPlan.ts) is pure; core creates no watcher.
`desiredWatches` returns one non-recursive watcher per folder (a folder and a
pattern without path separators): `.migent/` (whose pattern covers `config.yaml` and
`config.local.yaml`), `workflows/`, `sessions/`, every
discovered session directory (eligible, hidden or pending) and, only for
retained targets whose folder exists, `executions/`, one execution directory
with its `artifacts/`, `turns/` and each `turns/<turn>/` (`verify.md`), and
`outputs/`. A `missing` scan drops that folder's watcher; without `.migent/`
the set is empty. `anchorWatch` is the registry-owned watcher on the workspace
root. `diffWatches` compares the set with live watchers.

`classifyPath` maps a changed path to a project, workflow, config (`config.yaml` or
`config.local.yaml`, both a `config` change) or session
target, or null for paths nobody displays. `routeSessionChanges` reduces the
changes the [Coalescer](../src/core/coalescer.ts) collected for one session to
"refresh the snapshot" (manifest, status, lock, cancel request) plus distinct
file targets. The coalescer is a per-key trailing debounce with a maximum wait
and an injectable clock.

Evidence: [eventTail.test.ts](../src/core/eventTail.test.ts),
[timelineFormat.test.ts](../src/core/timelineFormat.test.ts),
[watchPlan.test.ts](../src/core/watchPlan.test.ts),
[coalescer.test.ts](../src/core/coalescer.test.ts).

The Sessions view's Files branch and each attempt also keep one non-recursive watcher per expanded directory,
created through the same backend. Collapsing a directory releases its watcher and those of its descendants.

## Updating this guide

Update the relevant section when changing a state rule, read/error policy, load
trigger, cache lifecycle, or compatibility boundary. Keep exact data shapes in
[model.ts](../src/core/model.ts), detailed edge cases in tests, and upstream file
formats in Migent's contract. Internal refactors need documentation changes only
when these behaviors or links change.
