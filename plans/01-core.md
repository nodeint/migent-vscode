# Phase 1: Skeleton and `core/` (read, no UI yet)

Part of [`vscode-extension.md`](./vscode-extension.md). Next: [`02-monitoring.md`](./02-monitoring.md).

## Scope

- Scaffold the repo, esbuild, vitest, CI (build + test + `vsce package` on Windows and Linux).
- Install `yaml`. Write `paths`, `manifest`, `statusReader`, `lockProbe`, `displayState`, `eventTail`, `executions`, `workflows`, `questions`, `questionAnswers`, `nextWorkflows`, `handoff`, `model`, `store` under `src/core/` (see the tree in the overview). Question design: [`03a-human-input.md`](./03a-human-input.md). Downstream readers/binding boundaries: [`03b-downstream-handoff.md`](./03b-downstream-handoff.md).
- Build fixtures from real sessions: completed, active-stopped, failed, blocked, question, cancelled, prepared, running (fake live lock), stale lock, corrupt status.json, unknown schema, mixed running/blocked with pending questions, answered/superseded question history. Redact paths, hostnames and real prompts before committing.

## 1. Displayed state

`status.json.status` is not enough. An `active` session with no lock is just "stopped, can be resumed". The displayed state is derived as follows:

| Displayed | Condition | Icon (codicon) |
|---|---|---|
| Prepared | `status = prepared` | `circle-outline` |
| Running | lock is alive (see below) | `sync~spin` |
| Blocked | `status = blocked` | `warning` |
| Question | `status = question`, no live lock | `comment-discussion` |
| Failed | `active`, no lock, `latest_execution_status = failed` | `error` |
| Stopped | `active`, no lock, last execution not failed | `debug-pause` |
| Cancelled | `status = cancelled` | `circle-slash` |
| Completed | `status = completed` | `pass` |
| Unknown | unknown schema, corrupt status.json | `question` |

**Lock is alive:** `session.lock` parses, `host` equals `os.hostname()`, `process.kill(pid, 0)` does not throw `ESRCH`, and `heartbeat_at` is within 30 seconds. A lock from another host shows Running (the pid cannot be checked) but write operations are disabled. If the lock cannot be parsed, fall back to the file's mtime, as `session-lock.ts` does.

`deriveDisplayState(status, lock, now)` is a pure function; the decision table above is its test suite.

Pending human questions are an orthogonal attention signal, not a replacement for displayState. A live lock still shows Running even with pending questions; a session blocked by another stage still shows Blocked while exposing those questions. Derive pending recipients/stages from structured records, never from `latest_execution_status` alone. Keep schema versions independent: workflow version 3 does not imply manifest version 3; the question history envelope currently has version 1.

## 2. SessionStore

- `Map<projectRoot, Map<sessionId, SessionSnapshot>>`.
- `SessionSnapshot` holds manifest, status, lock, displayState, pending question summaries, lazily loaded question history, a list of executions (lightweight: id, stage, attempt, status, decision) and `lastEventSeq`. Scope `(execution_id, question id)` by project/session; batch groups include originating stage/execution and a content fingerprint.
- `onDidChange(event: {project, sessionId, kind})` so views refresh only what changed. The store must not import `vscode`, so use a small local emitter.
- Initial load: scan `.migent/sessions/*/` (direct reads, faster than spawning the CLI). `migent session list --json` is used only for reconciliation when diagnostic mode is on.
- Lazy loading: the initial list reads only manifest + status + lock, including `status.json.questions`. Load the session `questions.json` when pending questions exist or the question/history view opens; execution original batches are read on demand. The execution list is read only when a session node is expanded or the session is running.
- Limit: show the N most recent sessions (default 50). The sessions directory can reach hundreds of entries.
- Lazily read `next.json` and canonical frozen downstream/output metadata for Completed-session Results or expanded next-workflow nodes. Model missing/invalid metadata independently from completion. Index observed `prior_session_id` links and load target manifest handoff/snapshot provenance on demand; a referenced source can be outside the recent-session limit. No inferred child creation or extension-side artifact binding.

## 3. Event tail

- Keep an `offset` per session; each read goes from `offset` to end of file and processes only lines terminated by `\n`, keeping the remainder for next time (the log may be partially written; the kernel has `sealTornTail`).
- `seq` is used for de-duplication. On an unknown `v`, return the raw line rather than dropping it.
- Envelope: `{v, seq, event, timestamp, execution_id, stage_id, summary, data}`.

## 4. `statusReader`

`status.json` is written atomically so reads are complete. On a parse error (seen during a rename on Windows), retry after 100ms, up to 3 times, then mark Unknown.

## Done when

- The whole state table in section 1 has tests.
- `eventTail` handles the partial-line case.
- Question parsers, mixed-state attention, batch identity/fingerprinting and answer-map serialization have fixtures/tests, including separate workflow/manifest/question schema versions.
- Next-file version 1, frozen source suggestions, malformed/tampered metadata, child lineage, bound provenance and legacy context have reader fixtures. Workflow version 4 does not imply a new manifest version. Details and integration tests are in phase 3b.
- No file in `core/` imports `vscode`.
