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
| `events.jsonl` | Explicit `EventTail.read()` by the consumer; the store does not hold it | Open failure yields no events and preserves the offset |
| `.migent/workflows/*.{yaml,yml}` | Explicit `scanWorkflows`, or `readWorkflowFile` for one file | Missing, empty and unreadable directories are distinct outcomes; an unparsable or unreadable file stays listed as `invalid` or `unreadable` with its error |
| `.migent/config.yaml` | `readProjectConfig` | `missing`, `ok`, `invalid` (unparsable or not a mapping) or `unreadable`; raw integer `schema_version` or null; no defaults |

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
| `scanOutcome` | Last scan: `missing`, `empty`, `unreadable` or `ok`, with `discovered` directories split into `eligible` (marker present) and `pending` (no marker yet). A change emits `scan` on `onDidChangeProject` |
| `refreshSession(id)` | Builds a snapshot; adds it if absent or replaces it when the compared body changes |
| `all()` / `snapshot(id)` | Returns current cached snapshots; does not refresh disk data |
| `removeSession(id)` | Removes the snapshot, then emits `removed` |

Sessions are ordered by manifest creation time, falling back to status creation
time, then session id. The limit is applied after a full scan and when refresh
adds a session, not before disk reads. It limits retained snapshots rather than
the cost of the initial scan.

Change events carry `{project, sessionId, kind}`. Kinds are `added`, `updated`
and `removed`. Subscribing returns an unsubscribe function.
Callers read the resulting snapshot; events do not carry a snapshot payload.

Snapshot comparison uses raw manifest/status content, status-error flag, lock,
display state name, unknown reason, and writable flag. References returned
earlier are not live handles to a replacement snapshot; read `snapshot(id)` again
after an `updated` event.

Evidence: [store.test.ts](../src/core/store.test.ts).

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

Log truncation or replacement is not automatically recovered: when file size is
below the offset, the tail reader keeps that offset. Consumers must preserve the
append-only log assumption.

Evidence: [eventTail.test.ts](../src/core/eventTail.test.ts).

## Updating this guide

Update the relevant section when changing a state rule, read/error policy, load
trigger, cache lifecycle, or compatibility boundary. Keep exact data shapes in
[model.ts](../src/core/model.ts), detailed edge cases in tests, and upstream file
formats in Migent's contract. Internal refactors need documentation changes only
when these behaviors or links change.
